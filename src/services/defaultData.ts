import { AppDatabase, ComfyWorkflowProfile, TTSServiceConfig } from '../types';
import { heuristicMapWorkflow } from './comfyService';

export const DEFAULT_TTS_SERVICE: TTSServiceConfig = {
  enabled: true,
  provider: 'edge-tts',
  baseUrl: 'http://127.0.0.1:8880/v1',
  apiKey: '',
  model: 'kokoro',
  defaultVoiceId: 'auto',
  speed: 1.0,
  pitch: 0,
  readingMode: 'dialogue_only',
  autoPlay: false,
  cacheAudio: true,
  multiVoiceNpc: true,
  gptSovitsRefAudioPath: 'I:\\GPT-SoVITS\\voices\\default_ref_zh.wav',
  gptSovitsPromptText: '你好，欢迎来到角色扮演工作室，今天你想聊些什么呢？',
  gptSovitsPromptLang: 'zh',
  gptSovitsTopK: 5,
  gptSovitsTopP: 0.85,
  gptSovitsTemperature: 0.8,
  gptSovitsRepetitionPenalty: 1.35,
  gptSovitsFragmentInterval: 0.15,
  gptSovitsTextSplitMethod: 'cut2',
  status: 'connected',
};

/**
 * 1. Qwen-Image-2.1-Edit Workflow (Character Consistency Reference Image + Scene Edit Instruction)
 * Uses a LoadImage node (#10) for the Character Reference Avatar/Sheet so Qwen-Image-2.1-Edit
 * preserves the exact character identity while placing them in the current role-play scene!
 */
export const SAMPLE_QWEN_IMAGE_EDIT_WORKFLOW: Record<string, any> = {
  '1': {
    inputs: {
      unet_name: 'qwen_image_edit_2.1_bf16.safetensors',
      weight_dtype: 'default',
    },
    class_type: 'UNETLoader',
    _meta: { title: 'Load Qwen-Image-2.1-Edit Model' },
  },
  '2': {
    inputs: {
      clip_name: 'qwen_2.5_vl_7b_fp8.safetensors',
      type: 'qwen_image',
    },
    class_type: 'CLIPLoader',
    _meta: { title: 'Load Qwen2.5-VL Vision-Language Encoder' },
  },
  '3': {
    inputs: {
      vae_name: 'qwen_image_vae.safetensors',
    },
    class_type: 'VAELoader',
    _meta: { title: 'Load Qwen Image VAE' },
  },
  '10': {
    inputs: {
      image: 'character_reference.png',
      upload: 'image',
    },
    class_type: 'LoadImage',
    _meta: { title: 'Load Character Reference Image (Consistency)' },
  },
  '6': {
    inputs: {
      prompt:
        'Keep the exact character identity, facial features, silver braided hair, and silver-rimmed glasses from the reference image. Change the scene so she is standing inside a rain-lit clockwork observatory at night holding a glowing sapphire Star-Core relic on a velvet cloth, cinematic lighting.',
      clip: ['2', 0],
      vae: ['3', 0],
      image: ['10', 0],
    },
    class_type: 'TextEncodeQwenImageEdit',
    _meta: { title: 'Qwen-Image-2.1-Edit Instruction & Reference Conditioning' },
  },
  '7': {
    inputs: {
      text: 'blurry, distorted face, altered character identity, low quality, bad anatomy, watermark',
      clip: ['2', 0],
    },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'Negative Conditioning' },
  },
  '11': {
    inputs: {
      pixels: ['10', 0],
      vae: ['3', 0],
    },
    class_type: 'VAEEncode',
    _meta: { title: 'Encode Reference Latent' },
  },
  '12': {
    inputs: {
      seed: 918273645,
      steps: 24,
      cfg: 4.5,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 0.85,
      model: ['1', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['11', 0],
    },
    class_type: 'KSampler',
    _meta: { title: 'KSampler (Qwen Edit)' },
  },
  '13': {
    inputs: {
      samples: ['12', 0],
      vae: ['3', 0],
    },
    class_type: 'VAEDecode',
    _meta: { title: 'VAE Decode' },
  },
  '14': {
    inputs: {
      filename_prefix: 'RolePlay_QwenEdit_Consistent',
      images: ['13', 0],
    },
    class_type: 'SaveImage',
    _meta: { title: 'Save Character-Consistent Scene Image' },
  },
};

/**
 * 2. Moss / Flux.1 Modern Natural-Language Diffusion Workflow
 * Uses UNETLoader, DualCLIPLoader, FluxGuidance, RandomNoise, BasicScheduler, SamplerCustomAdvanced.
 */
export const SAMPLE_MOSS_NATURAL_WORKFLOW: Record<string, any> = {
  '1': {
    inputs: {
      unet_name: 'moss_v1_dev_fp8.safetensors',
      weight_dtype: 'fp8_e4m3fn',
    },
    class_type: 'UNETLoader',
    _meta: { title: 'Load Moss / Flux UNET Model' },
  },
  '2': {
    inputs: {
      clip_name1: 't5xxl_fp8_e4m3fn.safetensors',
      clip_name2: 'clip_l.safetensors',
      type: 'flux',
    },
    class_type: 'DualCLIPLoader',
    _meta: { title: 'DualCLIP Loader (T5-XXL + CLIP-L)' },
  },
  '3': {
    inputs: {
      vae_name: 'ae.safetensors',
    },
    class_type: 'VAELoader',
    _meta: { title: 'Load VAE' },
  },
  '5': {
    inputs: {
      width: 1024,
      height: 1024,
      batch_size: 1,
    },
    class_type: 'EmptySD3LatentImage',
    _meta: { title: 'Empty Moss / Flux Latent Dimensions' },
  },
  '6': {
    inputs: {
      text: 'A cinematic portrait of Seraphina Vale, a poised female archivist with long braided silver hair, violet eyes, and silver-rimmed spectacles, standing in a rain-lashed clockwork observatory tower at midnight while inspecting a glowing sapphire Star-Core relic.',
      clip: ['2', 0],
    },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'Natural Language Scene Prompt (Moss / Flux)' },
  },
  '15': {
    inputs: {
      guidance: 3.5,
      conditioning: ['6', 0],
    },
    class_type: 'FluxGuidance',
    _meta: { title: 'Moss / Flux Guidance Scale' },
  },
  '16': {
    inputs: {
      noise_seed: 7812398412,
    },
    class_type: 'RandomNoise',
    _meta: { title: 'Random Seed Noise' },
  },
  '17': {
    inputs: {
      model: ['1', 0],
      conditioning: ['15', 0],
    },
    class_type: 'BasicGuider',
    _meta: { title: 'Basic Guider' },
  },
  '18': {
    inputs: {
      sampler_name: 'euler',
    },
    class_type: 'KSamplerSelect',
    _meta: { title: 'Sampler Select' },
  },
  '19': {
    inputs: {
      scheduler: 'simple',
      steps: 22,
      denoise: 1.0,
      model: ['1', 0],
    },
    class_type: 'BasicScheduler',
    _meta: { title: 'Basic Scheduler (Steps & Denoise)' },
  },
  '20': {
    inputs: {
      noise: ['16', 0],
      guider: ['17', 0],
      sampler: ['18', 0],
      sigmas: ['19', 0],
      latent_image: ['5', 0],
    },
    class_type: 'SamplerCustomAdvanced',
    _meta: { title: 'SamplerCustomAdvanced (Moss / Flux)' },
  },
  '21': {
    inputs: {
      samples: ['20', 0],
      vae: ['3', 0],
    },
    class_type: 'VAEDecode',
    _meta: { title: 'VAE Decode' },
  },
  '22': {
    inputs: {
      filename_prefix: 'RolePlay_Moss_Scene',
      images: ['21', 0],
    },
    class_type: 'SaveImage',
    _meta: { title: 'Save Moss / Flux Scene Image' },
  },
};

/**
 * 3. Standard SDXL / Illustrious / Pony Tag Workflow
 */
export const SAMPLE_COMFY_API_WORKFLOW: Record<string, any> = {
  '3': {
    inputs: {
      seed: 428910412,
      steps: 24,
      cfg: 7,
      sampler_name: 'euler_ancestral',
      scheduler: 'normal',
      denoise: 1,
      model: ['4', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
    },
    class_type: 'KSampler',
    _meta: { title: 'KSampler (Main)' },
  },
  '4': {
    inputs: {
      ckpt_name: 'ILSDXL\\waiIllustriousSDXL_v170.safetensors',
    },
    class_type: 'CheckpointLoaderSimple',
    _meta: { title: 'Load Checkpoint' },
  },
  '5': {
    inputs: {
      width: 832,
      height: 1216,
      batch_size: 1,
    },
    class_type: 'EmptyLatentImage',
    _meta: { title: 'Empty Latent Image (Portrait)' },
  },
  '6': {
    inputs: {
      text: 'masterpiece, best quality, 1girl, silver hair, violet eyes, astral library, glowing grimoire, cinematic lighting',
      clip: ['4', 1],
    },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
  },
  '7': {
    inputs: {
      text: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, watermark, blurry',
      clip: ['4', 1],
    },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Negative Prompt)' },
  },
  '8': {
    inputs: {
      samples: ['3', 0],
      vae: ['4', 2],
    },
    class_type: 'VAEDecode',
    _meta: { title: 'VAE Decode' },
  },
  '9': {
    inputs: {
      filename_prefix: 'RolePlayStudio_Scene',
      images: ['8', 0],
    },
    class_type: 'SaveImage',
    _meta: { title: 'Save Final Scene Image' },
  },
};

export const STARTER_WORKFLOW_TEMPLATES: ComfyWorkflowProfile[] = [
  {
    id: 'wf-qwen-image-edit',
    name: 'Qwen-Image-2.1-Edit (Character Consistency + Scene Edit)',
    description:
      'Uploads the character reference avatar into LoadImage (#10) and uses Qwen-Image-2.1-Edit instruction conditioning (#6) to preserve exact character appearance across every role-play scene.',
    promptStyle: 'edit_instruction',
    rawApiJson: SAMPLE_QWEN_IMAGE_EDIT_WORKFLOW,
    bindings: heuristicMapWorkflow(SAMPLE_QWEN_IMAGE_EDIT_WORKFLOW),
    defaultNegativePrompt:
      'blurry, distorted face, altered character identity, low quality, bad anatomy, watermark',
    defaultWidth: 1024,
    defaultHeight: 1024,
    createdAt: '2026-11-09T12:00:00.000Z',
  },
  {
    id: 'wf-moss-natural',
    name: 'Moss / Flux.1 — Natural Language Cinematic Scene',
    description:
      'Modern UNET + DualCLIP (T5/CLIP) + SamplerCustomAdvanced workflow using rich natural-language scene descriptions crafted by your local LLM.',
    promptStyle: 'natural',
    rawApiJson: SAMPLE_MOSS_NATURAL_WORKFLOW,
    bindings: heuristicMapWorkflow(SAMPLE_MOSS_NATURAL_WORKFLOW),
    defaultNegativePrompt: '',
    defaultWidth: 1024,
    defaultHeight: 1024,
    createdAt: '2026-11-09T12:00:00.000Z',
  },
  {
    id: 'wf-sdxl-standard',
    name: 'SDXL / Illustrious — Tag-Based Portrait',
    description:
      'Standard Checkpoint + CLIPTextEncode + KSampler workflow for Danbooru tag-based anime and realistic checkpoints.',
    promptStyle: 'tags',
    rawApiJson: SAMPLE_COMFY_API_WORKFLOW,
    bindings: heuristicMapWorkflow(SAMPLE_COMFY_API_WORKFLOW),
    defaultNegativePrompt:
      'lowres, bad anatomy, bad hands, text, error, worst quality, low quality, blurry, watermark',
    defaultWidth: 832,
    defaultHeight: 1216,
    createdAt: '2026-11-09T12:00:00.000Z',
  },
];

export const DEFAULT_DATABASE: AppDatabase = {
  llmServices: [
    {
      id: 'llm-ollama-local',
      name: 'Ollama (Local)',
      type: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      defaultModel: '',
      availableModels: [],
      status: 'disconnected',
      parameterMode: 'preset',
      presetName: 'default',
      temperature: 0.8,
      repetitionPenalty: 1.1,
      topP: 0.9,
      topK: 30,
      maxTokens: 1024,
      contextLength: 8192,
      contextSizeAuto: true,
    },
    {
      id: 'llm-lmstudio-local',
      name: 'LM Studio (OpenAI Local)',
      type: 'lmstudio',
      baseUrl: 'http://127.0.0.1:1234/v1',
      defaultModel: '',
      availableModels: [],
      status: 'disconnected',
      parameterMode: 'preset',
      presetName: 'default',
      temperature: 0.8,
      repetitionPenalty: 1.1,
      topP: 0.9,
      topK: 30,
      maxTokens: 1024,
      contextLength: 8192,
      contextSizeAuto: true,
    },
  ],
  activeChatLlmId: 'llm-ollama-local',
  activeHelperLlmId: 'llm-ollama-local',
  comfyService: {
    id: 'comfy-local',
    name: 'Local ComfyUI Server',
    baseUrl: 'http://127.0.0.1:8188',
    status: 'disconnected',
    lowVramHandoff: false,
    defaultWorkflowId: 'wf-qwen-image-edit',
  },
  ttsService: DEFAULT_TTS_SERVICE,
  workflows: STARTER_WORKFLOW_TEMPLATES,
  characters: [
    {
      id: 'char-seraphina',
      name: 'Seraphina Vale',
      gender: 'female',
      description:
        '{{char}} is the Head Archivist of the Obsidian Spire, an ancient clockwork observatory suspended above a sea of clouds. She is sharp-witted, secretly curious about forbidden pre-collapse artifacts, and speaks with measured elegance.',
      personality:
        'Analytical, poised, dryly humorous, fiercely protective of ancient knowledge, secretly warm.',
      scenario:
        "{{user}} has arrived at the Obsidian Spire late at night carrying an unrecorded Star-Core relic that hums when brought near {{char}}'s desk.",
      first_mes:
        '*The brass pendulums of the Grand Astrolabe click softly overhead as rain lashes against the stained-glass dome. Seraphina adjusts her silver-rimmed spectacles, her violet eyes locking onto the pulsing Star-Core resting in your palm.*\n\n"The Spire doors were sealed an hour ago, traveler," *she murmurs, setting her quill down beside an open grimoire.* "Which means you either bypassed three arcane wards... or that relic in your hand unlocked them for you. Place it on the velvet cloth before it scorches your fingers."',
      mes_example:
        '<START>\n{{user}}: "Can you read the inscription on its surface?"\n{{char}}: *She leans closer, a lock of silver hair slipping over her shoulder as the relic\'s blue light reflects in her eyes.* "Pre-Shattering High Aetherian. Give me a moment—and don\'t touch the outer ring."',
      creator_notes:
        'Starter fantasy/steampunk role-play character with pre-configured ComfyUI visual tags and Qwen-Image-2.1-Edit consistency support.',
      system_prompt:
        'Stay strictly in character as {{char}}. Write physical actions, sensory descriptions, and silent internal thoughts in *asterisks* (or brief inner thoughts in *single quotes* inside asterisks), and reserve double quotation marks ("...") strictly for words actually spoken out loud—never put unspoken thoughts inside double quotes. Never speak or act on behalf of {{user}}.',
      post_history_instructions: '',
      alternate_greetings: [
        '*Seraphina looks up from a floating holographic star-chart, surprised to see {{user}} standing on the balcony of the Obsidian Spire.*\n\n"You\'re early. Did the Council send you, or are you here about the anomaly in the lower vaults?"',
      ],
      tags: ['fantasy', 'steampunk', 'archivist', 'mystery'],
      avatarUrl: '',
      visualPrompt:
        '1girl, solo, silver hair, long braided hair, violet eyes, silver-rimmed glasses, dark blue gothic archivist coat, gold filigree, glowing arcane library background',
    },
    {
      id: 'char-kaelen',
      name: 'Kaelen Vance',
      gender: 'male',
      description:
        '{{char}} is a rogue sky-ship captain and relic smuggler with a cybernetic compass-eye and a reckless grin. Often clashes with {{char}} Seraphina over whether relics belong in a museum or powering sky-ships.',
      personality:
        'Daring, charismatic, pragmatic, quick on his feet, loyal to his crew.',
      scenario: 'Aboard the airship "Sunbreaker" docked at the Obsidian Spire.',
      first_mes:
        '*Kaelen leans against the brass railing of the airship dock, tossing a whistling aether-coin between his gloved fingers.*\n\n"Tell me you brought the core, {{user}}. The Imperial patrol frigates are already sweeping the lower cloud-bank, and I\'d rather not test their cannon range tonight."',
      mes_example: '',
      creator_notes:
        'Great companion character for testing Group Chats alongside Seraphina.',
      system_prompt:
        'Stay strictly in character as {{char}}. Keep dialogue punchy and atmospheric. Write physical actions, sensory descriptions, and silent internal thoughts in *asterisks* (or brief inner thoughts in *single quotes* inside asterisks), and reserve double quotation marks ("...") strictly for words actually spoken out loud—never put unspoken thoughts inside double quotes. Never write actions or dialogue for {{user}}.',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: ['steampunk', 'captain', 'adventure'],
      avatarUrl: '',
      visualPrompt:
        '1boy, solo, tousled dark hair, amber cybernetic eye, leather sky-captain trenchcoat, brass goggles around neck, airship deck at night, dramatic lighting',
    },
  ],
  personas: [
    {
      id: 'persona-default',
      name: 'Traveler',
      gender: 'male',
      description:
        'An independent relic hunter and scholar exploring the Shattered Skies.',
      visualPrompt: 'hooded traveler, dark cloak, glowing relic in hand',
      avatarUrl: '',
    },
  ],
  activePersonaId: 'persona-default',
  lorebooks: [
    {
      id: 'lore-obsidian-spire',
      name: 'Chronicles of the Shattered Skies',
      description:
        'World info for the Obsidian Spire, Star-Cores, and High Aetherian lore.',
      entries: [
        {
          id: 'le-1',
          name: 'The Obsidian Spire',
          keys: ['spire', 'obsidian spire', 'observatory', 'archive'],
          content:
            'The Obsidian Spire is a neutral floating citadel anchored at 14,000 feet by pre-Shattering gravity coils. Its Grand Astrolabe tracks fragments of fallen stars.',
          enabled: true,
          constant: false,
          priority: 10,
        },
        {
          id: 'le-2',
          name: 'Star-Core Relics',
          keys: ['star-core', 'relic', 'core', 'aetherian'],
          content:
            'Star-Cores are crystalline engines forged before the Great Shattering. They resonate with living pulse-beats and glow sapphire blue when awakened.',
          enabled: true,
          constant: false,
          priority: 20,
        },
      ],
    },
  ],
  chats: [
    {
      id: 'chat-starter-1',
      title: 'Midnight at the Obsidian Spire',
      isGroup: false,
      characterIds: ['char-seraphina'],
      personaId: 'persona-default',
      lorebookIds: ['lore-obsidian-spire'],
      groupTurnMode: 'natural',
      memorySummary: '',
      autoImageEveryNTurns: 0,
      updatedAt: '2026-11-09T12:00:00.000Z',
      messages: [
        {
          id: 'msg-init-1',
          role: 'assistant',
          speakerId: 'char-seraphina',
          speakerName: 'Seraphina Vale',
          speakerAvatar: '',
          swipes: [
            '*The brass pendulums of the Grand Astrolabe click softly overhead as rain lashes against the stained-glass dome. Seraphina adjusts her silver-rimmed spectacles, her violet eyes locking onto the pulsing Star-Core resting in your palm.*\n\n"The Spire doors were sealed an hour ago, traveler," *she murmurs, setting her quill down beside an open grimoire.* "Which means you either bypassed three arcane wards... or that relic in your hand unlocked them for you. Place it on the velvet cloth before it scorches your fingers."',
            '*Seraphina looks up from a floating holographic star-chart, surprised to see Traveler standing on the balcony of the Obsidian Spire.*\n\n"You\'re early. Did the Council send you, or are you here about the anomaly in the lower vaults?"',
          ],
          activeSwipeIndex: 0,
          createdAt: '2026-11-09T12:00:00.000Z',
        },
      ],
    },
  ],
  activeChatId: 'chat-starter-1',
};
