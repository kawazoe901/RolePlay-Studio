import React, { useState } from 'react';
import {
  BookOpen,
  HelpCircle,
  Cpu,
  Users,
  Activity,
  Image as ImageIcon,
  Sparkles,
  Check,
  Copy,
  Search,
  ChevronDown,
  ChevronRight,
  Layers,
  Server,
  MessageSquare,
  Workflow,
  ShieldAlert,
  FolderOpen,
  Wand2,
} from 'lucide-react';

interface GuideAndFaqViewProps {
  onNavigateTab?: (
    tab: 'chat' | 'workflows' | 'characters' | 'services' | 'guide'
  ) => void;
}

type GuideCategory =
  | 'all'
  | 'quickstart'
  | 'vram_memory'
  | 'group_relationships'
  | 'status_hud'
  | 'comfy_images'
  | 'troubleshooting';

interface FaqItem {
  id: string;
  category: Exclude<GuideCategory, 'all'>;
  question: string;
  badge: string;
  answer: string[];
  codeSnippet?: {
    label: string;
    content: string;
  };
  actionTab?: {
    label: string;
    tab: 'chat' | 'workflows' | 'characters' | 'services';
  };
}

const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'vram-context-cutoff',
    category: 'vram_memory',
    badge: 'VRAM & Context',
    question:
      'Why do replies cut off early in long conversations, or why is a custom Modelfile context size overridden?',
    answer: [
      'In Service Hub, if "Use Model Default (Modelfile)" is unchecked, RolePlay Studio sends the configured Context Window (num_ctx, e.g. 8192) in the Ollama API request—which overrides the PARAMETER num_ctx inside your Modelfile.',
      'Even when a model supports a very large context window (such as 64k), allocating a huge KV cache on 30B–38B models consumes 10–14 GB of extra VRAM, which can force Ollama to offload layers to system RAM and slow generation down drastically.',
      'Solution: RolePlay Studio uses a 4-Layer Low-VRAM Sliding Context Window. In Role-Play Chat -> Story & Memory -> 3. Story Memory Summary, set "Keep Recent Verbatim Messages" to Last 12 or Last 16 Messages and "Auto-Summarize Aged-Out Turns" to Every 10 Turns. Your full chat stays visible in the UI, while the LLM only processes ~3.5k–4.5k tokens per turn.',
    ],
    actionTab: {
      label: 'Open Service Hub',
      tab: 'services',
    },
  },
  {
    id: 'low-vram-recommended',
    category: 'vram_memory',
    badge: 'Low-VRAM Setup',
    question:
      'What are the best settings for users with 8 GB, 12 GB, 16 GB, or 24 GB of GPU VRAM?',
    answer: [
      '8 GB – 12 GB VRAM: Set Service Hub Context Window (num_ctx) to 4096 or 6144. In Story & Memory -> 3. Story Memory Summary, choose "Last 8 Messages (Ultra Low VRAM ~2.5k ctx)" and "Auto-Summarize Every 8 Turns".',
      '16 GB VRAM: Set Context Window (num_ctx) to 8192. Choose "Last 16 Messages (Recommended Balance ~4.5k ctx)" and "Auto-Summarize Every 10 Turns".',
      '24 GB+ VRAM: Set Context Window (num_ctx) to 12288–16384 (or check "Use Model Default (Modelfile)"). Choose "Last 24 Messages" or "Last 32 Messages".',
      'Remember: The Sequential AI GPU Queue in the bottom footer automatically runs LLM text and ComfyUI image generation one-at-a-time so they never fight over VRAM simultaneously.',
    ],
  },
  {
    id: 'group-chat-how-it-works',
    category: 'group_relationships',
    badge: 'Group RP',
    question:
      'How does Group Chat work when 2 or more characters are in the same story?',
    answer: [
      'When you create a story with 2+ characters (via "+ New Story" in the chat sidebar), you can switch between 3 Group Turn Modes in the chat header:',
      '1. AI Natural Turn: If your message or the previous character mentions another character by name, that character automatically replies next; otherwise turns rotate naturally.',
      '2. Round-Robin: Characters take turns replying in sequential order (Char A -> Char B -> Char C).',
      '3. Manual Click: You click the "Ask [Character] to Speak" buttons at the bottom of the chat to choose who speaks next—you can even trigger two AI characters to talk back-and-forth without speaking in between.',
    ],
    actionTab: {
      label: 'Go to Role-Play Chat',
      tab: 'chat',
    },
  },
  {
    id: 'group-relationship-mapping',
    category: 'group_relationships',
    badge: 'Relationships & Secrets',
    question:
      'In Group Chat, how should shared relationships vs. private character secrets be configured?',
    answer: [
      'For Open Relationships (friends, rivals, party members, or family where everyone knows the public dynamic): putting a [Group Relationships] block inside Story & Memory -> 1. World Setting (or Constant Lore) paired with Status HUD relationship fields is sufficient and uses minimal tokens.',
      'For Secret / Asymmetric Relationships (e.g., Character A has a hidden motive, secret pact, or private alliance that Character B does not know about): do NOT put the secret inside the shared World Setting or shared Lorebook. Anything in World Setting or active Lore is visible to ALL speakers on their turn, so Character B would accidentally know the secret.',
      'How to isolate secrets between AI characters: put public facts ("A and B are longtime allies; {{user}} recently joined the team") in World Setting, and put Character A’s private secret inside Character A’s own Character Card Description—because only the active speaker’s full Description is injected on their turn.',
    ],
    codeSnippet: {
      label: 'Copy Group Relationship Template for World Setting',
      content: `[Group Relationships & Dynamics]
- {{char}} & {{user}}: Childhood friends with unspoken tension.
- {{char}} & [Character B]: Former partners and competitive rivals.
- [Character B] & {{user}}: Cautious allies testing each other's trust.
- Scene Rule: Each character only knows what they have personally witnessed or heard aloud in the scene.`,
    },
  },
  {
    id: 'secondary-npc-intrusion-1on1',
    category: 'group_relationships',
    badge: '1-on-1 RP & Secondary NPCs',
    question:
      'In 1-on-1 role-play, how can secondary NPCs (like a friend, boss, or rival) interrupt via phone calls, texts, or unexpected visits?',
    answer: [
      'In 1-on-1 role-play, you do not need a multi-character group chat for occasional background characters. The active LLM acts as both the main character and the surrounding world/narrator.',
      'To have secondary NPCs (such as a roommate, supervisor, or acquaintance) create tension or surprise events automatically, add a [Secondary NPC & Environmental Intrusion Rule] into Story & Memory -> 1. World Setting or Story Lore.',
      'When tension rises, the LLM can naturally narrate a phone screen lighting up with a call or message (e.g. *A phone buzzes on the table: [Alex: Are you still at the office?]*), and the main character can react in real time.',
      'You can also trigger an interruption anytime by typing a short cue in the Scene Direction / Steer bar (e.g. "Alex calls unexpectedly to check in") and using "Guide & Continue" or "Steer & Suggest".',
      'Live NPC Speech Enactment: When you direct an NPC to speak or call, RolePlay Studio instructs the model not to skip straight to the aftermath (e.g. "*After Alex called...*") and instead depict the NPC speaking live with quoted dialogue in the narration.',
    ],
    codeSnippet: {
      label: 'Copy Secondary NPC Intrusion Template (for World Setting / Story Lore)',
      content: `[Secondary NPC & Environmental Intrusion Rule]
- Secondary NPC: [NPC Name, e.g. Alex] is {{char}}'s [Relationship, e.g. colleague / manager / roommate].
- Dynamic Intrusion: As dramatic tension rises between {{char}} and {{user}}, occasionally have [NPC Name] interrupt the scene via:
  1. An unexpected phone call or incoming text message asking where {{char}} is or requesting an update.
  2. A knock at the door, footsteps approaching outside, or an unplanned encounter.
- Narrative Delivery: Include [NPC Name]'s incoming message text or caller ID directly in the narration (e.g. *Her phone vibrates on the table, displaying: [Alex: Heading back soon?]*).
- Character Reaction: {{char}} should react naturally (urgency, hesitation, lowering their voice, or hiding the screen) while continuing to interact with {{user}}.`,
    },
    actionTab: {
      label: 'Go to Role-Play Chat',
      tab: 'chat',
    },
  },
  {
    id: 'character-card-size-guide',
    category: 'quickstart',
    badge: 'Character Card Limits',
    question:
      'What is the recommended Character Card length and field balance to avoid prompt bloat?',
    answer: [
      'Ideal Sweet Spot (CJK / Chinese cards): keep combined active runtime fields (description + personality + scenario + system_prompt + mes_example + first_mes) between 2,500 and 4,500 characters (~2,000–3,800 tokens), with a practical ceiling under 6,000 characters (~5,500 tokens).',
      'English cards use roughly 3x fewer tokens per character (~0.30 tokens/char vs ~0.92 for CJK), so English cards around 5,000–9,500 characters stay within a similar ~2,000–3,500 token budget.',
      'Flexible Load-Balancing: RolePlay Studio combines system_prompt, description, personality, scenario, and mes_example at runtime, so only the combined total matters—not rigid per-field caps. For rule-heavy characters, put more into system_prompt (e.g. 1,200–1,800 chars of numbered KEY RULES at the top of the prompt) and keep mes_example lean (400–800 chars / 1–3 short <START> voice samples) to reduce line echoing. Baseline split: system_prompt 500–1,200 | description 400–800 | personality 200–500 | scenario 250–500 | mes_example 600–1,200 | first_mes 400–800.',
      'Zero-Cost Storage Tips: creator_notes is NEVER sent to the chat LLM at runtime (0 tokens), so store full master design notes there. Move side characters, locations, or conditional events into keyword-triggered Lorebook entries.',
      'Why oversized cards degrade quality: (1) local models lose focus on instructions buried in massive prompts ("lost in the middle"), (2) every turn re-evaluates the card, slowing first-token latency, (3) too many <START> examples cause premature example echoing, and (4) Group Chats inject multiple characters per turn.',
    ],
    codeSnippet: {
      label: 'Copy Length & Balance Guideline for External Character Card Builders',
      content: `Keep the combined total of description + personality + scenario + system_prompt + mes_example + first_mes between 3,000 and 5,500 CJK characters (hard max 6,000; or 5,000–9,500 chars if English).
You can freely load-balance between fields as long as the combined total stays within budget:
- Rule-heavy RP (recommended): put 1,200–1,800 chars in system_prompt (numbered KEY RULES + core dynamic) and keep mes_example lean (400–800 chars, 1–3 short <START> samples).
- Baseline split: system_prompt 500–1,200 | description 400–800 | personality 200–500 | scenario 250–500 | mes_example 600–1,200 | first_mes 400–800.
Move overflow world lore, side-character bios, and design notes into creator_notes (0 runtime tokens) or keyword-triggered Lorebook entries.`,
    },
    actionTab: {
      label: 'Open Characters & Lore',
      tab: 'characters',
    },
  },
  {
    id: 'status-hud-guide',
    category: 'status_hud',
    badge: 'Status HUD & Meters',
    question:
      'How does the Visual Status HUD & Meter Tracker (<status_bar>) work at the bottom of replies?',
    answer: [
      'In Role-Play Chat, use the Status HUD preset selector (or configure a Character’s Default Status HUD in Characters & Lore) to pick a mode: Auto, RPG Traveler, Romance & Affection, Intimate & Detailed State, or Custom Template.',
      'When active, the AI appends a structured <status_bar>[Key|Value]</status_bar> block at the end of its reply, and RolePlay Studio automatically parses it into visual progress bars, attitude cards, and inner thought quotes.',
      'To save VRAM, RolePlay Studio automatically strips old <status_bar> blocks from earlier turns in prompt history and keeps only the latest state as continuity for the next turn.',
      'You can also click the Status HUD action on any existing assistant message to generate or refresh its HUD card in one click.',
    ],
    codeSnippet: {
      label: 'Copy Custom Status Bar Template Example',
      content: `[Time|Friday, 8:00 PM]
[Location|Observation Deck]
[Outfit|Casual jacket, dark scarf]
[Attitude toward {{user}}|Guarded on the surface, quietly curious]
[Thoughts|Why did they bring this up right now...]
[Trust|65/100]
[Tension|40/100]
[Stage|Chapter 1 · Unspoken Alliance]`,
    },
  },
  {
    id: 'scene-direction-suggestions',
    category: 'quickstart',
    badge: 'Scene Steering',
    question:
      'How can I guide where a scene goes without writing long role-play replies myself?',
    answer: [
      'Use the "Scene Direction" / "Steer & Suggest" controls right above the chat input box.',
      'Enter a brief story beat in the Scene Direction bar (e.g., "Ask about the mysterious letter and step closer") or write a short draft in the chat box and click "Steer & Suggest".',
      'The AI will generate 3 full, in-character replies in distinct tones (Gentle, Direct, Playful/Dramatic). Click "Use in Box" to refine one, or "Send Now" to send it immediately. The Scene Direction field clears automatically once your message is submitted.',
    ],
  },
  {
    id: 'comfy-long-appearance-tags',
    category: 'comfy_images',
    badge: 'Scene Prompts',
    question:
      'What if Character Visual Appearance Tags are very long or include studio poses—will that conflict with live chat scene images?',
    answer: [
      'RolePlay Studio passes Character Visual Appearance Tags through a Core Physical Identity Extractor when generating in-chat scene images.',
      'It keeps permanent identity traits (gender tag, hair color/style, eye color, body build, and distinguishing facial features) while stripping static portrait poses ("sitting portrait"), studio backdrops ("studio background"), and default outfits so the prompt focuses on live scene action, current outfit state, and setting.',
    ],
  },
  {
    id: 'qwen-edit-single-vs-dual',
    category: 'comfy_images',
    badge: 'Qwen-Image-2.1-Edit',
    question:
      'How do Single-Image vs. Two-Image workflows work in ComfyUI (especially Qwen-Image-2.1-Edit)?',
    answer: [
      'Image #1 (<image1>) is always your character’s Portrait / Reference Image from their Character Card.',
      'Image #2 (<image2>) is an optional Secondary Reference (such as an Outfit, Pose, or Background reference) that you can upload inside the "Prompt" preview drawer before clicking Render.',
      'If your ComfyUI workflow has TWO LoadImage nodes mapped, and you only provide 1 image (the character profile), RolePlay Studio automatically disconnects the unused 2nd image wire from the encoder/latent nodes before sending it to ComfyUI so ComfyUI never throws a missing-image error!',
      'For Qwen-Image-2.1-Edit, set the Workflow Prompt Style in ComfyUI Workflow Linker to "Qwen-Image-Edit / Omni (<image1>, <image2>)". It automatically crafts natural single-moment medium portraits to prevent distorted body proportions.',
    ],
    actionTab: {
      label: 'Open ComfyUI Workflow Linker',
      tab: 'workflows',
    },
  },
  {
    id: 'where-are-images-stored',
    category: 'comfy_images',
    badge: 'Disk Storage',
    question:
      'Where are generated images and character portraits stored locally?',
    answer: [
      '1. Inside the app data folder: generated chat images and uploaded portraits are stored locally under data/images/ inside the project directory and served at /api/images/<filename>, so your images still load even when ComfyUI is closed.',
      '2. Inside ComfyUI: any workflow with a SaveImage node also writes the raw output PNG into your ComfyUI output directory.',
      '3. Deleting an image in chat removes it from the message and deletes its mirrored copy in data/images/.',
    ],
  },
  {
    id: 'tts-character-voices',
    category: 'quickstart',
    badge: 'TTS & Voice',
    question:
      'How do I configure Character Voices (TTS), Dialogue-Only reading, and local audio caching?',
    answer: [
      'In Service Hub -> Text-to-Speech (TTS) & Character Voice Synthesis, choose from 4 engines: Built-in Edge Neural TTS (0 VRAM, multilingual), OpenAI-Compatible (/v1/audio/speech for Kokoro / Fish Speech), GPT-SoVITS (local zero-shot voice cloning on port 9880), or Browser Speech.',
      'Dialogue-Only Mode: by default, TTS extracts only spoken lines inside quotes ("...", “...”, 「...」) and automatically skips *action narration*, <think> blocks, and <status_bar> tags. You can switch between "Dialogue Only" and "Full Narration + Quotes" anytime from the chat top bar.',
      'Per-Character Voice Preset: open any character in Characters & World Hub to assign a dedicated voice ID, speed, pitch, or GPT-SoVITS reference clip—and export it inside the Character Card V2 JSON.',
      'Local Audio Caching: synthesized voice clips are cached in data/audio/ and served at /api/audio/<filename>, so replaying a line or listening on your phone over Tailscale is instant.',
    ],
    actionTab: {
      label: 'Configure TTS in Service Hub',
      tab: 'services',
    },
  },
  {
    id: 'ollama-jinja-system-error',
    category: 'troubleshooting',
    badge: 'Troubleshooting',
    question:
      'Why did Ollama return "Error: Jinja Exception: System message must be at the beginning"?',
    answer: [
      'Strict ChatML / Qwen3 Jinja templates in Ollama reject requests that contain any "role": "system" message after index 0.',
      'RolePlay Studio automatically merges all system instructions, lore, status tracker rules, and memory summaries into a single initial system message at index 0, and attaches turn-end reminders as a [Note: ...] on the final user message so this error will never occur.',
    ],
  },
];

export const GuideAndFaqView: React.FC<GuideAndFaqViewProps> = ({
  onNavigateTab,
}) => {
  const [selectedCategory, setSelectedCategory] =
    useState<GuideCategory>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({
    'vram-context-cutoff': true,
    'group-relationship-mapping': true,
    'character-card-size-guide': true,
    'status-hud-guide': true,
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopySnippet = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredFaqs = FAQ_ITEMS.filter((item) => {
    const matchesCat =
      selectedCategory === 'all' || item.category === selectedCategory;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return matchesCat;
    const hay = `${item.question} ${item.badge} ${item.answer.join(' ')} ${
      item.codeSnippet?.content || ''
    }`.toLowerCase();
    return matchesCat && hay.includes(q);
  });

  const categories: Array<{
    id: GuideCategory;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'all',
      label: 'All Topics',
      icon: <BookOpen className="w-3.5 h-3.5" />,
    },
    {
      id: 'vram_memory',
      label: 'VRAM, Context & Memory',
      icon: <Cpu className="w-3.5 h-3.5 text-emerald-400" />,
    },
    {
      id: 'group_relationships',
      label: 'Group Chat & Relationships',
      icon: <Users className="w-3.5 h-3.5 text-indigo-400" />,
    },
    {
      id: 'status_hud',
      label: 'Status HUD & Meters',
      icon: <Activity className="w-3.5 h-3.5 text-pink-400" />,
    },
    {
      id: 'comfy_images',
      label: 'ComfyUI & Qwen Image Edit',
      icon: <ImageIcon className="w-3.5 h-3.5 text-fuchsia-400" />,
    },
    {
      id: 'quickstart',
      label: 'Scene Steering & Tips',
      icon: <Wand2 className="w-3.5 h-3.5 text-amber-400" />,
    },
    {
      id: 'troubleshooting',
      label: 'Troubleshooting',
      icon: <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />,
    },
  ];

  return (
    <div className="max-w-6xl w-full mx-auto p-3 sm:p-6 space-y-5 sm:space-y-6 overflow-x-hidden">
      {/* Hero Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              RolePlay Studio Setup & Architecture Guide
            </div>
            <h1 className="text-xl font-bold text-white">
              Setup Instructions, Low-VRAM Optimization & FAQ
            </h1>
            <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
              Everything you need to configure local LLMs (Ollama / LM Studio),
              optimize context windows for 8 GB–24 GB GPUs, map Group Chat
              relationships without leaking character secrets, and link ComfyUI
              scene generation.
            </p>
          </div>

          {onNavigateTab && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={() => onNavigateTab('services')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium border border-slate-700 transition"
              >
                <Server className="w-3.5 h-3.5 text-indigo-400" />
                1. Service Hub
              </button>
              <button
                onClick={() => onNavigateTab('workflows')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium border border-slate-700 transition"
              >
                <Workflow className="w-3.5 h-3.5 text-fuchsia-400" />
                2. ComfyUI Linker
              </button>
              <button
                onClick={() => onNavigateTab('chat')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                3. Open Chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 4 Architecture Cards Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
            <Cpu className="w-4 h-4" />
            1. Low-VRAM Sliding Memory
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Keeps the last <strong>8–16 messages verbatim</strong> (~3.5k
            tokens) and automatically compresses older turns into a{' '}
            <strong>5–8 bullet Rolling Summary</strong> every 10 turns so Turn
            100+ never runs out of context or VRAM.
          </p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-pink-400 font-semibold text-xs">
            <Activity className="w-4 h-4" />
            2. Live Status HUD Save-State
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Appends a <code>&lt;status_bar&gt;</code> block tracking location,
            clothing, body state, attitudes, and meters. Older status blocks are
            stripped from history so only the latest state is fed to the AI.
          </p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-indigo-400 font-semibold text-xs">
            <Users className="w-4 h-4" />
            3. Group Chat & Secret Isolation
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Put <strong>public relationships</strong> in{' '}
            <em>World Setting / Lore</em>, and put{' '}
            <strong>private secrets</strong> inside each character’s own{' '}
            <em>Character Card Description</em> so other AI speakers can’t
            meta-game secrets.
          </p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-fuchsia-400 font-semibold text-xs">
            <Layers className="w-4 h-4" />
            4. 1-by-1 GPU Queue & Storage
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Queues LLM text and ComfyUI renders sequentially to prevent GPU
            freezes. All images are mirrored to{' '}
            <code>data/images/</code> on your PC for offline access.
          </p>
        </div>
      </div>

      {/* Quick Hardware & VRAM Reference Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 sm:p-5 space-y-3 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Cpu className="w-4 h-4 text-emerald-400" />
            Recommended Context & Memory Settings by GPU VRAM
          </h2>
          <span className="text-[11px] text-slate-400">
            Configure in Service Hub &amp; Chat → Story &amp; Memory
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2 pr-4 font-semibold">GPU VRAM Tier</th>
                <th className="py-2 px-4 font-semibold">
                  Service Hub Context (`num_ctx`)
                </th>
                <th className="py-2 px-4 font-semibold">
                  Keep Recent Verbatim Messages
                </th>
                <th className="py-2 px-4 font-semibold">
                  Auto-Summarize Interval
                </th>
                <th className="py-2 pl-4 font-semibold">
                  Why This Works Best
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-slate-200">
              <tr>
                <td className="py-2.5 pr-4 font-semibold text-amber-300">
                  8 GB – 12 GB VRAM
                </td>
                <td className="py-2.5 px-4">
                  <code>4096</code> – <code>6144</code>
                </td>
                <td className="py-2.5 px-4">
                  <strong>Last 8 or 12 Messages</strong> (~2.5k–3.5k ctx)
                </td>
                <td className="py-2.5 px-4">Every 8 Turns</td>
                <td className="py-2.5 pl-4 text-slate-400">
                  Keeps KV cache tiny so 100% of model layers stay on GPU VRAM
                  besides ComfyUI.
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-semibold text-emerald-300">
                  16 GB VRAM (Sweet Spot)
                </td>
                <td className="py-2.5 px-4">
                  <code>8192</code>
                </td>
                <td className="py-2.5 px-4">
                  <strong>Last 16 Messages</strong> (~4.5k ctx, Default)
                </td>
                <td className="py-2.5 px-4">Every 10 Turns (Default)</td>
                <td className="py-2.5 pl-4 text-slate-400">
                  Leaves 3,500+ tokens of free headroom for long replies +
                  Status HUD without CPU offloading.
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-semibold text-indigo-300">
                  24 GB+ VRAM
                </td>
                <td className="py-2.5 px-4">
                  <code>12288</code> – <code>32768</code> (or Modelfile Default)
                </td>
                <td className="py-2.5 px-4">
                  <strong>Last 24 or 32 Messages</strong> (~6.5k–9k ctx)
                </td>
                <td className="py-2.5 px-4">Every 16 Turns</td>
                <td className="py-2.5 pl-4 text-slate-400">
                  Deep verbatim recall while still avoiding 64k "lost-in-the-middle"
                  attention drift.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Search & Category Filter Bar */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                  selectedCategory === cat.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {cat.icon}
                {cat.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search FAQ, VRAM, Qwen, Group..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Accordion FAQ List */}
        <div className="space-y-3">
          {filteredFaqs.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-400">
              No guide entries matched "{searchQuery}". Try clearing the search
              box or selecting "All Topics".
            </div>
          ) : (
            filteredFaqs.map((item) => {
              const isOpen = Boolean(expandedIds[item.id]);
              return (
                <div
                  key={item.id}
                  className="bg-slate-900/95 border border-slate-800 rounded-2xl overflow-hidden transition"
                >
                  <button
                    onClick={() => toggleExpand(item.id)}
                    className="w-full px-3.5 sm:px-5 py-3.5 sm:py-4 flex items-start sm:items-center justify-between gap-2.5 sm:gap-4 text-left hover:bg-slate-800/40 transition"
                  >
                    <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0">
                      <HelpCircle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5 sm:mt-0" />
                      <span className="text-xs sm:text-sm font-semibold text-white break-words">
                        {item.question}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
                      <span className="hidden sm:inline-block text-[11px] px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-medium">
                        {item.badge}
                      </span>
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-3.5 sm:px-5 pb-4 sm:pb-5 pt-1 border-t border-slate-800/70 space-y-3 text-xs text-slate-300 leading-relaxed break-words">
                      {item.answer.map((paragraph, pIdx) => (
                        <p key={pIdx}>{paragraph}</p>
                      ))}

                      {item.codeSnippet && (
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2 overflow-hidden">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-indigo-300">
                              {item.codeSnippet.label}
                            </span>
                            <button
                              onClick={() =>
                                handleCopySnippet(
                                  item.id,
                                  item.codeSnippet!.content
                                )
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition shrink-0"
                            >
                              {copiedId === item.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  Copy Template
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap break-words leading-relaxed overflow-x-auto max-w-full">
                            {item.codeSnippet.content}
                          </pre>
                        </div>
                      )}

                      {item.actionTab && onNavigateTab && (
                        <div className="pt-1">
                          <button
                            onClick={() => onNavigateTab(item.actionTab!.tab)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition"
                          >
                            {item.actionTab.label} →
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Local Data & File Storage Footer Note */}
      <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-400">
        <div className="flex items-center gap-2.5">
          <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            <strong>Local-First Storage:</strong> Your database is auto-saved to{' '}
            <code className="text-slate-200">data/roleplay-db.json</code> and
            generated images are stored in{' '}
            <code className="text-slate-200">data/images/</code> inside your
            project folder.
          </span>
        </div>
      </div>
    </div>
  );
};
