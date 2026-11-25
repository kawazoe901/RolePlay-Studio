import {
  ComfyNodeBinding,
  ComfyUIServiceConfig,
  ComfyWorkflowProfile,
  LLMServiceConfig,
  WorkflowParameterRole,
  WorkflowPromptStyle,
} from '../types';
import { generateChatCompletion, unloadOllamaModel } from './llmService';
import { proxyFetch } from './proxyFetch';
import { aiTaskQueue } from './aiTaskQueue';

export interface ComfyNodeSummary {
  nodeId: string;
  classType: string;
  title: string;
  primitiveInputs: Record<string, string | number | boolean>;
  linkedInputs: Record<string, { fromNodeId: string; fromSlot: number }>;
}

/**
 * Tests connection to a ComfyUI server via /system_stats
 */
export async function testComfyService(
  comfy: ComfyUIServiceConfig
): Promise<{ ok: boolean; vramInfo?: string; error?: string }> {
  const cleanBase = comfy.baseUrl.replace(/\/+$/, '');
  try {
    const res = await proxyFetch(`${cleanBase}/system_stats`, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    const device = data?.devices?.[0];
    const vramInfo = device
      ? `${device.name} (${Math.round((device.vram_total || 0) / 1024 / 1024 / 1024)}GB VRAM)`
      : 'ComfyUI Ready';
    return { ok: true, vramInfo };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Could not reach ComfyUI server',
    };
  }
}

/**
 * Queries ComfyUI /object_info to discover installed Checkpoints, UNETs (Moss/Flux/Qwen), and LoRAs.
 */
export async function fetchComfyModels(
  comfy: ComfyUIServiceConfig
): Promise<{ checkpoints: string[]; loras: string[] }> {
  const cleanBase = comfy.baseUrl.replace(/\/+$/, '');
  const checkpoints = new Set<string>();
  const loras = new Set<string>();

  try {
    const [ckptRes, unetRes, ggufRes, loraRes] = await Promise.allSettled([
      proxyFetch(`${cleanBase}/object_info/CheckpointLoaderSimple`),
      proxyFetch(`${cleanBase}/object_info/UNETLoader`),
      proxyFetch(`${cleanBase}/object_info/UnetLoaderGGUF`),
      proxyFetch(`${cleanBase}/object_info/LoraLoader`),
    ]);

    if (ckptRes.status === 'fulfilled' && ckptRes.value.ok) {
      const data = await ckptRes.value.json();
      const list =
        data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
      if (Array.isArray(list))
        list.forEach((item: string) => checkpoints.add(item));
    }
    if (unetRes.status === 'fulfilled' && unetRes.value.ok) {
      const data = await unetRes.value.json();
      const list = data?.UNETLoader?.input?.required?.unet_name?.[0];
      if (Array.isArray(list))
        list.forEach((item: string) => checkpoints.add(item));
    }
    if (ggufRes.status === 'fulfilled' && ggufRes.value.ok) {
      const data = await ggufRes.value.json();
      const list = data?.UnetLoaderGGUF?.input?.required?.unet_name?.[0];
      if (Array.isArray(list))
        list.forEach((item: string) => checkpoints.add(item));
    }
    if (loraRes.status === 'fulfilled' && loraRes.value.ok) {
      const data = await loraRes.value.json();
      const list = data?.LoraLoader?.input?.required?.lora_name?.[0];
      if (Array.isArray(list)) list.forEach((item: string) => loras.add(item));
    }
  } catch {
    // ignore if offline
  }

  return {
    checkpoints: Array.from(checkpoints),
    loras: Array.from(loras),
  };
}

/**
 * Converts any image URL or Data URI (including SVG avatars) into a valid PNG Blob
 * and uploads it to ComfyUI's `POST /upload/image` endpoint so `LoadImage` nodes
 * in Qwen-Image-2.1-Edit, Moss, Flux Kontext, IPAdapter, or PulID workflows can use it
 * for character consistency!
 */
export async function uploadImageToComfyUI(
  comfy: ComfyUIServiceConfig,
  imageSource: string,
  filenameHint = 'rp_char_reference.png'
): Promise<string> {
  const cleanBase = comfy.baseUrl.replace(/\/+$/, '');
  const pngBlob = await imageSourceToPngBlob(imageSource);

  const safeName = filenameHint.endsWith('.png')
    ? filenameHint
    : `${filenameHint.replace(/[^a-z0-9_-]/gi, '_')}.png`;

  const formData = new FormData();
  formData.append('image', pngBlob, safeName);
  formData.append('overwrite', 'true');
  formData.append('type', 'input');

  const res = await proxyFetch(`${cleanBase}/upload/image`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(
      `Failed to upload reference image to ComfyUI (${res.status}): ${await res.text()}`
    );
  }

  const data = await res.json();
  if (data?.subfolder) {
    return `${data.subfolder}/${data.name}`;
  }
  return data?.name || safeName;
}

/**
 * Renders any image source (PNG/JPEG data URL, remote URL, or SVG) onto an HTML5 Canvas
 * to guarantee ComfyUI's PIL Image.open() receives a valid raster PNG.
 */
async function imageSourceToPngBlob(src: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const width = img.naturalWidth || 768;
      const height = img.naturalHeight || 768;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed'));
      }, 'image/png');
    };
    img.onerror = () =>
      reject(new Error('Could not load character reference image for upload'));
    img.src = src;
  });
}

/**
 * Detects whether an uploaded JSON is ComfyUI's UI format (with `nodes` array & `links` array)
 * vs. ComfyUI API format (object keyed by node ID with `class_type` and `inputs`).
 */
export function normalizeComfyWorkflowJson(raw: any): {
  isApiFormat: boolean;
  apiJson: Record<string, any>;
  warning?: string;
} {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid JSON object.');
  }

  // Case 1: Already ComfyUI API format
  const sampleValues = Object.values(raw);
  if (
    !Array.isArray(raw.nodes) &&
    sampleValues.length > 0 &&
    sampleValues.some(
      (v: any) =>
        v && typeof v === 'object' && 'class_type' in v && 'inputs' in v
    )
  ) {
    return { isApiFormat: true, apiJson: raw };
  }

  // Case 2: Standard ComfyUI UI format (has `nodes` array and `links` array)
  if (Array.isArray(raw.nodes)) {
    const linkMap = new Map<number, [string, number]>();
    if (Array.isArray(raw.links)) {
      for (const link of raw.links) {
        if (Array.isArray(link) && link.length >= 5) {
          linkMap.set(Number(link[0]), [String(link[1]), Number(link[2])]);
        }
      }
    }

    const converted: Record<string, any> = {};
    for (const node of raw.nodes) {
      const nodeId = String(node.id);
      const classType = node.type || 'UnknownNode';
      if (classType === 'Note' || classType === 'Reroute') continue;

      const inputs: Record<string, any> = {};
      if (Array.isArray(node.inputs)) {
        for (const inp of node.inputs) {
          if (inp.link != null && linkMap.has(Number(inp.link))) {
            inputs[inp.name] = linkMap.get(Number(inp.link));
          }
        }
      }

      const widgets = Array.isArray(node.widgets_values)
        ? node.widgets_values
        : [];
      if (
        (classType.includes('CLIPTextEncode') ||
          classType.includes('Qwen') ||
          classType.includes('Prompt') ||
          classType.includes('TextEncode')) &&
        widgets.length > 0 &&
        typeof widgets[0] === 'string'
      ) {
        inputs.text = widgets[0];
      } else if (classType === 'LoadImage' && widgets.length > 0) {
        inputs.image = widgets[0];
      } else if (classType === 'KSampler' && widgets.length >= 6) {
        inputs.seed = widgets[0];
        inputs.steps = widgets[2];
        inputs.cfg = widgets[3];
        inputs.sampler_name = widgets[4];
        inputs.scheduler = widgets[5];
        inputs.denoise = widgets[6] ?? 1;
      } else if (classType === 'RandomNoise' && widgets.length > 0) {
        inputs.noise_seed = widgets[0];
      } else if (classType === 'BasicScheduler' && widgets.length >= 3) {
        inputs.scheduler = widgets[0];
        inputs.steps = widgets[1];
        inputs.denoise = widgets[2];
      } else if (classType === 'FluxGuidance' && widgets.length > 0) {
        inputs.guidance = widgets[0];
      } else if (
        (classType === 'EmptyLatentImage' ||
          classType === 'EmptySD3LatentImage' ||
          classType === 'EmptyMochiLatentVideo') &&
        widgets.length >= 2
      ) {
        inputs.width = widgets[0];
        inputs.height = widgets[1];
        inputs.batch_size = widgets[2] ?? 1;
      } else if (classType.includes('CheckpointLoader') && widgets.length > 0) {
        inputs.ckpt_name = widgets[0];
      } else if (classType.includes('UNETLoader') && widgets.length > 0) {
        inputs.unet_name = widgets[0];
      } else if (classType === 'SaveImage' && widgets.length > 0) {
        inputs.filename_prefix = widgets[0];
      }

      converted[nodeId] = {
        class_type: classType,
        inputs,
        _meta: { title: node.title || classType },
      };
    }

    return {
      isApiFormat: false,
      apiJson: converted,
      warning:
        'Detected ComfyUI UI-format JSON and auto-converted nodes (including LoadImage / Qwen / Moss / Sampler nodes) to API format. For complex custom nodes, exporting via "Save (API Format)" in ComfyUI Dev Mode is recommended.',
    };
  }

  throw new Error('Unrecognized ComfyUI workflow JSON structure.');
}

/**
 * Summarizes all nodes and edges in a ComfyUI API JSON workflow.
 */
export function summarizeComfyWorkflowGraph(
  apiJson: Record<string, any>
): ComfyNodeSummary[] {
  const summaries: ComfyNodeSummary[] = [];

  for (const [nodeId, node] of Object.entries(apiJson)) {
    if (!node || typeof node !== 'object' || !node.class_type) continue;
    const primitiveInputs: Record<string, string | number | boolean> = {};
    const linkedInputs: Record<string, { fromNodeId: string; fromSlot: number }> =
      {};

    const inputs = node.inputs || {};
    for (const [key, val] of Object.entries(inputs)) {
      if (Array.isArray(val) && val.length === 2) {
        linkedInputs[key] = {
          fromNodeId: String(val[0]),
          fromSlot: Number(val[1]),
        };
      } else if (
        typeof val === 'string' ||
        typeof val === 'number' ||
        typeof val === 'boolean'
      ) {
        primitiveInputs[key] = val;
      }
    }

    summaries.push({
      nodeId,
      classType: String(node.class_type),
      title: String(node._meta?.title || node.class_type),
      primitiveInputs,
      linkedInputs,
    });
  }

  return summaries;
}

/**
 * Checks whether a ComfyUI workflow uses the MOSS-Image architecture
 * (e.g. CLIPLoader with `type: "moss_image"`, `MossImageLayoutPrompt`, or `moss` UNET).
 */
export function isMossWorkflow(
  workflowOrJson?: ComfyWorkflowProfile | Record<string, any> | null
): boolean {
  if (!workflowOrJson || typeof workflowOrJson !== 'object') return false;
  const rawJson =
    'rawApiJson' in workflowOrJson && workflowOrJson.rawApiJson
      ? (workflowOrJson as ComfyWorkflowProfile).rawApiJson
      : workflowOrJson;
  const wfName =
    'name' in workflowOrJson ? String((workflowOrJson as any).name || '') : '';
  const allText = `${wfName} ${JSON.stringify(rawJson)}`;
  return /moss_image|MossImageLayoutPrompt|mossRefined|moss_v1|Moss\\\\|\/Moss\//i.test(
    allText
  );
}

/**
 * Resolves the effective pixel width & height of a ComfyUI workflow canvas,
 * including support for `ResolutionSelector` nodes (e.g. in `image_moss_image_t2i`
 * where `EmptyFlux2LatentImage` links width/height from `ResolutionSelector`).
 */
export function resolveWorkflowCanvasSize(
  workflow?: ComfyWorkflowProfile | null,
  overrideWidth?: number,
  overrideHeight?: number
): { width: number; height: number } {
  if (!workflow) {
    return {
      width: overrideWidth || 1024,
      height: overrideHeight || 1024,
    };
  }

  const raw = workflow.rawApiJson || {};
  for (const node of Object.values(raw) as any[]) {
    if (
      node &&
      typeof node === 'object' &&
      node.class_type === 'ResolutionSelector' &&
      node.inputs
    ) {
      const ratioStr = String(node.inputs.aspect_ratio || '1:1');
      const megapixels = Number(node.inputs.megapixels) || 1.0;
      const multiple = Number(node.inputs.multiple) || 16;
      const match = ratioStr.match(/(\d+)\s*:\s*(\d+)/);
      if (match) {
        const rw = Number(match[1]) || 1;
        const rh = Number(match[2]) || 1;
        const totalPixels = megapixels * 1024 * 1024;
        const rawW = Math.sqrt((totalPixels * rw) / rh);
        const rawH = Math.sqrt((totalPixels * rh) / rw);
        const snap = (v: number) =>
          Math.max(256, Math.round(v / multiple) * multiple);
        return {
          width: snap(rawW),
          height: snap(rawH),
        };
      }
    }
  }

  const widthBinding = workflow.bindings?.find((b) => b.role === 'width');
  const heightBinding = workflow.bindings?.find((b) => b.role === 'height');
  const wFromNode =
    widthBinding && typeof widthBinding.currentValue === 'number'
      ? widthBinding.currentValue
      : undefined;
  const hFromNode =
    heightBinding && typeof heightBinding.currentValue === 'number'
      ? heightBinding.currentValue
      : undefined;

  return {
    width: overrideWidth || wFromNode || workflow.defaultWidth || 1024,
    height: overrideHeight || hFromNode || workflow.defaultHeight || 1024,
  };
}

/**
 * Detects whether a workflow is best suited for:
 * - 'edit_instruction' (Qwen-Image-2.1-Edit, Flux Kontext, OmniGen, or workflows with LoadImage + Edit/Reference nodes)
 * - 'moss_bbox' (MOSS-Image layout-guided bounding box JSON + 8-facet caption)
 * - 'natural' (Flux, SD3.5, PixArt, Lumina, Qwen T2I)
 * - 'tags' (SDXL, Illustrious, Pony, SD1.5)
 */
export function detectWorkflowPromptStyle(
  summaries: ComfyNodeSummary[]
): WorkflowPromptStyle {
  const allText = summaries
    .map((s) => `${s.classType} ${s.title} ${JSON.stringify(s.primitiveInputs)}`)
    .join(' ');

  if (
    /Qwen.*Edit|ImageEdit|Kontext|OmniGen|InstructPix2Pix|EditPrompt/i.test(
      allText
    )
  ) {
    return 'edit_instruction';
  }

  if (
    /moss_image|MossImageLayoutPrompt|mossRefined|moss_v1|Moss\\\\|MOSS-Image/i.test(
      allText
    )
  ) {
    return 'moss_bbox';
  }

  if (/\banima\b|anima[_-]?xl|qwen_3_06b|animaStyle/i.test(allText)) {
    return 'anima_xl';
  }

  if (/Moss|Flux|SD3|AuraFlow|Lumina|PixArt|Qwen|Wan|Hunyuan|T5/i.test(allText)) {
    return 'natural';
  }

  if (/juggernaut|realvis|dreamshaperxl|sd_xl_base|epicrealism|cyberrealistic|lustify/i.test(allText)) {
    return 'sdxl_natural';
  }

  return 'tags';
}

/**
 * Deterministic graph-traversal heuristic mapper supporting SDXL, Moss, Flux,
 * and Qwen-Image-2.1-Edit (including `LoadImage` character reference nodes!).
 */
export function heuristicMapWorkflow(
  apiJson: Record<string, any>
): ComfyNodeBinding[] {
  const summaries = summarizeComfyWorkflowGraph(apiJson);
  const byId = new Map(summaries.map((s) => [s.nodeId, s]));
  const bindings: ComfyNodeBinding[] = [];

  const addBinding = (
    role: WorkflowParameterRole,
    node: ComfyNodeSummary,
    inputKey: string,
    confidence: 'high' | 'medium',
    reasoning: string
  ) => {
    if (bindings.some((b) => b.role === role)) return;
    bindings.push({
      role,
      nodeId: node.nodeId,
      nodeTitle: node.title,
      classType: node.classType,
      inputKey,
      currentValue: node.primitiveInputs[inputKey] as
        | string
        | number
        | undefined,
      confidence,
      reasoning,
    });
  };

  // 0. Detect Character Reference Image (`LoadImage`) nodes for Qwen-Image-2.1-Edit / Moss / IPAdapter / PulID
  // Sort LoadImage nodes so whichever connects to `images.image_1` / `images.image0` / `image_1` comes first (<image1>)
  const getLoadImageOrderScore = (nodeId: string): number => {
    for (const s of summaries) {
      for (const [inpName, link] of Object.entries(s.linkedInputs)) {
        if (link.fromNodeId !== nodeId) continue;
        if (/image_?1$|image0$/i.test(inpName)) return 1;
        if (/image_?2$|image1$/i.test(inpName)) return 2;
      }
    }
    return 1.5;
  };

  const loadImageNodes = summaries
    .filter(
      (s) =>
        /LoadImage/i.test(s.classType) &&
        ('image' in s.primitiveInputs ||
          Object.keys(s.primitiveInputs).length > 0)
    )
    .sort(
      (a, b) =>
        getLoadImageOrderScore(a.nodeId) - getLoadImageOrderScore(b.nodeId)
    );
  if (loadImageNodes.length >= 1) {
    const firstImgNode = loadImageNodes[0];
    const imgKey = 'image' in firstImgNode.primitiveInputs ? 'image' : Object.keys(firstImgNode.primitiveInputs)[0];
    addBinding(
      'character_ref_image',
      firstImgNode,
      imgKey,
      'high',
      `Character reference image loader (#${firstImgNode.nodeId} ${firstImgNode.title}) for Qwen-Image-Edit / Moss / IPAdapter character consistency.`
    );
  }
  if (loadImageNodes.length >= 2) {
    const secondImgNode = loadImageNodes[1];
    const imgKey = 'image' in secondImgNode.primitiveInputs ? 'image' : Object.keys(secondImgNode.primitiveInputs)[0];
    addBinding(
      'secondary_ref_image',
      secondImgNode,
      imgKey,
      'medium',
      `Secondary reference image loader (#${secondImgNode.nodeId} ${secondImgNode.title}) for persona or scene continuity.`
    );
  }

  // Identify nodes that act as LLM / Prompt-Enhancer System Prompts (e.g., #459:479 "Text (System Prompt)" or #18:14)
  // These must NEVER be overwritten with the user's scene prompt!
  const systemPromptNodeIds = new Set<string>();
  for (const s of summaries) {
    const sysLink = s.linkedInputs['system_prompt'];
    if (sysLink) {
      systemPromptNodeIds.add(sysLink.fromNodeId);
    }
    if (/system\s*prompt/i.test(s.title)) {
      systemPromptNodeIds.add(s.nodeId);
    }
    const valStr = String(
      s.primitiveInputs['value'] || s.primitiveInputs['text'] || ''
    ).trim();
    if (
      valStr.startsWith('# Edit Prompt Enhancer') ||
      /^You are an? (uncensored|expert)/i.test(valStr)
    ) {
      systemPromptNodeIds.add(s.nodeId);
    }
  }

  const isSystemPromptNode = (node: ComfyNodeSummary, inputKey?: string) => {
    if (inputKey === 'system_prompt') return true;
    return systemPromptNodeIds.has(node.nodeId);
  };

  // Helper to trace upstream from a sampler conditioning/guider link to find the text encoder / instruction node
  const PROMPT_KEYS = [
    'text',
    'prompt',
    'instruction',
    'edit_prompt',
    'caption',
    'text_g',
    'clip_l',
    't5xxl',
    'string',
    'value',
    'on_false',
    'on_true',
  ];

  const traceTextEncoder = (
    startNodeId: string,
    visited = new Set<string>()
  ): { node: ComfyNodeSummary; key: string } | null => {
    if (visited.has(startNodeId)) return null;
    visited.add(startNodeId);
    const node = byId.get(startNodeId);
    if (!node || isSystemPromptNode(node)) return null;

    // If this is a ComfySwitchNode (like #459:484 in Qwen-Image-2.1-Edit),
    // follow the active branch first, or return the primitive string on on_false/on_true
    if (/Switch/i.test(node.classType)) {
      const isTrueBranch = Boolean(node.primitiveInputs['switch']);
      const activeKey = isTrueBranch ? 'on_true' : 'on_false';
      const fallbackKey = isTrueBranch ? 'on_false' : 'on_true';

      if (node.linkedInputs[activeKey]) {
        const found = traceTextEncoder(
          node.linkedInputs[activeKey].fromNodeId,
          visited
        );
        if (found) return found;
      }
      if (typeof node.primitiveInputs[activeKey] === 'string') {
        return { node, key: activeKey };
      }
      if (node.linkedInputs[fallbackKey]) {
        const found = traceTextEncoder(
          node.linkedInputs[fallbackKey].fromNodeId,
          visited
        );
        if (found) return found;
      }
      if (typeof node.primitiveInputs[fallbackKey] === 'string') {
        return { node, key: fallbackKey };
      }
    }

    // Check if the node has a linked `prompt` or `source` input first (e.g., TextEncodeQwenImage21 -> PreviewAny -> Switch -> TextGenerate)
    for (const [inpName, link] of Object.entries(node.linkedInputs)) {
      if (inpName === 'system_prompt' || inpName === 'negative') continue;
      if (
        [
          'text',
          'prompt',
          'instruction',
          'string',
          'source',
          'on_true',
          'on_false',
          'conditioning',
          'guider',
          'positive',
          'clip_l',
          't5xxl',
        ].some((k) => inpName.toLowerCase().includes(k))
      ) {
        const found = traceTextEncoder(link.fromNodeId, visited);
        if (found) return found;
      }
    }

    for (const candidateKey of PROMPT_KEYS) {
      if (
        typeof node.primitiveInputs[candidateKey] === 'string' &&
        !isSystemPromptNode(node, candidateKey)
      ) {
        return { node, key: candidateKey };
      }
    }

    return null;
  };

  // 1. Locate Sampler / Noise / Scheduler nodes (supports KSampler, SamplerCustomAdvanced, RandomNoise, BasicScheduler, Qwen samplers)
  for (const s of summaries) {
    for (const seedKey of ['seed', 'noise_seed']) {
      if (seedKey in s.primitiveInputs) {
        addBinding(
          'seed',
          s,
          seedKey,
          'high',
          `Found ${seedKey} on node #${s.nodeId} (${s.classType}).`
        );
      }
    }
    if ('steps' in s.primitiveInputs) {
      addBinding(
        'steps',
        s,
        'steps',
        'high',
        `Sampling steps on #${s.nodeId} (${s.classType}).`
      );
    }
    if ('cfg' in s.primitiveInputs) {
      addBinding(
        'cfg',
        s,
        'cfg',
        'high',
        `CFG scale on #${s.nodeId} (${s.classType}).`
      );
    }
    for (const gKey of ['guidance', 'denoise', 'image_strength', 'edit_strength']) {
      if (
        gKey in s.primitiveInputs &&
        typeof s.primitiveInputs[gKey] === 'number'
      ) {
        addBinding(
          'guidance_or_denoise',
          s,
          gKey,
          'high',
          `Guidance / Denoise strength (${gKey}) on #${s.nodeId} (${s.classType}).`
        );
      }
    }
  }

  const samplerNode = summaries.find((s) =>
    /KSampler|SamplerCustom|QwenImage|Moss/i.test(s.classType)
  );

  if (samplerNode) {
    const posLink =
      samplerNode.linkedInputs['positive'] ||
      samplerNode.linkedInputs['conditioning'] ||
      samplerNode.linkedInputs['guider'] ||
      samplerNode.linkedInputs['prompt'];
    if (posLink) {
      const posTarget = traceTextEncoder(posLink.fromNodeId);
      if (posTarget) {
        addBinding(
          'positive_prompt',
          posTarget.node,
          posTarget.key,
          'high',
          `Traced upstream from #${samplerNode.nodeId} to #${posTarget.node.nodeId} (${posTarget.node.title}).`
        );
      }
    }

    const negLink = samplerNode.linkedInputs['negative'];
    if (negLink) {
      const negFromNode = byId.get(negLink.fromNodeId);
      if (
        negFromNode &&
        typeof negFromNode.primitiveInputs['negative_prompt'] === 'string'
      ) {
        addBinding(
          'negative_prompt',
          negFromNode,
          'negative_prompt',
          'high',
          `Matched negative_prompt on #${negFromNode.nodeId} (${negFromNode.title}).`
        );
      } else {
        const negTarget = traceTextEncoder(negLink.fromNodeId);
        if (
          negTarget &&
          (!posLink || negLink.fromNodeId !== posLink.fromNodeId)
        ) {
          addBinding(
            'negative_prompt',
            negTarget.node,
            negTarget.key,
            'high',
            `Traced upstream from #${samplerNode.nodeId} negative link to #${negTarget.node.nodeId} (${negTarget.node.title}).`
          );
        }
      }
    }
  }

  // Fallback for Positive / Negative / Edit Instruction Prompt nodes (excluding System Prompt nodes!)
  const textNodes = summaries.filter(
    (s) =>
      !isSystemPromptNode(s) &&
      Object.keys(s.primitiveInputs).some(
        (k) =>
          PROMPT_KEYS.includes(k) && typeof s.primitiveInputs[k] === 'string'
      )
  );
  // Sort so explicit "User Prompt" / "TextGenerate" / "TextEncode" nodes come first
  textNodes.sort((a, b) => {
    const score = (n: ComfyNodeSummary) => {
      if (/user\s*prompt/i.test(n.title)) return 0;
      if (/TextGenerate|TextEncode|CLIPTextEncode/i.test(n.classType)) return 1;
      return 2;
    };
    return score(a) - score(b);
  });

  for (const tn of textNodes) {
    const key = Object.keys(tn.primitiveInputs).find(
      (k) =>
        PROMPT_KEYS.includes(k) &&
        typeof tn.primitiveInputs[k] === 'string' &&
        !isSystemPromptNode(tn, k)
    );
    if (!key) continue;
    const titleLower = `${tn.title} ${tn.classType}`.toLowerCase();
    const valLower = String(tn.primitiveInputs[key] || '').toLowerCase();
    if (
      titleLower.includes('neg') ||
      valLower.includes('worst quality') ||
      valLower.includes('bad anatomy')
    ) {
      addBinding(
        'negative_prompt',
        tn,
        key,
        'medium',
        `Matched negative prompt on #${tn.nodeId} (${tn.title}).`
      );
    } else {
      addBinding(
        'positive_prompt',
        tn,
        key,
        'medium',
        `Matched prompt / edit instruction on #${tn.nodeId} (${tn.title}).`
      );
    }
  }

  // 2. Latent image dimensions (width & height)
  const latentNode = summaries.find(
    (s) =>
      'width' in s.primitiveInputs &&
      'height' in s.primitiveInputs &&
      /Latent|Empty|Resize|ImageScale|Qwen|Moss/i.test(s.classType + s.title)
  );
  if (latentNode) {
    addBinding(
      'width',
      latentNode,
      'width',
      'high',
      `Width on #${latentNode.nodeId} (${latentNode.title}).`
    );
    addBinding(
      'height',
      latentNode,
      'height',
      'high',
      `Height on #${latentNode.nodeId} (${latentNode.title}).`
    );
  }

  // 3. Checkpoint / UNET / Qwen / Moss model loader
  const ckptNode = summaries.find((s) =>
    ['ckpt_name', 'unet_name', 'model_name', 'model_path'].some(
      (k) => k in s.primitiveInputs
    )
  );
  if (ckptNode) {
    const key = ['ckpt_name', 'unet_name', 'model_name', 'model_path'].find(
      (k) => k in ckptNode.primitiveInputs
    )!;
    addBinding(
      'checkpoint',
      ckptNode,
      key,
      'high',
      `Model loader node #${ckptNode.nodeId} (${ckptNode.classType}).`
    );
  }

  // 4. LoRA loader
  const loraNode = summaries.find((s) => 'lora_name' in s.primitiveInputs);
  if (loraNode) {
    addBinding(
      'lora',
      loraNode,
      'lora_name',
      'high',
      `LoRA loader node #${loraNode.nodeId} (${loraNode.classType}).`
    );
  }

  // 5. Output / SaveImage / PreviewImage node
  const outputNode =
    summaries.find((s) => s.classType === 'SaveImage') ||
    summaries.find((s) =>
      /PreviewImage|SaveImageWebsocket/i.test(s.classType)
    );
  if (outputNode) {
    addBinding(
      'output_image',
      outputNode,
      'images',
      'high',
      `Final image output node #${outputNode.nodeId} (${outputNode.classType}).`
    );
  }

  return bindings;
}

/**
 * Uses the connected Ollama / LM Studio LLM + deterministic graph heuristics to analyze ANY
 * ComfyUI workflow (SDXL, Moss, Flux, Qwen-Image-2.1-Edit, IPAdapter, PulID, etc.)
 * and map character reference images, prompts, seeds, and parameters.
 */
export async function aiAnalyzeComfyWorkflow(
  apiJson: Record<string, any>,
  llmService: LLMServiceConfig,
  userInstruction?: string
): Promise<{
  bindings: ComfyNodeBinding[];
  aiSummary: string;
  detectedStyle: WorkflowPromptStyle;
}> {
  const heuristicBindings = heuristicMapWorkflow(apiJson);
  const graphSummary = summarizeComfyWorkflowGraph(apiJson);
  const fallbackStyle = detectWorkflowPromptStyle(graphSummary);

  const compactGraph = graphSummary.map((n) => ({
    id: n.nodeId,
    type: n.classType,
    title: n.title,
    inputs: n.primitiveInputs,
    links: n.linkedInputs,
  }));

  const systemPrompt = `You are an expert ComfyUI Workflow Architect embedded in RolePlay Studio.
You support ALL modern ComfyUI architectures including:
1. Qwen-Image-2.1-Edit / Flux Kontext / OmniGen / IPAdapter / PulID (workflows that take a LoadImage character reference image + an edit instruction or scene prompt for character consistency!)
2. Moss / Flux.1 / SD3.5 / Qwen-Image (UNETLoader, DualCLIPLoader, TextEncodeQwenImageEdit, RandomNoise, BasicScheduler, FluxGuidance, SamplerCustomAdvanced)
3. SDXL / Illustrious / Pony / SD1.5 (CheckpointLoaderSimple, CLIPTextEncode, KSampler)

Inspect the workflow graph and map node IDs and input keys to these roles:
- "positive_prompt": Main prompt, scene description, or Qwen edit instruction text input (e.g. text, prompt, instruction, edit_prompt)
- "negative_prompt": Negative prompt text input (if used)
- "character_ref_image": Primary LoadImage node (.image input) where the Character's Reference Avatar/Sheet should be injected for character consistency
- "secondary_ref_image": Optional second LoadImage node (.image input) for User Persona or previous scene frame
- "seed": seed or noise_seed input
- "width": Latent or image width input
- "height": Latent or image height input
- "steps": Sampling steps
- "cfg": CFG scale
- "guidance_or_denoise": Flux guidance, edit strength, or denoise input
- "checkpoint": ckpt_name, unet_name, or model_name input
- "lora": lora_name input
- "output_image": SaveImage or PreviewImage node

Also set "detectedStyle" to:
- "edit_instruction" if this is a Qwen-Image-Edit / image-editing / character-reference instruction workflow
- "moss_bbox" if this is a MOSS-Image workflow (CLIPLoader type "moss_image" or Moss UNET) that supports spatial bounding-box layout JSON
- "anima_xl" if this is an Anima / Anima XL anime workflow (Anima UNET / qwen_3_06b text encoder) using hybrid tags + natural prose
- "natural" if this is a Flux / SD3.5 / natural-language workflow
- "sdxl_natural" if this is a realistic/general SDXL workflow (e.g. Juggernaut XL, RealVisXL, SDXL Base) best suited to natural-language prose
- "sdxl_hybrid" if this is an SDXL / Illustrious / NoobAI workflow combining core Danbooru anchor tags with natural language scene prose
- "tags" if this is an SDXL / Pony / Illustrious pure Danbooru tag workflow

Return ONLY valid JSON with this structure:
{
  "summary": "1-2 sentence explanation of this workflow architecture and how character consistency / prompts are linked.",
  "detectedStyle": "edit_instruction" | "moss_bbox" | "anima_xl" | "natural" | "sdxl_natural" | "sdxl_hybrid" | "tags",
  "bindings": [
    {
      "role": "character_ref_image",
      "nodeId": "10",
      "inputKey": "image",
      "reasoning": "Uploads character reference image into LoadImage node #10 for Qwen-Image-2.1-Edit consistency"
    }
  ]
}`;

  const userPrompt = `ComfyUI Workflow Nodes:
${JSON.stringify(compactGraph, null, 2)}

Initial Heuristic Bindings:
${JSON.stringify(heuristicBindings, null, 2)}

${
  userInstruction
    ? `USER OVERRIDE INSTRUCTION: "${userInstruction}". Prioritize this instruction when mapping nodes!`
    : 'Verify and refine all bindings, paying special attention to LoadImage nodes for character consistency and Qwen/Moss prompt nodes.'
}`;

  try {
    const rawReply = await generateChatCompletion(
      llmService,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { jsonMode: true, temperature: 0.2 }
    );

    const jsonMatch = rawReply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('LLM did not return a JSON object');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const byId = new Map(graphSummary.map((n) => [n.nodeId, n]));
    const validatedBindings: ComfyNodeBinding[] = [];

    if (Array.isArray(parsed.bindings)) {
      for (const item of parsed.bindings) {
        const node = byId.get(String(item.nodeId));
        if (!node) continue;
        const inputKey = String(item.inputKey || '');
        if (
          (item.role === 'positive_prompt' ||
            item.role === 'negative_prompt') &&
          (/system\s*prompt/i.test(node.title) || inputKey === 'system_prompt')
        ) {
          continue;
        }
        if (
          inputKey in node.primitiveInputs ||
          (item.role === 'output_image' &&
            (inputKey === 'images' || !inputKey))
        ) {
          validatedBindings.push({
            role: item.role as WorkflowParameterRole,
            nodeId: node.nodeId,
            nodeTitle: node.title,
            classType: node.classType,
            inputKey: item.role === 'output_image' ? 'images' : inputKey,
            currentValue: node.primitiveInputs[inputKey] as
              | string
              | number
              | undefined,
            confidence: 'high',
            reasoning: item.reasoning || 'AI mapped workflow parameter',
          });
        }
      }
    }

    for (const hb of heuristicBindings) {
      if (!validatedBindings.some((vb) => vb.role === hb.role)) {
        validatedBindings.push(hb);
      }
    }

    const style: WorkflowPromptStyle =
      parsed.detectedStyle === 'edit_instruction' ||
      parsed.detectedStyle === 'moss_bbox' ||
      parsed.detectedStyle === 'anima_xl' ||
      parsed.detectedStyle === 'natural' ||
      parsed.detectedStyle === 'sdxl_natural' ||
      parsed.detectedStyle === 'sdxl_hybrid' ||
      parsed.detectedStyle === 'tags'
        ? parsed.detectedStyle
        : fallbackStyle;

    return {
      bindings: validatedBindings,
      aiSummary:
        parsed.summary ||
        `AI analyzed ${graphSummary.length} nodes and linked ${validatedBindings.length} parameters (Mode: ${style}).`,
      detectedStyle: style,
    };
  } catch (err: any) {
    return {
      bindings: heuristicBindings,
      aiSummary: `Mapped ${heuristicBindings.length} nodes via graph traversal (${
        err?.message ? `Note: ${err.message}` : 'Heuristic mode'
      }).`,
      detectedStyle: fallbackStyle,
    };
  }
}

/**
 * Executes any linked ComfyUI workflow (SDXL, Moss, Flux, or Qwen-Image-2.1-Edit).
 * If the workflow has a `character_ref_image` (or `secondary_ref_image`) binding,
 * it automatically uploads the character's reference image to ComfyUI's `/upload/image`
 * endpoint first and injects the uploaded filename into the mapped `LoadImage` node!
 */
export async function executeComfyWorkflow(
  comfy: ComfyUIServiceConfig,
  workflow: ComfyWorkflowProfile,
  params: {
    positivePrompt: string;
    negativePrompt?: string;
    characterReferenceImageUrl?: string;
    secondaryReferenceImageUrl?: string;
    seed?: number;
    width?: number;
    height?: number;
    activeLlmService?: LLMServiceConfig;
    onProgress?: (statusText: string) => void;
  }
): Promise<{
  imageUrl: string;
  seed: number;
  promptId: string;
  referenceUsed: boolean;
  localPath?: string;
  comfyFilename?: string;
}> {
  if (aiTaskQueue.getSnapshot().activeTask) {
    params.onProgress?.('Queued — waiting for active AI task to finish...');
  }

  return aiTaskQueue.enqueue(
    'comfy-image',
    `ComfyUI Render (${workflow.name})`,
    async (updateDetail) => {
      const reportProgress = (msg: string) => {
        updateDetail(msg);
        params.onProgress?.(msg);
      };

      const cleanBase = comfy.baseUrl.replace(/\/+$/, '');

      // Optional Low-VRAM Handoff: Unload Ollama model before starting ComfyUI generation
      if (comfy.lowVramHandoff && params.activeLlmService) {
        reportProgress('Releasing LLM VRAM for ComfyUI...');
        await unloadOllamaModel(params.activeLlmService);
      }

      const promptGraph = JSON.parse(JSON.stringify(workflow.rawApiJson));
      const usedSeed =
        params.seed ?? Math.floor(Math.random() * 900000000000000) + 100000;

      let referenceUsed = false;
      let uploadedPrimaryFilename = '';

      // Re-evaluate heuristic bindings on the graph so <image1> (images.image_1 / images.image0)
      // and <image2> (images.image_2 / images.image1) are always ordered accurately.
      const freshHeuristicBindings = heuristicMapWorkflow(promptGraph);

      // 1. If workflow binds `character_ref_image` and we have a character reference image, upload it to ComfyUI!
      const charRefBinding =
        freshHeuristicBindings.find((b) => b.role === 'character_ref_image') ||
        workflow.bindings.find((b) => b.role === 'character_ref_image');
      if (charRefBinding && params.characterReferenceImageUrl) {
        reportProgress(
          'Uploading character reference image to ComfyUI for consistency...'
        );
        uploadedPrimaryFilename = await uploadImageToComfyUI(
          comfy,
          params.characterReferenceImageUrl,
          `char_ref_${Date.now()}.png`
        );
        const targetNode = promptGraph[charRefBinding.nodeId];
        if (targetNode && targetNode.inputs) {
          targetNode.inputs[charRefBinding.inputKey] = uploadedPrimaryFilename;
          referenceUsed = true;
        }
      }

      // 2. Optional secondary reference image (<image2>: uploaded 2nd image, User Persona, outfit/pose ref, or 2nd character)
      const secRefBinding =
        freshHeuristicBindings.find((b) => b.role === 'secondary_ref_image') ||
        workflow.bindings.find((b) => b.role === 'secondary_ref_image');
      if (params.secondaryReferenceImageUrl) {
        reportProgress('Uploading 2nd reference image (<image2>) to ComfyUI...');
        const uploadedSecond = await uploadImageToComfyUI(
          comfy,
          params.secondaryReferenceImageUrl,
          `secondary_ref_${Date.now()}.png`
        );
        if (secRefBinding && promptGraph[secRefBinding.nodeId]?.inputs) {
          promptGraph[secRefBinding.nodeId].inputs[secRefBinding.inputKey] =
            uploadedSecond;
        } else {
          // If the Qwen-Image-2.1-Edit workflow only had 1 LoadImage node (#470),
          // dynamically create a 2nd LoadImage node and connect it to TextEncodeQwenImage21.inputs["images.image_2"]
          // and BatchImagesNode.inputs["images.image1"] so <image1> and <image2> work out of the box!
          const dynamicNodeId = 'rp_second_ref_image';
          promptGraph[dynamicNodeId] = {
            class_type: 'LoadImage',
            inputs: {
              image: uploadedSecond,
            },
            _meta: {
              title: 'Load 2nd Reference Image (<image2>)',
            },
          };

          for (const node of Object.values(promptGraph) as any[]) {
            if (!node || typeof node !== 'object' || !node.inputs) continue;
            if (
              /TextEncodeQwenImage/i.test(node.class_type) &&
              'images.image_1' in node.inputs &&
              !node.inputs['images.image_2']
            ) {
              node.inputs['images.image_2'] = [dynamicNodeId, 0];
            }
            if (
              node.class_type === 'BatchImagesNode' &&
              'images.image0' in node.inputs &&
              !node.inputs['images.image1']
            ) {
              node.inputs['images.image1'] = [dynamicNodeId, 0];
            }
          }
        }
      } else if (secRefBinding && secRefBinding.nodeId !== charRefBinding?.nodeId) {
        // When only 1 image (<image1> character profile) is used with a 2-image ComfyUI workflow,
        // automatically disconnect optional 2nd-image inputs (`images.image_2`, `images.image1`)
        // and remove the unused 2nd LoadImage node so ComfyUI never throws an error on the 2nd input!
        const secId = secRefBinding.nodeId;
        for (const node of Object.values(promptGraph) as any[]) {
          if (!node || typeof node !== 'object' || !node.inputs) continue;
          if (
            /TextEncodeQwenImage/i.test(node.class_type) &&
            Array.isArray(node.inputs['images.image_2']) &&
            String(node.inputs['images.image_2'][0]) === secId
          ) {
            delete node.inputs['images.image_2'];
          }
          if (
            node.class_type === 'BatchImagesNode' &&
            Array.isArray(node.inputs['images.image1']) &&
            String(node.inputs['images.image1'][0]) === secId
          ) {
            delete node.inputs['images.image1'];
          }
        }

        // Check if any remaining node in the graph still links to secId
        let stillReferenced = false;
        for (const [nid, node] of Object.entries(promptGraph) as [
          string,
          any,
        ][]) {
          if (nid === secId || !node?.inputs) continue;
          for (const val of Object.values(node.inputs)) {
            if (Array.isArray(val) && String(val[0]) === secId) {
              stillReferenced = true;
              break;
            }
          }
        }

        if (!stillReferenced) {
          delete promptGraph[secId];
        } else if (
          uploadedPrimaryFilename &&
          promptGraph[secId]?.inputs
        ) {
          // Fallback if a strict 2-input node (e.g. ImageStitch) still requires secId
          promptGraph[secId].inputs[secRefBinding.inputKey] =
            uploadedPrimaryFilename;
        }
      }

      // 3. Inject text prompts, seed, dimensions (with auto-healing against System Prompt nodes)
      const effectiveBindings = workflow.bindings.map((b) => {
        if (b.role === 'positive_prompt') {
          const targetNode = promptGraph[b.nodeId];
          const title = String(targetNode?._meta?.title || b.nodeTitle || '');
          const val = String(targetNode?.inputs?.[b.inputKey] || '');
          if (
            /system\s*prompt/i.test(title) ||
            b.inputKey === 'system_prompt' ||
            val.startsWith('# Edit Prompt Enhancer') ||
            /^You are an? (uncensored|expert)/i.test(val)
          ) {
            const corrected = freshHeuristicBindings.find(
              (fb) => fb.role === 'positive_prompt'
            );
            if (corrected) return corrected;
          }
        }
        return b;
      });

      for (const binding of effectiveBindings) {
        const targetNode = promptGraph[binding.nodeId];
        if (!targetNode || !targetNode.inputs) continue;

        switch (binding.role) {
          case 'positive_prompt': {
            const title = String(targetNode._meta?.title || '');
            if (!/system\s*prompt/i.test(title)) {
              targetNode.inputs[binding.inputKey] = params.positivePrompt;
            }
            break;
          }
          case 'negative_prompt':
            if (params.negativePrompt !== undefined) {
              const isQwen21Encoder =
                /TextEncodeQwenImage/i.test(targetNode.class_type) &&
                targetNode.inputs[binding.inputKey] === '';
              const isGenericBoilerplate =
                /^lowres,\s*bad anatomy,\s*bad hands/i.test(
                  params.negativePrompt.trim()
                );
              if (!(isQwen21Encoder && isGenericBoilerplate)) {
                targetNode.inputs[binding.inputKey] = params.negativePrompt;
              }
            }
            break;
          case 'seed':
            targetNode.inputs[binding.inputKey] = usedSeed;
            break;
          case 'width':
            if (params.width)
              targetNode.inputs[binding.inputKey] = params.width;
            break;
          case 'height':
            if (params.height)
              targetNode.inputs[binding.inputKey] = params.height;
            break;
        }
      }

      // 3b. For Qwen-Image-2.1-Edit / Moss subgraphs that use ComfySwitchNode + TextGenerate (Prompt Enhancer)
      // or ComfySwitchNode for EmptyLatentImage vs reference image latent size:
      // - Synchronize all user-prompt entry points (both TextGenerate.prompt and ComfySwitchNode.on_false)
      // - Unlock EmptyLatentImage (`on_true`) when custom width/height are configured so a landscape avatar
      //   never locks role-play scene generations into a squashed 16:9 widescreen latent canvas!
      for (const node of Object.values(promptGraph) as any[]) {
        if (!node || typeof node !== 'object' || !node.inputs) continue;
        const title = String(node._meta?.title || '');
        if (/system\s*prompt/i.test(title)) continue;

        if (
          node.class_type === 'TextGenerate' &&
          typeof node.inputs.prompt === 'string'
        ) {
          node.inputs.prompt = params.positivePrompt;
          if (typeof node.inputs['sampling_mode.seed'] === 'number') {
            node.inputs['sampling_mode.seed'] = usedSeed;
          }
        }
        if (
          node.class_type === 'ComfySwitchNode' &&
          typeof node.inputs.on_false === 'string'
        ) {
          node.inputs.on_false = params.positivePrompt;
        }
        if (
          node.class_type === 'ComfySwitchNode' &&
          Array.isArray(node.inputs.on_true) &&
          Array.isArray(node.inputs.on_false)
        ) {
          const trueNode = promptGraph[String(node.inputs.on_true[0])];
          const falseNode = promptGraph[String(node.inputs.on_false[0])];
          // If positivePrompt is a MOSS Layout Bounding-Box JSON, ensure ComfySwitchNode routes the raw JSON (`on_false`)
          // straight into CLIPTextEncode (`type: "moss_image"`) instead of running TextGenerate (`on_true`).
          if (
            trueNode?.class_type === 'TextGenerate' &&
            params.positivePrompt.includes('"bbox_coord_space"') &&
            params.positivePrompt.includes('"abs_centralized"')
          ) {
            node.inputs.switch = false;
          }
          if (
            params.width &&
            params.height &&
            trueNode?.class_type === 'EmptyLatentImage' &&
            /TextEncodeQwenImage/i.test(String(falseNode?.class_type || ''))
          ) {
            node.inputs.switch = true;
          }
        }
        if (
          node.class_type === 'PrimitiveStringMultiline' &&
          /user\s*prompt/i.test(title) &&
          typeof node.inputs.value === 'string'
        ) {
          node.inputs.value = params.positivePrompt;
        }
      }

      // 4. Auto-validate ckpt_name / unet_name against ComfyUI's installed models so placeholder model names never cause HTTP 400 value_not_in_list errors
      try {
        const installed = await fetchComfyModels(comfy);
        for (const node of Object.values(promptGraph) as any[]) {
          if (!node || typeof node !== 'object' || !node.inputs) continue;
          if (
            node.class_type === 'CheckpointLoaderSimple' &&
            typeof node.inputs.ckpt_name === 'string' &&
            installed.checkpoints.length > 0 &&
            !installed.checkpoints.includes(node.inputs.ckpt_name)
          ) {
            const preferred =
              installed.checkpoints.find((c) =>
                /waiIllustrious|ILSDXL/i.test(c)
              ) || installed.checkpoints[0];
            node.inputs.ckpt_name = preferred;
          }
          if (
            node.class_type === 'UNETLoader' &&
            typeof node.inputs.unet_name === 'string' &&
            installed.checkpoints.length > 0 &&
            !installed.checkpoints.includes(node.inputs.unet_name)
          ) {
            const isAnima = /anima/i.test(node.inputs.unet_name + workflow.name);
            const isQwen = /qwen/i.test(node.inputs.unet_name + workflow.name);
            const isMoss = /moss/i.test(node.inputs.unet_name + workflow.name);
            const preferred =
              installed.checkpoints.find((c) =>
                isAnima
                  ? /anima/i.test(c)
                  : isQwen
                  ? /qwen/i.test(c)
                  : isMoss
                  ? /moss/i.test(c)
                  : false
              ) || node.inputs.unet_name;
            node.inputs.unet_name = preferred;
          }
        }
      } catch {
        // Non-fatal if /object_info check fails
      }

      reportProgress('Queueing workflow in ComfyUI...');
      const clientId = `rp-studio-${Date.now()}`;
      const queueRes = await proxyFetch(`${cleanBase}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptGraph,
          client_id: clientId,
        }),
      });

      if (!queueRes.ok) {
        throw new Error(
          `ComfyUI /prompt error (${queueRes.status}): ${await queueRes.text()}`
        );
      }

      const queueData = await queueRes.json();
      const promptId: string = queueData.prompt_id;
      if (!promptId) {
        throw new Error('ComfyUI did not return a prompt_id.');
      }

      // Poll /history/{prompt_id} until output images are ready
      const startTime = Date.now();
      const timeoutMs = 240_000; // 4 minutes max for Qwen-Image-2.1-Edit / Moss / Flux
      let stepCount = 0;

      while (Date.now() - startTime < timeoutMs) {
        await new Promise((r) => setTimeout(r, 1200));
        stepCount++;
        reportProgress(
          `Generating in ComfyUI (${workflow.name})... ${stepCount}s`
        );

        const histRes = await proxyFetch(`${cleanBase}/history/${promptId}`, {
          method: 'GET',
        });
        if (!histRes.ok) continue;

        const histData = await histRes.json();
        const record = histData?.[promptId];
        if (!record) continue;

        if (record.status?.status_str === 'error') {
          throw new Error(
            `ComfyUI execution error: ${JSON.stringify(
              record.status?.messages || ''
            )}`
          );
        }

        const outputs = record.outputs || {};
        const outputBinding = workflow.bindings.find(
          (b) => b.role === 'output_image'
        );
        const candidateNodes = outputBinding
          ? [outputs[outputBinding.nodeId], ...Object.values(outputs)]
          : Object.values(outputs);

        for (const out of candidateNodes) {
          if (
            out &&
            Array.isArray((out as any).images) &&
            (out as any).images.length > 0
          ) {
            const img = (out as any).images[0];
            const query = new URLSearchParams({
              filename: img.filename,
              subfolder: img.subfolder || '',
              type: img.type || 'output',
            }).toString();

            const rawImageUrl = `${cleanBase}/view?${query}`;
            const imgRes = await proxyFetch(rawImageUrl, { method: 'GET' });
            const blob = await imgRes.blob();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });

            // Save rendered PNG as a local file on the PC in data/images/ via /api/images
            let storedImageUrl = dataUrl;
            let localPath: string | undefined;
            try {
              const extMatch = String(img.filename || '').match(/\.(png|jpg|jpeg|webp)$/i);
              const ext = extMatch ? extMatch[0].toLowerCase() : '.png';
              const localFilename = `rp_${Date.now()}_${usedSeed}${ext}`;
              const saveRes = await fetch('/api/images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  filename: localFilename,
                  dataUrl,
                }),
              });
              if (saveRes.ok) {
                const saveJson = await saveRes.json();
                if (saveJson?.url) {
                  storedImageUrl = saveJson.url;
                  localPath = saveJson.localPath;
                }
              }
            } catch {
              // Fallback to inline dataUrl if /api/images fails
            }

            if (comfy.lowVramHandoff) {
              try {
                await proxyFetch(`${cleanBase}/free`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    unload_models: true,
                    free_memory: true,
                  }),
                });
              } catch {
                // ignore
              }
            }

            return {
              imageUrl: storedImageUrl,
              seed: usedSeed,
              promptId,
              referenceUsed,
              localPath,
              comfyFilename: img.filename,
            };
          }
        }
      }

      throw new Error(
        'Timed out waiting for ComfyUI workflow generation (240s).'
      );
    }
  );
}

/**
 * Deletes a locally stored image from `data/images/` on the PC when an image is deleted or replaced.
 */
export async function deleteLocalSavedImage(imageUrl?: string): Promise<void> {
  if (!imageUrl || !imageUrl.startsWith('/api/images/')) return;
  try {
    await fetch(imageUrl, { method: 'DELETE' });
  } catch {
    // non-fatal
  }
}
