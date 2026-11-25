import { LLMServiceConfig } from '../types';
import { proxyFetch } from './proxyFetch';
import { aiTaskQueue } from './aiTaskQueue';

export interface ChatTurnMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Tests connection to an LLM service (Ollama, LM Studio, or OpenAI-compatible)
 * and discovers all available models.
 */
export async function testLlmService(
  service: LLMServiceConfig
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const cleanBase = service.baseUrl.replace(/\/+$/, '');

  try {
    if (service.type === 'ollama') {
      const res = await proxyFetch(`${cleanBase}/api/tags`, { method: 'GET' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      const models: string[] = Array.isArray(data?.models)
        ? data.models.map((m: any) => m.name || m.model).filter(Boolean)
        : [];
      return { ok: true, models };
    } else {
      // LM Studio or OpenAI-compatible (/v1/models)
      const modelsUrl = cleanBase.endsWith('/v1')
        ? `${cleanBase}/models`
        : `${cleanBase}/v1/models`;
      const headers: Record<string, string> = {};
      if (service.apiKey) {
        headers['Authorization'] = `Bearer ${service.apiKey}`;
      }
      const res = await proxyFetch(modelsUrl, { method: 'GET', headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      const models: string[] = Array.isArray(data?.data)
        ? data.data.map((m: any) => m.id).filter(Boolean)
        : [];
      return { ok: true, models };
    }
  } catch (err: any) {
    return {
      ok: false,
      models: [],
      error: err?.message || 'Unable to reach LLM endpoint',
    };
  }
}

/**
 * Ensures `role: 'system'` only appears at index 0 (`loop.first`) so strict Jinja chat templates
 * in Ollama / LM Studio (Qwen3, Gemma, Llama-3.1+, Mistral) never throw:
 * `Error: Jinja Exception: System message must be at the beginning.`
 */
function sanitizeMessagesForJinja(
  messages: ChatTurnMessage[]
): ChatTurnMessage[] {
  const systemContents: string[] = [];
  const conversationTurns: ChatTurnMessage[] = [];

  for (const m of messages) {
    if (!m.content || !m.content.trim()) continue;
    if (m.role === 'system') {
      systemContents.push(m.content.trim());
    } else {
      conversationTurns.push(m);
    }
  }

  // Ensure at least one user turn exists if only system/assistant turns were present (e.g. Swiping on opening greeting)
  if (
    conversationTurns.length === 0 ||
    !conversationTurns.some((t) => t.role === 'user')
  ) {
    conversationTurns.unshift({
      role: 'user',
      content: '[Begin or continue the role-play scene in character.]',
    });
  }

  if (systemContents.length > 0) {
    return [
      { role: 'system', content: systemContents.join('\n\n') },
      ...conversationTurns,
    ];
  }
  return conversationTurns;
}

/**
 * Streams or completes a chat request against the configured LLM service.
 */
export async function generateChatCompletion(
  service: LLMServiceConfig,
  rawMessages: ChatTurnMessage[],
  options: {
    onToken?: (token: string, fullText: string) => void;
    stopSequences?: string[];
    jsonMode?: boolean;
    temperature?: number;
    disableThinking?: boolean;
    maxTokensOverride?: number;
    taskLabel?: string;
  } = {}
): Promise<string> {
  const messages = sanitizeMessagesForJinja(rawMessages);
  const cleanBase = service.baseUrl.replace(/\/+$/, '');
  const model = service.defaultModel || service.availableModels[0];
  if (!model) {
    throw new Error(
      `No model selected for service "${service.name}". Please test the connection and select a model in Service Hub.`
    );
  }

  const kind = options.onToken ? 'llm-chat' : 'llm-helper';
  const label =
    options.taskLabel ||
    (options.onToken ? `Role-Play Reply (${model})` : `AI Helper (${model})`);

  return aiTaskQueue.enqueue(kind, label, async (updateDetail) => {
    updateDetail('Generating text...');
    const temperature = options.temperature ?? service.temperature ?? 0.8;
    const repetitionPenalty = service.repetitionPenalty ?? 1.1;
    const topP = service.topP ?? 0.9;
    const topK = service.topK ?? 30;
    const maxPredict = options.maxTokensOverride ?? service.maxTokens ?? 1024;
    const isAutoContext = service.contextSizeAuto ?? false;

    if (service.type === 'ollama') {
      const isThinkingModel = /qwen3|qwq|deepseek-r1|r1/i.test(model);
      const shouldDisableThink =
        options.disableThinking !== undefined
          ? options.disableThinking
          : service.enableThinking === true
          ? false
          : isThinkingModel;

      // Estimate prompt token count (CJK-aware) so num_ctx never runs out of generation headroom
      const estimatedPromptTokens = messages.reduce((sum, m) => {
        const text = m.content || '';
        const cjkCount = (
          text.match(/[\u3000-\u9fff\uff00-\uffef\uac00-\ud7af]/g) || []
        ).length;
        const otherCount = Math.max(0, text.length - cjkCount);
        return sum + Math.ceil(cjkCount * 0.95 + otherCount * 0.32) + 8;
      }, 0);

      const configuredCtx = service.contextLength || 8192;
      const requiredCtx =
        estimatedPromptTokens + Math.min(maxPredict, 2048) + 512;
      // Snap num_ctx to fixed 4K buckets when growing past configuredCtx so Ollama
      // keeps its KV cache warm across turns instead of reallocating every turn.
      const effectiveNumCtx =
        requiredCtx <= configuredCtx
          ? configuredCtx
          : Math.min(32768, Math.ceil(requiredCtx / 4096) * 4096);

      const ollamaOptions: Record<string, any> = {
        temperature,
        repeat_penalty: repetitionPenalty,
        top_p: topP,
        top_k: topK,
        num_predict: maxPredict,
        ...(service.minP !== undefined ? { min_p: service.minP } : {}),
        ...(service.presencePenalty !== undefined
          ? { presence_penalty: service.presencePenalty }
          : {}),
        ...(service.frequencyPenalty !== undefined
          ? { frequency_penalty: service.frequencyPenalty }
          : {}),
        ...(!isAutoContext || requiredCtx > configuredCtx
          ? { num_ctx: effectiveNumCtx }
          : {}),
        ...(options.stopSequences?.length
          ? { stop: options.stopSequences }
          : {}),
      };

      const body: Record<string, any> = {
        model,
        messages,
        // Always stream from Ollama so HTTP headers arrive immediately during cold model reloads
        stream: true,
        ...(shouldDisableThink ? { think: false } : {}),
        options: ollamaOptions,
      };
      if (options.jsonMode) {
        body.format = 'json';
      }

      let res = await proxyFetch(`${cleanBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 502) {
        await new Promise((r) => setTimeout(r, 400));
        res = await proxyFetch(`${cleanBase}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        throw new Error(`Ollama Error (${res.status}): ${await res.text()}`);
      }

      if (!res.body) {
        const data = await res.json();
        return data?.message?.content || '';
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let thinkingText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            const thinkChunk = parsed?.message?.thinking || '';
            const contentChunk = parsed?.message?.content || '';
            if (thinkChunk) {
              thinkingText += thinkChunk;
            }
            if (contentChunk) {
              fullText += contentChunk;
              updateDetail(`Streaming (${fullText.length} chars)...`);
              options.onToken?.(contentChunk, fullText);
            } else if (thinkChunk && !fullText) {
              options.onToken?.('', `<think>${thinkingText}</think>`);
            }
          } catch {
            // ignore partial JSON line
          }
        }
      }
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          const contentChunk = parsed?.message?.content || '';
          if (contentChunk) {
            fullText += contentChunk;
            options.onToken?.(contentChunk, fullText);
          }
        } catch {
          // ignore
        }
      }

      // Clean any <think>...</think> wrapper if it consumed the output
      const stripped = fullText
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*/i, '')
        .trim();

      if (stripped) {
        return stripped;
      }

      // If the model still only produced thinking tokens without content, retry once with explicit /no_think non-streaming
      const retryRes = await proxyFetch(`${cleanBase}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: messages.map((m, i) =>
            i === 0 && m.role === 'system'
              ? { ...m, content: `/no_think\n${m.content}` }
              : m
          ),
          stream: false,
          think: false,
          options: ollamaOptions,
        }),
      });
      if (retryRes.ok) {
        const retryData = await retryRes.json();
        const retryContent = (retryData?.message?.content || '')
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .trim();
        if (retryContent) return retryContent;
      }

      return fullText.trim();
    } else {
      // LM Studio / OpenAI-compatible (/v1/chat/completions)
      const chatUrl = cleanBase.endsWith('/v1')
        ? `${cleanBase}/chat/completions`
        : `${cleanBase}/v1/chat/completions`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (service.apiKey) {
        headers['Authorization'] = `Bearer ${service.apiKey}`;
      }

      const body: Record<string, any> = {
        model,
        messages,
        temperature,
        top_p: topP,
        top_k: topK,
        repetition_penalty: repetitionPenalty,
        max_tokens: maxPredict,
        ...(service.presencePenalty !== undefined
          ? { presence_penalty: service.presencePenalty }
          : {}),
        ...(service.frequencyPenalty !== undefined
          ? { frequency_penalty: service.frequencyPenalty }
          : {}),
        stream: Boolean(options.onToken),
      };
      if (options.stopSequences?.length) {
        body.stop = options.stopSequences;
      }
      if (options.jsonMode) {
        body.response_format = { type: 'json_object' };
      }

      const res = await proxyFetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error(`LLM API Error (${res.status}): ${await res.text()}`);
      }

      if (!options.onToken || !res.body) {
        const data = await res.json();
        return data?.choices?.[0]?.message?.content || '';
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') break;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              updateDetail(`Streaming (${fullText.length} chars)...`);
              options.onToken(delta, fullText);
            }
          } catch {
            // ignore malformed SSE chunk
          }
        }
      }
      return fullText;
    }
  });
}

/**
 * Unloads the active Ollama model from VRAM (keep_alive: 0) before running heavy ComfyUI workflows
 * to prevent single-GPU Out-Of-Memory (RISK-002).
 */
export async function unloadOllamaModel(service: LLMServiceConfig): Promise<void> {
  if (service.type !== 'ollama' || !service.defaultModel) return;
  const cleanBase = service.baseUrl.replace(/\/+$/, '');
  try {
    await proxyFetch(`${cleanBase}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: service.defaultModel,
        keep_alive: 0,
      }),
    });
  } catch {
    // Non-fatal if Ollama is already idle
  }
}
