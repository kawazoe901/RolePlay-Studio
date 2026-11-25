import {
  CharacterCardV2,
  CharacterGender,
  ConversationLanguage,
  TTSProviderType,
  TTSReadingMode,
  TTSServiceConfig,
} from '../types';
import { DEFAULT_TTS_SERVICE } from './defaultData';
import { aiTaskQueue } from './aiTaskQueue';
import { proxyFetch } from './proxyFetch';
import { parseMessageStatusBlocks } from '../utils/statusTracker';

export interface VoicePresetOption {
  id: string;
  label: string;
  lang: 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko';
  gender: CharacterGender;
  provider: 'edge-tts' | 'openai-compatible';
  badge: string;
}

export const EDGE_TTS_VOICE_OPTIONS: VoicePresetOption[] = [
  // Chinese (Mainland & Taiwan/HK)
  {
    id: 'zh-CN-XiaoxiaoNeural',
    label: 'Xiaoxiao · 晓晓 (Warm & Expressive Female)',
    lang: 'zh-CN',
    gender: 'female',
    provider: 'edge-tts',
    badge: 'zh-CN · Female',
  },
  {
    id: 'zh-CN-XiaoyiNeural',
    label: 'Xiaoyi · 晓伊 (Lively & Youthful Female)',
    lang: 'zh-CN',
    gender: 'female',
    provider: 'edge-tts',
    badge: 'zh-CN · Female',
  },
  {
    id: 'zh-CN-XiaohanNeural',
    label: 'Xiaohan · 晓涵 (Gentle & Mature Female)',
    lang: 'zh-CN',
    gender: 'female',
    provider: 'edge-tts',
    badge: 'zh-CN · Female',
  },
  {
    id: 'zh-CN-XiaomengNeural',
    label: 'Xiaomeng · 晓梦 (Soft & Dreamy Female)',
    lang: 'zh-CN',
    gender: 'female',
    provider: 'edge-tts',
    badge: 'zh-CN · Female',
  },
  {
    id: 'zh-CN-YunxiNeural',
    label: 'Yunxi · 云希 (Clear Youthful Male)',
    lang: 'zh-CN',
    gender: 'male',
    provider: 'edge-tts',
    badge: 'zh-CN · Male',
  },
  {
    id: 'zh-CN-YunjianNeural',
    label: 'Yunjian · 云健 (Deep & Steady Male)',
    lang: 'zh-CN',
    gender: 'male',
    provider: 'edge-tts',
    badge: 'zh-CN · Male',
  },
  {
    id: 'zh-CN-YunxiaNeural',
    label: 'Yunxia · 云夏 (Energetic Young Male)',
    lang: 'zh-CN',
    gender: 'male',
    provider: 'edge-tts',
    badge: 'zh-CN · Male',
  },
  {
    id: 'zh-TW-HsiaoChenNeural',
    label: 'HsiaoChen · 曉臻 (Soft Taiwanese Female)',
    lang: 'zh-TW',
    gender: 'female',
    provider: 'edge-tts',
    badge: 'zh-TW · Female',
  },
  {
    id: 'zh-TW-YunJheNeural',
    label: 'YunJhe · 雲哲 (Gentle Taiwanese Male)',
    lang: 'zh-TW',
    gender: 'male',
    provider: 'edge-tts',
    badge: 'zh-TW · Male',
  },

  // English
  {
    id: 'en-US-AvaMultilingualNeural',
    label: 'Ava Multilingual (Natural Expressive Female)',
    lang: 'en',
    gender: 'female',
    provider: 'edge-tts',
    badge: 'en-US · Female',
  },
  {
    id: 'en-US-AriaNeural',
    label: 'Aria (Warm Conversational Female)',
    lang: 'en',
    gender: 'female',
    provider: 'edge-tts',
    badge: 'en-US · Female',
  },
  {
    id: 'en-US-JennyNeural',
    label: 'Jenny (Clear Friendly Female)',
    lang: 'en',
    gender: 'female',
    provider: 'edge-tts',
    badge: 'en-US · Female',
  },
  {
    id: 'en-GB-SoniaNeural',
    label: 'Sonia (Poised British Female)',
    lang: 'en',
    gender: 'female',
    provider: 'edge-tts',
    badge: 'en-GB · Female',
  },
  {
    id: 'en-US-AndrewMultilingualNeural',
    label: 'Andrew Multilingual (Warm Natural Male)',
    lang: 'en',
    gender: 'male',
    provider: 'edge-tts',
    badge: 'en-US · Male',
  },
  {
    id: 'en-US-GuyNeural',
    label: 'Guy (Dynamic Male)',
    lang: 'en',
    gender: 'male',
    provider: 'edge-tts',
    badge: 'en-US · Male',
  },
  {
    id: 'en-GB-RyanNeural',
    label: 'Ryan (British Male)',
    lang: 'en',
    gender: 'male',
    provider: 'edge-tts',
    badge: 'en-GB · Male',
  },

  // Japanese
  {
    id: 'ja-JP-NanamiNeural',
    label: 'Nanami · 七海 (Expressive Anime Female)',
    lang: 'ja',
    gender: 'female',
    provider: 'edge-tts',
    badge: 'ja-JP · Female',
  },
  {
    id: 'ja-JP-KeitaNeural',
    label: 'Keita · 圭太 (Natural Japanese Male)',
    lang: 'ja',
    gender: 'male',
    provider: 'edge-tts',
    badge: 'ja-JP · Male',
  },

  // Korean
  {
    id: 'ko-KR-SunHiNeural',
    label: 'SunHi · 선희 (Bright Korean Female)',
    lang: 'ko',
    gender: 'female',
    provider: 'edge-tts',
    badge: 'ko-KR · Female',
  },
  {
    id: 'ko-KR-InJoonNeural',
    label: 'InJoon · 인준 (Steady Korean Male)',
    lang: 'ko',
    gender: 'male',
    provider: 'edge-tts',
    badge: 'ko-KR · Male',
  },
];

export const KOKORO_OPENAI_VOICE_OPTIONS: VoicePresetOption[] = [
  {
    id: 'af_heart',
    label: 'af_heart (Kokoro English Expressive Female)',
    lang: 'en',
    gender: 'female',
    provider: 'openai-compatible',
    badge: 'Kokoro · EN Female',
  },
  {
    id: 'af_bella',
    label: 'af_bella (Kokoro English Soft Female)',
    lang: 'en',
    gender: 'female',
    provider: 'openai-compatible',
    badge: 'Kokoro · EN Female',
  },
  {
    id: 'am_adam',
    label: 'am_adam (Kokoro English Deep Male)',
    lang: 'en',
    gender: 'male',
    provider: 'openai-compatible',
    badge: 'Kokoro · EN Male',
  },
  {
    id: 'zf_xiaoxiao',
    label: 'zf_xiaoxiao (Kokoro Chinese Female)',
    lang: 'zh-CN',
    gender: 'female',
    provider: 'openai-compatible',
    badge: 'Kokoro · ZH Female',
  },
  {
    id: 'zf_xiaoyi',
    label: 'zf_xiaoyi (Kokoro Chinese Lively Female)',
    lang: 'zh-CN',
    gender: 'female',
    provider: 'openai-compatible',
    badge: 'Kokoro · ZH Female',
  },
  {
    id: 'zm_yunxi',
    label: 'zm_yunxi (Kokoro Chinese Male)',
    lang: 'zh-CN',
    gender: 'male',
    provider: 'openai-compatible',
    badge: 'Kokoro · ZH Male',
  },
  {
    id: 'jf_alpha',
    label: 'jf_alpha (Kokoro Japanese Female)',
    lang: 'ja',
    gender: 'female',
    provider: 'openai-compatible',
    badge: 'Kokoro · JA Female',
  },
  {
    id: 'alloy',
    label: 'alloy (OpenAI Standard Neutral)',
    lang: 'en',
    gender: 'female',
    provider: 'openai-compatible',
    badge: 'OpenAI · Neutral',
  },
  {
    id: 'nova',
    label: 'nova (OpenAI Warm Female)',
    lang: 'en',
    gender: 'female',
    provider: 'openai-compatible',
    badge: 'OpenAI · Female',
  },
  {
    id: 'onyx',
    label: 'onyx (OpenAI Deep Male)',
    lang: 'en',
    gender: 'male',
    provider: 'openai-compatible',
    badge: 'OpenAI · Male',
  },
];

/**
 * Detects dominant script/language of a text snippet ('zh' | 'ja' | 'ko' | 'en').
 */
export function detectTextLanguage(
  text: string,
  hint?: ConversationLanguage
): 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'en' {
  if (hint && hint !== 'auto') {
    return hint;
  }
  const jaRegex = /[\u3040-\u309f\u30a0-\u30ff]/;
  const koRegex = /[\uac00-\ud7af\u1100-\u11ff]/;
  const zhRegex = /[\u4e00-\u9fff]/;

  if (jaRegex.test(text)) return 'ja';
  if (koRegex.test(text)) return 'ko';
  if (zhRegex.test(text)) return 'zh-CN';
  return 'en';
}

const CN_SINGLE_LETTER_MAP: Record<string, string> = {
  A: '诶',
  B: '比',
  C: '西',
  D: '迪',
  E: '伊',
  F: '艾弗',
  G: '吉',
  H: '艾尺',
  I: '艾',
  J: '杰',
  K: '凯',
  L: '艾勒',
  M: '艾姆',
  N: '恩',
  O: '欧',
  P: '皮',
  Q: '丘',
  R: '阿',
  S: '艾斯',
  T: '梯',
  U: '优',
  V: '微',
  W: '达布溜',
  X: '艾克斯',
  Y: '歪',
  Z: '泽',
};

function replaceIsolatedLatinInChinese(text: string): string {
  return text
    .replace(/[Vv]\s*字?\s*手势/g, '剪刀手')
    .replace(/[Vv]\s*领/g, '微领')
    .replace(/[Tt]\s*恤/g, '体恤')
    .replace(/\b[Oo][Kk]\b/g, '好的')
    .replace(
      /(^|[\u4e00-\u9fff，。！？；：、\s])([A-Za-z])(?=[\u4e00-\u9fff，。！？；：、\s]|$)/g,
      (_, prefix: string, letter: string) =>
        `${prefix}${CN_SINGLE_LETTER_MAP[letter.toUpperCase()] || ''}`
    );
}

function balanceChineseRhythm(text: string): string {
  const parts = text
    .split(/(?<=[，。！？；：])/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return text;

  const clauses: Array<{ body: string; endSent: boolean }> = [];
  let cBuf = '';

  for (const p of parts) {
    const body = p.replace(/[，。！？；：]+$/g, '');
    const punc = (p.match(/[，。！？；：]$/) || ['，'])[0];
    if (!body) continue;
    const cand = cBuf ? cBuf + body : body;
    if (cand.length < 9) {
      cBuf = cand;
      continue;
    }
    clauses.push({
      body: cand,
      endSent: punc === '。' || punc === '！' || punc === '？',
    });
    cBuf = '';
  }

  if (cBuf) {
    if (clauses.length > 0) {
      clauses[clauses.length - 1].body += cBuf;
      clauses[clauses.length - 1].endSent = true;
    } else {
      clauses.push({ body: cBuf, endSent: true });
    }
  }

  const out: string[] = [];
  let sentLen = 0;
  for (let i = 0; i < clauses.length; i++) {
    const cl = clauses[i];
    sentLen += cl.body.length;
    const isLast = i === clauses.length - 1;
    if (isLast || sentLen >= 30 || (cl.endSent && sentLen >= 18)) {
      out.push(`${cl.body}。`);
      sentLen = 0;
    } else {
      out.push(`${cl.body}，`);
    }
  }

  return out.join('');
}

/**
 * Normalizes RP punctuation (ellipses, em-dashes, tildes, stray spaces) and ensures
 * script-appropriate ending punctuation so TTS engines (especially GPT-SoVITS on Chinese)
 * do not stall, speed up on 90-char run-on sentences, or drag into slow-motion on short stutters.
 */
function normalizeTtsClause(raw: string): string {
  const base = raw
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base || !/[\p{L}\p{N}]/u.test(base)) return '';

  const hasCjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(base);
  const isChinese =
    /[\u4e00-\u9fff]/.test(base) && !/[\u3040-\u30ff\uac00-\ud7af]/.test(base);
  const comma = hasCjk ? '，' : ', ';
  const period = hasCjk ? '。' : '.';

  let text = base;
  if (hasCjk) {
    // Collapse short 1-4 char CJK stutters across ellipses (e.g. "坐...坐在", "摄影师... 哥哥...")
    text = text.replace(
      /([\u4e00-\u9fff]{1,4})\s*(?:\u2026+|…+|\.{2,})\s*(?=[\u4e00-\u9fff])/g,
      '$1'
    );
  }

  text = text
    .replace(/\u2026+|…+|\.{2,}/g, comma)
    .replace(/[—–\u2015\u2500]+|--+/g, comma)
    .replace(/[~～_#`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,，])\s*([,，.。!！?？:：;；])/g, '$2')
    .replace(/([.!?。！？])\s*[,，]+/g, '$1')
    .replace(/[,，]\s*[,，]+/g, hasCjk ? '，' : ',')
    .trim();

  if (hasCjk) {
    text = text
      .replace(/\s*([，。！？；：、])\s*/g, '$1')
      .replace(/\s+(?=[\u4e00-\u9fff])/g, '')
      .trim();
  }

  if (isChinese) {
    text = replaceIsolatedLatinInChinese(text);
    text = balanceChineseRhythm(text);
  }

  if (!text || !/[\p{L}\p{N}]/u.test(text)) return '';

  text = text.replace(/[,，]+$/, '').trim();
  if (!text) return '';
  if (!/[.!?。！？]$/.test(text)) {
    text = `${text}${period}`;
  }
  return text;
}

function joinTtsSegments(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const endsCjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af，。！？；：、]$/.test(a);
  const startsCjk = /^[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(b);
  return endsCjk && startsCjk ? `${a}${b}` : `${a} ${b}`;
}

/**
 * Extracts speakable text from a role-play message according to `readingMode`:
 * - Always removes `<think>...</think>`, `<status_bar>...</status_bar>`, and code blocks.
 * - `'dialogue_only'`: Extracts spoken lines inside `"..."`, `“...”`, `「...」`, `『...』`.
 *   Falls back to non-asterisk text if no quotes exist in the message.
 * - `'full_text'`: Reads both narration and dialogue with markdown formatting removed.
 */
export function extractSpeakableText(
  rawText: string,
  mode: TTSReadingMode = 'dialogue_only'
): string {
  if (!rawText) return '';

  // 1. Strip <think> blocks and <status_bar> / <UpdateVariable> blocks
  let cleaned = parseMessageStatusBlocks(rawText)
    .cleanNarrativeText.replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();

  if (!cleaned) return '';

  if (mode === 'dialogue_only') {
    const spokenSegments: string[] = [];
    // Match straight quotes "...", curly quotes “...”, and CJK quotes 「...」 / 『...』
    const quotePattern =
      /"([^"\n]{1,600})"|“([^”\n]{1,600})”|「([^」\n]{1,600})」|『([^』\n]{1,600})』/g;
    let match: RegExpExecArray | null;
    while ((match = quotePattern.exec(cleaned)) !== null) {
      const normalized = normalizeTtsClause(
        match[1] || match[2] || match[3] || match[4] || ''
      );
      if (normalized) {
        spokenSegments.push(normalized);
      }
    }

    if (spokenSegments.length > 0) {
      return spokenSegments.reduce((acc, seg) => joinTtsSegments(acc, seg), '');
    }

    // Fallback if message has no quotation marks: strip *action* blocks
    const withoutActions = normalizeTtsClause(
      cleaned.replace(/\*[^*]+\*/g, ' ')
    );
    if (withoutActions) {
      return withoutActions;
    }
  }

  // Full text mode (or fallback if entire message was inside asterisks)
  const boundaryNormalized = cleaned
    .replace(/\*+/g, '')
    .replace(/(?<![.!?。！？,，:：;\s])\s*(?=[""“「『])/g, ', ')
    .replace(/[""“”「」『』]/g, ' ');
  return normalizeTtsClause(boundaryNormalized);
}

/**
 * Resolves the effective provider, voiceId, speed, pitch, and GPT-SoVITS reference settings
 * for a given character and text snippet.
 */
export function resolveVoiceSettings(params: {
  ttsConfig?: TTSServiceConfig;
  character?: CharacterCardV2;
  text: string;
  languageHint?: ConversationLanguage;
}): {
  provider: TTSProviderType;
  voiceId: string;
  speed: number;
  pitch: number;
  refAudioPath: string;
  refPromptText: string;
  refPromptLang: string;
  detectedLang: 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'en';
} {
  const cfg = { ...DEFAULT_TTS_SERVICE, ...(params.ttsConfig || {}) };
  const charVoice = params.character?.voiceConfig;
  const provider: TTSProviderType = charVoice?.provider || cfg.provider || 'edge-tts';
  const speed = charVoice?.speed ?? cfg.speed ?? 1.0;
  const pitch = charVoice?.pitch ?? cfg.pitch ?? 0;
  const detectedLang = detectTextLanguage(
    params.text,
    params.character?.defaultLanguage || params.languageHint
  );
  const gender: CharacterGender = params.character?.gender || 'female';

  let voiceId = (charVoice?.voiceId || cfg.defaultVoiceId || 'auto').trim();

  if (provider === 'edge-tts') {
    const isEdgeVoice = /^[a-z]{2}-[A-Z]{2}-.+Neural$/i.test(voiceId);
    if (!voiceId || voiceId === 'auto' || !isEdgeVoice) {
      if (detectedLang === 'zh-CN') {
        voiceId =
          gender === 'male' ? 'zh-CN-YunxiNeural' : 'zh-CN-XiaoxiaoNeural';
      } else if (detectedLang === 'zh-TW') {
        voiceId =
          gender === 'male' ? 'zh-TW-YunJheNeural' : 'zh-TW-HsiaoChenNeural';
      } else if (detectedLang === 'ja') {
        voiceId = gender === 'male' ? 'ja-JP-KeitaNeural' : 'ja-JP-NanamiNeural';
      } else if (detectedLang === 'ko') {
        voiceId = gender === 'male' ? 'ko-KR-InJoonNeural' : 'ko-KR-SunHiNeural';
      } else {
        voiceId =
          gender === 'male'
            ? 'en-US-AndrewMultilingualNeural'
            : 'en-US-AvaMultilingualNeural';
      }
    } else {
      // If character has no explicit voiceId override and workspace default voice language doesn't match CJK/EN script, adapt automatically
      if (!charVoice?.voiceId) {
        const voiceLangPrefix = voiceId.slice(0, 2).toLowerCase();
        if (detectedLang.startsWith('zh') && voiceLangPrefix !== 'zh') {
          voiceId =
            gender === 'male' ? 'zh-CN-YunxiNeural' : 'zh-CN-XiaoxiaoNeural';
        } else if (detectedLang === 'ja' && voiceLangPrefix !== 'ja') {
          voiceId =
            gender === 'male' ? 'ja-JP-KeitaNeural' : 'ja-JP-NanamiNeural';
        } else if (detectedLang === 'ko' && voiceLangPrefix !== 'ko') {
          voiceId =
            gender === 'male' ? 'ko-KR-InJoonNeural' : 'ko-KR-SunHiNeural';
        }
      }
    }
  } else if (provider === 'openai-compatible') {
    if (!voiceId || voiceId === 'auto') {
      if (detectedLang.startsWith('zh')) {
        voiceId = gender === 'male' ? 'zm_yunxi' : 'zf_xiaoxiao';
      } else if (detectedLang === 'ja') {
        voiceId = 'jf_alpha';
      } else {
        voiceId = gender === 'male' ? 'am_adam' : 'af_heart';
      }
    }
  }

  const DEFAULT_ZH_REF_WAV = 'I:\\GPT-SoVITS\\voices\\default_ref_zh.wav';
  const DEFAULT_ZH_MALE_REF_WAV =
    'I:\\GPT-SoVITS\\voices\\default_ref_male_zh.wav';
  const DEFAULT_ZH_PROMPT_TEXT =
    '你好，欢迎来到角色扮演工作室，今天你想聊些什么呢？';
  const DEFAULT_EN_REF_WAV = 'I:\\GPT-SoVITS\\voices\\default_ref_en.wav';
  const DEFAULT_EN_MALE_REF_WAV =
    'I:\\GPT-SoVITS\\voices\\default_ref_male_en.wav';
  const DEFAULT_EN_PROMPT_TEXT =
    'Hello, welcome to RolePlay Studio. What kind of story would you like to explore today?';

  const hasCustomCharRef = Boolean(charVoice?.refAudioPath?.trim());
  let rawRefAudioPath = hasCustomCharRef
    ? charVoice!.refAudioPath!.trim()
    : (cfg.gptSovitsRefAudioPath || DEFAULT_ZH_REF_WAV).trim();

  let normRefPath = rawRefAudioPath.replace(/\//g, '\\').toLowerCase();
  if (!hasCustomCharRef && gender === 'male') {
    if (normRefPath.endsWith('default_ref_zh.wav')) {
      rawRefAudioPath = DEFAULT_ZH_MALE_REF_WAV;
      normRefPath = rawRefAudioPath.toLowerCase();
    } else if (normRefPath.endsWith('default_ref_en.wav')) {
      rawRefAudioPath = DEFAULT_EN_MALE_REF_WAV;
      normRefPath = rawRefAudioPath.toLowerCase();
    }
  }

  const isDefaultZhWav =
    normRefPath.endsWith('default_ref_zh.wav') ||
    normRefPath.endsWith('default_ref_male_zh.wav');
  const isDefaultEnWav =
    normRefPath.endsWith('default_ref_en.wav') ||
    normRefPath.endsWith('default_ref_male_en.wav');

  let resolvedPromptText = hasCustomCharRef
    ? (charVoice?.refPromptText ?? '').trim()
    : (cfg.gptSovitsPromptText ?? '').trim();

  let resolvedPromptLang = hasCustomCharRef
    ? charVoice?.refPromptLang || cfg.gptSovitsPromptLang || 'zh'
    : cfg.gptSovitsPromptLang || 'zh';

  if (isDefaultZhWav) {
    if (!resolvedPromptText || resolvedPromptText === DEFAULT_EN_PROMPT_TEXT) {
      resolvedPromptText = DEFAULT_ZH_PROMPT_TEXT;
    }
    resolvedPromptLang = 'zh';
  } else if (isDefaultEnWav) {
    if (!resolvedPromptText || resolvedPromptText === DEFAULT_ZH_PROMPT_TEXT) {
      resolvedPromptText = DEFAULT_EN_PROMPT_TEXT;
    }
    resolvedPromptLang = 'en';
  } else {
    // Custom user WAV: never send the built-in default_ref_zh / default_ref_en transcript,
    // because mismatched prompt_text causes GPT-SoVITS to output gibberish.
    // Leaving prompt_text empty ("") activates GPT-SoVITS v2 Reference-Text-Free Mode.
    if (
      resolvedPromptText === DEFAULT_ZH_PROMPT_TEXT ||
      resolvedPromptText === DEFAULT_EN_PROMPT_TEXT
    ) {
      resolvedPromptText = '';
    }
  }

  return {
    provider,
    voiceId,
    speed,
    pitch,
    refAudioPath: rawRefAudioPath,
    refPromptText: resolvedPromptText,
    refPromptLang: resolvedPromptLang,
    detectedLang,
  };
}

export interface MultiSpeakerTtsSegment {
  text: string;
  voiceId: string;
  speed: number;
  pitch: number;
  isNpc: boolean;
  speakerLabel: string;
  detectedLang: 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'en';
  refAudioPath?: string;
  refPromptText?: string;
  refPromptLang?: string;
}

function resolveSecondaryNpcVoice(params: {
  provider: TTSProviderType;
  npcGender: CharacterGender;
  detectedLang: 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'en';
  mainVoiceId: string;
  baseSpeed: number;
  basePitch: number;
}): {
  voiceId: string;
  speed: number;
  pitch: number;
  refAudioPath: string;
  refPromptText: string;
  refPromptLang: string;
} {
  const { provider, npcGender, detectedLang, mainVoiceId, baseSpeed, basePitch } =
    params;

  const isEn = detectedLang === 'en';
  const npcRefAudioPath =
    npcGender === 'male'
      ? isEn
        ? 'I:\\GPT-SoVITS\\voices\\default_ref_male_en.wav'
        : 'I:\\GPT-SoVITS\\voices\\default_ref_male_zh.wav'
      : isEn
      ? 'I:\\GPT-SoVITS\\voices\\default_ref_en.wav'
      : 'I:\\GPT-SoVITS\\voices\\default_ref_zh.wav';
  const npcRefPromptText = isEn
    ? 'Hello, welcome to RolePlay Studio. What kind of story would you like to explore today?'
    : '你好，欢迎来到角色扮演工作室，今天你想聊些什么呢？';
  const npcRefPromptLang = isEn ? 'en' : 'zh';

  if (provider === 'openai-compatible') {
    let voiceId = 'am_adam';
    if (detectedLang.startsWith('zh')) {
      voiceId =
        npcGender === 'male'
          ? 'zm_yunxi'
          : mainVoiceId === 'zf_xiaoxiao'
          ? 'zf_xiaoyi'
          : 'zf_xiaoxiao';
    } else if (detectedLang === 'ja') {
      voiceId = 'jf_alpha';
    } else {
      voiceId =
        npcGender === 'male'
          ? mainVoiceId === 'am_adam'
            ? 'onyx'
            : 'am_adam'
          : mainVoiceId === 'af_heart'
          ? 'af_bella'
          : 'af_heart';
    }
    return {
      voiceId,
      speed: Math.max(0.6, Math.min(1.5, baseSpeed * 0.96)),
      pitch: npcGender === 'male' ? basePitch - 4 : basePitch + 3,
      refAudioPath: npcRefAudioPath,
      refPromptText: npcRefPromptText,
      refPromptLang: npcRefPromptLang,
    };
  }

  // Default Edge / 0-VRAM voice pool
  let voiceId = 'en-US-AndrewMultilingualNeural';
  if (detectedLang === 'zh-CN') {
    if (npcGender === 'male') {
      voiceId =
        mainVoiceId === 'zh-CN-YunxiNeural'
          ? 'zh-CN-YunjianNeural'
          : 'zh-CN-YunxiNeural';
    } else {
      voiceId =
        mainVoiceId === 'zh-CN-XiaoxiaoNeural'
          ? 'zh-CN-XiaohanNeural'
          : 'zh-CN-XiaoxiaoNeural';
    }
  } else if (detectedLang === 'zh-TW') {
    voiceId =
      npcGender === 'male' ? 'zh-TW-YunJheNeural' : 'zh-TW-HsiaoChenNeural';
  } else if (detectedLang === 'ja') {
    voiceId = npcGender === 'male' ? 'ja-JP-KeitaNeural' : 'ja-JP-NanamiNeural';
  } else if (detectedLang === 'ko') {
    voiceId = npcGender === 'male' ? 'ko-KR-InJoonNeural' : 'ko-KR-SunHiNeural';
  } else {
    if (npcGender === 'male') {
      voiceId =
        mainVoiceId === 'en-US-AndrewMultilingualNeural'
          ? 'en-US-GuyNeural'
          : 'en-US-AndrewMultilingualNeural';
    } else {
      voiceId =
        mainVoiceId === 'en-US-AvaMultilingualNeural'
          ? 'en-GB-SoniaNeural'
          : 'en-US-AvaMultilingualNeural';
    }
  }

  return {
    voiceId,
    speed: Math.max(0.6, Math.min(1.5, baseSpeed * 0.97)),
    pitch: npcGender === 'male' ? basePitch - 3 : basePitch + 3,
    refAudioPath: npcRefAudioPath,
    refPromptText: npcRefPromptText,
    refPromptLang: npcRefPromptLang,
  };
}

function classifyQuoteSpeaker(params: {
  beforeClause: string;
  afterClause: string;
  mainCharacter?: CharacterCardV2;
  allCharacters?: CharacterCardV2[];
}):
  | { kind: 'main' }
  | { kind: 'known-char'; character: CharacterCardV2 }
  | { kind: 'npc'; gender: CharacterGender } {
  const { beforeClause, afterClause, mainCharacter, allCharacters } = params;
  const mainGender: CharacterGender = mainCharacter?.gender || 'female';
  const mainName = (mainCharacter?.name || '').trim();
  const cleanBefore = beforeClause.replace(/\*+/g, ' ').trim();
  const cleanAfter = afterClause.replace(/\*+/g, ' ').trim();
  const combinedClause = `${cleanBefore} ${cleanAfter}`.trim();

  // 1. Check explicit dialogue prefix right before the quote (e.g., `Name:` or `[Name]:`)
  const prefixMatch = cleanBefore.match(
    /(?:^|[\n。！？.!?])\s*\[?([A-Za-z\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af][A-Za-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\s·_-]{0,18})\]?\s*[:：]\s*$/
  );
  if (prefixMatch) {
    const speakerTag = prefixMatch[1].trim();
    if (mainName && speakerTag.toLowerCase() === mainName.toLowerCase()) {
      return { kind: 'main' };
    }
    const knownByPrefix = (allCharacters || []).find(
      (c) =>
        c.id !== mainCharacter?.id &&
        c.name.trim().toLowerCase() === speakerTag.toLowerCase()
    );
    if (knownByPrefix) {
      return { kind: 'known-char', character: knownByPrefix };
    }
    const oppositeGender: CharacterGender =
      mainGender === 'male' ? 'female' : 'male';
    return { kind: 'npc', gender: oppositeGender };
  }

  // 2. If mainCharacter's name is explicitly the speaker right before/after the quote, keep 'main'
  if (mainName) {
    const escapedMain = mainName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mainSpeakingRegex = new RegExp(
      `${escapedMain}[^。！？.!?"“「『]{0,18}(?:说|问|答|道|低语|轻声|小声|开口|笑道|喊|叫|said|says|asked|asks|replied|whispered|murmured|called|sighed)`,
      'i'
    );
    if (mainSpeakingRegex.test(combinedClause)) {
      return { kind: 'main' };
    }
  }

  // 3. Check if another known Character Card in the workspace is named as the speaker in this local clause
  for (const otherChar of allCharacters || []) {
    if (!otherChar.name || otherChar.id === mainCharacter?.id) continue;
    const escaped = otherChar.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRegex = new RegExp(escaped, 'i');
    if (nameRegex.test(combinedClause)) {
      // Ensure it's not merely "to OtherChar" / "对OtherChar" while mainCharacter is speaking
      const addressedOnly = new RegExp(
        `(?:to|toward|towards|at|with|对|向|朝|冲|看|看着|望着|盯着|给|和|跟|同)${escaped}`,
        'i'
      ).test(combinedClause);
      if (!addressedOnly) {
        return { kind: 'known-char', character: otherChar };
      }
    }
  }

  // 4. General opposite-gender & external NPC attribution cues in local clause
  // Guard against matching object pronouns in narration like "她看着他笑道" or "扑进他怀里低语".
  const cnPronounObjPrefix =
    '(?<![对向朝着冲给替帮陪拉抱推吻在进把被跟和同离问看望盯的])';
  const maleSpeechCue = new RegExp(
    `\\b(?:he|his)\\s+(?:said|says|asked|asks|replied|replies|whispered|murmured|called|shouted|growled|laughed|added|continued|voice|tone)\\b|\\b(?:said|asked|replied|whispered|murmured|growled)\\s+he\\b|\\b(?:a\\s+man'?s\\s+voice|male\\s+voice|deep\\s+voice|boyfriend'?s\\s+voice|husband'?s\\s+voice|father'?s\\s+voice|boss'?s\\s+voice)\\b|(?:${cnPronounObjPrefix}他(?!的|身上|怀里|耳边|手里|面前|身边|眼前|脸上|眼中)|男人|男生|少年|男友|男朋友|老公|丈夫|父亲|爸爸|哥哥|弟弟|学长|上司|老板|大叔|男声|男人声音|低沉的声音|低沉的嗓音|粗犷的声音)[^，。！？"',]{0,10}(?:说|问|答|道|喊|叫|低语|嘟囔|咆哮|冷笑|笑道|开口|传来|响起|声音|嗓音)|(?:电话那头|听筒里|扩音器里|门外|身后)[^。！？"',]{0,14}(?:他|男人|男声|低沉|男友|男朋友|老公)`,
    'i'
  );

  const femaleSpeechCue = new RegExp(
    `\\b(?:she|her)\\s+(?:said|says|asked|asks|replied|replies|whispered|murmured|called|shouted|giggled|sighed|added|continued|voice|tone)\\b|\\b(?:said|asked|replied|whispered|murmured|sighed)\\s+she\\b|\\b(?:a\\s+woman'?s\\s+voice|female\\s+voice|girl'?s\\s+voice|girlfriend'?s\\s+voice|wife'?s\\s+voice|mother'?s\\s+voice|sister'?s\\s+voice)\\b|(?:${cnPronounObjPrefix}她(?!的|身上|怀里|耳边|手里|面前|身边|眼前|脸上|眼中)|女人|女生|少女|女友|女朋友|老婆|妻子|母亲|妈妈|姐姐|妹妹|学姐|学妹|女声|清脆的声音|娇柔的声音)[^，。！？"',]{0,10}(?:说|问|答|道|喊|叫|低语|嘟囔|娇嗔|轻笑|笑道|开口|传来|响起|声音|嗓音)|(?:电话那头|听筒里|扩音器里|门外|身后)[^。！？"',]{0,14}(?:她|女人|女声|少女|女友|女朋友|老婆)`,
    'i'
  );

  const ambientOrPhoneNpcCue =
    /\b(?:from the other end of the line|from the phone|through the speaker|through the receiver|from behind the door|the waiter|the waitress|the clerk|the bartender|the driver|the guard|the doctor|the nurse|another voice|a voice from)\b|(?:电话那头|听筒里|听筒那头|扬声器里|免提里|门外传来|走廊里传来|服务员|店员|司机|路人|护士|医生|保安|广播里)[^"\n]{0,16}(?:传来|响起|问道|说道|喊道|声音|说|问|道)/i;

  if (mainGender === 'female' && maleSpeechCue.test(combinedClause)) {
    return { kind: 'npc', gender: 'male' };
  }
  if (mainGender === 'male' && femaleSpeechCue.test(combinedClause)) {
    return { kind: 'npc', gender: 'female' };
  }
  if (ambientOrPhoneNpcCue.test(combinedClause)) {
    if (maleSpeechCue.test(combinedClause)) {
      return { kind: 'npc', gender: 'male' };
    }
    if (femaleSpeechCue.test(combinedClause)) {
      return { kind: 'npc', gender: 'female' };
    }
    // Default phone/ambient NPC to opposite gender so it contrasts clearly with {{char}}
    return {
      kind: 'npc',
      gender: mainGender === 'male' ? 'female' : 'male',
    };
  }

  return { kind: 'main' };
}

/**
 * Splits a role-play message into speaker-attributed voice segments (`{{char}}`, known cards, or secondary NPCs),
 * merging adjacent segments that share the same voice so single-speaker messages incur zero extra requests.
 */
export function extractMultiSpeakerSegments(params: {
  rawText: string;
  mode: TTSReadingMode;
  ttsConfig?: TTSServiceConfig;
  mainCharacter?: CharacterCardV2;
  allCharacters?: CharacterCardV2[];
  languageHint?: ConversationLanguage;
}): MultiSpeakerTtsSegment[] {
  const cfg = { ...DEFAULT_TTS_SERVICE, ...(params.ttsConfig || {}) };
  const fallbackSingleText = extractSpeakableText(params.rawText, params.mode);
  if (!fallbackSingleText) return [];

  const mainResolved = resolveVoiceSettings({
    ttsConfig: cfg,
    character: params.mainCharacter,
    text: fallbackSingleText,
    languageHint: params.languageHint,
  });

  if (params.mode === 'full_text' || cfg.multiVoiceNpc === false) {
    return [
      {
        text: fallbackSingleText,
        voiceId: mainResolved.voiceId,
        speed: mainResolved.speed,
        pitch: mainResolved.pitch,
        isNpc: false,
        speakerLabel: params.mainCharacter?.name || 'Character',
        detectedLang: mainResolved.detectedLang,
        refAudioPath: mainResolved.refAudioPath,
        refPromptText: mainResolved.refPromptText,
        refPromptLang: mainResolved.refPromptLang,
      },
    ];
  }

  const cleaned = parseMessageStatusBlocks(params.rawText)
    .cleanNarrativeText.replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();

  const paragraphs = cleaned
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const rawSegments: MultiSpeakerTtsSegment[] = [];

  for (const para of paragraphs) {
    const quotePattern =
      /"([^"\n]{1,600})"|“([^”\n]{1,600})”|「([^」\n]{1,600})」|『([^』\n]{1,600})』/g;
    const matches: Array<{
      text: string;
      start: number;
      end: number;
    }> = [];
    let match: RegExpExecArray | null;
    while ((match = quotePattern.exec(para)) !== null) {
      const normalized = normalizeTtsClause(
        match[1] || match[2] || match[3] || match[4] || ''
      );
      if (normalized) {
        matches.push({
          text: normalized,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }

    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i];
      const prevEnd = i > 0 ? matches[i - 1].end : 0;
      const nextStart = i + 1 < matches.length ? matches[i + 1].start : para.length;
      const beforeClause = para.slice(Math.max(prevEnd, cur.start - 95), cur.start);
      const afterClause = para.slice(cur.end, Math.min(nextStart, cur.end + 65));

      const attribution = classifyQuoteSpeaker({
        beforeClause,
        afterClause,
        mainCharacter: params.mainCharacter,
        allCharacters: params.allCharacters,
      });

      const quoteLang = detectTextLanguage(
        cur.text,
        params.mainCharacter?.defaultLanguage || params.languageHint
      );

      if (attribution.kind === 'known-char') {
        const otherResolved = resolveVoiceSettings({
          ttsConfig: cfg,
          character: attribution.character,
          text: cur.text,
          languageHint: params.languageHint,
        });
        rawSegments.push({
          text: cur.text,
          voiceId: otherResolved.voiceId,
          speed: otherResolved.speed,
          pitch: otherResolved.pitch,
          isNpc: true,
          speakerLabel: attribution.character.name,
          detectedLang: otherResolved.detectedLang,
          refAudioPath: otherResolved.refAudioPath,
          refPromptText: otherResolved.refPromptText,
          refPromptLang: otherResolved.refPromptLang,
        });
      } else if (attribution.kind === 'npc') {
        const npcVoice = resolveSecondaryNpcVoice({
          provider: mainResolved.provider,
          npcGender: attribution.gender,
          detectedLang: quoteLang,
          mainVoiceId: mainResolved.voiceId,
          baseSpeed: mainResolved.speed,
          basePitch: mainResolved.pitch,
        });
        rawSegments.push({
          text: cur.text,
          voiceId: npcVoice.voiceId,
          speed: npcVoice.speed,
          pitch: npcVoice.pitch,
          isNpc: true,
          speakerLabel: 'NPC',
          detectedLang: quoteLang,
          refAudioPath: npcVoice.refAudioPath,
          refPromptText: npcVoice.refPromptText,
          refPromptLang: npcVoice.refPromptLang,
        });
      } else {
        const charResolved = resolveVoiceSettings({
          ttsConfig: cfg,
          character: params.mainCharacter,
          text: cur.text,
          languageHint: params.languageHint,
        });
        rawSegments.push({
          text: cur.text,
          voiceId: charResolved.voiceId,
          speed: charResolved.speed,
          pitch: charResolved.pitch,
          isNpc: false,
          speakerLabel: params.mainCharacter?.name || 'Character',
          detectedLang: charResolved.detectedLang,
          refAudioPath: charResolved.refAudioPath,
          refPromptText: charResolved.refPromptText,
          refPromptLang: charResolved.refPromptLang,
        });
      }
    }
  }

  if (rawSegments.length === 0) {
    return [
      {
        text: fallbackSingleText,
        voiceId: mainResolved.voiceId,
        speed: mainResolved.speed,
        pitch: mainResolved.pitch,
        isNpc: false,
        speakerLabel: params.mainCharacter?.name || 'Character',
        detectedLang: mainResolved.detectedLang,
        refAudioPath: mainResolved.refAudioPath,
        refPromptText: mainResolved.refPromptText,
        refPromptLang: mainResolved.refPromptLang,
      },
    ];
  }

  // Merge consecutive segments that share the exact same voice, speed, pitch, refAudioPath, and role
  const merged: MultiSpeakerTtsSegment[] = [];
  for (const seg of rawSegments) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.voiceId === seg.voiceId &&
      prev.isNpc === seg.isNpc &&
      prev.speed === seg.speed &&
      prev.pitch === seg.pitch &&
      prev.refAudioPath === seg.refAudioPath
    ) {
      prev.text = joinTtsSegments(prev.text, seg.text);
    } else {
      merged.push({ ...seg });
    }
  }

  return merged;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Uploads a user-selected .wav file to the local host (`I:\GPT-SoVITS\voices\`)
 * and returns its absolute Windows filesystem path for zero-shot voice cloning.
 */
export async function uploadReferenceVoiceWav(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const res = await fetch('/api/ref-voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      base64,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data?.ok || !data?.path) {
    throw new Error(data?.error || 'Failed to upload reference WAV file');
  }
  return data.path;
}

/**
 * Compacts abnormally long dead-silence gaps inside a 16-bit PCM WAV buffer.
 * GPT-SoVITS (especially in Reference-Text-Free mode or on stuttered Chinese clauses)
 * can occasionally miss an EOS token and insert 1s-60s of near-zero silence frames;
 * this trims any silent run longer than `maxPauseSec` down to `keepPauseSec`.
 */
function compactWavSilence(
  wavBuffer: ArrayBuffer,
  maxPauseSec = 0.9,
  keepPauseSec = 0.4
): ArrayBuffer {
  if (wavBuffer.byteLength <= 44) return wavBuffer;
  const view = new DataView(wavBuffer);
  const channels = view.getUint16(22, true) || 1;
  const sampleRate = view.getUint32(24, true) || 32000;
  const bitsPerSample = view.getUint16(34, true) || 16;
  if (bitsPerSample !== 16 || sampleRate < 8000 || sampleRate > 96000) {
    return wavBuffer;
  }

  const headerBytes = new Uint8Array(wavBuffer, 0, 44);
  const pcmByteLen = wavBuffer.byteLength - 44;
  const totalSamples = Math.floor(pcmByteLen / 2);
  if (totalSamples <= 0) return wavBuffer;

  const samples = new Int16Array(wavBuffer, 44, totalSamples);
  const windowSamples = Math.max(
    channels,
    Math.floor(sampleRate * 0.025) * channels
  );
  const numWindows = Math.ceil(totalSamples / windowSamples);
  if (numWindows <= 8) return wavBuffer;

  const winAvgs = new Float32Array(numWindows);
  const winPeaks = new Float32Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSamples;
    const end = Math.min(totalSamples, start + windowSamples);
    const count = end - start;
    let sum = 0;
    let peak = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i]);
      sum += v;
      if (v > peak) peak = v;
    }
    winAvgs[w] = sum / count;
    winPeaks[w] = peak;
  }

  // Keep silence threshold low (avg < 220 && peak < 1100) so soft consonants (s/sh/f/h/x/t)
  // and word onsets/tails (avg 250-850) are NEVER treated as silence or clipped.
  const isSilentWindow = new Uint8Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    if (winAvgs[w] < 220 && winPeaks[w] < 1100) {
      isSilentWindow[w] = 1;
    }
  }

  // Detect multi-second stuck-token vocoder hiss / drone stalls (2.0s sliding window where
  // either local 90th-percentile peak < 40% of global 90th-percentile speech peak, or modulation CV < 0.40;
  // real speech over 2.0s has CV 0.60-0.95 and p90Peak ~12000, whereas a stuck '/v/' or '/s/' hiss has CV ~0.30 and p90Peak ~2900).
  const activePeaksSorted = Array.from(winPeaks)
    .filter((x) => x > 500)
    .sort((a, b) => a - b);
  const globalP90Peak =
    activePeaksSorted.length > 0
      ? activePeaksSorted[Math.floor(activePeaksSorted.length * 0.9)]
      : 12000;
  const droneSpan = 80; // 80 * 25ms = 2.0s
  if (numWindows >= droneSpan) {
    for (let w = 0; w + droneSpan <= numWindows; w += 8) {
      let sum = 0;
      const localPeaks = new Float32Array(droneSpan);
      for (let k = 0; k < droneSpan; k++) {
        const idx = w + k;
        sum += winAvgs[idx];
        localPeaks[k] = winPeaks[idx];
      }
      const mean = sum / droneSpan;
      if (mean > 60) {
        let sq = 0;
        for (let k = w; k < w + droneSpan; k++) {
          const d = winAvgs[k] - mean;
          sq += d * d;
        }
        const cv = Math.sqrt(sq / droneSpan) / mean;
        localPeaks.sort();
        const localP90 = localPeaks[Math.floor(droneSpan * 0.9)];
        if (localP90 < globalP90Peak * 0.4 || cv < 0.4) {
          for (let k = w; k < w + droneSpan; k++) {
            isSilentWindow[k] = 1;
          }
        }
      }
    }
  }

  // Only trim genuinely abnormal stalls (> maxPauseSec, default 0.90s); leave all normal 0.15-0.85s speech pauses untouched!
  const maxPauseWin = Math.max(28, Math.round(maxPauseSec / 0.025));
  const keepPauseWin = Math.max(10, Math.round(keepPauseSec / 0.025));
  const tailKeepWin = Math.ceil(keepPauseWin * 0.55);
  const preOnsetKeepWin = Math.max(4, keepPauseWin - tailKeepWin);
  const maxLeadTailWin = 6; // 150ms natural lead-in/out cushion

  let firstSpeech = 0;
  while (firstSpeech < numWindows && isSilentWindow[firstSpeech]) {
    firstSpeech++;
  }
  if (firstSpeech >= numWindows) return wavBuffer;

  let lastSpeech = numWindows - 1;
  while (lastSpeech > firstSpeech && isSilentWindow[lastSpeech]) {
    lastSpeech--;
  }

  const startWin = Math.max(0, firstSpeech - maxLeadTailWin);
  const endWin = Math.min(numWindows - 1, lastSpeech + maxLeadTailWin);

  // Collect contiguous runs so that when a long stall (> maxPauseWin) is trimmed,
  // we keep BOTH the decay tail after the previous word AND the pre-onset cushion right before the next word!
  const keptWindows: number[] = [];
  let w = startWin;
  while (w <= endWin) {
    if (!isSilentWindow[w]) {
      keptWindows.push(w);
      w++;
    } else {
      let runEnd = w;
      while (runEnd <= endWin && isSilentWindow[runEnd]) {
        runEnd++;
      }
      const runLen = runEnd - w;
      if (runLen <= maxPauseWin) {
        // Normal speech pause: keep 100% intact so cadence and consonant onsets never pop
        for (let k = w; k < runEnd; k++) {
          keptWindows.push(k);
        }
      } else {
        // Abnormal stall (> 0.9s): keep post-word decay tail + pre-word onset cushion
        for (let k = w; k < w + tailKeepWin; k++) {
          keptWindows.push(k);
        }
        for (let k = runEnd - preOnsetKeepWin; k < runEnd; k++) {
          keptWindows.push(k);
        }
      }
      w = runEnd;
    }
  }

  let outSamplesCount = 0;
  for (const kw of keptWindows) {
    const start = kw * windowSamples;
    const end = Math.min(totalSamples, start + windowSamples);
    outSamplesCount += end - start;
  }

  const outBytesLen = outSamplesCount * 2;
  const outBuf = new ArrayBuffer(44 + outBytesLen);
  const outUint8 = new Uint8Array(outBuf);
  outUint8.set(headerBytes, 0);

  const outSamples = new Int16Array(outBuf, 44, outSamplesCount);
  let dst = 0;
  for (let idx = 0; idx < keptWindows.length; idx++) {
    const kw = keptWindows[idx];
    const start = kw * windowSamples;
    const end = Math.min(totalSamples, start + windowSamples);
    const slice = samples.subarray(start, end);
    outSamples.set(slice, dst);
    // Smooth 10ms fade at any non-contiguous splice boundary to eliminate any click/pop
    if (idx > 0 && kw !== keptWindows[idx - 1] + 1) {
      const fadeLen = Math.min(slice.length, Math.floor(sampleRate * 0.01));
      for (let f = 0; f < fadeLen; f++) {
        const ratio = f / fadeLen;
        if (dst - fadeLen + f >= 0) {
          outSamples[dst - fadeLen + f] = Math.round(
            outSamples[dst - fadeLen + f] * (1 - ratio)
          );
        }
        outSamples[dst + f] = Math.round(outSamples[dst + f] * ratio);
      }
    }
    dst += slice.length;
  }

  // Gentle macro-level RMS loudness leveling (±2.5s window, 0.70x-1.45x range, heavy smoothing)
  // to balance quiet vs loud chunks without boosting word attacks after pauses.
  const outWinCount = Math.ceil(outSamplesCount / windowSamples);
  if (outWinCount > 8) {
    const winRms = new Float32Array(outWinCount);
    const winVoiced = new Uint8Array(outWinCount);
    for (let ow = 0; ow < outWinCount; ow++) {
      const s = ow * windowSamples;
      const e = Math.min(outSamplesCount, s + windowSamples);
      const len = e - s;
      let sumSq = 0;
      let sumAbs = 0;
      for (let i = s; i < e; i++) {
        const v = Math.abs(outSamples[i]);
        sumAbs += v;
        sumSq += v * v;
      }
      const avg = sumAbs / len;
      if (avg >= 900) {
        winVoiced[ow] = 1;
        winRms[ow] = Math.sqrt(sumSq / len);
      }
    }

    const targetRms = 4800;
    const gains = new Float32Array(outWinCount);
    let lastValidGain = 1.0;
    for (let ow = 0; ow < outWinCount; ow++) {
      let sumSq = 0;
      let cnt = 0;
      const kStart = Math.max(0, ow - 80);
      const kEnd = Math.min(outWinCount - 1, ow + 80);
      for (let k = kStart; k <= kEnd; k++) {
        if (winVoiced[k]) {
          sumSq += winRms[k] * winRms[k];
          cnt++;
        }
      }
      if (cnt > 0) {
        const localRms = Math.sqrt(sumSq / cnt);
        lastValidGain = Math.max(
          0.7,
          Math.min(1.45, targetRms / Math.max(1200, localRms))
        );
      }
      // Hold gain steady across pauses instead of dropping to 1.0 and jumping on word onset!
      gains[ow] = lastValidGain;
    }

    for (let ow = 1; ow < outWinCount; ow++) {
      gains[ow] = gains[ow - 1] * 0.92 + gains[ow] * 0.08;
    }
    for (let ow = outWinCount - 2; ow >= 0; ow--) {
      gains[ow] = gains[ow + 1] * 0.92 + gains[ow] * 0.08;
    }

    for (let ow = 0; ow < outWinCount; ow++) {
      const s = ow * windowSamples;
      const e = Math.min(outSamplesCount, s + windowSamples);
      const g0 = gains[ow];
      const g1 = ow + 1 < outWinCount ? gains[ow + 1] : g0;
      const len = e - s;
      for (let i = 0; i < len; i++) {
        const g = g0 + (g1 - g0) * (i / len);
        let val = outSamples[s + i] * g;
        const abs = Math.abs(val);
        if (abs > 23000) {
          const sign = val < 0 ? -1 : 1;
          val = sign * (23000 + 7000 * Math.tanh((abs - 23000) / 7000));
        }
        outSamples[s + i] = Math.round(val);
      }
    }
  }

  const outView = new DataView(outBuf);
  outView.setUint32(4, 36 + outBytesLen, true);
  outView.setUint32(40, outBytesLen, true);
  return outBuf;
}

/**
 * Concatenates multiple PCM WAV ArrayBuffers (sharing the same sample rate/channels)
 * into a single valid RIFF WAV ArrayBuffer for seamless multi-speaker playback,
 * and compacts any multi-second GPT-SoVITS silence stalls.
 */
function combineWavBuffers(
  buffers: ArrayBuffer[],
  maxPauseSec = 0.25,
  keepPauseSec = 0.18
): ArrayBuffer {
  if (buffers.length === 0) return new ArrayBuffer(0);
  if (buffers.length === 1) {
    return compactWavSilence(buffers[0], maxPauseSec, keepPauseSec);
  }

  const first = new Uint8Array(buffers[0]);
  if (first.byteLength <= 44) return buffers[0];

  const header = first.slice(0, 44);
  const pcmChunks: Uint8Array[] = [];
  let totalPcmBytes = 0;

  for (const buf of buffers) {
    const arr = new Uint8Array(buf);
    const pcm = arr.byteLength > 44 ? arr.subarray(44) : arr;
    pcmChunks.push(pcm);
    totalPcmBytes += pcm.byteLength;
  }

  const combined = new Uint8Array(44 + totalPcmBytes);
  combined.set(header, 0);
  let offset = 44;
  for (const pcm of pcmChunks) {
    combined.set(pcm, offset);
    offset += pcm.byteLength;
  }

  const view = new DataView(combined.buffer);
  view.setUint32(4, 36 + totalPcmBytes, true);
  view.setUint32(40, totalPcmBytes, true);
  return compactWavSilence(combined.buffer, maxPauseSec, keepPauseSec);
}

async function cacheAudioBufferToDisk(
  buffer: ArrayBuffer,
  ext: 'mp3' | 'wav',
  prefix = 'tts'
): Promise<string> {
  const base64 = arrayBufferToBase64(buffer);
  const filename = `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 7)}.${ext}`;
  const res = await fetch('/api/audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename,
      base64,
    }),
  });
  if (res.ok) {
    const data = await res.json();
    if (data?.url) return data.url;
  }
  const mime = ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
  return `data:${mime};base64,${base64}`;
}

/**
 * Tests the configured TTS service and returns connection status.
 */
export async function testTtsService(
  config: TTSServiceConfig
): Promise<{ ok: boolean; note?: string; error?: string }> {
  try {
    if (config.provider === 'browser') {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices();
        return {
          ok: true,
          note: `Browser Speech API ready (${voices.length} system voices)`,
        };
      }
      return {
        ok: false,
        error: 'window.speechSynthesis is not supported in this browser.',
      };
    }

    if (
      config.provider === 'edge-tts' ||
      config.provider === 'google-tts' ||
      config.provider === 'windows-sapi'
    ) {
      const res = await fetch('/api/edge-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine: config.provider,
          text: 'Hello, voice synthesis is ready.',
          voice:
            config.defaultVoiceId && config.defaultVoiceId !== 'auto'
              ? config.defaultVoiceId
              : 'en-US-AvaMultilingualNeural',
          speed: config.speed || 1.0,
          pitch: config.pitch || 0,
          cacheAudio: false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        return {
          ok: false,
          error: data?.error || `TTS synthesis failed (${res.status})`,
        };
      }
      const engineLabel =
        data.engineUsed === 'google-tts'
          ? config.provider === 'edge-tts'
            ? '0-VRAM Cloud TTS Ready (Edge 403 Auto-Bypassed)'
            : 'Google Cloud Stream TTS Ready (0 VRAM)'
          : data.engineUsed === 'windows-sapi'
          ? 'Windows Native SAPI TTS Ready (Offline · 0 VRAM)'
          : 'Edge Neural TTS Connected (0 VRAM)';
      return {
        ok: true,
        note: engineLabel,
      };
    }

    if (config.provider === 'openai-compatible') {
      const cleanBase = config.baseUrl.replace(/\/+$/, '');
      const modelsUrl = cleanBase.endsWith('/v1')
        ? `${cleanBase}/models`
        : `${cleanBase}/v1/models`;
      const headers: Record<string, string> = {};
      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }
      const res = await proxyFetch(modelsUrl, { method: 'GET', headers });
      if (res.ok) {
        return { ok: true, note: 'OpenAI-compatible TTS endpoint reachable' };
      }
      // Some TTS servers only expose /v1/audio/speech or /audio/voices
      const voicesUrl = cleanBase.endsWith('/v1')
        ? `${cleanBase}/audio/voices`
        : `${cleanBase}/v1/audio/voices`;
      const vRes = await proxyFetch(voicesUrl, { method: 'GET', headers });
      if (vRes.ok) {
        return { ok: true, note: 'TTS voices endpoint reachable' };
      }
      return {
        ok: false,
        error: `Could not reach TTS server at ${config.baseUrl} (HTTP ${res.status})`,
      };
    }

    if (config.provider === 'gpt-sovits') {
      const cleanBase = config.baseUrl.replace(/\/+$/, '');
      const res = await proxyFetch(`${cleanBase}/`, { method: 'GET' });
      // Even a 400/422/405 from FastAPI root confirms the server is listening on the port
      if (res.ok || [400, 404, 405, 422].includes(res.status)) {
        return { ok: true, note: 'GPT-SoVITS API server is online' };
      }
      return {
        ok: false,
        error: `GPT-SoVITS server unreachable at ${cleanBase} (HTTP ${res.status})`,
      };
    }

    return { ok: false, error: 'Unsupported TTS provider' };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Failed to connect to TTS service',
    };
  }
}

export interface TtsPlaybackSnapshot {
  activeId: string | null;
  status: 'idle' | 'synthesizing' | 'playing';
  error: string | null;
}

class GlobalTtsPlayer {
  private audioEl: HTMLAudioElement | null = null;
  private listeners = new Set<() => void>();
  private snapshot: TtsPlaybackSnapshot = {
    activeId: null,
    status: 'idle',
    error: null,
  };
  private currentRunToken = 0;

  private updateState(patch: Partial<TtsPlaybackSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getSnapshot = (): TtsPlaybackSnapshot => {
    return this.snapshot;
  };

  public stop = () => {
    this.currentRunToken++;
    if (this.audioEl) {
      try {
        this.audioEl.pause();
        this.audioEl.src = '';
      } catch {
        // ignore
      }
      this.audioEl = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    this.updateState({
      activeId: null,
      status: 'idle',
    });
  };

  private playAudioUrl(url: string, id: string, runToken: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (runToken !== this.currentRunToken) {
        resolve();
        return;
      }
      const audio = new Audio(url);
      this.audioEl = audio;
      this.updateState({
        activeId: id,
        status: 'playing',
        error: null,
      });

      audio.onended = () => {
        if (this.currentRunToken === runToken) {
          this.audioEl = null;
          this.updateState({ activeId: null, status: 'idle' });
        }
        resolve();
      };

      audio.onerror = () => {
        if (this.currentRunToken === runToken) {
          this.audioEl = null;
          this.updateState({ activeId: null, status: 'idle' });
        }
        reject(new Error('Audio playback failed or cached file not found'));
      };

      audio.play().catch((err) => {
        if (this.currentRunToken === runToken) {
          this.audioEl = null;
          this.updateState({
            activeId: null,
            status: 'idle',
            error: err?.message || 'Playback blocked by browser',
          });
        }
        reject(err);
      });
    });
  }

  public async toggleOrSpeak(params: {
    id: string;
    rawText: string;
    ttsConfig?: TTSServiceConfig;
    character?: CharacterCardV2;
    allCharacters?: CharacterCardV2[];
    languageHint?: ConversationLanguage;
    existingAudioUrl?: string;
    forceRegenerate?: boolean;
    onAudioCached?: (audioUrl: string) => void;
  }): Promise<void> {
    if (
      !params.forceRegenerate &&
      this.snapshot.activeId === params.id &&
      (this.snapshot.status === 'playing' ||
        this.snapshot.status === 'synthesizing')
    ) {
      this.stop();
      return;
    }

    this.stop();
    const runToken = ++this.currentRunToken;
    const cfg = { ...DEFAULT_TTS_SERVICE, ...(params.ttsConfig || {}) };

    const segments = extractMultiSpeakerSegments({
      rawText: params.rawText,
      mode: cfg.readingMode || 'dialogue_only',
      ttsConfig: cfg,
      mainCharacter: params.character,
      allCharacters: params.allCharacters,
      languageHint: params.languageHint,
    });

    if (segments.length === 0) {
      this.updateState({
        activeId: null,
        status: 'idle',
        error: 'No speakable dialogue found in this message.',
      });
      return;
    }

    const speakableText = segments.map((s) => s.text).join(' ');
    const resolved = resolveVoiceSettings({
      ttsConfig: cfg,
      character: params.character,
      text: speakableText,
      languageHint: params.languageHint,
    });

    // 1. Try existing cached audio URL first if available (unless forceRegenerate is requested)
    if (
      !params.forceRegenerate &&
      params.existingAudioUrl &&
      cfg.cacheAudio &&
      resolved.provider !== 'browser'
    ) {
      try {
        await this.playAudioUrl(params.existingAudioUrl, params.id, runToken);
        return;
      } catch {
        // Cached file may have been removed; proceed to synthesize fresh audio
      }
    }

    this.updateState({
      activeId: params.id,
      status: 'synthesizing',
      error: null,
    });

    try {
      // Browser Web Speech API
      if (resolved.provider === 'browser') {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
          throw new Error('Browser Speech Synthesis is not supported.');
        }
        const voices = window.speechSynthesis.getVoices();
        const langMap: Record<string, string> = {
          'zh-CN': 'zh-CN',
          'zh-TW': 'zh-TW',
          ja: 'ja-JP',
          ko: 'ko-KR',
          en: 'en-US',
        };

        this.updateState({
          activeId: params.id,
          status: 'playing',
          error: null,
        });

        segments.forEach((seg, idx) => {
          const utterance = new SpeechSynthesisUtterance(seg.text);
          utterance.rate = Math.max(0.5, Math.min(2.0, seg.speed));
          utterance.pitch = Math.max(
            0.5,
            Math.min(1.5, 1 + seg.pitch * 0.025)
          );
          utterance.lang = langMap[seg.detectedLang] || 'en-US';
          const langPrefix = utterance.lang.slice(0, 2).toLowerCase();
          const matchingVoice =
            voices.find((v) => v.name === seg.voiceId) ||
            voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
          if (matchingVoice) {
            utterance.voice = matchingVoice;
          }
          if (idx === segments.length - 1) {
            utterance.onend = () => {
              if (this.currentRunToken === runToken) {
                this.updateState({ activeId: null, status: 'idle' });
              }
            };
            utterance.onerror = () => {
              if (this.currentRunToken === runToken) {
                this.updateState({ activeId: null, status: 'idle' });
              }
            };
          }
          window.speechSynthesis.speak(utterance);
        });
        return;
      }

      // Built-in 0-VRAM TTS (Edge Neural -> Google Cloud Stream -> Windows SAPI Offline)
      if (
        resolved.provider === 'edge-tts' ||
        resolved.provider === 'google-tts' ||
        resolved.provider === 'windows-sapi'
      ) {
        const res = await fetch('/api/edge-tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engine: resolved.provider,
            text: speakableText,
            voice: resolved.voiceId,
            speed: resolved.speed,
            pitch: resolved.pitch,
            segments: segments.map((s) => ({
              text: s.text,
              voice: s.voiceId,
              speed: s.speed,
              pitch: s.pitch,
              isNpc: s.isNpc,
            })),
            cacheAudio: cfg.cacheAudio,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || `TTS synthesis error (${res.status})`);
        }
        const audioUrl: string = data.url || data.dataUrl;
        if (data.url && params.onAudioCached) {
          params.onAudioCached(data.url);
        }
        await this.playAudioUrl(audioUrl, params.id, runToken);
        return;
      }

      // Local GPU / OpenAI-Compatible (/v1/audio/speech)
      if (resolved.provider === 'openai-compatible') {
        const audioUrl = await aiTaskQueue.enqueue(
          'tts-audio',
          `TTS Voice (${params.character?.name || resolved.voiceId})`,
          async (updateDetail) => {
            updateDetail('Synthesizing speech via OpenAI-compatible TTS...');
            const cleanBase = cfg.baseUrl.replace(/\/+$/, '');
            const endpoint = cleanBase.endsWith('/v1')
              ? `${cleanBase}/audio/speech`
              : `${cleanBase}/v1/audio/speech`;
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            if (cfg.apiKey) {
              headers['Authorization'] = `Bearer ${cfg.apiKey}`;
            }

            const chunkBuffers: Uint8Array[] = [];
            let totalLen = 0;

            for (const seg of segments) {
              const res = await proxyFetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  model: cfg.model || 'kokoro',
                  input: seg.text,
                  voice: seg.voiceId || 'af_heart',
                  speed: seg.speed || 1.0,
                  response_format: 'mp3',
                }),
              });
              if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(
                  `TTS /v1/audio/speech failed (${res.status}): ${errText.slice(0, 140)}`
                );
              }
              const arr = new Uint8Array(await res.arrayBuffer());
              chunkBuffers.push(arr);
              totalLen += arr.byteLength;
            }

            const combined = new Uint8Array(totalLen);
            let offset = 0;
            for (const arr of chunkBuffers) {
              combined.set(arr, offset);
              offset += arr.byteLength;
            }
            const buf = combined.buffer;
            if (cfg.cacheAudio) {
              return cacheAudioBufferToDisk(buf, 'mp3', 'openai_tts');
            }
            return `data:audio/mpeg;base64,${arrayBufferToBase64(buf)}`;
          }
        );

        if (audioUrl.startsWith('/api/audio/') && params.onAudioCached) {
          params.onAudioCached(audioUrl);
        }
        await this.playAudioUrl(audioUrl, params.id, runToken);
        return;
      }

      // GPT-SoVITS Local Server (Port 9880)
      if (resolved.provider === 'gpt-sovits') {
        const audioUrl = await aiTaskQueue.enqueue(
          'tts-audio',
          `GPT-SoVITS (${params.character?.name || 'Voice'})`,
          async (updateDetail) => {
            updateDetail('Synthesizing voice via GPT-SoVITS...');
            const cleanBase = (cfg.baseUrl || 'http://127.0.0.1:9880').replace(
              /\/+$/,
              ''
            );
            const textLangMap: Record<string, string> = {
              'zh-CN': 'zh',
              'zh-TW': 'zh',
              ja: 'ja',
              ko: 'ko',
              en: 'en',
            };

            const wavBuffers: ArrayBuffer[] = [];

            for (let i = 0; i < segments.length; i++) {
              const seg = segments[i];
              if (segments.length > 1) {
                updateDetail(
                  `Synthesizing segment ${i + 1}/${segments.length} (${seg.speakerLabel})...`
                );
              }
              const segTextLang = textLangMap[seg.detectedLang] || 'zh';
              const segRefPath = seg.refAudioPath || resolved.refAudioPath;
              const segPromptText =
                seg.refPromptText !== undefined
                  ? seg.refPromptText
                  : resolved.refPromptText || '';
              const segPromptLang =
                seg.refPromptLang || resolved.refPromptLang || 'zh';
              const segSpeed = seg.speed || resolved.speed || 1.0;

              const payload: Record<string, any> = {
                text: seg.text,
                text_lang: segTextLang,
                ref_audio_path: segRefPath,
                prompt_text: segPromptText,
                prompt_lang: segPromptLang,
                speed_factor: segSpeed,
                text_split_method: cfg.gptSovitsTextSplitMethod || 'cut2',
                // Sequential chunk inference + rep_pen >= 1.35 prevents GPT-SoVITS from looping a stuck breath/silence token at low temp
                parallel_infer: false,
                top_k: cfg.gptSovitsTopK ?? 5,
                top_p: cfg.gptSovitsTopP ?? 0.85,
                temperature: cfg.gptSovitsTemperature ?? 0.8,
                repetition_penalty:
                  (cfg.gptSovitsTemperature ?? 0.8) < 0.75
                    ? Math.max(1.35, cfg.gptSovitsRepetitionPenalty ?? 1.35)
                    : cfg.gptSovitsRepetitionPenalty ?? 1.35,
                fragment_interval: cfg.gptSovitsFragmentInterval ?? 0.15,
                media_type: 'wav',
                use_cuda_graph: false,
              };

              let res = await proxyFetch(`${cleanBase}/tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });

              if (res.status === 404) {
                // Fallback for GPT-SoVITS v1 root endpoint
                res = await proxyFetch(`${cleanBase}/`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    text: seg.text,
                    text_language: segTextLang,
                    refer_wav_path: segRefPath,
                    prompt_text: segPromptText,
                    prompt_language: segPromptLang,
                    speed: segSpeed,
                  }),
                });
              }

              if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(
                  `GPT-SoVITS failed (${res.status}): ${
                    errText.slice(0, 140) ||
                    'Check ref_audio_path and server status on port 9880'
                  }`
                );
              }

              wavBuffers.push(await res.arrayBuffer());
            }

            // Only trim genuinely abnormal multi-second stalls (> 0.90s) down to ~0.40s,
            // leaving all normal 0.15s-0.85s sentence pauses and consonant onsets untouched.
            const buf = combineWavBuffers(wavBuffers, 0.9, 0.4);
            if (cfg.cacheAudio) {
              return cacheAudioBufferToDisk(buf, 'wav', 'sovits');
            }
            return `data:audio/wav;base64,${arrayBufferToBase64(buf)}`;
          }
        );

        if (audioUrl.startsWith('/api/audio/') && params.onAudioCached) {
          params.onAudioCached(audioUrl);
        }
        await this.playAudioUrl(audioUrl, params.id, runToken);
        return;
      }
    } catch (err: any) {
      if (this.currentRunToken === runToken) {
        this.updateState({
          activeId: null,
          status: 'idle',
          error: err?.message || 'TTS synthesis failed',
        });
      }
    }
  }
}

export const ttsPlayer = new GlobalTtsPlayer();
