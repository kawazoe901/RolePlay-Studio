export type LLMProviderType = 'ollama' | 'lmstudio' | 'openai-compatible';

export interface LLMServiceConfig {
  id: string;
  name: string;
  type: LLMProviderType;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  availableModels: string[];
  /** Optional subset of models starred in Service Hub for 1-click quick switching in Chat */
  quickSwitchModels?: string[];
  status: 'disconnected' | 'connected' | 'error' | 'checking';
  lastError?: string;
  parameterMode?: 'preset' | 'custom';
  presetName?: 'default' | 'creative' | 'focused' | 'narrative';
  temperature: number;
  repetitionPenalty?: number;
  topP: number;
  topK?: number;
  minP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  maxTokens: number;
  contextLength: number;
  contextSizeAuto?: boolean;
  enableThinking?: boolean;
}

export type ImageStylePreset =
  | 'photography'
  | 'anime'
  | 'semi_realistic'
  | 'painting'
  | 'manga';

export interface ComfyUIServiceConfig {
  id: string;
  name: string;
  baseUrl: string;
  status: 'disconnected' | 'connected' | 'error' | 'checking';
  lastError?: string;
  lowVramHandoff: boolean;
  defaultWorkflowId?: string;
  /** Default art/medium style for scene & MOSS prompts (photography, anime, etc.) */
  defaultImageStyle?: ImageStylePreset;
}

export type WorkflowParameterRole =
  | 'positive_prompt'
  | 'negative_prompt'
  | 'character_ref_image'
  | 'secondary_ref_image'
  | 'seed'
  | 'width'
  | 'height'
  | 'steps'
  | 'cfg'
  | 'guidance_or_denoise'
  | 'checkpoint'
  | 'lora'
  | 'output_image';

export type WorkflowPromptStyle =
  | 'tags'
  | 'sdxl_hybrid'
  | 'sdxl_natural'
  | 'natural'
  | 'anima_xl'
  | 'moss_bbox'
  | 'edit_instruction';

export type WorkflowPromptLengthPreset =
  | 'compact'
  | 'balanced'
  | 'detailed'
  | 'ultra';

export interface ComfyNodeBinding {
  role: WorkflowParameterRole;
  nodeId: string;
  nodeTitle: string;
  classType: string;
  inputKey: string;
  currentValue?: string | number;
  confidence: 'high' | 'medium' | 'manual';
  reasoning?: string;
}

export interface ComfyWorkflowProfile {
  id: string;
  name: string;
  description: string;
  /**
   * - 'tags': Danbooru comma-separated tags (SDXL / Illustrious / Pony)
   * - 'sdxl_hybrid': Concise Danbooru anchor tags + natural language scene prose (SDXL / Illustrious)
   * - 'sdxl_natural': Concise natural-language scene prose optimized for SDXL CLIP-L + ViT-bigG
   * - 'natural': Rich natural-language prose (Moss / Flux / SD3.5 / Qwen-Image T2I)
   * - 'anima_xl': Hybrid Danbooru tags + natural scene prose (Anima / Anima XL · Qwen3-0.6B)
   * - 'moss_bbox': MOSS-Image spatial bounding-box layout JSON
   * - 'edit_instruction': Character-consistency edit instruction referencing the uploaded character avatar (Qwen-Image-2.1-Edit / Flux Kontext / OmniGen)
   */
  promptStyle: WorkflowPromptStyle;
  /** Optional scene prompt detail/word budget preset (defaults to 'balanced') */
  promptLengthPreset?: WorkflowPromptLengthPreset;
  rawApiJson: Record<string, any>;
  bindings: ComfyNodeBinding[];
  defaultNegativePrompt: string;
  defaultWidth: number;
  defaultHeight: number;
  createdAt: string;
}

export type CharacterGender = 'female' | 'male' | 'non-binary' | 'other';

export type TTSProviderType =
  | 'edge-tts'
  | 'google-tts'
  | 'windows-sapi'
  | 'openai-compatible'
  | 'gpt-sovits'
  | 'browser';

export type TTSReadingMode = 'dialogue_only' | 'full_text';

export interface TTSServiceConfig {
  enabled: boolean;
  provider: TTSProviderType;
  /** Base URL for OpenAI-compatible (/v1) or GPT-SoVITS (http://127.0.0.1:9880) */
  baseUrl: string;
  apiKey?: string;
  /** Model ID for OpenAI-compatible endpoints (e.g. 'kokoro', 'tts-1', 'fish-speech') */
  model: string;
  /** Default voice ID (e.g. 'zh-CN-XiaoxiaoNeural' for Edge TTS, 'af_heart' for Kokoro) */
  defaultVoiceId: string;
  /** Speech speed multiplier (0.5 to 2.0, default 1.0) */
  speed: number;
  /** Pitch adjustment in Hz (-20 to +20, default 0) */
  pitch?: number;
  /** Whether to read spoken quoted lines only or full text (narration + dialogue) */
  readingMode: TTSReadingMode;
  /** Automatically synthesize & play new assistant replies when generation completes */
  autoPlay: boolean;
  /** Cache synthesized audio files in data/audio/ for instant replay & Tailscale phone playback */
  cacheAudio: boolean;
  /** Automatically assign distinct voices when secondary NPCs or other characters speak inside a single message */
  multiVoiceNpc?: boolean;
  /** Default reference audio file path on the host PC for GPT-SoVITS zero-shot voice cloning */
  gptSovitsRefAudioPath?: string;
  /** Transcript of the GPT-SoVITS reference audio clip */
  gptSovitsPromptText?: string;
  /** Language code for the GPT-SoVITS reference clip ('zh' | 'en' | 'ja' | 'ko') */
  gptSovitsPromptLang?: string;
  /** GPT-SoVITS sampling top_k (lower = cleaner/more consistent, default 5) */
  gptSovitsTopK?: number;
  /** GPT-SoVITS sampling top_p (0.5–1.0, default 0.85) */
  gptSovitsTopP?: number;
  /** GPT-SoVITS sampling temperature (0.3–1.2, default 0.8) */
  gptSovitsTemperature?: number;
  /** GPT-SoVITS repetition penalty (1.0–1.8, default 1.35) */
  gptSovitsRepetitionPenalty?: number;
  /** Pause gap between split chunks in seconds (0.05–0.5, default 0.15) */
  gptSovitsFragmentInterval?: number;
  /** GPT-SoVITS text_split_method ('cut2' recommended to avoid chopping every comma) */
  gptSovitsTextSplitMethod?: 'cut2' | 'cut1' | 'cut4' | 'cut3' | 'cut5' | 'cut0';
  status?: 'disconnected' | 'connected' | 'error' | 'checking';
  lastError?: string;
}

export interface CharacterVoiceConfig {
  /** Optional provider override for this character (undefined uses workspace TTS provider) */
  provider?: TTSProviderType;
  /** Character-specific voice ID (e.g. 'zh-CN-XiaoxiaoNeural', 'en-US-AvaMultilingualNeural', 'zf_xiaoxiao') */
  voiceId?: string;
  /** Character-specific speech speed multiplier (0.5 to 2.0) */
  speed?: number;
  /** Character-specific pitch adjustment in Hz (-20 to +20) */
  pitch?: number;
  /** Optional character-specific GPT-SoVITS reference audio file path on host PC */
  refAudioPath?: string;
  /** Transcript of the character's reference audio clip */
  refPromptText?: string;
  /** Language of the character's reference audio clip ('zh' | 'en' | 'ja' | 'ko') */
  refPromptLang?: string;
}

export interface CharacterCardV2 {
  id: string;
  name: string;
  gender?: CharacterGender;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  tags: string[];
  avatarUrl: string;
  /**
   * Optional dedicated high-res character reference image (PNG/JPG data URL)
   * uploaded to ComfyUI's LoadImage node for Qwen-Image-2.1-Edit / Moss / IPAdapter character consistency.
   * Defaults to avatarUrl if not set separately.
   */
  referenceImageUrl?: string;
  /** Visual appearance tags/description injected into ComfyUI prompts */
  visualPrompt: string;
  /** Optional character-specific ComfyUI workflow override */
  preferredWorkflowId?: string;
  /** Optional default Status HUD mode applied automatically when starting a 1-on-1 chat */
  defaultStatusTrackerMode?: StatusTrackerMode;
  /** Optional default Status HUD fields (`<status_bar>...</status_bar>` or `[Key|Val]` lines) */
  defaultCustomStatusTemplate?: string;
  /** Optional default conversation language applied automatically when starting a 1-on-1 chat */
  defaultLanguage?: ConversationLanguage;
  /** Optional default Player Persona ID applied automatically when starting a 1-on-1 chat with this character */
  defaultPersonaId?: string;
  /** Optional per-character TTS voice preset */
  voiceConfig?: CharacterVoiceConfig;
}

export interface UserPersona {
  id: string;
  name: string;
  gender?: CharacterGender;
  description: string;
  visualPrompt: string;
  avatarUrl: string;
}

export interface LorebookEntry {
  id: string;
  name: string;
  keys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  priority: number;
}

export interface Lorebook {
  id: string;
  name: string;
  description: string;
  entries: LorebookEntry[];
}

export interface GeneratedMedia {
  id: string;
  imageUrl: string;
  prompt: string;
  negativePrompt: string;
  seed: number;
  workflowId?: string;
  workflowName: string;
  referenceUsed?: boolean;
  localPath?: string;
  comfyFilename?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  speakerId?: string;
  speakerName: string;
  speakerAvatar?: string;
  swipes: string[];
  activeSwipeIndex: number;
  images?: GeneratedMedia[];
  /** Cached TTS audio file URLs indexed by swipe index (e.g. { 0: '/api/audio/edge_abc123.mp3' }) */
  audioUrls?: Record<number, string>;
  createdAt: string;
  injectedLore?: string[];
  injectedChapters?: string[];
  injectedMemory?: string;
}

export interface StoryMemoryChapter {
  id: string;
  /** Short chapter title, e.g. "Chapter 1: Midnight Encounter at the Cafe" */
  title: string;
  /** 1-based inclusive turn range covered by this chapter, e.g. [1, 10] */
  turnRange: [number, number];
  /** Permanent episodic bullet points preserving concrete events, promises, locations, and facts from these turns */
  summary: string;
  /** Keywords (character names, NPCs, locations, items, events) that auto-recall this chapter when mentioned in later turns */
  keywords: string[];
  /** If true, this chapter is always injected into the prompt regardless of keywords */
  pinned?: boolean;
  createdAt: string;
}

export type GroupTurnMode = 'natural' | 'round-robin' | 'manual';

export type ConversationLanguage =
  | 'auto'
  | 'zh-CN'
  | 'zh-TW'
  | 'en'
  | 'ja'
  | 'ko';

export type StatusTrackerMode =
  | 'auto'
  | 'off'
  | 'rpg_traveler'
  | 'romance_affection'
  | 'intimate_detailed'
  | 'custom';

export interface ChatSession {
  id: string;
  title: string;
  isGroup: boolean;
  characterIds: string[];
  personaId: string;
  /** Optional manual per-chat override for LLM endpoint & model (never auto-switched) */
  preferredLlmServiceId?: string;
  preferredModel?: string;
  /** Conversation language for character replies & suggested responses */
  language?: ConversationLanguage;
  /** Visual Status HUD / Meter Tracker mode at the end of character replies */
  statusTrackerMode?: StatusTrackerMode;
  /** Optional custom template of [Key|...] fields when statusTrackerMode === 'custom' */
  customStatusTemplate?: string;
  /** Self-contained World Setting & Scenario for this specific story */
  worldSetting?: string;
  /** Self-contained Lore / World Info entries belonging exclusively to this story */
  storyLore?: LorebookEntry[];
  lorebookIds: string[];
  groupTurnMode: GroupTurnMode;
  memorySummary: string;
  /** Live personality, confidence, and relationship evolution that supersedes Day-1 character baseline in this story */
  characterEvolution?: string;
  /** Permanent episodic chapter archive so early story arcs (Turns 1-10, 11-20...) are never overwritten in 100+ turn stories */
  memoryChapters?: StoryMemoryChapter[];
  /** Automatically extract new NPCs, locations, items, and story facts into storyLore when summarizing aged-out turns (default = true) */
  autoExtractLore?: boolean;
  /** Number of recent messages to keep verbatim in prompt history (e.g. 8, 12, 16, 24; 0 = fit full token budget) */
  maxRecentMessages?: number;
  /** Automatically fold older messages outside the recent window into memorySummary every N messages (0 = off, default = 10) */
  autoSummarizeEveryNTurns?: number;
  /** Index of the last message already folded into memorySummary for incremental rolling compression */
  summarizedUpToIndex?: number;
  messages: ChatMessage[];
  autoImageEveryNTurns: number;
  /** Sticky art/medium style for scene & MOSS image prompts in this story */
  imageStylePreset?: ImageStylePreset;
  updatedAt: string;
}

export interface AppDatabase {
  llmServices: LLMServiceConfig[];
  activeChatLlmId: string;
  activeHelperLlmId: string;
  comfyService: ComfyUIServiceConfig;
  ttsService?: TTSServiceConfig;
  workflows: ComfyWorkflowProfile[];
  characters: CharacterCardV2[];
  personas: UserPersona[];
  activePersonaId: string;
  lorebooks: Lorebook[];
  chats: ChatSession[];
  activeChatId: string;
  /** Default conversation language for new chats */
  defaultLanguage?: ConversationLanguage;
  /** Starter workflow IDs explicitly deleted by the user so they aren't re-added on reload */
  dismissedStarterWorkflowIds?: string[];
}
