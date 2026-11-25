import React, { Suspense, lazy, useState, useRef, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  AppDatabase,
  CharacterCardV2,
  CharacterGender,
  ChatMessage,
  ChatSession,
  ConversationLanguage,
  GeneratedMedia,
  ImageStylePreset,
  LorebookEntry,
  StatusTrackerMode,
  StoryMemoryChapter,
  TTSReadingMode,
  UserPersona,
  WorkflowPromptLengthPreset,
  WorkflowPromptStyle,
} from '../types';
import { DEFAULT_TTS_SERVICE } from '../services/defaultData';
import { ttsPlayer } from '../services/ttsService';
import {
  CONVERSATION_LANGUAGES,
  IMAGE_STYLE_PRESETS,
  MOSS_SPATIAL_PRESETS,
  MossBoundingBoxItem,
  WORKFLOW_PROMPT_LENGTH_PRESETS,
  absCentralizedYxyxToPctBox,
  aiExtractLoreFromStory,
  aiGenerateStoryWorldAndOpening,
  applyVisualStyleToMossCaption,
  buildRolePlayMessages,
  craftSceneImagePrompt,
  formatGenderBadge,
  generateIncrementalStorySummary,
  generateSuggestedUserResponses,
  getImageStylePresetSpec,
  getLanguageInstruction,
  parseMossLayoutPrompt,
  pctBoxToAbsCentralizedYxyx,
  replaceMacros,
  selectNextGroupSpeaker,
  serializeMossLayoutPrompt,
} from '../services/promptEngine';
import { generateChatCompletion } from '../services/llmService';
import {
  deleteLocalSavedImage,
  executeComfyWorkflow,
  isMossWorkflow,
  resolveWorkflowCanvasSize,
} from '../services/comfyService';
import { LlmParametersPanel } from './LlmParametersPanel';
import { MessageStatusHudCard } from './MessageStatusHudCard';
import { ConfirmActionModal, ConfirmActionState } from './ConfirmActionModal';
import { BufferedField } from './BufferedField';

const SceneGalleryAndLightboxModals = lazy(() =>
  import('./SceneGalleryAndLightboxModals').then((m) => ({
    default: m.SceneGalleryAndLightboxModals,
  }))
);
const StatusHudEditorModal = lazy(() =>
  import('./StatusHudEditorModal').then((m) => ({
    default: m.StatusHudEditorModal,
  }))
);
import {
  ParsedStatusField,
  appendStatusBarToGreeting,
  buildStatusTrackerSystemInstruction,
  detectGameOverFromMessages,
  extractLatestRawStatusBlock,
  getDefaultStatusTemplateForMode,
  getStatusStartingPresets,
  healGeneratedStatusContinuity,
  isHateOrHostilityMeterKey,
  isNumericStatusField,
  parseMessageStatusBlocks,
  parseStatusTemplateRows,
  replaceMessageStatusBarBlock,
  resolveCharacterInitialStatusConfig,
  serializeStatusTemplateRows,
} from '../utils/statusTracker';
import {
  Send,
  Sparkles,
  Image as ImageIcon,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Plus,
  Users,
  User,
  Trash2,
  Brain,
  Edit3,
  Check,
  X,
  Eye,
  GitBranch,
  Sliders,
  FastForward,
  Lightbulb,
  Globe,
  Download,
  FolderOpen,
  Maximize2,
  Minimize2,
  Compass,
  Activity,
  Menu,
  Settings2,
  MessageSquare,
  Volume2,
  VolumeX,
  Square,
  Pin,
  Film,
  BookOpen,
  UserCheck,
  Skull,
  Flame,
  Cpu,
} from 'lucide-react';

export const CHARACTER_STEER_PRESETS = [
  {
    label: '🎯 Stay on Topic',
    prompt:
      'Stay strictly focused on what was just said and done; do not change subjects or divert to unrelated matters.',
  },
  {
    label: '😳 Shy & Flustered',
    prompt:
      'Act flustered and shy, blushing deeply while speaking softly with hesitation.',
  },
  {
    label: '💖 Warm & Intimate',
    prompt: 'Be warm, receptive, and emotionally open, leaning in closer.',
  },
  {
    label: '🔥 Daring & Bolder',
    prompt:
      'Tease back with a daring smile, provocative eye contact, and bolder actions.',
  },
  {
    label: '🤫 Secret & Guilt',
    prompt:
      'Feel a wave of guilt and secrecy, torn between fear of being caught and temptation.',
  },
  {
    label: '📱 NPC Enters / Calls',
    prompt:
      'A secondary NPC (e.g. friend, waiter, or caller) speaks or calls directly in the scene; quote the NPC\'s live spoken words.',
  },
];

interface Props {
  db: AppDatabase;
  onUpdateDb: (updater: (prev: AppDatabase) => AppDatabase) => void;
}

const MossCoordNumberInput: React.FC<{
  value: number;
  min: number;
  max: number;
  onCommit: (nextVal: number) => void;
}> = ({ value, min, max, onCommit }) => {
  const [draft, setDraft] = useState<string>(String(value));
  const [isEditing, setIsEditing] = useState<boolean>(false);

  useEffect(() => {
    if (!isEditing) {
      setDraft(String(value));
    }
  }, [value, isEditing]);

  const commitValue = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      setDraft(String(value));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, Math.round(parsed)));
    setDraft(String(clamped));
    if (clamped !== value) {
      onCommit(clamped);
    }
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      value={isEditing ? draft : value}
      onFocus={(e) => {
        setIsEditing(true);
        setDraft(String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const nextRaw = e.target.value;
        setDraft(nextRaw);
        const trimmed = nextRaw.trim();
        if (trimmed !== '') {
          const parsed = Number(trimmed);
          if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
            onCommit(Math.round(parsed));
          }
        }
      }}
      onBlur={() => {
        setIsEditing(false);
        commitValue(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          setIsEditing(false);
          commitValue(draft);
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setIsEditing(false);
          setDraft(String(value));
          e.currentTarget.blur();
        }
      }}
      className="w-11 bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-center text-slate-200"
    />
  );
};

interface ChatComposerBarProps {
  externalDraft: { text: string; seq: number } | null;
  draftRef: React.MutableRefObject<string>;
  charName: string;
  personaName: string;
  placeholder: string;
  isGeneratingText: boolean;
  isGeneratingSuggestions: boolean;
  isStoryLocked: boolean;
  showDirectionBar: boolean;
  hasSuggestionDirection: boolean;
  onSendMessage: (rawText: string) => void;
  onSuggestReplies: (draftText: string) => void;
  onContinue: () => void;
  onToggleDirection: () => void;
}

const ChatComposerBar: React.FC<ChatComposerBarProps> = React.memo(
  ({
    externalDraft,
    draftRef,
    charName,
    personaName,
    placeholder,
    isGeneratingText,
    isGeneratingSuggestions,
    isStoryLocked,
    showDirectionBar,
    hasSuggestionDirection,
    onSendMessage,
    onSuggestReplies,
    onContinue,
    onToggleDirection,
  }) => {
    const [text, setText] = useState<string>('');
    const [isExpanded, setIsExpanded] = useState<boolean>(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const rafIdRef = useRef<number | null>(null);
    const lastAppliedHeightRef = useRef<number>(0);

    useEffect(() => {
      if (!externalDraft) return;
      draftRef.current = externalDraft.text;
      setText(externalDraft.text);
    }, [externalDraft, draftRef]);

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const minHeight = isExpanded ? 190 : 56;
        const maxHeight = isExpanded ? 400 : 240;
        // Shrink height to measure cleanly only when lines were deleted or toggled; otherwise grow directly
        el.style.height = `${minHeight}px`;
        const nextHeight = Math.min(
          Math.max(el.scrollHeight, minHeight),
          maxHeight
        );
        if (nextHeight !== lastAppliedHeightRef.current) {
          lastAppliedHeightRef.current = nextHeight;
        }
        el.style.height = `${nextHeight}px`;
      });
      return () => {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };
    }, [text, isExpanded]);

    const handleSendClick = () => {
      if (!text.trim() || isGeneratingText || isStoryLocked) return;
      onSendMessage(text);
    };

    return (
      <div className="w-full flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-end">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            rows={isExpanded ? 7 : 2}
            value={text}
            onChange={(e) => {
              const raw = e.target.value;
              const nextVal = raw.includes('{{')
                ? replaceMacros(raw, charName, personaName)
                : raw;
              draftRef.current = nextVal;
              setText(nextVal);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendClick();
              }
            }}
            disabled={isStoryLocked}
            placeholder={placeholder}
            className="w-full bg-slate-950 border border-slate-700/90 rounded-xl pl-4 pr-10 py-2.5 text-sm text-slate-100 leading-relaxed focus:outline-none focus:border-indigo-500 overflow-y-auto resize-y disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            title={
              isExpanded
                ? 'Shrink chat box'
                : 'Expand chat box for longer writing'
            }
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-indigo-300 border border-slate-800 transition"
          >
            {isExpanded ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-start w-full sm:w-auto">
          <div className="inline-flex items-center rounded-xl border border-amber-500/30 bg-amber-500/15 overflow-hidden flex-1 sm:flex-initial justify-center">
            <button
              onClick={() => onSuggestReplies(text)}
              disabled={
                isGeneratingSuggestions || isGeneratingText || isStoryLocked
              }
              title="Have AI suggest 3 in-character responses (uses your Scene Direction or rough draft in the chat box if present)"
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2.5 sm:py-3 hover:bg-amber-500/25 text-amber-300 text-xs font-semibold transition disabled:opacity-40"
            >
              <Lightbulb
                className={`w-4 h-4 ${
                  isGeneratingSuggestions ? 'animate-pulse' : ''
                }`}
              />
              <span>{isGeneratingSuggestions ? 'Thinking...' : 'Suggest'}</span>
            </button>
            <button
              onClick={onToggleDirection}
              disabled={isStoryLocked}
              title="Toggle optional Scene Direction input to steer AI suggestions"
              className={`px-2 py-2.5 sm:py-3 border-l border-amber-500/30 hover:bg-amber-500/25 transition shrink-0 disabled:opacity-40 ${
                showDirectionBar || hasSuggestionDirection
                  ? 'bg-amber-500/30 text-amber-200'
                  : 'text-amber-300/80'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={onContinue}
            disabled={isGeneratingText || isStoryLocked}
            title="Let the AI continue and advance the scene without typing a message"
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2.5 sm:py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition disabled:opacity-40"
          >
            <FastForward className="w-4 h-4 text-emerald-400" />
            <span>Continue</span>
          </button>

          <button
            onClick={handleSendClick}
            disabled={isGeneratingText || !text.trim() || isStoryLocked}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold transition disabled:opacity-40 shadow-sm"
          >
            <Send className="w-4 h-4" />
            <span>Send</span>
          </button>
        </div>
      </div>
    );
  }
);

interface DirectorGuidanceBarProps {
  visible: boolean;
  externalGuidance: { text: string; seq: number } | null;
  guidanceRef: React.MutableRefObject<string>;
  composerDraftRef: React.MutableRefObject<string>;
  charName: string;
  personaName: string;
  isGeneratingText: boolean;
  isGeneratingSuggestions: boolean;
  isArchivedChat: boolean;
  onGuideContinue: (guidanceText: string) => void;
  onSuggestReplies: (guidanceText: string) => void;
  onSendUserDraft: (userDraft: string) => void;
  onClose: () => void;
}

const DirectorGuidanceBar: React.FC<DirectorGuidanceBarProps> = React.memo(
  ({
    visible,
    externalGuidance,
    guidanceRef,
    composerDraftRef,
    charName,
    personaName,
    isGeneratingText,
    isGeneratingSuggestions,
    isArchivedChat,
    onGuideContinue,
    onSuggestReplies,
    onSendUserDraft,
    onClose,
  }) => {
    const [text, setText] = useState<string>('');

    useEffect(() => {
      if (!externalGuidance) return;
      guidanceRef.current = externalGuidance.text;
      setText(externalGuidance.text);
    }, [externalGuidance, guidanceRef]);

    if (!visible && !text) return null;

    return (
      <div className="w-full max-w-full flex flex-col gap-2.5 bg-amber-950/25 border border-amber-500/40 rounded-xl p-2.5 sm:p-3 shadow-lg animate-in fade-in duration-150 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-bold text-amber-300 truncate">
              <Compass className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="hidden sm:inline">
                Director&apos;s Note · Guide {charName}&apos;s Next Reply
              </span>
              <span className="sm:hidden">Director&apos;s Note</span>
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-amber-500/30 text-amber-200 shrink-0 hidden xs:inline">
              Anti-Divergence
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => {
                const g = text.trim();
                guidanceRef.current = '';
                setText('');
                onGuideContinue(g);
              }}
              disabled={isGeneratingText || isArchivedChat}
              title="Have the character advance the story right now following this direction"
              className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-200 text-xs font-semibold transition disabled:opacity-40"
            >
              <FastForward className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="hidden sm:inline">Guide &amp; </span>Continue
            </button>
            <button
              type="button"
              onClick={() => onSuggestReplies(text)}
              disabled={
                isGeneratingSuggestions || isGeneratingText || isArchivedChat
              }
              title="Generate 3 player reply options following this direction"
              className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/35 border border-amber-500/40 text-amber-200 text-xs font-semibold transition disabled:opacity-40"
            >
              <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="hidden sm:inline">Suggest Player </span>Replies
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close guidance bar"
              className="p-1 text-slate-400 hover:text-white shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative">
          <input
            type="text"
            value={text}
            onChange={(e) => {
              const raw = e.target.value;
              const nextVal = raw.includes('{{')
                ? replaceMacros(raw, charName, personaName)
                : raw;
              guidanceRef.current = nextVal;
              setText(nextVal);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (composerDraftRef.current.trim()) {
                  onSendUserDraft(composerDraftRef.current);
                } else {
                  const g = text.trim();
                  guidanceRef.current = '';
                  setText('');
                  onGuideContinue(g);
                }
              }
            }}
            placeholder={`e.g. 'Stay strictly on topic, blush shyly and agree to sit together, do not change the subject' (type {{char}} for ${charName})...`}
            className="w-full bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-lg pl-3 pr-10 py-1.5 text-xs text-slate-100 focus:outline-none"
          />
          {text && (
            <button
              type="button"
              onClick={() => {
                guidanceRef.current = '';
                setText('');
              }}
              className="absolute right-2.5 top-1.5 text-slate-400 hover:text-white text-xs"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-slate-400 mr-0.5">
            Quick Steer Presets:
          </span>
          {CHARACTER_STEER_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                guidanceRef.current = p.prompt;
                setText(p.prompt);
              }}
              className="px-2 py-0.5 rounded bg-slate-900/90 hover:bg-amber-900/40 border border-slate-700/80 hover:border-amber-500/40 text-[10px] text-amber-200 transition"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
);

const InlineMessageEditor: React.FC<{
  initialText: string;
  onSave: (nextText: string) => void;
  onCancel: () => void;
}> = React.memo(({ initialText, onSave, onCancel }) => {
  const [draft, setDraft] = useState<string>(initialText);
  return (
    <div className="space-y-2">
      <textarea
        rows={4}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-100"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 text-xs text-slate-300"
        >
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
        <button
          onClick={() => onSave(draft)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-xs text-white"
        >
          <Check className="w-3.5 h-3.5" /> Save
        </button>
      </div>
    </div>
  );
});

const InlineMessageSteerBox: React.FC<{
  speakerName: string;
  charName: string;
  personaName: string;
  initialPrompt: string;
  isGeneratingText: boolean;
  onExecute: (guidance: string) => void;
  onCancel: () => void;
}> = React.memo(
  ({
    speakerName,
    charName,
    personaName,
    initialPrompt,
    isGeneratingText,
    onExecute,
    onCancel,
  }) => {
    const [draft, setDraft] = useState<string>(initialPrompt);
    return (
      <div className="mt-2.5 p-3 rounded-xl bg-amber-950/35 border border-amber-500/40 space-y-2.5 shadow-lg">
        <div className="flex items-center justify-between text-xs text-amber-300 font-semibold">
          <span className="flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-amber-400" />
            Steer {speakerName}&apos;s Reply for this Turn:
          </span>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-white p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="relative">
          <input
            type="text"
            value={draft}
            onChange={(e) => {
              const raw = e.target.value;
              const nextVal = raw.includes('{{')
                ? replaceMacros(raw, charName, personaName)
                : raw;
              setDraft(nextVal);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onExecute(draft);
              }
            }}
            placeholder="e.g. 'Stay on topic, do not mention homework, shyly accept the invitation'..."
            className="w-full bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-lg pl-3 pr-8 py-1.5 text-xs text-slate-100 focus:outline-none"
          />
          {draft && (
            <button
              type="button"
              onClick={() => setDraft('')}
              className="absolute right-2.5 top-1.5 text-slate-400 hover:text-white text-xs"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-slate-400 mr-0.5">
              Quick Presets:
            </span>
            {CHARACTER_STEER_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setDraft(p.prompt)}
                className="px-2 py-0.5 rounded bg-slate-900/90 hover:bg-amber-900/40 border border-slate-700/80 hover:border-amber-500/40 text-[10px] text-amber-200 transition"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onExecute(draft)}
              disabled={isGeneratingText}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow transition disabled:opacity-40"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Regenerate with Guidance
            </button>
          </div>
        </div>
      </div>
    );
  }
);

export const ChatWorkspaceView: React.FC<Props> = ({ db, onUpdateDb }) => {
  const composerDraftRef = useRef<string>('');
  const [externalDraft, setExternalDraft] = useState<{
    text: string;
    seq: number;
  } | null>(null);
  const setComposerDraft = (nextText: string) => {
    composerDraftRef.current = nextText;
    setExternalDraft({ text: nextText, seq: Date.now() });
  };

  const guidanceDraftRef = useRef<string>('');
  const [externalGuidance, setExternalGuidance] = useState<{
    text: string;
    seq: number;
  } | null>(null);
  const setDirectorGuidance = (nextText: string) => {
    guidanceDraftRef.current = nextText;
    setExternalGuidance({ text: nextText, seq: Date.now() });
  };
  const [isGeneratingText, setIsGeneratingText] = useState<boolean>(false);
  const [streamingText, setStreamingText] = useState<string>('');
  const [streamingSpeaker, setStreamingSpeaker] =
    useState<CharacterCardV2 | null>(null);
  const [chatError, setChatError] = useState<string>('');
  const ttsSnapshot = useSyncExternalStore(
    ttsPlayer.subscribe,
    ttsPlayer.getSnapshot
  );

  // In-chat ComfyUI image generation state
  const [generatingImageForMsgId, setGeneratingImageForMsgId] = useState<
    string | null
  >(null);
  const [imageProgressText, setImageProgressText] = useState<string>('');
  const [showMemoryModal, setShowMemoryModal] = useState<boolean>(false);
  const [showLlmParamsModal, setShowLlmParamsModal] = useState<boolean>(false);
  const [storyBibleTab, setStoryBibleTab] = useState<
    'world' | 'lore' | 'memory'
  >('world');
  const [isExtractingLore, setIsExtractingLore] = useState<boolean>(false);
  const [isSummarizingMemory, setIsSummarizingMemory] =
    useState<boolean>(false);

  const [showNewGroupModal, setShowNewGroupModal] = useState<boolean>(false);
  const [selectedGroupCharIds, setSelectedGroupCharIds] = useState<string[]>(
    db.characters.slice(0, 1).map((c) => c.id)
  );
  const [newStoryTitle, setNewStoryTitle] = useState<string>('');
  const [newStoryWorldSetting, setNewStoryWorldSetting] = useState<string>('');
  const [newStoryOpening, setNewStoryOpening] = useState<string>('');
  const [newStoryLore, setNewStoryLore] = useState<LorebookEntry[]>([]);
  const [newStoryLanguage, setNewStoryLanguage] =
    useState<ConversationLanguage>(db.defaultLanguage || 'auto');
  const [newStoryPersonaId, setNewStoryPersonaId] = useState<string>(
    db.activePersonaId
  );
  const [isGeneratingStoryWorld, setIsGeneratingStoryWorld] =
    useState<boolean>(false);

  // Quick Create / Switch Persona Modal State
  const [showQuickPersonaModal, setShowQuickPersonaModal] =
    useState<boolean>(false);
  const [quickPersonaTarget, setQuickPersonaTarget] = useState<
    'active_chat' | 'new_story'
  >('active_chat');
  const [quickPersonaName, setQuickPersonaName] = useState<string>('');
  const [quickPersonaGender, setQuickPersonaGender] =
    useState<CharacterGender>('male');
  const [quickPersonaDesc, setQuickPersonaDesc] = useState<string>('');

  // Editing message state
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [lightboxImage, setLightboxImage] = useState<GeneratedMedia | null>(
    null
  );
  const [visibleMessageCount, setVisibleMessageCount] = useState<number>(35);

  // Prompt Preview & Gallery Drawer State (REQ-006)
  const [promptPreviewTarget, setPromptPreviewTarget] =
    useState<ChatMessage | null>(null);
  const [draftReplaceImageId, setDraftReplaceImageId] = useState<string | null>(
    null
  );
  const [draftPositivePrompt, setDraftPositivePrompt] = useState<string>('');
  const [draftWorkflowId, setDraftWorkflowId] = useState<string>('');
  const [draftPromptLength, setDraftPromptLength] =
    useState<WorkflowPromptLengthPreset>('balanced');
  const [draftPrimaryRefImage, setDraftPrimaryRefImage] = useState<string>('');
  const [draftSecondaryRefImage, setDraftSecondaryRefImage] =
    useState<string>('');
  const [draftSecondImageRole, setDraftSecondImageRole] = useState<string>(
    'Outfit / Clothing Reference'
  );
  const [isDraftingPrompt, setIsDraftingPrompt] = useState<boolean>(false);
  const [showGalleryModal, setShowGalleryModal] = useState<boolean>(false);

  // Suggested User Responses & Composer Expansion State
  const [suggestedReplies, setSuggestedReplies] = useState<string[]>([]);
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] =
    useState<boolean>(false);
  const [showDirectionBar, setShowDirectionBar] = useState<boolean>(false);
  const [showGuidanceBar, setShowGuidanceBar] = useState<boolean>(false);
  const [steerMsgId, setSteerMsgId] = useState<string | null>(null);
  const [steerPrompt, setSteerPrompt] = useState<string>('');
  const [generatingStatusForMsgId, setGeneratingStatusForMsgId] = useState<
    string | null
  >(null);
  const [showCustomStatusModal, setShowCustomStatusModal] =
    useState<boolean>(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [showMobileToolsModal, setShowMobileToolsModal] = useState<boolean>(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(
    null
  );

  // Visual Novel Theater / Immersive Mode State
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(false);
  const [theaterTurnIndex, setTheaterTurnIndex] = useState<number | null>(null);
  const [showTheaterHud, setShowTheaterHud] = useState<boolean>(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeSession =
    db.chats.find((c) => c.id === db.activeChatId) || db.chats[0];

  const activePersona =
    db.personas.find((p) => p.id === (activeSession?.personaId || db.activePersonaId)) ||
    db.personas[0];

  const sessionCharacters = activeSession
    ? db.characters.filter((c) => activeSession.characterIds.includes(c.id))
    : [db.characters[0]];

  const isArchivedChat = Boolean(
    activeSession && sessionCharacters.length === 0
  );

  useEffect(() => {
    setVisibleMessageCount(35);
  }, [activeSession?.id]);

  const totalSessionMessages = activeSession?.messages.length || 0;
  const hiddenMessageCount = Math.max(
    0,
    totalSessionMessages - visibleMessageCount
  );
  const visibleMessages = useMemo(
    () =>
      activeSession
        ? activeSession.messages.slice(hiddenMessageCount)
        : [],
    [activeSession, hiddenMessageCount]
  );

  const gameOverState = useMemo(
    () =>
      activeSession
        ? detectGameOverFromMessages(
            activeSession.messages,
            activeSession.statusTrackerMode
          )
        : { isGameOver: false },
    [activeSession?.messages, activeSession?.statusTrackerMode]
  );

  const isStoryLocked = isArchivedChat || gameOverState.isGameOver;

  const globalChatLlm =
    db.llmServices.find((s) => s.id === db.activeChatLlmId) ||
    db.llmServices[0];

  const isChatLlmPinned = Boolean(
    activeSession?.preferredLlmServiceId || activeSession?.preferredModel
  );

  const resolvedBaseChatLlm =
    (activeSession?.preferredLlmServiceId &&
      db.llmServices.find(
        (s) => s.id === activeSession.preferredLlmServiceId
      )) ||
    globalChatLlm;

  const primaryChatLlm =
    resolvedBaseChatLlm && activeSession?.preferredModel
      ? { ...resolvedBaseChatLlm, defaultModel: activeSession.preferredModel }
      : resolvedBaseChatLlm;

  const helperLlm =
    db.llmServices.find((s) => s.id === db.activeHelperLlmId) ||
    primaryChatLlm;

  const quickSwitchLlmGroups = useMemo(
    () =>
      db.llmServices
        .map((svc) => {
          const favorites = (svc.quickSwitchModels || []).filter((m) =>
            m.trim()
          );
          const baseList =
            favorites.length > 0
              ? favorites
              : svc.availableModels.length > 0
              ? svc.availableModels
              : svc.defaultModel
              ? [svc.defaultModel]
              : [];
          const models = Array.from(
            new Set([
              ...baseList,
              ...(svc.defaultModel ? [svc.defaultModel] : []),
              ...(activeSession?.preferredLlmServiceId === svc.id &&
              activeSession?.preferredModel
                ? [activeSession.preferredModel]
                : []),
            ])
          ).filter(Boolean);
          return { service: svc, models };
        })
        .filter((group) => group.models.length > 0),
    [
      db.llmServices,
      activeSession?.preferredLlmServiceId,
      activeSession?.preferredModel,
    ]
  );

  const currentChatLlmEncodedValue = primaryChatLlm
    ? JSON.stringify([primaryChatLlm.id, primaryChatLlm.defaultModel || ''])
    : '';

  const handleQuickSwitchChatModel = (encodedSelection: string) => {
    let serviceId = '';
    let modelName = '';
    try {
      const parsed = JSON.parse(encodedSelection) as [string, string];
      serviceId = parsed[0] || '';
      modelName = parsed[1] || '';
    } catch {
      return;
    }
    if (!serviceId || !modelName) return;

    if (activeSession && isChatLlmPinned) {
      onUpdateDb((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === activeSession.id
            ? {
                ...c,
                preferredLlmServiceId: serviceId,
                preferredModel: modelName,
              }
            : c
        ),
      }));
      return;
    }

    onUpdateDb((prev) => ({
      ...prev,
      activeChatLlmId: serviceId,
      llmServices: prev.llmServices.map((s) =>
        s.id === serviceId ? { ...s, defaultModel: modelName } : s
      ),
    }));
  };

  const handleTogglePinChatModel = () => {
    if (!activeSession || !primaryChatLlm) return;
    if (isChatLlmPinned) {
      onUpdateDb((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === activeSession.id
            ? {
                ...c,
                preferredLlmServiceId: undefined,
                preferredModel: undefined,
              }
            : c
        ),
      }));
    } else {
      onUpdateDb((prev) => ({
        ...prev,
        chats: prev.chats.map((c) =>
          c.id === activeSession.id
            ? {
                ...c,
                preferredLlmServiceId: primaryChatLlm.id,
                preferredModel: primaryChatLlm.defaultModel || '',
              }
            : c
        ),
      }));
    }
  };

  useEffect(() => {
    if (!showNewGroupModal) return;
    if (selectedGroupCharIds.length === 1) {
      const char = db.characters.find((c) => c.id === selectedGroupCharIds[0]);
      setNewStoryLanguage(
        char?.defaultLanguage || db.defaultLanguage || 'auto'
      );
      setNewStoryPersonaId(
        char?.defaultPersonaId &&
          db.personas.some((p) => p.id === char.defaultPersonaId)
          ? char.defaultPersonaId
          : db.activePersonaId
      );
    } else {
      setNewStoryLanguage(db.defaultLanguage || 'auto');
      setNewStoryPersonaId(db.activePersonaId);
    }
  }, [
    showNewGroupModal,
    selectedGroupCharIds,
    db.characters,
    db.defaultLanguage,
    db.activePersonaId,
    db.personas,
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages.length, streamingText]);

  useEffect(() => {
    setTheaterTurnIndex(null);
  }, [activeSession?.id, activeSession?.messages.length]);

  const updateActiveSession = (
    updater: (session: ChatSession) => ChatSession
  ) => {
    if (!activeSession) return;
    onUpdateDb((prev) => ({
      ...prev,
      chats: prev.chats.map((c) =>
        c.id === activeSession.id ? updater(c) : c
      ),
    }));
  };

  /**
   * Triggers a character response from the active LLM.
   */
  const triggerCharacterReply = async (
    sessionSnapshot: ChatSession,
    forcedSpeaker?: CharacterCardV2,
    appendSwipeToMessageId?: string,
    isContinue?: boolean,
    guidanceOverride?: string
  ) => {
    setChatError('');
    setSuggestedReplies([]);
    if (!forcedSpeaker && sessionCharacters.length === 0) {
      setChatError(
        'This chat is a read-only archive because its character was deleted. Start a new story or switch chats to continue.'
      );
      return;
    }
    const speaker =
      forcedSpeaker ||
      selectNextGroupSpeaker(sessionSnapshot, sessionCharacters);

    const effectiveLanguage: ConversationLanguage =
      sessionSnapshot.language || db.defaultLanguage || 'auto';

    const effectiveGuidance =
      guidanceOverride !== undefined
        ? guidanceOverride.trim()
        : guidanceDraftRef.current.trim();

    const promptBundle = buildRolePlayMessages({
      session: { ...sessionSnapshot, language: effectiveLanguage },
      activeCharacter: speaker,
      allSessionCharacters: sessionCharacters,
      persona: activePersona,
      lorebooks: db.lorebooks,
      maxContextTokens: primaryChatLlm.contextLength || 8192,
      isContinue,
      characterGuidance: effectiveGuidance || undefined,
    });

    setIsGeneratingText(true);
    setStreamingSpeaker(speaker);
    setStreamingText('');

    try {
      const reply = await generateChatCompletion(
        primaryChatLlm,
        promptBundle.messages,
        {
          stopSequences: promptBundle.stopSequences,
          taskLabel: `${speaker.name} Reply (${
            primaryChatLlm.defaultModel || primaryChatLlm.name
          })`,
          onToken: (_chunk, full) => {
            setStreamingText(full);
          },
        }
      );

      const rawCleaned =
        reply.trim() || `*${speaker.name} pauses thoughtfully.*`;
      const cleanedReply = healGeneratedStatusContinuity(
        rawCleaned,
        sessionSnapshot.messages
      );

      let targetMessageId = appendSwipeToMessageId || `msg-${Date.now()}`;

      onUpdateDb((prev) => ({
        ...prev,
        chats: prev.chats.map((c) => {
          if (c.id !== sessionSnapshot.id) return c;
          if (appendSwipeToMessageId) {
            return {
              ...c,
              updatedAt: new Date().toISOString(),
              messages: c.messages.map((m) => {
                if (m.id !== appendSwipeToMessageId) return m;
                const nonStubSwipes = m.swipes.filter(
                  (s) => s.trim().length > 16
                );
                const nextSwipes =
                  nonStubSwipes.length > 0
                    ? [...nonStubSwipes, cleanedReply]
                    : [cleanedReply];
                return {
                  ...m,
                  swipes: nextSwipes,
                  activeSwipeIndex: nextSwipes.length - 1,
                  injectedLore: promptBundle.injectedLoreNames,
                  injectedChapters: promptBundle.injectedChapterTitles,
                };
              }),
            };
          } else {
            const newMsg: ChatMessage = {
              id: targetMessageId,
              role: 'assistant',
              speakerId: speaker.id,
              speakerName: speaker.name,
              speakerAvatar: speaker.avatarUrl,
              swipes: [cleanedReply],
              activeSwipeIndex: 0,
              createdAt: new Date().toISOString(),
              injectedLore: promptBundle.injectedLoreNames,
              injectedChapters: promptBundle.injectedChapterTitles,
            };
            return {
              ...c,
              updatedAt: new Date().toISOString(),
              messages: [...c.messages, newMsg],
            };
          }
        }),
      }));

      // If TTS Auto-Play is enabled, automatically synthesize & play the spoken dialogue
      if (db.ttsService?.enabled !== false && db.ttsService?.autoPlay) {
        const swipeIdxForTts = appendSwipeToMessageId
          ? (sessionSnapshot.messages.find(
              (m) => m.id === appendSwipeToMessageId
            )?.swipes.length || 0)
          : 0;
        const msgIdForTts = appendSwipeToMessageId || targetMessageId;
        setTimeout(() => {
          ttsPlayer.toggleOrSpeak({
            id: `${msgIdForTts}:${swipeIdxForTts}`,
            rawText: cleanedReply,
            ttsConfig: db.ttsService,
            character: speaker,
            allCharacters: db.characters,
            languageHint: effectiveLanguage,
            onAudioCached: (audioUrl) => {
              onUpdateDb((prev) => ({
                ...prev,
                chats: prev.chats.map((c) =>
                  c.id === sessionSnapshot.id
                    ? {
                        ...c,
                        messages: c.messages.map((m) =>
                          m.id === msgIdForTts
                            ? {
                                ...m,
                                audioUrls: {
                                  ...(m.audioUrls || {}),
                                  [swipeIdxForTts]: audioUrl,
                                },
                              }
                            : m
                        ),
                      }
                    : c
                ),
              }));
            },
          });
        }, 120);
      }

      // If Auto-Image Every N Turns is enabled, automatically trigger ComfyUI scene generation!
      const turnCount = sessionSnapshot.messages.filter(
        (m) => m.role === 'assistant'
      ).length + 1;
      if (
        !appendSwipeToMessageId &&
        sessionSnapshot.autoImageEveryNTurns > 0 &&
        turnCount % sessionSnapshot.autoImageEveryNTurns === 0
      ) {
        const autoMsg: ChatMessage = {
          id: targetMessageId,
          role: 'assistant',
          speakerId: speaker.id,
          speakerName: speaker.name,
          speakerAvatar: speaker.avatarUrl,
          swipes: [cleanedReply],
          activeSwipeIndex: 0,
          createdAt: new Date().toISOString(),
        };
        setTimeout(() => {
          handleVisualizeMessage(autoMsg);
        }, 150);
      }

      // If Auto-Summarize Aged-Out Turns is enabled (default = every 10 messages),
      // fold older messages outside the recent sliding window into session.memorySummary in the background!
      const autoSummarizeInterval =
        sessionSnapshot.autoSummarizeEveryNTurns === undefined
          ? 10
          : sessionSnapshot.autoSummarizeEveryNTurns;
      const keepRecentCount =
        sessionSnapshot.maxRecentMessages === undefined
          ? 16
          : sessionSnapshot.maxRecentMessages;

      if (
        !appendSwipeToMessageId &&
        autoSummarizeInterval > 0 &&
        keepRecentCount > 0
      ) {
        const updatedMessages: ChatMessage[] = [
          ...sessionSnapshot.messages,
          {
            id: targetMessageId,
            role: 'assistant',
            speakerId: speaker.id,
            speakerName: speaker.name,
            speakerAvatar: speaker.avatarUrl,
            swipes: [cleanedReply],
            activeSwipeIndex: 0,
            createdAt: new Date().toISOString(),
          },
        ];
        const cutoffIdx = Math.max(0, updatedMessages.length - keepRecentCount);
        const alreadySummarized = sessionSnapshot.summarizedUpToIndex || 0;
        const unsummarizedAgedCount = cutoffIdx - alreadySummarized;

        if (unsummarizedAgedCount >= autoSummarizeInterval) {
          const snapshotForSummary: ChatSession = {
            ...sessionSnapshot,
            messages: updatedMessages,
          };
          generateIncrementalStorySummary({
            llmService: helperLlm,
            session: snapshotForSummary,
            characters: sessionCharacters,
            effectiveLanguage,
            onlySummarizeOlderThanRecentWindow: true,
          })
            .then((res) => {
              if (!res) return;
              onUpdateDb((prev) => ({
                ...prev,
                chats: prev.chats.map((c) => {
                  if (c.id !== sessionSnapshot.id) return c;
                  const existingChapters = (c.memoryChapters || []).filter(
                    (ch, idx, arr) =>
                      !(
                        idx > 0 &&
                        ch.turnRange[0] === 1 &&
                        ch.turnRange[1] > 40 &&
                        arr.length > 2
                      )
                  );
                  const nextChapters = res.newChapter
                    ? [
                        ...existingChapters.filter(
                          (ch) =>
                            !(
                              ch.turnRange[0] === res.newChapter!.turnRange[0] &&
                              ch.turnRange[1] === res.newChapter!.turnRange[1]
                            )
                        ),
                        res.newChapter,
                      ]
                    : existingChapters;

                  const existingLore = c.storyLore || [];
                  const existingLoreSet = new Set(
                    existingLore.map((e) => e.name.trim().toLowerCase())
                  );
                  const autoLoreToAdd =
                    c.autoExtractLore !== false && res.extractedLore
                      ? res.extractedLore.filter(
                          (e) => !existingLoreSet.has(e.name.trim().toLowerCase())
                        )
                      : [];

                  return {
                    ...c,
                    memorySummary: res.summary,
                    ...(res.characterEvolution !== undefined
                      ? { characterEvolution: res.characterEvolution }
                      : {}),
                    summarizedUpToIndex: res.summarizedUpToIndex,
                    memoryChapters: nextChapters,
                    storyLore: [...existingLore, ...autoLoreToAdd],
                  };
                }),
              }));
            })
            .catch(() => {
              // Silent background fallback (buildRolePlayMessages already includes condensed recap)
            });
        }
      }
    } catch (err: any) {
      setChatError(
        err?.message ||
          `Could not reach ${primaryChatLlm.name}. Check your connection & selected model in Service Hub.`
      );
    } finally {
      setIsGeneratingText(false);
      setStreamingSpeaker(null);
      setStreamingText('');
    }
  };

  const handleSendUserMessage = async (rawDraft?: string) => {
    const sourceText = rawDraft !== undefined ? rawDraft : composerDraftRef.current;
    if (!sourceText.trim() || !activeSession || isGeneratingText) return;
    if (gameOverState.isGameOver) {
      setChatError(
        `GAME OVER: ${gameOverState.meterName || 'Hate'} reached ${
          gameOverState.meterDisplay || '100/100'
        }. This timeline has ended — use Swipe, Undo Fatal Turn, Branch, or Reset Story below to continue.`
      );
      return;
    }
    if (sessionCharacters.length === 0) {
      setChatError(
        'This chat is a read-only archive because its character was deleted. Start a new story or switch chats to continue.'
      );
      return;
    }
    const leadSpeaker =
      selectNextGroupSpeaker(activeSession, sessionCharacters) ||
      sessionCharacters[0] ||
      db.characters[0];
    const text = replaceMacros(
      sourceText.trim(),
      leadSpeaker?.name || 'Character',
      activePersona.name
    );
    setComposerDraft('');
    setDirectorGuidance('');
    setSuggestedReplies([]);

    // Support `/imagine <prompt>` shortcut directly in chat
    if (text.toLowerCase().startsWith('/imagine')) {
      const customPrompt = text.slice(8).trim();
      const lastMsg = activeSession.messages[activeSession.messages.length - 1];
      if (lastMsg) {
        await handleVisualizeMessage(lastMsg, customPrompt || undefined);
      }
      return;
    }

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      speakerId: 'user',
      speakerName: activePersona.name,
      speakerAvatar: activePersona.avatarUrl,
      swipes: [text],
      activeSwipeIndex: 0,
      createdAt: new Date().toISOString(),
    };

    const nextSession: ChatSession = {
      ...activeSession,
      updatedAt: new Date().toISOString(),
      messages: [...activeSession.messages, userMsg],
    };

    const guidance = guidanceDraftRef.current.trim();
    setDirectorGuidance('');

    updateActiveSession(() => nextSession);
    await triggerCharacterReply(
      nextSession,
      undefined,
      undefined,
      false,
      guidance || undefined
    );
  };

  /**
   * Generates a scene illustration for any message using the AI Scene Prompt Crafter
   * and the character's or default linked ComfyUI workflow.
   */
  const handleVisualizeMessage = async (
    msg: ChatMessage,
    overridePrompt?: string,
    overrideWorkflowId?: string,
    overridePrimaryImageUrl?: string,
    overrideSecondaryImageUrl?: string,
    replaceImageId?: string
  ) => {
    if (!activeSession || generatingImageForMsgId) return;
    setGeneratingImageForMsgId(msg.id);
    setChatError('');

    const speakerChar =
      db.characters.find((c) => c.id === msg.speakerId) ||
      sessionCharacters[0] ||
      db.characters[0];

    const workflow =
      db.workflows.find((w) => w.id === overrideWorkflowId) ||
      db.workflows.find((w) => w.id === db.comfyService.defaultWorkflowId) ||
      db.workflows.find((w) => w.id === speakerChar.preferredWorkflowId) ||
      db.workflows[0];

    if (!workflow) {
      setChatError('No ComfyUI workflow profile configured.');
      setGeneratingImageForMsgId(null);
      return;
    }

    try {
      setImageProgressText(
        replaceImageId
          ? 'Regenerating scene image in ComfyUI...'
          : 'AI crafting scene prompt...'
      );
      const msgIndex = activeSession.messages.findIndex((m) => m.id === msg.id);
      const contextSlice = activeSession.messages.slice(
        Math.max(0, msgIndex - 2),
        msgIndex + 1
      );

      const primaryImgUrl =
        overridePrimaryImageUrl !== undefined
          ? overridePrimaryImageUrl
          : speakerChar.referenceImageUrl || speakerChar.avatarUrl;

      const secondaryImgUrl = overrideSecondaryImageUrl || '';

      const hasSecondaryRef = Boolean(secondaryImgUrl);
      const canvasSize = resolveWorkflowCanvasSize(workflow);
      const effectiveStyle: WorkflowPromptStyle =
        workflow.promptStyle === 'moss_bbox' ||
        (workflow.promptStyle === 'natural' && isMossWorkflow(workflow))
          ? 'moss_bbox'
          : workflow.promptStyle;

      const activeImageStyle: ImageStylePreset =
        activeSession.imageStylePreset ||
        db.comfyService.defaultImageStyle ||
        'photography';

      const finalPositivePrompt =
        overridePrompt ||
        (await craftSceneImagePrompt({
          llmService: helperLlm,
          character: speakerChar,
          persona: activePersona,
          recentMessages: contextSlice,
          promptStyle: effectiveStyle,
          promptLengthPreset: workflow.promptLengthPreset || 'balanced',
          referenceImageCount: hasSecondaryRef ? 2 : 1,
          secondImageRole: draftSecondImageRole,
          canvasWidth: canvasSize.width,
          canvasHeight: canvasSize.height,
          imageStylePreset: activeImageStyle,
        }));

      const renderRes = await executeComfyWorkflow(db.comfyService, workflow, {
        positivePrompt: finalPositivePrompt,
        negativePrompt: workflow.defaultNegativePrompt,
        characterReferenceImageUrl: primaryImgUrl || undefined,
        secondaryReferenceImageUrl: secondaryImgUrl || undefined,
        width: workflow.defaultWidth,
        height: workflow.defaultHeight,
        activeLlmService: primaryChatLlm,
        onProgress: (status) => setImageProgressText(status),
      });

      const media: GeneratedMedia = {
        id: `img-${Date.now()}`,
        imageUrl: renderRes.imageUrl,
        prompt: finalPositivePrompt,
        negativePrompt: workflow.defaultNegativePrompt,
        seed: renderRes.seed,
        workflowId: workflow.id,
        workflowName: workflow.name,
        referenceUsed: renderRes.referenceUsed,
        localPath: renderRes.localPath,
        comfyFilename: renderRes.comfyFilename,
        createdAt: new Date().toISOString(),
      };

      // If replacing an existing image, clean up the old local image file
      if (replaceImageId) {
        const oldImg = msg.images?.find((im) => im.id === replaceImageId);
        if (oldImg?.imageUrl) {
          deleteLocalSavedImage(oldImg.imageUrl);
        }
        if (lightboxImage?.id === replaceImageId) {
          setLightboxImage(media);
        }
      }

      updateActiveSession((s) => ({
        ...s,
        messages: s.messages.map((m) => {
          if (m.id !== msg.id) return m;
          const existing = m.images || [];
          if (replaceImageId && existing.some((im) => im.id === replaceImageId)) {
            return {
              ...m,
              images: existing.map((im) =>
                im.id === replaceImageId ? media : im
              ),
            };
          }
          return { ...m, images: [...existing, media] };
        }),
      }));
    } catch (err: any) {
      setChatError(
        `ComfyUI Image Error: ${
          err?.message || 'Ensure ComfyUI is running at ' + db.comfyService.baseUrl
        }`
      );
    } finally {
      setGeneratingImageForMsgId(null);
      setImageProgressText('');
    }
  };

  /**
   * Deletes a specific generated image from a message and removes its local file in `data/images/`.
   */
  const handleDeleteMessageImage = (msgId: string, img: GeneratedMedia) => {
    setConfirmAction({
      title: 'Delete Generated Image?',
      message:
        'Remove this generated image from the chat message and delete its local PNG file from data/images/?',
      confirmLabel: 'Delete Image',
      onConfirm: () => {
        deleteLocalSavedImage(img.imageUrl);
        if (lightboxImage?.id === img.id) {
          setLightboxImage(null);
        }
        updateActiveSession((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  images: (m.images || []).filter((item) => item.id !== img.id),
                }
              : m
          ),
        }));
      },
    });
  };

  /**
   * Regenerates an existing image in-place using its workflow and prompt with a fresh random seed.
   */
  const handleRegenerateMessageImage = (
    msg: ChatMessage,
    img: GeneratedMedia
  ) => {
    const wf =
      db.workflows.find(
        (w) => w.id === img.workflowId || w.name === img.workflowName
      ) ||
      db.workflows.find((w) => w.id === db.comfyService.defaultWorkflowId) ||
      db.workflows[0];
    handleVisualizeMessage(
      msg,
      img.prompt,
      wf?.id,
      undefined,
      undefined,
      img.id
    );
  };

  /**
   * Downloads a generated image to the user's browser Downloads folder.
   */
  const handleDownloadImage = (img: GeneratedMedia) => {
    const a = document.createElement('a');
    a.href = img.imageUrl;
    a.download = img.comfyFilename || `roleplay_${img.seed || Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleOpenPromptPreview = async (
    msg: ChatMessage,
    existingImgToReplace?: GeneratedMedia
  ) => {
    if (!activeSession) return;
    const speakerChar =
      db.characters.find((c) => c.id === msg.speakerId) ||
      sessionCharacters[0] ||
      db.characters[0];

    const wfId =
      existingImgToReplace?.workflowId ||
      db.workflows.find((w) => w.name === existingImgToReplace?.workflowName)
        ?.id ||
      db.comfyService.defaultWorkflowId ||
      speakerChar.preferredWorkflowId ||
      db.workflows[0]?.id ||
      '';
    const wf = db.workflows.find((w) => w.id === wfId) || db.workflows[0];

    const initialPrimary =
      speakerChar.referenceImageUrl || speakerChar.avatarUrl || '';
    const initialSecondary = '';

    setPromptPreviewTarget(msg);
    setDraftReplaceImageId(existingImgToReplace?.id || null);
    setDraftWorkflowId(wf?.id || '');
    const initialPromptLength: WorkflowPromptLengthPreset =
      wf?.promptLengthPreset || 'balanced';
    setDraftPromptLength(initialPromptLength);
    setDraftPrimaryRefImage(initialPrimary);
    setDraftSecondaryRefImage(initialSecondary);

    if (existingImgToReplace?.prompt) {
      setDraftPositivePrompt(existingImgToReplace.prompt);
      setIsDraftingPrompt(false);
      return;
    }

    setIsDraftingPrompt(true);
    const isMossWf =
      wf?.promptStyle === 'moss_bbox' ||
      (wf?.promptStyle === 'natural' && isMossWorkflow(wf));
    setDraftPositivePrompt(
      isMossWf
        ? 'AI crafting MOSS spatial bounding-box layout prompt from dialogue...'
        : 'AI crafting scene prompt from dialogue...'
    );

    const msgIndex = activeSession.messages.findIndex((m) => m.id === msg.id);
    const contextSlice = activeSession.messages.slice(
      Math.max(0, msgIndex - 2),
      msgIndex + 1
    );
    const canvasSize = resolveWorkflowCanvasSize(wf);
    const effectiveStyle: WorkflowPromptStyle = isMossWf
      ? 'moss_bbox'
      : wf?.promptStyle || 'tags';
    const activeImageStyle: ImageStylePreset =
      activeSession.imageStylePreset ||
      db.comfyService.defaultImageStyle ||
      'photography';
    const crafted = await craftSceneImagePrompt({
      llmService: helperLlm,
      character: speakerChar,
      persona: activePersona,
      recentMessages: contextSlice,
      promptStyle: effectiveStyle,
      promptLengthPreset: initialPromptLength,
      referenceImageCount: initialSecondary ? 2 : 1,
      secondImageRole: draftSecondImageRole,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      imageStylePreset: activeImageStyle,
    });
    setDraftPositivePrompt(crafted);
    setIsDraftingPrompt(false);
  };

  const handleRecraftDraftPrompt = async (
    targetWfId?: string,
    hasSecondImg?: boolean,
    roleDesc?: string,
    forcePromptStyle?: WorkflowPromptStyle,
    forceImageStyle?: ImageStylePreset,
    forcePromptLength?: WorkflowPromptLengthPreset
  ) => {
    if (!activeSession || !promptPreviewTarget) return;
    const speakerChar =
      db.characters.find((c) => c.id === promptPreviewTarget.speakerId) ||
      sessionCharacters[0] ||
      db.characters[0];
    const wf =
      db.workflows.find((w) => w.id === (targetWfId ?? draftWorkflowId)) ||
      db.workflows[0];
    const useTwoImages =
      hasSecondImg !== undefined
        ? hasSecondImg
        : Boolean(draftSecondaryRefImage);

    setIsDraftingPrompt(true);
    const msgIndex = activeSession.messages.findIndex(
      (m) => m.id === promptPreviewTarget.id
    );
    const contextSlice = activeSession.messages.slice(
      Math.max(0, msgIndex - 2),
      msgIndex + 1
    );
    const canvasSize = resolveWorkflowCanvasSize(wf);
    const effectiveStyle: WorkflowPromptStyle =
      forcePromptStyle ||
      (wf?.promptStyle === 'moss_bbox' ||
      (wf?.promptStyle === 'natural' && isMossWorkflow(wf))
        ? 'moss_bbox'
        : wf?.promptStyle || 'tags');
    const activeImageStyle: ImageStylePreset =
      forceImageStyle ||
      activeSession.imageStylePreset ||
      db.comfyService.defaultImageStyle ||
      'photography';
    const effectivePromptLength: WorkflowPromptLengthPreset =
      forcePromptLength ??
      (targetWfId !== undefined
        ? wf?.promptLengthPreset || 'balanced'
        : draftPromptLength);
    const crafted = await craftSceneImagePrompt({
      llmService: helperLlm,
      character: speakerChar,
      persona: activePersona,
      recentMessages: contextSlice,
      promptStyle: effectiveStyle,
      promptLengthPreset: effectivePromptLength,
      referenceImageCount: useTwoImages ? 2 : 1,
      secondImageRole: roleDesc ?? draftSecondImageRole,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      imageStylePreset: activeImageStyle,
    });
    setDraftPositivePrompt(crafted);
    setIsDraftingPrompt(false);
  };

  const handleBranchFromMessage = (msgId: string) => {
    if (!activeSession) return;
    const idx = activeSession.messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    const branched: ChatSession = {
      ...activeSession,
      id: `chat-${Date.now()}`,
      title: `${activeSession.title} (Branch #${idx + 1})`,
      updatedAt: new Date().toISOString(),
      messages: JSON.parse(
        JSON.stringify(activeSession.messages.slice(0, idx + 1))
      ),
    };
    onUpdateDb((prev) => ({
      ...prev,
      chats: [branched, ...prev.chats],
      activeChatId: branched.id,
    }));
  };

  const handleDeleteFromMessage = (msgId: string) => {
    if (!activeSession) return;
    const idx = activeSession.messages.findIndex((m) => m.id === msgId);
    if (idx <= 0) return; // keep at least greeting
    updateActiveSession((s) => ({
      ...s,
      messages: s.messages.slice(0, idx),
    }));
  };

  /**
   * Regenerates/swipes an assistant message using explicit Director's Guidance
   * so the character's reaction immediately follows the player's instruction (e.g. stay on topic, be bolder, etc.).
   */
  const handleExecuteSteeredSwipe = (
    msg: ChatMessage,
    customSteer: string
  ) => {
    if (!activeSession || isGeneratingText) return;
    const speaker = db.characters.find((c) => c.id === msg.speakerId);
    const msgIdx = activeSession.messages.findIndex((m) => m.id === msg.id);
    if (msgIdx === -1) return;
    const truncatedSession: ChatSession = {
      ...activeSession,
      messages: activeSession.messages.slice(0, msgIdx),
    };
    setSteerMsgId(null);
    setSteerPrompt('');
    triggerCharacterReply(
      truncatedSession,
      speaker,
      msg.id,
      false,
      customSteer.trim() || undefined
    );
  };

  /**
   * Resets the current chat back to the opening greeting while preserving its World Setting & Lore.
   */
  const handleResetChat = () => {
    if (!activeSession) return;
    setConfirmAction({
      title: `Reset "${activeSession.title}"?`,
      message: `Reset this story back to the opening scene? Current messages (${activeSession.messages.length} turns) and Story Memory Summary will be cleared.`,
      confirmLabel: 'Reset Story',
      tone: 'warning',
      onConfirm: () => {
        const firstChar = sessionCharacters[0] || db.characters[0];
        const initialMsg = activeSession.messages[0] || {
          id: `msg-init-${Date.now()}`,
          role: 'assistant' as const,
          speakerId: firstChar.id,
          speakerName: firstChar.name,
          speakerAvatar: firstChar.avatarUrl,
          swipes: [
            replaceMacros(
              firstChar.first_mes,
              firstChar.name,
              activePersona.name
            ),
          ],
          activeSwipeIndex: 0,
          createdAt: new Date().toISOString(),
        };
        setSuggestedReplies([]);
        updateActiveSession((s) => ({
          ...s,
          memorySummary: '',
          memoryChapters: [],
          summarizedUpToIndex: 0,
          updatedAt: new Date().toISOString(),
          messages: [{ ...initialMsg, images: [] }],
        }));
      },
    });
  };

  /**
   * Starts a brand-new session with the exact same character(s), World Setting, and Lore
   * while keeping the current session in the sidebar history.
   */
  const handleNewSessionFromCurrent = () => {
    if (!activeSession) return;
    const firstChar = sessionCharacters[0] || db.characters[0];
    const effectiveLang: ConversationLanguage =
      activeSession.language ||
      (!activeSession.isGroup ? firstChar?.defaultLanguage : undefined) ||
      db.defaultLanguage ||
      'auto';
    const sessionMode = activeSession.statusTrackerMode;
    let initialBlock: string | undefined;
    if (!activeSession.isGroup && firstChar) {
      if (sessionMode && sessionMode !== 'auto' && sessionMode !== 'off') {
        const body = (activeSession.customStatusTemplate || '')
          .replace(/<\/?status(?:_bar)?>/gi, '')
          .trim() ||
          getDefaultStatusTemplateForMode({
            mode: sessionMode,
            charName: firstChar.name,
            userName: activePersona.name,
            language: effectiveLang,
          });
        if (body) initialBlock = `<status_bar>\n${body}\n</status_bar>`;
      } else if (!sessionMode) {
        initialBlock = resolveCharacterInitialStatusConfig({
          char: firstChar,
          userName: activePersona.name,
          language: effectiveLang,
        }).initialStatusBarBlock;
      }
    }

    const newSession: ChatSession = {
      ...activeSession,
      id: `chat-${Date.now()}`,
      title: `${activeSession.title.replace(/ \(Session #\d+\)$/, '')} (Session #${
        db.chats.length + 1
      })`,
      memorySummary: '',
      memoryChapters: [],
      summarizedUpToIndex: 0,
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: `msg-init-${Date.now()}`,
          role: 'assistant',
          speakerId: firstChar.id,
          speakerName: firstChar.name,
          speakerAvatar: firstChar.avatarUrl,
          swipes: [
            appendStatusBarToGreeting(
              replaceMacros(
                firstChar.first_mes,
                firstChar.name,
                activePersona.name
              ),
              initialBlock
            ),
            ...(firstChar.alternate_greetings || []).map((g) =>
              appendStatusBarToGreeting(
                replaceMacros(g, firstChar.name, activePersona.name),
                initialBlock
              )
            ),
          ],
          activeSwipeIndex: 0,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    setSuggestedReplies([]);
    onUpdateDb((prev) => ({
      ...prev,
      chats: [newSession, ...prev.chats],
      activeChatId: newSession.id,
    }));
  };

  /**
   * Generates 3 suggested responses for the player using the connected local LLM.
   * Optionally uses `suggestionDirection` (or a rough draft in `userInput`) to steer the scene!
   */
  const handleSuggestReplies = async (overrideDirection?: string) => {
    if (
      !activeSession ||
      isGeneratingSuggestions ||
      sessionCharacters.length === 0
    ) {
      return;
    }
    setIsGeneratingSuggestions(true);
    setChatError('');
    try {
      const leadSpeaker =
        selectNextGroupSpeaker(activeSession, sessionCharacters) ||
        sessionCharacters[0];
      const effectiveLanguage: ConversationLanguage =
        activeSession.language || db.defaultLanguage || 'auto';
      const directionToUse =
        overrideDirection !== undefined
          ? overrideDirection.trim()
          : guidanceDraftRef.current.trim();
      const suggestions = await generateSuggestedUserResponses({
        llmService: helperLlm,
        session: { ...activeSession, language: effectiveLanguage },
        activeCharacter: leadSpeaker,
        persona: activePersona,
        userDirection: directionToUse || undefined,
      });
      setSuggestedReplies(suggestions);
    } catch (err: any) {
      setChatError(`Could not generate reply suggestions: ${err?.message}`);
    } finally {
      setIsGeneratingSuggestions(false);
    }
  };

  const handleSummarizeStoryMemory = async () => {
    if (!activeSession || isSummarizingMemory) return;
    setIsSummarizingMemory(true);
    try {
      const effectiveLanguage: ConversationLanguage =
        activeSession.language || db.defaultLanguage || 'auto';
      const result = await generateIncrementalStorySummary({
        llmService: helperLlm,
        session: activeSession,
        characters: sessionCharacters,
        effectiveLanguage,
        onlySummarizeOlderThanRecentWindow: false,
      });
      if (result) {
        updateActiveSession((s) => {
          const existingChapters = (s.memoryChapters || []).filter(
            (ch, idx, arr) =>
              !(
                idx > 0 &&
                ch.turnRange[0] === 1 &&
                ch.turnRange[1] > 40 &&
                arr.length > 2
              )
          );
          const nextChapters = result.newChapter
            ? [
                ...existingChapters.filter(
                  (ch) =>
                    !(
                      ch.turnRange[0] === result.newChapter!.turnRange[0] &&
                      ch.turnRange[1] === result.newChapter!.turnRange[1]
                    )
                ),
                result.newChapter,
              ]
            : existingChapters;

          const existingLore = s.storyLore || [];
          const existingLoreSet = new Set(
            existingLore.map((e) => e.name.trim().toLowerCase())
          );
          const autoLoreToAdd =
            s.autoExtractLore !== false && result.extractedLore
              ? result.extractedLore.filter(
                  (e) => !existingLoreSet.has(e.name.trim().toLowerCase())
                )
              : [];

          return {
            ...s,
            memorySummary: result.summary,
            ...(result.characterEvolution !== undefined
              ? { characterEvolution: result.characterEvolution }
              : {}),
            summarizedUpToIndex: result.summarizedUpToIndex,
            memoryChapters: nextChapters,
            storyLore: [...existingLore, ...autoLoreToAdd],
          };
        });
      }
    } catch (err: any) {
      setChatError(`Memory summary error: ${err?.message}`);
    } finally {
      setIsSummarizingMemory(false);
    }
  };

  const handleSwitchSessionPersona = (
    nextPersonaId: string,
    newlyCreatedPersona?: UserPersona
  ) => {
    if (nextPersonaId === '__create_new__') {
      setQuickPersonaTarget('active_chat');
      setQuickPersonaName('');
      setQuickPersonaGender(activePersona?.gender || 'male');
      setQuickPersonaDesc('');
      setShowQuickPersonaModal(true);
      return;
    }

    const nextPersona =
      newlyCreatedPersona ||
      db.personas.find((p) => p.id === nextPersonaId) ||
      activePersona;
    if (!nextPersona || !activeSession) return;

    const oldName = activePersona?.name?.trim() || '';
    const newName = nextPersona.name.trim();
    const replaceOldName = (text?: string): string => {
      if (!text) return '';
      if (!oldName || oldName === newName) return text;
      return text.split(oldName).join(newName);
    };

    onUpdateDb((prev) => ({
      ...prev,
      activePersonaId: nextPersona.id,
      ...(newlyCreatedPersona
        ? { personas: [...prev.personas, newlyCreatedPersona] }
        : {}),
      chats: prev.chats.map((c) => {
        if (c.id !== activeSession.id) return c;
        return {
          ...c,
          personaId: nextPersona.id,
          worldSetting: c.worldSetting
            ? replaceOldName(c.worldSetting)
            : c.worldSetting,
          customStatusTemplate: c.customStatusTemplate
            ? replaceOldName(c.customStatusTemplate)
            : c.customStatusTemplate,
          messages: c.messages.map((m) => ({
            ...m,
            speakerName: m.role === 'user' ? newName : m.speakerName,
            speakerAvatar:
              m.role === 'user' ? nextPersona.avatarUrl : m.speakerAvatar,
            swipes: m.swipes.map((sw) => replaceOldName(sw)),
          })),
        };
      }),
    }));
  };

  const handleConfirmQuickCreatePersona = () => {
    const trimmedName = quickPersonaName.trim();
    if (!trimmedName) return;
    const baseTag =
      quickPersonaGender === 'female'
        ? '1girl'
        : quickPersonaGender === 'male'
        ? '1boy'
        : '1person';
    const created: UserPersona = {
      id: `persona-${Date.now()}`,
      name: trimmedName,
      gender: quickPersonaGender,
      description:
        quickPersonaDesc.trim() ||
        `${trimmedName} is the main protagonist interacting with {{char}}.`,
      visualPrompt: `${baseTag}, detailed portrait of ${trimmedName}`,
      avatarUrl: '',
    };

    if (quickPersonaTarget === 'new_story') {
      onUpdateDb((prev) => ({
        ...prev,
        activePersonaId: created.id,
        personas: [...prev.personas, created],
      }));
      setNewStoryPersonaId(created.id);
    } else {
      handleSwitchSessionPersona(created.id, created);
    }
    setShowQuickPersonaModal(false);
  };

  const handleCreateGroupChat = () => {
    if (selectedGroupCharIds.length === 0) return;
    const chosenChars = db.characters.filter((c) =>
      selectedGroupCharIds.includes(c.id)
    );
    const firstChar = chosenChars[0];
    const isOneOnOne = chosenChars.length === 1;
    const chosenPersona =
      db.personas.find((p) => p.id === newStoryPersonaId) || activePersona;
    const effectiveLang: ConversationLanguage =
      newStoryLanguage || db.defaultLanguage || 'auto';
    const initialStatus = isOneOnOne
      ? resolveCharacterInitialStatusConfig({
          char: firstChar,
          userName: chosenPersona.name,
          language: effectiveLang,
        })
      : { statusTrackerMode: 'auto' as StatusTrackerMode };

    const rawOpening =
      newStoryOpening.trim() ||
      replaceMacros(firstChar.first_mes, firstChar.name, chosenPersona.name);
    const openingText = isOneOnOne
      ? appendStatusBarToGreeting(
          rawOpening,
          initialStatus.initialStatusBarBlock
        )
      : rawOpening;

    const newChat: ChatSession = {
      id: `chat-${Date.now()}`,
      title:
        newStoryTitle.trim() ||
        (chosenChars.length > 1
          ? `Group: ${chosenChars.map((c) => c.name.split(' ')[0]).join(' & ')}`
          : `Story with ${firstChar.name}`),
      isGroup: chosenChars.length > 1,
      characterIds: chosenChars.map((c) => c.id),
      personaId: chosenPersona.id,
      language: effectiveLang,
      statusTrackerMode: initialStatus.statusTrackerMode,
      ...(initialStatus.customStatusTemplate
        ? { customStatusTemplate: initialStatus.customStatusTemplate }
        : {}),
      worldSetting:
        newStoryWorldSetting.trim() ||
        replaceMacros(firstChar.scenario, firstChar.name, chosenPersona.name),
      storyLore: newStoryLore,
      lorebookIds: [], // Self-contained story by default!
      groupTurnMode: 'natural',
      memorySummary: '',
      autoImageEveryNTurns: 0,
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: `msg-init-${Date.now()}`,
          role: 'assistant',
          speakerId: firstChar.id,
          speakerName: firstChar.name,
          speakerAvatar: firstChar.avatarUrl,
          swipes: [openingText],
          activeSwipeIndex: 0,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    onUpdateDb((prev) => ({
      ...prev,
      activePersonaId: chosenPersona.id,
      defaultLanguage:
        isOneOnOne && firstChar.defaultLanguage
          ? prev.defaultLanguage
          : newChat.language,
      chats: [newChat, ...prev.chats],
      activeChatId: newChat.id,
    }));
    setNewStoryTitle('');
    setNewStoryWorldSetting('');
    setNewStoryOpening('');
    setNewStoryLore([]);
    setShowNewGroupModal(false);
  };

  const handleAiBuildNewStory = async () => {
    if (selectedGroupCharIds.length === 0) return;
    const chosenChars = db.characters.filter((c) =>
      selectedGroupCharIds.includes(c.id)
    );
    const chosenPersona =
      db.personas.find((p) => p.id === newStoryPersonaId) || activePersona;
    setIsGeneratingStoryWorld(true);
    try {
      const built = await aiGenerateStoryWorldAndOpening({
        llmService: helperLlm,
        premise:
          newStoryWorldSetting.trim() ||
          newStoryTitle.trim() ||
          chosenChars[0].scenario,
        characters: chosenChars,
        persona: chosenPersona,
        language: newStoryLanguage || db.defaultLanguage || 'auto',
      });
      setNewStoryTitle(built.title);
      setNewStoryWorldSetting(built.worldSetting);
      setNewStoryOpening(built.openingMessage);
      setNewStoryLore(built.storyLore);
    } catch (err: any) {
      setChatError(`AI Story Builder error: ${err?.message}`);
    } finally {
      setIsGeneratingStoryWorld(false);
    }
  };

  const handleAiExtractStoryLore = async () => {
    if (!activeSession) return;
    setIsExtractingLore(true);
    try {
      const extracted = await aiExtractLoreFromStory({
        llmService: helperLlm,
        session: activeSession,
      });
      if (extracted.length > 0) {
        updateActiveSession((s) => ({
          ...s,
          storyLore: [...(s.storyLore || []), ...extracted],
        }));
      }
    } catch (err: any) {
      setChatError(`Lore extraction error: ${err?.message}`);
    } finally {
      setIsExtractingLore(false);
    }
  };

  /**
   * Generates or updates a <status_bar>...</status_bar> HUD block on any assistant message
   * in 1 click using the connected LLM and the active Status HUD mode.
   */
  const handleGenerateStatusHudForMessage = async (msg: ChatMessage) => {
    if (!activeSession || generatingStatusForMsgId) return;
    setGeneratingStatusForMsgId(msg.id);
    setChatError('');
    try {
      const speakerChar =
        db.characters.find((c) => c.id === msg.speakerId) ||
        sessionCharacters[0] ||
        db.characters[0];
      const msgIdx = activeSession.messages.findIndex((m) => m.id === msg.id);
      const priorMessages =
        msgIdx > 0 ? activeSession.messages.slice(0, msgIdx) : [];
      const prevStatusBlock = extractLatestRawStatusBlock(priorMessages);

      // If session is currently on 'auto' or 'off', default to 'rpg_traveler' or 'romance_affection' based on user's choice
      const effectiveMode: StatusTrackerMode =
        activeSession.statusTrackerMode &&
        activeSession.statusTrackerMode !== 'auto' &&
        activeSession.statusTrackerMode !== 'off'
          ? activeSession.statusTrackerMode
          : 'romance_affection';

      const statusInstruction = buildStatusTrackerSystemInstruction({
        mode: effectiveMode,
        customTemplate: activeSession.customStatusTemplate,
        charName: speakerChar.name,
        userName: activePersona.name,
        language: activeSession.language || db.defaultLanguage || 'auto',
        previousStatusBlock: prevStatusBlock,
      });

      const currentRaw = msg.swipes[msg.activeSwipeIndex] || '';
      const parsedCurrent = parseMessageStatusBlocks(currentRaw);
      const recentDialogueContext = priorMessages
        .slice(-3)
        .map((m) => {
          const p = parseMessageStatusBlocks(
            m.swipes[m.activeSwipeIndex] || ''
          );
          return `${m.speakerName}: ${p.cleanNarrativeText.slice(0, 260)}`;
        })
        .join('\n\n');

      const generated = await generateChatCompletion(
        helperLlm,
        [
          {
            role: 'system',
            content: `/no_think\nYou are a Status HUD Tracker for RolePlay Studio.\n${statusInstruction}\nOutput ONLY the <status_bar>...</status_bar> block and nothing else.`,
          },
          {
            role: 'user',
            content: `Character: ${speakerChar.name}\nUser Persona: ${activePersona.name}\n${
              prevStatusBlock
                ? `Previous Turn Live State (Evolve from this — keep the same [地点]/[Location] unless they moved in the turns below!):\n${prevStatusBlock}\n\n`
                : ''
            }${
              recentDialogueContext
                ? `Recent Turns Leading Up to This Moment:\n${recentDialogueContext}\n\n`
                : ''
            }Latest Turn by ${speakerChar.name}:\n${
              parsedCurrent.cleanNarrativeText || currentRaw
            }\n\nOutput ONLY the updated <status_bar>...</status_bar> block for this moment:`,
          },
        ],
        {
          temperature: 0.35,
          disableThinking: true,
          maxTokensOverride: 600,
          taskLabel: `Status HUD (${speakerChar.name})`,
        }
      );

      const cleaned = generated.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      const statusMatch = cleaned.match(
        /<status(?:_bar)?>[\s\S]*?<\/status(?:_bar)?>/i
      );
      const finalBlock = statusMatch
        ? statusMatch[0]
        : `<status_bar>\n${cleaned}\n</status_bar>`;

      const updatedSwipeText = healGeneratedStatusContinuity(
        `${parsedCurrent.cleanNarrativeText || currentRaw}\n\n${finalBlock}`,
        priorMessages
      );

      updateActiveSession((s) => ({
        ...s,
        statusTrackerMode:
          !s.statusTrackerMode ||
          s.statusTrackerMode === 'auto' ||
          s.statusTrackerMode === 'off'
            ? effectiveMode
            : s.statusTrackerMode,
        messages: s.messages.map((m) =>
          m.id === msg.id
            ? {
                ...m,
                swipes: m.swipes.map((sw, idx) =>
                  idx === m.activeSwipeIndex ? updatedSwipeText : sw
                ),
              }
            : m
        ),
      }));
    } catch (err: any) {
      setChatError(`Status HUD generation error: ${err?.message}`);
    } finally {
      setGeneratingStatusForMsgId(null);
    }
  };

  /**
   * Auto-heals inverted asterisks, unbalanced asterisks, and speech quotation mix-ups within a single line.
   * Prevents local LLMs from flipping dialogue into *asterisks* and leaving action bare, or leaking unclosed asterisks.
   */
  const healSingleRolePlayLine = (rawLine: string): string => {
    const trimmed = rawLine.trim();
    if (!trimmed) return rawLine;

    // 1. Inverted pattern: *Spoken Dialogue* Action Narration *Spoken Dialogue*
    // When a local LLM mistakenly wraps spoken speech in asterisks and leaves narrative action bare
    const invertedTwoQuotes = trimmed.match(
      /^\*([^*]+)\*\s*([^*"“”「」\n]+?)\s*\*([^*]+)\*$/
    );
    if (invertedTwoQuotes) {
      const [, speech1, action, speech2] = invertedTwoQuotes;
      const isSpeech = (s: string) =>
        /[？?!！~…，,。]/.test(s) ||
        /(你|我|他|她|谁|走|别|先|要|可|吗|呢|吧|啊|哦|呀|嘛|啦|去|我们|快|来)/.test(
          s
        );
      if (isSpeech(speech1) || isSpeech(speech2)) {
        return `"${speech1.trim()}" *${action.trim()}* "${speech2.trim()}"`;
      }
    }

    // 2. Inverted pattern: *Spoken Dialogue* Action Narration (single dialogue leading)
    const invertedLeadingSpeech = trimmed.match(
      /^\*([^*]+)\*\s*([^*"“”「」\n]+)$/
    );
    if (invertedLeadingSpeech) {
      const [, speech, action] = invertedLeadingSpeech;
      if (
        /[？?!！~…]/.test(speech) ||
        /(你|我|他|她|走|别|先|要|可|吗|呢|吧|啊|哦|去|我们)/.test(speech)
      ) {
        return `"${speech.trim()}" *${action.trim()}*`;
      }
    }

    // 3. Inverted pattern: Action Narration *Spoken Dialogue* (single dialogue trailing)
    const invertedTrailingSpeech = trimmed.match(
      /^([^*"“”「」\n]+)\s*\*([^*]+)\*$/
    );
    if (invertedTrailingSpeech) {
      const [, action, speech] = invertedTrailingSpeech;
      if (
        /[？?!！~…]/.test(speech) ||
        /(你|我|他|她|走|别|先|要|可|吗|呢|吧|啊|哦|去|我们)/.test(speech)
      ) {
        return `*${action.trim()}* "${speech.trim()}"`;
      }
    }

    const starCount = (trimmed.match(/\*/g) || []).length;
    if (starCount === 0 || starCount % 2 === 0) {
      return trimmed;
    }

    // Odd number of asterisks on this line — auto-balance within this line only:
    // Case A: Starts with `*` and has only 1 `*`
    if (trimmed.startsWith('*') && starCount === 1) {
      // Check if the line transitions from narration into trailing spoken dialogue: e.g. *她笑了笑，"走吧。"
      const trailingQuoteMatch = trimmed.match(
        /^(\*[^"“「]+?[，,。：:\s])\s*(["“「][\s\S]+["”」])$/
      );
      if (trailingQuoteMatch) {
        return `${trailingQuoteMatch[1]}* ${trailingQuoteMatch[2]}`;
      }
      // If it's a long narration block with an orphan leading asterisk, strip the orphan '*'
      // so it doesn't accidentally italicize the entire multi-sentence paragraph!
      if (trimmed.length > 25) {
        return trimmed.slice(1).trim();
      }
      return `${trimmed}*`;
    }

    // Case B: Ends with `*` and has only 1 `*`
    if (trimmed.endsWith('*') && starCount === 1) {
      const leadingQuoteMatch = trimmed.match(
        /^(["“「][^"”」]+["”」]\s*)([^"“「]+)\*$/
      );
      if (leadingQuoteMatch) {
        return `${leadingQuoteMatch[1]}*${leadingQuoteMatch[2].trim()}*`;
      }
      if (trimmed.length > 25) {
        return trimmed.slice(0, -1).trim();
      }
      return `*${trimmed}`;
    }

    // Case C: Stray `*` in the middle between two spoken quotes: e.g. "A" action* "B" or "A" *action "B"
    const betweenQuotesFixed = trimmed
      .replace(
        /(["”」])\s*([^*"“”「」]+?)\*\s*(["“「])/g,
        (_m, q1, mid, q2) => `${q1} *${mid.trim()}* ${q2}`
      )
      .replace(
        /(["”」])\s*\*\s*([^*"“”「」]+?)\s*(["“「])/g,
        (_m, q1, mid, q2) => `${q1} *${mid.trim()}* ${q2}`
      );

    if ((betweenQuotesFixed.match(/\*/g) || []).length % 2 === 0) {
      return betweenQuotesFixed;
    }

    // Fallback: close at end of line if still odd
    return `${trimmed}*`;
  };

  /**
   * Cleans and auto-formats an entire role-play message text so quotes and asterisks are properly paired and non-inverted.
   */
  const healFullRolePlayMessageText = (fullText: string): string => {
    const statusMatch = fullText.match(
      /<status(?:_bar)?>[\s\S]*?<\/status(?:_bar)?>/i
    );
    const thinkMatch = fullText.match(/<think>[\s\S]*?<\/think>/i);
    const body = fullText
      .replace(/<status(?:_bar)?>[\s\S]*?<\/status(?:_bar)?>/gi, '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim();

    const healedBody = body
      .split('\n')
      .map((line) => healSingleRolePlayLine(line))
      .join('\n');

    let result = healedBody;
    if (thinkMatch) result = `${thinkMatch[0]}\n\n${result}`;
    if (statusMatch) result = `${result}\n\n${statusMatch[0]}`;
    return result;
  };

  /**
   * Formats *actions* in italics, "dialogue" in bright highlights, collapses <think> blocks,
   * and renders `<status_bar>` / `<UpdateVariable>` blocks as interactive Visual Status HUD cards.
   */
  const renderFormattedMessage = (
    rawText: string,
    speakerName: string = '',
    msgIndex?: number,
    hideStatusCard: boolean = false
  ) => {
    const thinkMatch = rawText.match(/<think>([\s\S]*?)<\/think>/i);
    const thinkContent = thinkMatch ? thinkMatch[1].trim() : '';
    const mainBody = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    const parsedStatus =
      activeSession?.statusTrackerMode === 'off'
        ? {
            hasStatus: false,
            cleanNarrativeText: mainBody
              .replace(/<status(?:_bar)?>[\s\S]*?<\/status(?:_bar)?>/gi, '')
              .replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi, '')
              .trim(),
            metaFields: {},
            conditionFields: [],
            relationshipFields: [],
            statusMeters: [],
            variableMeters: [],
          }
        : parseMessageStatusBlocks(
            mainBody,
            activeSession?.messages,
            msgIndex
          );

    const narrativeToRender = parsedStatus.cleanNarrativeText;

    return (
      <div className="space-y-2">
        {thinkContent && (
          <details className="bg-slate-950/70 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-400">
            <summary className="cursor-pointer font-medium text-indigo-400">
              Reasoning / Thought Process
            </summary>
            <p className="mt-1.5 whitespace-pre-wrap text-slate-400">
              {thinkContent}
            </p>
          </details>
        )}
        {narrativeToRender && (
          <div className="whitespace-pre-wrap break-words leading-relaxed text-sm text-slate-200">
            {narrativeToRender.split('\n').map((rawLine, lineIdx, allLines) => {
              const healedLine = healSingleRolePlayLine(rawLine);
              const chunks = healedLine.split(/(\*[^*\n]+\*)/g);
              return (
                <React.Fragment key={lineIdx}>
                  {chunks.map((part, i) => {
                    if (
                      part.startsWith('*') &&
                      part.endsWith('*') &&
                      part.length >= 2
                    ) {
                      const inner = part.slice(1, -1);
                      const innerQuoteParts = inner.split(
                        /("[^"\n]+"|“[^”\n]+”|「[^」\n]+」)/g
                      );
                      return (
                        <em key={i} className="text-indigo-200/90 italic">
                          {innerQuoteParts.map((iq, iqIdx) => {
                            if (
                              (iq.startsWith('"') && iq.endsWith('"')) ||
                              (iq.startsWith('“') && iq.endsWith('”')) ||
                              (iq.startsWith('「') && iq.endsWith('」'))
                            ) {
                              return (
                                <span
                                  key={iqIdx}
                                  className="text-white font-medium not-italic"
                                >
                                  {iq}
                                </span>
                              );
                            }
                            return <span key={iqIdx}>{iq}</span>;
                          })}
                        </em>
                      );
                    }
                    // Strip any remaining stray single '*' and highlight spoken dialogue ("..." / “...”)
                    const cleanPart = part.replace(/\*/g, '');
                    if (!cleanPart) return null;
                    const quoteParts = cleanPart.split(
                      /("[^"\n]+"|“[^”\n]+”|「[^」\n]+」)/g
                    );
                    return (
                      <span key={i}>
                        {quoteParts.map((qp, qIdx) => {
                          if (
                            (qp.startsWith('"') && qp.endsWith('"')) ||
                            (qp.startsWith('“') && qp.endsWith('”')) ||
                            (qp.startsWith('「') && qp.endsWith('」'))
                          ) {
                            return (
                              <span
                                key={qIdx}
                                className="text-white font-medium"
                              >
                                {qp}
                              </span>
                            );
                          }
                          return <span key={qIdx}>{qp}</span>;
                        })}
                      </span>
                    );
                  })}
                  {lineIdx < allLines.length - 1 ? '\n' : null}
                </React.Fragment>
              );
            })}
          </div>
        )}
        {parsedStatus.hasStatus && !hideStatusCard && (
          <MessageStatusHudCard
            speakerName={speakerName || '角色'}
            parsed={parsedStatus}
            rawMessageText={rawText}
            onSaveStatusRows={
              msgIndex !== undefined
                ? (updatedRows) => {
                    const updatedRaw = replaceMessageStatusBarBlock(
                      rawText,
                      updatedRows
                    );
                    const serializedTemplate = `<status_bar>\n${serializeStatusTemplateRows(
                      updatedRows
                    )}\n</status_bar>`;
                    updateActiveSession((s) => ({
                      ...s,
                      customStatusTemplate: serializedTemplate,
                      messages: s.messages.map((m, idx) =>
                        idx === msgIndex
                          ? {
                              ...m,
                              swipes: m.swipes.map((sw, sIdx) =>
                                sIdx === m.activeSwipeIndex ? updatedRaw : sw
                              ),
                            }
                          : m
                      ),
                    }));
                  }
                : undefined
            }
          />
        )}
      </div>
    );
  };

  const renderSidebarStoryAndCastList = (isMobile: boolean = false) => (
    <>
      <div className="p-3.5 space-y-3 overflow-y-auto flex-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-1">
            Active Stories ({db.chats.length})
          </span>
          {isMobile && (
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(false)}
              className="text-slate-400 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <button
          onClick={() => {
            setShowNewGroupModal(true);
            if (isMobile) setMobileSidebarOpen(false);
          }}
          className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shadow-md"
        >
          <Plus className="w-4 h-4" />
          New Story / Group Chat
        </button>

        <div className="space-y-1.5">
          {db.chats.map((chat) => {
            const isSelected = chat.id === activeSession?.id;
            return (
              <div
                key={chat.id}
                onClick={() => {
                  onUpdateDb((prev) => ({ ...prev, activeChatId: chat.id }));
                  if (isMobile) setMobileSidebarOpen(false);
                }}
                className={`p-2.5 rounded-xl border cursor-pointer transition flex items-center justify-between gap-2 ${
                  isSelected
                    ? 'bg-slate-800/90 border-indigo-500/50 text-white'
                    : 'bg-slate-950/40 border-slate-800/80 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {chat.isGroup && (
                      <Users className="w-3.5 h-3.5 text-fuchsia-400 shrink-0" />
                    )}
                    <p className="text-xs font-medium truncate">
                      {chat.title}
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {chat.messages.length} turns
                  </p>
                </div>
                {db.chats.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmAction({
                        title: `Delete chat "${chat.title}"?`,
                        message: `Permanently delete this story session and its ${chat.messages.length} turns?`,
                        confirmLabel: 'Delete Chat',
                        onConfirm: () => {
                          onUpdateDb((prev) => {
                            const rest = prev.chats.filter(
                              (c) => c.id !== chat.id
                            );
                            return {
                              ...prev,
                              chats: rest,
                              activeChatId:
                                prev.activeChatId === chat.id
                                  ? rest[0]?.id || ''
                                  : prev.activeChatId,
                            };
                          });
                        },
                      });
                    }}
                    title="Delete chat session"
                    className="text-slate-500 hover:text-rose-400 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Participants & Manual Turn Trigger */}
      {activeSession && (
        <div className="p-3.5 border-t border-slate-800 bg-slate-950/60 space-y-2.5 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Scene Cast ({sessionCharacters.length})
            </span>
            <button
              onClick={() => {
                setShowMemoryModal(true);
                if (isMobile) setMobileSidebarOpen(false);
              }}
              className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300"
            >
              <Brain className="w-3.5 h-3.5" />
              Memory &amp; Lore
            </button>
          </div>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {sessionCharacters.map((char) => {
              const genderBadge = formatGenderBadge(char.gender);
              return (
                <div
                  key={char.id}
                  className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-lg p-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {char.referenceImageUrl || char.avatarUrl ? (
                      <img
                        src={char.referenceImageUrl || char.avatarUrl}
                        alt={char.name}
                        className="w-7 h-7 rounded-full object-cover bg-slate-800 shrink-0"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                        <User className="w-3.5 h-3.5 text-slate-500" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-slate-200 truncate">
                          {char.name}
                        </span>
                        <span
                          title={`Gender: ${genderBadge.label}`}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${genderBadge.colorClass}`}
                        >
                          {genderBadge.symbol} {genderBadge.label}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      triggerCharacterReply(activeSession, char);
                      if (isMobile) setMobileSidebarOpen(false);
                    }}
                    disabled={isGeneratingText}
                    title={`Prompt ${char.name} to speak next`}
                    className="px-2 py-0.5 rounded bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white text-[11px] font-medium transition disabled:opacity-40"
                  >
                    Speak
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="flex w-full max-w-full h-[calc(100dvh-7.5rem)] md:h-[calc(100dvh-4.25rem)] overflow-hidden relative">
      {/* Mobile Slide-Over Drawer for Story List & Cast */}
      {mobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative w-4/5 max-w-xs bg-slate-900 border-r border-slate-800 h-full flex flex-col justify-between shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            {renderSidebarStoryAndCastList(true)}
          </div>
        </div>
      )}

      {/* Desktop Left Sidebar: Chat Sessions & Group Trigger Bar */}
      <div className="hidden md:flex w-72 bg-slate-900/90 border-r border-slate-800 flex-col justify-between shrink-0">
        {renderSidebarStoryAndCastList(false)}
      </div>

      {/* Center Chat Area */}
      <div className="flex-1 flex flex-col bg-slate-950 min-w-0 max-w-full overflow-x-hidden">
        {/* Top Session Header */}
        {activeSession && (
          <div className="min-h-14 py-2 border-b border-slate-800/90 px-3 sm:px-6 flex items-center justify-between bg-slate-900/40 shrink-0 gap-2 w-full max-w-full">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              {/* Mobile Sidebar Toggle Button */}
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                className="md:hidden inline-flex items-center justify-center p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-slate-800 shrink-0"
                title="View Active Stories & Cast"
              >
                <Menu className="w-4 h-4" />
              </button>

              <h2 className="font-bold text-white text-xs sm:text-base truncate max-w-[120px] sm:max-w-[220px]">
                {activeSession.title}
              </h2>
              <button
                onClick={handleResetChat}
                disabled={isGeneratingText}
                title="Reset this chat back to the opening scene"
                className="hidden sm:inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-rose-950/50 text-slate-300 hover:text-rose-300 border border-slate-800 text-xs transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
              <button
                onClick={handleNewSessionFromCurrent}
                disabled={isGeneratingText}
                title="Create a brand-new session with this same character and world setting"
                className="hidden sm:inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-indigo-950/60 text-indigo-300 border border-slate-800 text-xs transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Session</span>
              </button>
              {activeSession.isGroup && (
                <select
                  value={activeSession.groupTurnMode}
                  onChange={(e) =>
                    updateActiveSession((s) => ({
                      ...s,
                      groupTurnMode: e.target.value as any,
                    }))
                  }
                  className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-fuchsia-300"
                >
                  <option value="natural">Group: AI Turn</option>
                  <option value="round-robin">Group: Round-Robin</option>
                  <option value="manual">Group: Manual</option>
                </select>
              )}
            </div>

            {/* Mobile Story Tools & VN Theater Buttons */}
            <div className="md:hidden flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() =>
                  onUpdateDb((prev) => {
                    const isDisabled = prev.ttsService?.enabled === false;
                    return {
                      ...prev,
                      ttsService: {
                        ...DEFAULT_TTS_SERVICE,
                        ...(prev.ttsService || {}),
                        enabled: true,
                        autoPlay: isDisabled
                          ? true
                          : !prev.ttsService?.autoPlay,
                      },
                    };
                  })
                }
                title="Toggle automatic voice playback for new replies"
                className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-semibold transition ${
                  db.ttsService?.enabled !== false && db.ttsService?.autoPlay
                    ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {db.ttsService?.enabled !== false && db.ttsService?.autoPlay ? (
                  <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                )}
                <span>
                  {db.ttsService?.enabled !== false && db.ttsService?.autoPlay
                    ? 'Auto'
                    : 'Mute'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setIsTheaterMode((prev) => !prev)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                  isTheaterMode
                    ? 'bg-amber-500/25 border-amber-400/60 text-amber-200 shadow-sm'
                    : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-amber-300'
                }`}
                title="Toggle Visual Novel Theater Mode"
              >
                <Film className="w-3.5 h-3.5 text-amber-400" />
                <span>VN</span>
              </button>
              <button
                type="button"
                onClick={() => setShowMobileToolsModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-300 text-xs font-semibold transition"
                title="Scene & Story Tools (Language, Status HUD, Workflow, Lore, Gallery)"
              >
                <Settings2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>Tools</span>
              </button>
            </div>

            {/* Desktop Quick Header Toolbar */}
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 flex-wrap">
              {/* Player Persona ({{user}}) Selector for this Chat */}
              <div
                title="Switch Player Persona ({{user}}) for this story — automatically updates your name in the opening scene and Status HUD"
                className="flex items-center gap-1.5 bg-slate-900 border border-emerald-500/40 rounded-lg px-2.5 py-1"
              >
                <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-slate-400">You:</span>
                <select
                  value={activeSession.personaId || db.activePersonaId}
                  onChange={(e) => handleSwitchSessionPersona(e.target.value)}
                  className="bg-transparent text-emerald-200 font-semibold focus:outline-none cursor-pointer"
                >
                  {db.personas.map((p) => (
                    <option
                      key={p.id}
                      value={p.id}
                      className="bg-slate-900 text-slate-100"
                    >
                      {p.name} ({formatGenderBadge(p.gender).symbol})
                    </option>
                  ))}
                  <option
                    value="__create_new__"
                    className="bg-slate-900 text-indigo-300 font-semibold"
                  >
                    + New Persona / Custom Name...
                  </option>
                </select>
              </div>

              {/* 1-Click Chat Model Quick-Switcher + Manual Pin */}
              {quickSwitchLlmGroups.length > 0 && (
                <div
                  title={
                    isChatLlmPinned
                      ? 'This chat is manually pinned to this model (switching here updates only this chat). Click Pin to follow Global again.'
                      : 'Following Global Active Model — switching here updates the active model everywhere in 1 click, or click Pin to lock a specific model just for this chat.'
                  }
                  className={`flex items-center gap-1.5 bg-slate-900 rounded-lg px-2.5 py-1 border ${
                    isChatLlmPinned
                      ? 'border-amber-500/60'
                      : 'border-sky-500/40'
                  }`}
                >
                  <Cpu
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isChatLlmPinned ? 'text-amber-400' : 'text-sky-400'
                    }`}
                  />
                  <select
                    value={currentChatLlmEncodedValue}
                    onChange={(e) => handleQuickSwitchChatModel(e.target.value)}
                    className={`bg-transparent font-medium focus:outline-none cursor-pointer max-w-[175px] truncate ${
                      isChatLlmPinned ? 'text-amber-200' : 'text-sky-200'
                    }`}
                  >
                    {quickSwitchLlmGroups.map(({ service, models }) => (
                      <optgroup
                        key={service.id}
                        label={`${service.name}${
                          service.status === 'connected' ? ' ●' : ''
                        }`}
                        className="bg-slate-900 text-slate-400"
                      >
                        {models.map((m) => (
                          <option
                            key={`${service.id}::${m}`}
                            value={JSON.stringify([service.id, m])}
                            className="bg-slate-900 text-slate-100"
                          >
                            {m}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleTogglePinChatModel}
                    title={
                      isChatLlmPinned
                        ? 'Pinned to this chat — click to unpin and follow Global model'
                        : 'Pin this model to this chat only (will never auto-switch)'
                    }
                    className={`p-0.5 rounded transition shrink-0 ${
                      isChatLlmPinned
                        ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                        : 'text-slate-500 hover:text-sky-300'
                    }`}
                  >
                    <Pin className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Conversation Language Selector */}
              <div
                title="Set Conversation Language — forces AI narration, dialogue, and suggested replies into your chosen language"
                className="flex items-center gap-1.5 bg-slate-900 border border-indigo-500/40 rounded-lg px-2.5 py-1"
              >
                <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <select
                  value={activeSession.language || db.defaultLanguage || 'auto'}
                  onChange={(e) => {
                    const lang = e.target.value as ConversationLanguage;
                    onUpdateDb((prev) => ({
                      ...prev,
                      defaultLanguage: lang,
                      chats: prev.chats.map((c) =>
                        c.id === activeSession.id ? { ...c, language: lang } : c
                      ),
                    }));
                  }}
                  className="bg-transparent text-indigo-200 font-medium focus:outline-none cursor-pointer"
                >
                  {CONVERSATION_LANGUAGES.map((l) => (
                    <option
                      key={l.id}
                      value={l.id}
                      className="bg-slate-900 text-slate-100"
                    >
                      {l.shortLabel} — {l.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status HUD / Meter Tracker Mode Selector */}
              <div
                title="Status HUD & Meter Tracker — automatically renders a visual Status Panel (HP, Stamina, Affection, Outfit, Inner Thoughts, Corruption, or custom meters) at the bottom of character replies"
                className="flex items-center gap-1.5 bg-slate-900 border border-emerald-500/40 rounded-lg px-2.5 py-1"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <select
                  value={activeSession.statusTrackerMode || 'auto'}
                  onChange={(e) => {
                    const nextMode = e.target.value as StatusTrackerMode;
                    const leadChar =
                      sessionCharacters[0] || db.characters[0];
                    const defaultTpl =
                      nextMode !== 'off' && nextMode !== 'auto'
                        ? getDefaultStatusTemplateForMode({
                            mode: nextMode,
                            charName: leadChar?.name || '角色',
                            userName: activePersona.name,
                            language:
                              activeSession.language ||
                              db.defaultLanguage ||
                              'auto',
                          })
                        : activeSession.customStatusTemplate;
                    updateActiveSession((s) => ({
                      ...s,
                      statusTrackerMode: nextMode,
                      customStatusTemplate: defaultTpl
                        ? `<status_bar>\n${defaultTpl.replace(
                            /<\/?status(?:_bar)?>/gi,
                            ''
                          ).trim()}\n</status_bar>`
                        : s.customStatusTemplate,
                    }));
                    if (nextMode !== 'off' && nextMode !== 'auto') {
                      setShowCustomStatusModal(true);
                    }
                  }}
                  className="bg-transparent text-emerald-200 font-medium focus:outline-none cursor-pointer max-w-[165px] truncate"
                >
                  <option value="auto" className="bg-slate-900 text-slate-100">
                    HUD: Auto-Detect
                  </option>
                  <option
                    value="rpg_traveler"
                    className="bg-slate-900 text-slate-100"
                  >
                    HUD: RPG / Traveler (HP · Stamina · Gear)
                  </option>
                  <option
                    value="romance_affection"
                    className="bg-slate-900 text-slate-100"
                  >
                    HUD: Romance &amp; Mood (Affection · Trust · Thoughts)
                  </option>
                  <option
                    value="intimate_detailed"
                    className="bg-slate-900 text-slate-100"
                  >
                    HUD: Detailed Body &amp; Status (Body · Corruption)
                  </option>
                  <option
                    value="custom"
                    className="bg-slate-900 text-slate-100"
                  >
                    HUD: Custom Template...
                  </option>
                  <option value="off" className="bg-slate-900 text-slate-100">
                    HUD: Off
                  </option>
                </select>
                {activeSession.statusTrackerMode !== 'off' && (
                  <button
                    type="button"
                    onClick={() => setShowCustomStatusModal(true)}
                    title="Set Starting Values, Presets & Custom Fields for Status HUD"
                    className="inline-flex items-center gap-1 text-emerald-300 hover:text-white pl-1.5 border-l border-emerald-500/30 text-[11px] font-medium"
                  >
                    <Sliders className="w-3 h-3" />
                    <span className="hidden xl:inline">Initial Values</span>
                  </button>
                )}
              </div>

              {/* TTS Voice Reading Mode & Auto-Play Quick Bar */}
              <div
                title="Text-to-Speech (TTS) Reading Mode & Auto-Play — choose whether to read spoken quotes only or full text"
                className="flex items-center gap-1.5 bg-slate-900 border border-cyan-500/40 rounded-lg px-2.5 py-1"
              >
                {db.ttsService?.enabled === false ? (
                  <VolumeX className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                )}
                <select
                  value={
                    db.ttsService?.enabled === false
                      ? 'off'
                      : db.ttsService?.readingMode || 'dialogue_only'
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    onUpdateDb((prev) => ({
                      ...prev,
                      ttsService: {
                        ...DEFAULT_TTS_SERVICE,
                        ...(prev.ttsService || {}),
                        enabled: val !== 'off',
                        ...(val === 'dialogue_only' || val === 'full_text'
                          ? { readingMode: val as TTSReadingMode }
                          : {}),
                      },
                    }));
                    if (val === 'off') {
                      ttsPlayer.stop();
                    }
                  }}
                  className="bg-transparent text-cyan-200 font-medium focus:outline-none cursor-pointer max-w-[155px] truncate"
                >
                  <option
                    value="dialogue_only"
                    className="bg-slate-900 text-slate-100"
                  >
                    TTS: Dialogue Only (&quot;Quotes&quot;)
                  </option>
                  <option
                    value="full_text"
                    className="bg-slate-900 text-slate-100"
                  >
                    TTS: Full Narration + Quotes
                  </option>
                  <option value="off" className="bg-slate-900 text-slate-100">
                    TTS: Disabled
                  </option>
                </select>
                {db.ttsService?.enabled !== false && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateDb((prev) => ({
                        ...prev,
                        ttsService: {
                          ...DEFAULT_TTS_SERVICE,
                          ...(prev.ttsService || {}),
                          autoPlay: !prev.ttsService?.autoPlay,
                        },
                      }))
                    }
                    title="Automatically synthesize and play character voice when a new reply finishes generating"
                    className={`inline-flex items-center gap-1 pl-1.5 border-l border-cyan-500/30 text-[11px] font-medium transition ${
                      db.ttsService?.autoPlay
                        ? 'text-cyan-300'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span>
                      {db.ttsService?.autoPlay ? 'Auto: ON' : 'Auto: OFF'}
                    </span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 bg-slate-900 border border-fuchsia-500/40 rounded-lg px-2.5 py-1">
                <ImageIcon className="w-3.5 h-3.5 text-fuchsia-400 shrink-0" />
                <span className="text-slate-400 hidden sm:inline">Workflow:</span>
                <select
                  value={
                    db.comfyService.defaultWorkflowId ||
                    db.workflows[0]?.id ||
                    ''
                  }
                  onChange={(e) =>
                    onUpdateDb((prev) => ({
                      ...prev,
                      comfyService: {
                        ...prev.comfyService,
                        defaultWorkflowId: e.target.value,
                      },
                    }))
                  }
                  title="Choose which ComfyUI workflow is used when you click Visualize Scene"
                  className="bg-transparent text-fuchsia-200 font-medium focus:outline-none max-w-[210px] truncate cursor-pointer"
                >
                  {db.workflows.map((wf) => (
                    <option
                      key={wf.id}
                      value={wf.id}
                      className="bg-slate-900 text-slate-100"
                    >
                      {wf.name}
                    </option>
                  ))}
                </select>
              </div>

              <select
                value={activeSession.autoImageEveryNTurns || 0}
                onChange={(e) =>
                  updateActiveSession((s) => ({
                    ...s,
                    autoImageEveryNTurns: parseInt(e.target.value) || 0,
                  }))
                }
                title="Automatically trigger ComfyUI scene generation every N turns"
                className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-300"
              >
                <option value={0}>Auto-Image: Off</option>
                <option value={1}>Auto-Image: Every Turn</option>
                <option value={2}>Auto-Image: Every 2 Turns</option>
                <option value={3}>Auto-Image: Every 3 Turns</option>
              </select>

              <button
                onClick={() => setIsTheaterMode((prev) => !prev)}
                title="Toggle Visual Novel Theater / Immersive Mode — full-stage artwork backdrop, floating Live Status HUD, and translucent VN dialogue box"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-medium transition ${
                  isTheaterMode
                    ? 'bg-amber-500/25 border-amber-400/60 text-amber-200 shadow-sm'
                    : 'bg-slate-900 hover:bg-slate-800 text-amber-300 border-amber-500/35'
                }`}
              >
                <Film className="w-3.5 h-3.5 text-amber-400" />
                {isTheaterMode ? 'Exit VN Mode' : 'VN Theater'}
              </button>

              <button
                onClick={() => setShowGalleryModal(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-fuchsia-300 border border-slate-800"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Scene Gallery
              </button>

              <button
                onClick={() => setShowMemoryModal(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
              >
                <Eye className="w-3.5 h-3.5 text-indigo-400" />
                Story World & Lore ({(activeSession.storyLore || []).length})
              </button>

              <button
                onClick={() => setShowLlmParamsModal(true)}
                title="Adjust Preset & Custom LLM Generation Parameters (Temperature, Repetition Penalty, Top P, Top K, Max Response Tokens, Context Size)"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-sky-300 border border-slate-800"
              >
                <Sliders className="w-3.5 h-3.5 text-sky-400" />
                Parameters
              </button>
            </div>
          </div>
        )}

        {/* Visual Novel Theater Mode OR Standard Messages Scroll Container */}
        {isTheaterMode && activeSession ? (
          (() => {
            const msgs = activeSession.messages;
            const totalTurns = msgs.length;
            const effectiveIdx =
              theaterTurnIndex !== null &&
              theaterTurnIndex >= 0 &&
              theaterTurnIndex < totalTurns
                ? theaterTurnIndex
                : Math.max(0, totalTurns - 1);
            const currentMsg = msgs[effectiveIdx] || msgs[0];
            const isViewingLatest = effectiveIdx === totalTurns - 1;
            const isStreamingNow =
              isGeneratingText && Boolean(streamingSpeaker) && isViewingLatest;

            const isUserTurn = !isStreamingNow && currentMsg?.role === 'user';
            const speakerChar = isStreamingNow
              ? streamingSpeaker || undefined
              : !isUserTurn
              ? db.characters.find((c) => c.id === currentMsg?.speakerId) ||
                sessionCharacters[0]
              : sessionCharacters[0];

            const speakerName = isStreamingNow
              ? streamingSpeaker?.name || 'Character'
              : currentMsg?.speakerName || speakerChar?.name || 'Character';

            const speakerGenderBadge = formatGenderBadge(
              isUserTurn
                ? activePersona?.gender || 'male'
                : speakerChar?.gender || 'female'
            );

            const speakerAvatar = isUserTurn
              ? currentMsg?.speakerAvatar || activePersona?.avatarUrl || ''
              : speakerChar?.referenceImageUrl ||
                speakerChar?.avatarUrl ||
                currentMsg?.speakerAvatar ||
                '';

            // Find the most recent generated ComfyUI scene image up to effectiveIdx
            let stageMedia: GeneratedMedia | null = null;
            for (let i = effectiveIdx; i >= 0; i--) {
              const mImages = msgs[i]?.images;
              if (mImages && mImages.length > 0) {
                stageMedia = mImages[mImages.length - 1];
                break;
              }
            }
            const stageImageUrl =
              stageMedia?.imageUrl ||
              speakerChar?.referenceImageUrl ||
              speakerChar?.avatarUrl ||
              activePersona?.avatarUrl ||
              '';

            // Parse latest status HUD up to effectiveIdx
            let latestHudParsed = parseMessageStatusBlocks(
              isStreamingNow && streamingText
                ? streamingText
                : currentMsg?.swipes[currentMsg.activeSwipeIndex] || '',
              msgs,
              effectiveIdx
            );
            if (!latestHudParsed.hasStatus) {
              for (let i = effectiveIdx - 1; i >= 0; i--) {
                const candidate = parseMessageStatusBlocks(
                  msgs[i]?.swipes[msgs[i].activeSwipeIndex] || '',
                  msgs,
                  i
                );
                if (candidate.hasStatus) {
                  latestHudParsed = candidate;
                  break;
                }
              }
            }

            const currentSwipeText = isStreamingNow
              ? streamingText
              : currentMsg?.swipes[currentMsg?.activeSwipeIndex || 0] || '';
            const isGeneratingImgForCurrent =
              Boolean(currentMsg) && generatingImageForMsgId === currentMsg.id;

            return (
              <div className="flex-1 relative overflow-hidden flex flex-col justify-between bg-slate-950 select-none">
                {/* 1. Ambient Blurred Backdrop + Center Stage Illustration / Portrait */}
                {stageImageUrl && (
                  <>
                    <img
                      src={stageImageUrl}
                      alt="Ambient Backdrop"
                      className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-30 pointer-events-none"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/25 to-slate-950/75 pointer-events-none" />
                  </>
                )}

                {/* 2. Top Floating VN Stage Controls */}
                <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5 pt-2.5 pb-1.5">
                  <div className="flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-md border border-slate-800/90 rounded-xl p-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => setIsTheaterMode(false)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 text-xs font-semibold transition"
                      title="Return to standard scrolling chat view"
                    >
                      <Film className="w-3.5 h-3.5 text-amber-400" />
                      <span>Exit VN</span>
                    </button>

                    <div className="h-4 w-px bg-slate-800 mx-0.5" />

                    <button
                      type="button"
                      onClick={() =>
                        setTheaterTurnIndex(Math.max(0, effectiveIdx - 1))
                      }
                      disabled={effectiveIdx <= 0}
                      className="p-1 rounded-lg hover:bg-slate-800 text-slate-300 disabled:opacity-30"
                      title="Previous Turn"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-[11px] font-semibold text-slate-200 px-1.5">
                      Turn {effectiveIdx + 1} / {totalTurns}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setTheaterTurnIndex(
                          Math.min(totalTurns - 1, effectiveIdx + 1)
                        )
                      }
                      disabled={effectiveIdx >= totalTurns - 1}
                      className="p-1 rounded-lg hover:bg-slate-800 text-slate-300 disabled:opacity-30"
                      title="Next Turn"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    {!isViewingLatest && (
                      <button
                        type="button"
                        onClick={() => setTheaterTurnIndex(null)}
                        className="px-2 py-0.5 rounded-md bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 text-[10px] font-semibold"
                      >
                        Latest ⏭
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-md border border-slate-800/90 rounded-xl p-1 shadow-lg">
                    {currentMsg && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleVisualizeMessage(currentMsg)}
                          disabled={Boolean(generatingImageForMsgId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-fuchsia-600/25 hover:bg-fuchsia-600/40 text-fuchsia-200 border border-fuchsia-500/40 text-xs font-semibold transition disabled:opacity-40"
                          title="Render a fresh ComfyUI scene illustration for this turn"
                        >
                          <ImageIcon className="w-3.5 h-3.5 text-fuchsia-400" />
                          <span>
                            {isGeneratingImgForCurrent
                              ? 'Rendering...'
                              : 'Visualize Scene'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenPromptPreview(currentMsg)}
                          disabled={Boolean(generatingImageForMsgId)}
                          className="p-1.5 rounded-lg hover:bg-slate-800 text-fuchsia-300"
                          title="Open Scene Prompt Studio"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    {latestHudParsed.hasStatus && (
                      <button
                        type="button"
                        onClick={() => setShowTheaterHud((prev) => !prev)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition ${
                          showTheaterHud
                            ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40'
                            : 'bg-slate-900 text-slate-400 border-slate-800'
                        }`}
                        title="Toggle Floating Live Status HUD Overlay"
                      >
                        <Activity className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="hidden sm:inline">HUD</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 3. Center Stage Artwork + Floating Live Status HUD Overlay */}
                <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center px-4 py-1 overflow-hidden">
                  {stageImageUrl ? (
                    <div className="relative h-full flex items-center justify-center">
                      <img
                        src={stageImageUrl}
                        alt={speakerName}
                        onClick={() => {
                          if (stageMedia) {
                            setLightboxImage(stageMedia);
                          }
                        }}
                        className={`max-h-full max-w-full object-contain rounded-2xl shadow-2xl border border-white/10 transition ${
                          stageMedia ? 'cursor-zoom-in hover:scale-[1.01]' : ''
                        }`}
                      />
                      {isGeneratingImgForCurrent && (
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-slate-950/90 border border-fuchsia-500/50 text-xs text-fuchsia-200 flex items-center gap-2 shadow-xl">
                          <Sparkles className="w-3.5 h-3.5 animate-spin text-fuchsia-400" />
                          <span>
                            {imageProgressText || 'Rendering in ComfyUI...'}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center text-slate-500 text-xs space-y-2">
                      <ImageIcon className="w-8 h-8 mx-auto text-slate-600" />
                      <p>
                        Click &ldquo;Visualize Scene&rdquo; above to render a
                        ComfyUI illustration for this turn!
                      </p>
                    </div>
                  )}

                  {/* Floating Live Status HUD Card (Top-Right of Stage) */}
                  {showTheaterHud && latestHudParsed.hasStatus && (
                    <div className="hidden sm:flex flex-col gap-1.5 absolute top-2 right-5 w-64 max-h-[92%] overflow-y-auto bg-slate-950/80 backdrop-blur-xl border border-emerald-500/35 rounded-2xl p-3 text-xs shadow-2xl">
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                        <span className="font-bold text-emerald-300 flex items-center gap-1.5 text-[11px]">
                          <Activity className="w-3.5 h-3.5 text-emerald-400" />
                          Live Status · {speakerChar?.name || speakerName}
                        </span>
                        {latestHudParsed.stage && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-200 border border-emerald-500/30 truncate max-w-[110px]">
                            {latestHudParsed.stage}
                          </span>
                        )}
                      </div>

                      <div className="space-y-1 text-[11px]">
                        {latestHudParsed.metaFields.location && (
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-400 shrink-0">📍 Location:</span>
                            <span className="text-slate-100 font-medium text-right truncate">
                              {latestHudParsed.metaFields.location}
                            </span>
                          </div>
                        )}
                        {latestHudParsed.metaFields.time && (
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-400 shrink-0">🕒 Time:</span>
                            <span className="text-slate-200 text-right truncate">
                              {latestHudParsed.metaFields.time}
                            </span>
                          </div>
                        )}
                        {latestHudParsed.metaFields.outfit && (
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-400 shrink-0">👗 Outfit:</span>
                            <span className="text-slate-200 text-right truncate">
                              {latestHudParsed.metaFields.outfit}
                            </span>
                          </div>
                        )}
                        {latestHudParsed.conditionFields
                          .slice(0, 2)
                          .map((f, i) => (
                            <div key={i} className="flex justify-between gap-2">
                              <span className="text-slate-400 shrink-0">
                                {f.key}:
                              </span>
                              <span className="text-slate-200 text-right line-clamp-1">
                                {f.value}
                              </span>
                            </div>
                          ))}
                      </div>

                      {(latestHudParsed.statusMeters.length > 0 ||
                        latestHudParsed.variableMeters.length > 0) && (
                        <div className="space-y-1.5 pt-1.5 border-t border-slate-800/80">
                          {[
                            ...latestHudParsed.statusMeters,
                            ...latestHudParsed.variableMeters,
                          ]
                            .slice(0, 4)
                            .map((m, i) => {
                              const pct =
                                m.max > 0 ? Math.round((m.value / m.max) * 100) : m.value;
                              return (
                                <div key={i} className="space-y-0.5">
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-300 font-medium">
                                      {m.key}
                                    </span>
                                    <span className="text-emerald-300 font-mono">
                                      {m.rawDisplay}
                                    </span>
                                  </div>
                                  <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 rounded-full transition-all"
                                      style={{
                                        width: `${Math.min(
                                          100,
                                          Math.max(0, pct)
                                        )}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 4. Translucent Visual Novel Dialogue Box */}
                <div className="relative z-20 mx-2 sm:mx-5 mb-2 rounded-2xl bg-slate-950/88 backdrop-blur-xl border border-indigo-500/35 shadow-2xl p-3 sm:p-4 space-y-2">
                  {/* Speaker Nameplate & Quick Turn Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {speakerAvatar ? (
                        <img
                          src={speakerAvatar}
                          alt={speakerName}
                          className="w-8 h-8 rounded-xl object-cover border border-indigo-500/40 bg-slate-900 shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center shrink-0">
                          <User className="w-4 h-4 text-slate-400" />
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="font-bold text-white text-sm truncate">
                          {speakerName}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${speakerGenderBadge.colorClass}`}
                        >
                          {speakerGenderBadge.symbol} {speakerGenderBadge.label}
                        </span>
                        {isUserTurn && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-200 border border-indigo-500/30 text-[10px] font-semibold">
                            You
                          </span>
                        )}
                        {isStreamingNow && (
                          <span className="text-[11px] text-indigo-300 animate-pulse">
                            speaking...
                          </span>
                        )}
                        {!isStreamingNow &&
                          currentMsg?.injectedLore &&
                          currentMsg.injectedLore.length > 0 && (
                            <span
                              title={`Injected Lorebook: ${currentMsg.injectedLore.join(', ')}`}
                              className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[10px]"
                            >
                              +{currentMsg.injectedLore.length} Lore
                            </span>
                          )}
                        {!isStreamingNow &&
                          currentMsg?.injectedChapters &&
                          currentMsg.injectedChapters.length > 0 && (
                            <span
                              title={`Recalled Chapters: ${currentMsg.injectedChapters.join(', ')}`}
                              className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px]"
                            >
                              +{currentMsg.injectedChapters.length} Ch.
                            </span>
                          )}
                      </div>
                    </div>

                    {/* VN Dialogue Box Action Buttons (Speak, Swipes, Regenerate, Edit) */}
                    {currentMsg && !isStreamingNow && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {currentMsg.swipes.length > 1 && (
                          <div className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg px-2 py-0.5 text-xs text-slate-300">
                            <button
                              type="button"
                              onClick={() =>
                                updateActiveSession((s) => ({
                                  ...s,
                                  messages: s.messages.map((m) =>
                                    m.id === currentMsg.id
                                      ? {
                                          ...m,
                                          activeSwipeIndex: Math.max(
                                            0,
                                            m.activeSwipeIndex - 1
                                          ),
                                        }
                                      : m
                                  ),
                                }))
                              }
                              disabled={currentMsg.activeSwipeIndex === 0}
                              className="hover:text-white disabled:opacity-30"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-[11px]">
                              Swipe {currentMsg.activeSwipeIndex + 1}/
                              {currentMsg.swipes.length}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateActiveSession((s) => ({
                                  ...s,
                                  messages: s.messages.map((m) =>
                                    m.id === currentMsg.id
                                      ? {
                                          ...m,
                                          activeSwipeIndex: Math.min(
                                            m.swipes.length - 1,
                                            m.activeSwipeIndex + 1
                                          ),
                                        }
                                      : m
                                  ),
                                }))
                              }
                              disabled={
                                currentMsg.activeSwipeIndex ===
                                currentMsg.swipes.length - 1
                              }
                              className="hover:text-white disabled:opacity-30"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {!isUserTurn && db.ttsService?.enabled !== false && (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                const swipeIdx = currentMsg.activeSwipeIndex;
                                const playKey = `${currentMsg.id}:${swipeIdx}`;
                                const cachedUrl =
                                  currentMsg.audioUrls?.[swipeIdx];
                                ttsPlayer.toggleOrSpeak({
                                  id: playKey,
                                  rawText: currentSwipeText,
                                  ttsConfig: db.ttsService,
                                  character: speakerChar,
                                  allCharacters: db.characters,
                                  languageHint:
                                    activeSession.language ||
                                    speakerChar?.defaultLanguage ||
                                    db.defaultLanguage ||
                                    'auto',
                                  existingAudioUrl: cachedUrl,
                                  onAudioCached: (audioUrl) => {
                                    updateActiveSession((s) => ({
                                      ...s,
                                      messages: s.messages.map((m) =>
                                        m.id === currentMsg.id
                                          ? {
                                              ...m,
                                              audioUrls: {
                                                ...(m.audioUrls || {}),
                                                [swipeIdx]: audioUrl,
                                              },
                                            }
                                          : m
                                      ),
                                    }));
                                  },
                                });
                              }}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition ${
                                ttsSnapshot.activeId ===
                                  `${currentMsg.id}:${currentMsg.activeSwipeIndex}` &&
                                ttsSnapshot.status !== 'idle'
                                  ? 'bg-rose-950/60 text-rose-200 border-rose-500/50'
                                  : 'bg-cyan-950/50 hover:bg-cyan-900/60 text-cyan-300 border-cyan-500/30'
                              }`}
                            >
                              {ttsSnapshot.activeId ===
                                `${currentMsg.id}:${currentMsg.activeSwipeIndex}` &&
                              ttsSnapshot.status !== 'idle' ? (
                                <>
                                  <Square className="w-3 h-3 fill-current" />
                                  <span>Stop</span>
                                </>
                              ) : (
                                <>
                                  <Volume2 className="w-3 h-3" />
                                  <span>Speak</span>
                                </>
                              )}
                            </button>
                            {currentMsg.audioUrls?.[currentMsg.activeSwipeIndex] && (
                              <button
                                type="button"
                                onClick={() => {
                                  const swipeIdx = currentMsg.activeSwipeIndex;
                                  const playKey = `${currentMsg.id}:${swipeIdx}`;
                                  const prevCachedUrl =
                                    currentMsg.audioUrls?.[swipeIdx];
                                  ttsPlayer.toggleOrSpeak({
                                    id: playKey,
                                    rawText: currentSwipeText,
                                    ttsConfig: db.ttsService,
                                    character: speakerChar,
                                    allCharacters: db.characters,
                                    languageHint:
                                      activeSession.language ||
                                      speakerChar?.defaultLanguage ||
                                      db.defaultLanguage ||
                                      'auto',
                                    forceRegenerate: true,
                                    onAudioCached: (audioUrl) => {
                                      updateActiveSession((s) => ({
                                        ...s,
                                        messages: s.messages.map((m) =>
                                          m.id === currentMsg.id
                                            ? {
                                                ...m,
                                                audioUrls: {
                                                  ...(m.audioUrls || {}),
                                                  [swipeIdx]: audioUrl,
                                                },
                                              }
                                            : m
                                        ),
                                      }));
                                      if (
                                        prevCachedUrl &&
                                        prevCachedUrl !== audioUrl &&
                                        prevCachedUrl.startsWith('/api/audio/')
                                      ) {
                                        fetch(prevCachedUrl, {
                                          method: 'DELETE',
                                        }).catch(() => {});
                                      }
                                    },
                                  });
                                }}
                                title="Re-synthesize fresh voice audio (bypass cache & replace old file)"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-cyan-950/60 text-slate-400 hover:text-cyan-200 border border-slate-800 hover:border-cyan-500/40 text-[11px] transition"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )}

                        {!isUserTurn && (
                          <button
                            type="button"
                            onClick={() => {
                              const truncatedSession: ChatSession = {
                                ...activeSession,
                                messages: activeSession.messages.slice(
                                  0,
                                  effectiveIdx
                                ),
                              };
                              triggerCharacterReply(
                                truncatedSession,
                                speakerChar,
                                currentMsg.id
                              );
                            }}
                            disabled={isGeneratingText || isArchivedChat}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] disabled:opacity-40"
                            title="Regenerate / New Swipe"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Swipe</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Narrative & Spoken Dialogue Body inside VN Box */}
                  <div className="max-h-[24vh] sm:max-h-[26vh] overflow-y-auto pr-1 select-text">
                    {renderFormattedMessage(
                      currentSwipeText,
                      speakerName,
                      effectiveIdx,
                      true
                    )}
                  </div>

                  {chatError && (
                    <div className="w-full bg-rose-950/60 border border-rose-500/40 text-rose-200 rounded-xl p-2.5 text-xs">
                      {chatError}
                    </div>
                  )}
                </div>
              </div>
            );
          })()
        ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6 space-y-4 sm:space-y-5 w-full max-w-full">
          {!activeSession && (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-3 py-12">
              <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-indigo-400">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white">
                No Active Story Chats
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Start a new 1-on-1 or group role-play session with any character
                from your cast.
              </p>
              <button
                type="button"
                onClick={() => setShowNewGroupModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shadow-md"
              >
                <Plus className="w-4 h-4" />
                New Story / Group Chat
              </button>
            </div>
          )}
          {activeSession && hiddenMessageCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
              <span>
                Showing latest <strong className="text-white">{visibleMessages.length}</strong> of{' '}
                <strong className="text-white">{totalSessionMessages}</strong> messages ({hiddenMessageCount} earlier hidden for smooth scrolling)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleMessageCount((c) => c + 30)}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-200 font-medium transition"
                >
                  Load {Math.min(30, hiddenMessageCount)} earlier
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleMessageCount(totalSessionMessages)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition"
                >
                  Show all
                </button>
              </div>
            </div>
          )}
          {visibleMessages.map((msg, localIdx) => {
            const msgIdx = hiddenMessageCount + localIdx;
            const isUser = msg.role === 'user';
            const currentText = msg.swipes[msg.activeSwipeIndex] || '';
            const isGeneratingImg = generatingImageForMsgId === msg.id;
            const speakerChar = !isUser
              ? db.characters.find((c) => c.id === msg.speakerId)
              : undefined;
            const speakerGenderBadge = formatGenderBadge(
              isUser
                ? activePersona?.gender || 'male'
                : speakerChar?.gender || 'female'
            );
            const resolvedAvatar = isUser
              ? msg.speakerAvatar || activePersona?.avatarUrl || ''
              : msg.speakerAvatar ||
                speakerChar?.referenceImageUrl ||
                speakerChar?.avatarUrl ||
                '';

            return (
              <div
                key={msg.id}
                className={`flex gap-2.5 sm:gap-4 w-full max-w-full ${
                  isUser ? 'ml-auto flex-row-reverse' : ''
                }`}
              >
                {resolvedAvatar ? (
                  <img
                    src={resolvedAvatar}
                    alt={msg.speakerName}
                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl object-cover bg-slate-800 border border-slate-700 shrink-0 mt-0.5"
                  />
                ) : (
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
                  </div>
                )}

                <div className="flex-1 min-w-0 max-w-full space-y-1.5 sm:space-y-2 overflow-hidden">
                  <div
                    className={`flex items-center gap-2 text-xs ${
                      isUser ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <span className="font-semibold text-white">
                      {msg.speakerName}
                    </span>
                    <span
                      title={`Speaker Gender: ${speakerGenderBadge.label}`}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${speakerGenderBadge.colorClass}`}
                    >
                      {speakerGenderBadge.symbol} {speakerGenderBadge.label}
                    </span>
                    {msg.injectedLore && msg.injectedLore.length > 0 && (
                      <span
                        title={`Injected Lorebook: ${msg.injectedLore.join(', ')}`}
                        className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[10px]"
                      >
                        +{msg.injectedLore.length} Lore
                      </span>
                    )}
                    {msg.injectedChapters && msg.injectedChapters.length > 0 && (
                      <span
                        title={`Recalled Long-Term Chapters: ${msg.injectedChapters.join(', ')}`}
                        className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px]"
                      >
                        +{msg.injectedChapters.length} Ch.
                      </span>
                    )}
                  </div>

                  <div
                    className={`rounded-2xl p-3 sm:p-4 border break-words ${
                      isUser
                        ? 'bg-indigo-950/40 border-indigo-500/30'
                        : 'bg-slate-900/90 border-slate-800'
                    }`}
                  >
                    {editingMsgId === msg.id ? (
                      <InlineMessageEditor
                        initialText={editingText}
                        onCancel={() => setEditingMsgId(null)}
                        onSave={(nextText) => {
                          updateActiveSession((s) => ({
                            ...s,
                            messages: s.messages.map((m) =>
                              m.id === msg.id
                                ? {
                                    ...m,
                                    swipes: m.swipes.map((sw, idx) =>
                                      idx === m.activeSwipeIndex
                                        ? nextText
                                        : sw
                                    ),
                                  }
                                : m
                            ),
                          }));
                          setEditingMsgId(null);
                        }}
                      />
                    ) : (
                      renderFormattedMessage(
                        currentText,
                        msg.speakerName,
                        msgIdx
                      )
                    )}

                    {/* Inline Generated ComfyUI Scene Images */}
                    {msg.images && msg.images.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {msg.images.map((img) => (
                          <div
                            key={img.id}
                            onClick={() => setLightboxImage(img)}
                            className="group relative rounded-xl overflow-hidden border border-slate-700 bg-slate-950 cursor-pointer"
                          >
                            <img
                              src={img.imageUrl}
                              alt={img.prompt}
                              className="w-full max-h-72 object-cover group-hover:scale-[1.02] transition"
                            />
                            {/* Hover Action Buttons: Regenerate, Edit Prompt, Download, Delete */}
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition bg-slate-950/85 backdrop-blur-md border border-slate-700/80 rounded-lg p-1 shadow-lg"
                            >
                              <button
                                onClick={() =>
                                  handleRegenerateMessageImage(msg, img)
                                }
                                disabled={Boolean(generatingImageForMsgId)}
                                title="Regenerate this image (new seed, replaces current image)"
                                className="p-1.5 rounded hover:bg-fuchsia-600/30 text-fuchsia-300 hover:text-white transition disabled:opacity-40"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() =>
                                  handleOpenPromptPreview(msg, img)
                                }
                                disabled={Boolean(generatingImageForMsgId)}
                                title="Edit prompt / <image2> in Prompt Studio & replace this image"
                                className="p-1.5 rounded hover:bg-indigo-600/30 text-indigo-300 hover:text-white transition disabled:opacity-40"
                              >
                                <Sliders className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDownloadImage(img)}
                                title="Download PNG file"
                                className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-white transition"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() =>
                                  handleDeleteMessageImage(msg.id, img)
                                }
                                title="Delete this image (also deletes local file in data/images/)"
                                className="p-1.5 rounded hover:bg-rose-600/30 text-rose-400 hover:text-rose-200 transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="p-2 bg-slate-950/90 text-[11px] text-slate-400 truncate">
                              <span className="text-fuchsia-400 font-medium">
                                {img.workflowName}
                              </span>{' '}
                              • {img.prompt}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {isGeneratingImg && (
                      <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center gap-2.5 text-xs text-fuchsia-300">
                        <Sparkles className="w-4 h-4 animate-spin text-fuchsia-400" />
                        <span>{imageProgressText || 'Rendering in ComfyUI...'}</span>
                      </div>
                    )}
                  </div>

                  {/* Message Action Bar: Swipes, Visualize Scene (ComfyUI), Edit, Regenerate */}
                  <div
                    className={`flex flex-wrap items-center gap-2 text-xs text-slate-400 ${
                      isUser ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {/* Swipe controls */}
                    {msg.swipes.length > 1 && (
                      <div className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg px-2 py-0.5">
                        <button
                          onClick={() =>
                            updateActiveSession((s) => ({
                              ...s,
                              messages: s.messages.map((m) =>
                                m.id === msg.id
                                  ? {
                                      ...m,
                                      activeSwipeIndex: Math.max(
                                        0,
                                        m.activeSwipeIndex - 1
                                      ),
                                    }
                                  : m
                              ),
                            }))
                          }
                          disabled={msg.activeSwipeIndex === 0}
                          className="hover:text-white disabled:opacity-30"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[11px]">
                          {msg.activeSwipeIndex + 1} / {msg.swipes.length}
                        </span>
                        <button
                          onClick={() =>
                            updateActiveSession((s) => ({
                              ...s,
                              messages: s.messages.map((m) =>
                                m.id === msg.id
                                  ? {
                                      ...m,
                                      activeSwipeIndex: Math.min(
                                        m.swipes.length - 1,
                                        m.activeSwipeIndex + 1
                                      ),
                                    }
                                  : m
                              ),
                            }))
                          }
                          disabled={
                            msg.activeSwipeIndex === msg.swipes.length - 1
                          }
                          className="hover:text-white disabled:opacity-30"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Speak / Stop + Re-synthesize TTS Voice on this message */}
                    {!isUser && db.ttsService?.enabled !== false && (
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => {
                            const speakerChar = db.characters.find(
                              (c) => c.id === msg.speakerId
                            );
                            const swipeIdx = msg.activeSwipeIndex;
                            const playKey = `${msg.id}:${swipeIdx}`;
                            const cachedUrl = msg.audioUrls?.[swipeIdx];
                            ttsPlayer.toggleOrSpeak({
                              id: playKey,
                              rawText: currentText,
                              ttsConfig: db.ttsService,
                              character: speakerChar,
                              allCharacters: db.characters,
                              languageHint:
                                activeSession.language ||
                                speakerChar?.defaultLanguage ||
                                db.defaultLanguage ||
                                'auto',
                              existingAudioUrl: cachedUrl,
                              onAudioCached: (audioUrl) => {
                                updateActiveSession((s) => ({
                                  ...s,
                                  messages: s.messages.map((m) =>
                                    m.id === msg.id
                                      ? {
                                          ...m,
                                          audioUrls: {
                                            ...(m.audioUrls || {}),
                                            [swipeIdx]: audioUrl,
                                          },
                                        }
                                      : m
                                  ),
                                }));
                              },
                            });
                          }}
                          title={
                            msg.audioUrls?.[msg.activeSwipeIndex]
                              ? 'Play cached character voice (stored in data/audio/)'
                              : 'Synthesize and speak character dialogue aloud'
                          }
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition ${
                            ttsSnapshot.activeId ===
                              `${msg.id}:${msg.activeSwipeIndex}` &&
                            ttsSnapshot.status !== 'idle'
                              ? 'bg-rose-950/60 hover:bg-rose-900/70 text-rose-200 border-rose-500/50'
                              : 'bg-cyan-950/45 hover:bg-cyan-900/55 text-cyan-300 border-cyan-500/30'
                          }`}
                        >
                          {ttsSnapshot.activeId ===
                            `${msg.id}:${msg.activeSwipeIndex}` &&
                          ttsSnapshot.status !== 'idle' ? (
                            <>
                              <Square className="w-3 h-3 fill-current" />
                              <span>
                                {ttsSnapshot.status === 'synthesizing'
                                  ? 'Synthesizing...'
                                  : 'Stop Voice'}
                              </span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3 h-3" />
                              <span>Speak</span>
                              {msg.audioUrls?.[msg.activeSwipeIndex] && (
                                <span
                                  className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                                  title="Cached in data/audio/"
                                />
                              )}
                            </>
                          )}
                        </button>
                        {msg.audioUrls?.[msg.activeSwipeIndex] && (
                          <button
                            type="button"
                            onClick={() => {
                              const speakerChar = db.characters.find(
                                (c) => c.id === msg.speakerId
                              );
                              const swipeIdx = msg.activeSwipeIndex;
                              const playKey = `${msg.id}:${swipeIdx}`;
                              const prevCachedUrl = msg.audioUrls?.[swipeIdx];
                              ttsPlayer.toggleOrSpeak({
                                id: playKey,
                                rawText: currentText,
                                ttsConfig: db.ttsService,
                                character: speakerChar,
                                allCharacters: db.characters,
                                languageHint:
                                  activeSession.language ||
                                  speakerChar?.defaultLanguage ||
                                  db.defaultLanguage ||
                                  'auto',
                                forceRegenerate: true,
                                onAudioCached: (audioUrl) => {
                                  updateActiveSession((s) => ({
                                    ...s,
                                    messages: s.messages.map((m) =>
                                      m.id === msg.id
                                        ? {
                                            ...m,
                                            audioUrls: {
                                              ...(m.audioUrls || {}),
                                              [swipeIdx]: audioUrl,
                                            },
                                          }
                                        : m
                                    ),
                                  }));
                                  if (
                                    prevCachedUrl &&
                                    prevCachedUrl !== audioUrl &&
                                    prevCachedUrl.startsWith('/api/audio/')
                                  ) {
                                    fetch(prevCachedUrl, {
                                      method: 'DELETE',
                                    }).catch(() => {});
                                  }
                                },
                              });
                            }}
                            title="Re-synthesize fresh voice audio (ignores cache & replaces old file)"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900/80 hover:bg-cyan-950/60 text-slate-400 hover:text-cyan-200 border border-slate-800 hover:border-cyan-500/40 text-[11px] transition"
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Visualize Scene with ComfyUI */}
                    <button
                      onClick={() => handleVisualizeMessage(msg)}
                      disabled={Boolean(generatingImageForMsgId)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-fuchsia-950/50 hover:bg-fuchsia-900/60 text-fuchsia-300 border border-fuchsia-500/30 text-[11px] font-medium transition disabled:opacity-40"
                    >
                      <ImageIcon className="w-3 h-3" />
                      Visualize Scene
                    </button>

                    <button
                      onClick={() => handleOpenPromptPreview(msg)}
                      disabled={Boolean(generatingImageForMsgId)}
                      title="Preview & customize the AI scene prompt and ComfyUI workflow before rendering"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-fuchsia-200 border border-slate-800 text-[11px] transition"
                    >
                      <Sliders className="w-3 h-3" />
                      Prompt Studio
                    </button>

                    {/* Generate / Refresh Visual Status HUD Card on this message */}
                    {!isUser && (
                      <button
                        onClick={() => handleGenerateStatusHudForMessage(msg)}
                        disabled={
                          Boolean(generatingStatusForMsgId) || isGeneratingText
                        }
                        title="Generate or refresh the visual Status HUD & Meter Panel (<status_bar>) at the bottom of this reply"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium transition disabled:opacity-40"
                      >
                        <Activity
                          className={`w-3 h-3 ${
                            generatingStatusForMsgId === msg.id
                              ? 'animate-spin'
                              : ''
                          }`}
                        />
                        {generatingStatusForMsgId === msg.id
                          ? 'Updating HUD...'
                          : 'Status HUD'}
                      </button>
                    )}

                    {/* Steer & Swipe with Guidance */}
                    {!isUser && (
                      <button
                        onClick={() => {
                          setSteerMsgId(steerMsgId === msg.id ? null : msg.id);
                          setSteerPrompt('');
                        }}
                        disabled={isGeneratingText || isArchivedChat}
                        title="Steer how the character should respond in this turn (e.g. stay on topic, act bolder, be shier)"
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition disabled:opacity-40 ${
                          steerMsgId === msg.id
                            ? 'bg-amber-500/25 text-amber-200 border-amber-500/50'
                            : 'bg-amber-950/30 hover:bg-amber-900/40 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        <Compass className="w-3 h-3" />
                        Steer &amp; Swipe
                      </button>
                    )}

                    {/* Regenerate / New Swipe */}
                    {!isUser && (
                      <button
                        onClick={() => {
                          const speaker = db.characters.find(
                            (c) => c.id === msg.speakerId
                          );
                          const msgIdx = activeSession.messages.findIndex(
                            (m) => m.id === msg.id
                          );
                          const truncatedSession: ChatSession = {
                            ...activeSession,
                            messages: activeSession.messages.slice(0, msgIdx),
                          };
                          triggerCharacterReply(
                            truncatedSession,
                            speaker,
                            msg.id
                          );
                        }}
                        disabled={isGeneratingText || isArchivedChat}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-900 text-slate-400 hover:text-slate-200 text-[11px] disabled:opacity-40"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Swipe
                      </button>
                    )}

                    {/* Auto-fix formatting / quotation & asterisk mixups */}
                    {!isUser && (
                      <button
                        onClick={() => {
                          const cleaned = healFullRolePlayMessageText(currentText);
                          if (cleaned !== currentText) {
                            updateActiveSession((s) => ({
                              ...s,
                              messages: s.messages.map((m) =>
                                m.id === msg.id
                                  ? {
                                      ...m,
                                      swipes: m.swipes.map((sw, sIdx) =>
                                        sIdx === m.activeSwipeIndex ? cleaned : sw
                                      ),
                                    }
                                  : m
                              ),
                            }));
                          }
                        }}
                        title="Auto-fix inverted asterisks, unclosed quotes, and syntax mix-ups in this message"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-900 text-slate-400 hover:text-indigo-300 text-[11px]"
                      >
                        <Sparkles className="w-3 h-3" />
                        Fix Quotes
                      </button>
                    )}

                    {/* Edit */}
                    <button
                      onClick={() => {
                        setEditingMsgId(msg.id);
                        setEditingText(currentText);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-900 text-slate-400 hover:text-slate-200 text-[11px]"
                    >
                      <Edit3 className="w-3 h-3" />
                      Edit
                    </button>

                    {/* Branch Story from here */}
                    <button
                      onClick={() => handleBranchFromMessage(msg.id)}
                      title="Branch conversation into a new timeline from this message"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-900 text-slate-400 hover:text-indigo-300 text-[11px]"
                    >
                      <GitBranch className="w-3 h-3" />
                      Branch
                    </button>

                    {/* Delete from here */}
                    {activeSession.messages.indexOf(msg) > 0 && (
                      <button
                        onClick={() => handleDeleteFromMessage(msg.id)}
                        title="Delete this message and subsequent turns"
                        className="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg hover:bg-slate-900 text-slate-500 hover:text-rose-400 text-[11px]"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Inline Steer & Swipe Guidance Box for this specific turn */}
                  {!isUser && steerMsgId === msg.id && (
                    <InlineMessageSteerBox
                      speakerName={msg.speakerName}
                      charName={speakerChar?.name || 'Character'}
                      personaName={activePersona?.name || 'User'}
                      initialPrompt={steerPrompt}
                      isGeneratingText={isGeneratingText}
                      onCancel={() => setSteerMsgId(null)}
                      onExecute={(guidance) =>
                        handleExecuteSteeredSwipe(msg, guidance)
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}

          {/* Streaming Indicator */}
          {isGeneratingText && streamingSpeaker && (
            <div className="flex gap-2.5 sm:gap-4 w-full max-w-full">
              {streamingSpeaker.referenceImageUrl ||
              streamingSpeaker.avatarUrl ? (
                <img
                  src={
                    streamingSpeaker.referenceImageUrl ||
                    streamingSpeaker.avatarUrl
                  }
                  alt={streamingSpeaker.name}
                  className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl object-cover bg-slate-800 border border-indigo-500/50 shrink-0 mt-0.5"
                />
              ) : (
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-slate-900 border border-indigo-500/50 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" />
                </div>
              )}
              <div className="flex-1 min-w-0 max-w-full bg-slate-900/90 border border-indigo-500/40 rounded-2xl p-3 sm:p-4 space-y-1.5 overflow-hidden break-words">
                <div className="text-xs font-semibold text-indigo-300 flex items-center gap-2">
                  <span>{streamingSpeaker.name}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                      formatGenderBadge(streamingSpeaker.gender).colorClass
                    }`}
                  >
                    {formatGenderBadge(streamingSpeaker.gender).symbol}{' '}
                    {formatGenderBadge(streamingSpeaker.gender).label}
                  </span>
                  <span className="text-[11px] text-slate-400 animate-pulse">
                    typing...
                  </span>
                </div>
                {streamingText ? (
                  renderFormattedMessage(
                    streamingText,
                    streamingSpeaker.name,
                    activeSession.messages.length
                  )
                ) : generatingImageForMsgId ? (
                  <p className="text-xs text-amber-300/90 italic">
                    Queued (#1 in AI Queue) — waiting for ComfyUI image render to finish so LLM + Image don't overload your PC...
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 italic">
                    Awaiting response from {primaryChatLlm.name}...
                  </p>
                )}
              </div>
            </div>
          )}

          {chatError && (
            <div className="w-full bg-rose-950/50 border border-rose-500/40 text-rose-200 rounded-xl p-3.5 text-xs">
              {chatError}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
        )}

        {/* Bottom Composer with Suggested Responses & Continue Button */}
        {activeSession && (
          <div className="p-3 sm:p-4 border-t border-slate-800 bg-slate-900/60 space-y-2.5 w-full max-w-full max-h-[70dvh] sm:max-h-[75vh] overflow-y-auto overflow-x-hidden overscroll-contain shrink-0">
          {gameOverState.isGameOver && (
            <div className="w-full rounded-2xl bg-gradient-to-r from-rose-950/90 via-red-950/85 to-slate-950 border-2 border-rose-500/60 p-3.5 sm:p-4 shadow-2xl space-y-3 animate-in fade-in duration-200">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-rose-600/30 border border-rose-500/50 flex items-center justify-center text-rose-300 shrink-0 mt-0.5">
                    <Skull className="w-5 h-5 text-rose-400" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs sm:text-sm font-extrabold tracking-wider uppercase text-rose-300">
                        💀 GAME OVER — Bad Ending Reached
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-rose-500/25 border border-rose-500/50 text-[11px] font-bold text-rose-200">
                        {gameOverState.meterName}: {gameOverState.meterDisplay}
                      </span>
                      {gameOverState.stageText && (
                        <span className="px-2 py-0.5 rounded-full bg-slate-900/90 border border-slate-700 text-[10px] font-semibold text-amber-200">
                          {gameOverState.stageText}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-rose-200/90 leading-relaxed">
                      {gameOverState.triggerType === 'hp_zero'
                        ? `${
                            gameOverState.speakerName ||
                            sessionCharacters[0]?.name ||
                            'Character'
                          }'s HP dropped to 0. This story timeline has ended and cannot continue forward.`
                        : `${
                            gameOverState.speakerName ||
                            sessionCharacters[0]?.name ||
                            'Character'
                          }'s ${
                            gameOverState.meterName || 'Hate / Hostility'
                          } reached its maximum limit (${
                            gameOverState.meterDisplay || '100/100'
                          }). ${
                            gameOverState.speakerName ||
                            sessionCharacters[0]?.name ||
                            'They'
                          } has permanently cut ties — this timeline is locked.`}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-rose-500/30">
                <span className="text-[11px] font-semibold text-rose-300 mr-1">
                  Timeline Recovery:
                </span>
                {activeSession.messages.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const lastMsg =
                          activeSession.messages[
                            activeSession.messages.length - 1
                          ];
                        if (!lastMsg) return;
                        const speaker = db.characters.find(
                          (c) => c.id === lastMsg.speakerId
                        );
                        const truncatedSession: ChatSession = {
                          ...activeSession,
                          messages: activeSession.messages.slice(0, -1),
                        };
                        triggerCharacterReply(
                          truncatedSession,
                          speaker,
                          lastMsg.id
                        );
                      }}
                      disabled={isGeneratingText}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600/30 hover:bg-amber-600/45 text-amber-200 border border-amber-500/45 text-xs font-semibold transition disabled:opacity-40"
                      title="Regenerate the last character response to try for a non-fatal outcome"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Swipe / Retry Last Turn
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        // Remove the fatal assistant reply (and pre-fill the player's last message so they can try a different choice)
                        const msgs = activeSession.messages;
                        const lastAsstIdx = msgs.length - 1;
                        const prevUserMsg =
                          lastAsstIdx - 1 >= 0 &&
                          msgs[lastAsstIdx - 1].role === 'user'
                            ? msgs[lastAsstIdx - 1]
                            : null;
                        const cutIndex = prevUserMsg
                          ? lastAsstIdx - 1
                          : lastAsstIdx;
                        if (prevUserMsg) {
                          setComposerDraft(
                            prevUserMsg.swipes[prevUserMsg.activeSwipeIndex] ||
                              ''
                          );
                        }
                        updateActiveSession((s) => ({
                          ...s,
                          messages: s.messages.slice(
                            0,
                            Math.max(1, cutIndex)
                          ),
                        }));
                      }}
                      disabled={isGeneratingText}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/45 text-indigo-200 border border-indigo-500/45 text-xs font-semibold transition disabled:opacity-40"
                      title="Rewind the fatal turn and put your last message back into the input box so you can make a different choice"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Rewind &amp; Change Your Choice
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const safeIdx = Math.max(
                          0,
                          activeSession.messages.length - 3
                        );
                        const targetMsg = activeSession.messages[safeIdx];
                        if (targetMsg) {
                          handleBranchFromMessage(targetMsg.id);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-200 border border-emerald-500/40 text-xs font-semibold transition"
                      title="Branch into a new timeline right before the fatal turn"
                    >
                      <GitBranch className="w-3.5 h-3.5" />
                      Branch Before Game Over
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => {
                    // Remove the hate meter (or restore HP to 50/100) on the latest message & customStatusTemplate so the user can continue Unlimited Chat
                    updateActiveSession((s) => {
                      const cleanTplRows = s.customStatusTemplate
                        ? parseStatusTemplateRows(
                            s.customStatusTemplate
                          ).filter((r) => !isHateOrHostilityMeterKey(r.key))
                        : [];
                      const nextTpl =
                        cleanTplRows.length > 0
                          ? `<status_bar>\n${serializeStatusTemplateRows(
                              cleanTplRows
                            )}\n</status_bar>`
                          : s.customStatusTemplate;

                      const nextMessages = s.messages.map((m) => {
                        if (m.id !== gameOverState.messageId) return m;
                        const curText = m.swipes[m.activeSwipeIndex] || '';
                        const curRows = parseStatusTemplateRows(curText);
                        if (curRows.length === 0) return m;
                        const updatedRows =
                          gameOverState.triggerType === 'hp_zero'
                            ? curRows.map((r) =>
                                r.key.trim().toLowerCase() ===
                                (gameOverState.meterName || '')
                                  .trim()
                                  .toLowerCase()
                                  ? { ...r, value: '50/100' }
                                  : r
                              )
                            : curRows.filter(
                                (r) => !isHateOrHostilityMeterKey(r.key)
                              );
                        const replacedText = replaceMessageStatusBarBlock(
                          curText,
                          updatedRows
                        );
                        return {
                          ...m,
                          swipes: m.swipes.map((sw, sIdx) =>
                            sIdx === m.activeSwipeIndex ? replacedText : sw
                          ),
                        };
                      });

                      return {
                        ...s,
                        customStatusTemplate: nextTpl,
                        messages: nextMessages,
                      };
                    });
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 text-xs font-semibold transition"
                  title="Remove the Hate / Game Over limit from this chat and unlock Unlimited Chat immediately"
                >
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Unlock &amp; Continue (Unlimited Chat)
                </button>

                <button
                  type="button"
                  onClick={handleResetChat}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition shadow"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Story to Opening
                </button>
              </div>
            </div>
          )}
          {isArchivedChat && (
            <div className="w-full flex flex-wrap items-center justify-between gap-2 bg-amber-950/30 border border-amber-500/35 text-amber-200 rounded-xl px-3.5 py-2.5 text-xs">
              <span>
                <strong>Read-only archive:</strong> This character was deleted.
                Past messages and images are preserved, or you can start a new
                story.
              </span>
              <button
                type="button"
                onClick={() => setShowNewGroupModal(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold transition shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                New Story
              </button>
            </div>
          )}
          {isGeneratingSuggestions && (
            <div className="w-full flex items-center gap-2 text-xs text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-xl px-3.5 py-2">
              <Lightbulb className="w-4 h-4 animate-pulse text-amber-400 shrink-0" />
              <span className="truncate">
                {helperLlm.defaultModel || helperLlm.name} is crafting 3 in-character response options
                {guidanceDraftRef.current.trim()
                  ? ` following your direction ("${guidanceDraftRef.current.trim()}")`
                  : ''}
                ...
              </span>
            </div>
          )}

          {/* Director's Guidance & Scene Direction Studio (Steer Character Response) */}
          <DirectorGuidanceBar
            visible={
              showGuidanceBar ||
              showDirectionBar ||
              suggestedReplies.length > 0
            }
            externalGuidance={externalGuidance}
            guidanceRef={guidanceDraftRef}
            composerDraftRef={composerDraftRef}
            charName={sessionCharacters[0]?.name || 'Character'}
            personaName={activePersona?.name || 'User'}
            isGeneratingText={isGeneratingText}
            isGeneratingSuggestions={isGeneratingSuggestions}
            isArchivedChat={isArchivedChat}
            onGuideContinue={(g) => {
              if (!activeSession || isGeneratingText) return;
              triggerCharacterReply(
                activeSession,
                undefined,
                undefined,
                true,
                g || undefined
              );
            }}
            onSuggestReplies={(g) => handleSuggestReplies(g)}
            onSendUserDraft={(draftText) => handleSendUserMessage(draftText)}
            onClose={() => {
              setShowGuidanceBar(false);
              setShowDirectionBar(false);
            }}
          />

          {/* Suggested Replies Chips */}
          {suggestedReplies.length > 0 && (
            <div className="w-full space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-amber-300 px-1">
                <span className="font-semibold flex items-center gap-1 truncate mr-2">
                  <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Suggested Responses (Click card to edit in chat box, or click "Send Now" to reply immediately):</span>
                  <span className="sm:hidden">Suggested Responses:</span>
                </span>
                <button
                  onClick={() => setSuggestedReplies([])}
                  className="text-slate-400 hover:text-white shrink-0"
                >
                  Dismiss
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 max-h-[36dvh] md:max-h-[42vh] overflow-y-auto overscroll-contain pr-0.5 pb-1">
                {suggestedReplies.map((reply, idx) => {
                  const tierMeta =
                    idx === 0
                      ? {
                          badge: '1. Mild · Gentle & Subtle',
                          badgeClass:
                            'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
                          borderClass:
                            'border-slate-800 hover:border-emerald-500/50',
                        }
                      : idx === 1
                      ? {
                          badge: '2. Medium · Active & Advancing',
                          badgeClass:
                            'bg-amber-500/15 text-amber-300 border-amber-500/30',
                          borderClass:
                            'border-slate-800 hover:border-amber-500/50',
                        }
                      : {
                          badge: '3. High · Bold & Escalating',
                          badgeClass:
                            'bg-rose-500/15 text-rose-300 border-rose-500/30',
                          borderClass:
                            'border-slate-800 hover:border-rose-500/50',
                        };
                  return (
                    <div
                      key={idx}
                      onClick={() => setComposerDraft(reply)}
                      className={`p-2.5 rounded-xl bg-slate-950/90 hover:bg-slate-900 border ${tierMeta.borderClass} text-xs text-slate-200 cursor-pointer transition flex flex-col justify-between gap-2`}
                    >
                      <div className="space-y-1.5 min-w-0">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-bold tracking-wide ${tierMeta.badgeClass}`}
                        >
                          {tierMeta.badge}
                        </span>
                        <p className="leading-relaxed whitespace-pre-wrap break-words">{reply}</p>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
                        <span className="text-[10px] text-slate-400 hover:text-indigo-300">
                          Click to Edit
                        </span>
                        <button
                          onClick={async (e) => {
                          e.stopPropagation();
                          if (!activeSession || isGeneratingText) return;
                          setSuggestedReplies([]);
                          const g = guidanceDraftRef.current.trim();
                          setDirectorGuidance('');
                          setComposerDraft('');
                          const userMsg: ChatMessage = {
                            id: `msg-${Date.now()}`,
                            role: 'user',
                            speakerId: 'user',
                            speakerName: activePersona.name,
                            speakerAvatar: activePersona.avatarUrl,
                            swipes: [reply],
                            activeSwipeIndex: 0,
                            createdAt: new Date().toISOString(),
                          };
                          const nextSession: ChatSession = {
                            ...activeSession,
                            updatedAt: new Date().toISOString(),
                            messages: [...activeSession.messages, userMsg],
                          };
                          updateActiveSession(() => nextSession);
                          await triggerCharacterReply(nextSession, undefined, undefined, false, g || undefined);
                        }}
                        className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-[10px] text-white font-semibold"
                      >
                          Send Now →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <ChatComposerBar
            externalDraft={externalDraft}
            draftRef={composerDraftRef}
            charName={
              (sessionCharacters[0] || db.characters[0])?.name || 'Character'
            }
            personaName={activePersona?.name || 'User'}
            placeholder={
              gameOverState.isGameOver
                ? `💀 GAME OVER (${gameOverState.meterName}: ${gameOverState.meterDisplay}) — Chat cannot continue. Rewind, Swipe, Branch, or Reset above.`
                : isArchivedChat
                ? 'Read-only archive — character deleted'
                : `Write as ${
                    activePersona?.name || 'User'
                  }... (Tip: type {{char}} to auto-insert ${
                    sessionCharacters[0]?.name || 'character name'
                  }, or click 'Suggest'!)`
            }
            isGeneratingText={isGeneratingText}
            isGeneratingSuggestions={isGeneratingSuggestions}
            isStoryLocked={isStoryLocked}
            showDirectionBar={showDirectionBar}
            hasSuggestionDirection={showDirectionBar || showGuidanceBar}
            onSendMessage={(draftText) => handleSendUserMessage(draftText)}
            onSuggestReplies={(draftText) => {
              const effectiveDir =
                guidanceDraftRef.current.trim() ||
                (draftText.trim().length > 0 && draftText.trim().length < 220
                  ? draftText.trim()
                  : '');
              if (effectiveDir && !guidanceDraftRef.current.trim()) {
                setDirectorGuidance(effectiveDir);
              }
              handleSuggestReplies(effectiveDir);
            }}
            onContinue={() => {
              if (!activeSession || isGeneratingText || isStoryLocked) return;
              triggerCharacterReply(activeSession, undefined, undefined, true);
            }}
            onToggleDirection={() => setShowDirectionBar((prev) => !prev)}
          />
          </div>
        )}
      </div>

      {/* Mobile Modal: Scene & Story Tools */}
      {showMobileToolsModal && activeSession && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl max-w-lg w-full p-4 sm:p-5 space-y-4 max-h-[88vh] overflow-y-auto flex flex-col shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Settings2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">Scene &amp; Story Tools</h3>
                  <p className="text-[11px] text-slate-400 truncate max-w-[220px]">
                    {activeSession.title}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMobileToolsModal(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Player Persona Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                Your Player Persona (&#123;&#123;user&#125;&#125;)
              </label>
              <select
                value={activeSession.personaId || db.activePersonaId}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__create_new__') {
                    setShowMobileToolsModal(false);
                  }
                  handleSwitchSessionPersona(val);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-emerald-200 font-semibold focus:outline-none"
              >
                {db.personas.map((p) => (
                  <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100">
                    {p.name} ({formatGenderBadge(p.gender).symbol} {formatGenderBadge(p.gender).label})
                  </option>
                ))}
                <option value="__create_new__" className="bg-slate-900 text-indigo-300 font-semibold">
                  + New Persona / Custom Name...
                </option>
              </select>
            </div>

            {/* 1-Click AI Model Quick-Switcher + Manual Pin */}
            {quickSwitchLlmGroups.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-sky-400" />
                    AI Model
                  </label>
                  <button
                    type="button"
                    onClick={handleTogglePinChatModel}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border transition ${
                      isChatLlmPinned
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-200 font-medium'
                        : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-sky-200'
                    }`}
                  >
                    <Pin className="w-3 h-3" />
                    {isChatLlmPinned ? 'Pinned to this chat' : 'Following Global'}
                  </button>
                </div>
                <select
                  value={currentChatLlmEncodedValue}
                  onChange={(e) => handleQuickSwitchChatModel(e.target.value)}
                  className={`w-full bg-slate-950 border rounded-xl px-3 py-2 text-xs font-medium focus:outline-none ${
                    isChatLlmPinned
                      ? 'border-amber-500/50 text-amber-200'
                      : 'border-slate-700 text-sky-200'
                  }`}
                >
                  {quickSwitchLlmGroups.map(({ service, models }) => (
                    <optgroup
                      key={service.id}
                      label={`${service.name}${
                        service.status === 'connected' ? ' ●' : ''
                      }`}
                      className="bg-slate-900 text-slate-400"
                    >
                      {models.map((m) => (
                        <option
                          key={`${service.id}::${m}`}
                          value={JSON.stringify([service.id, m])}
                          className="bg-slate-900 text-slate-100"
                        >
                          {m}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 leading-snug">
                  {isChatLlmPinned
                    ? 'Locked to this chat only. Tap "Pinned to this chat" to return to following your Global model.'
                    : 'Following Global model (no auto-switching). Tap "Following Global" to lock a model specifically to this chat.'}
                </p>
              </div>
            )}

            {/* Language Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-indigo-400" />
                Story Language
              </label>
              <select
                value={activeSession.language || db.defaultLanguage || 'auto'}
                onChange={(e) => {
                  const lang = e.target.value as ConversationLanguage;
                  onUpdateDb((prev) => ({
                    ...prev,
                    defaultLanguage: lang,
                    chats: prev.chats.map((c) =>
                      c.id === activeSession.id ? { ...c, language: lang } : c
                    ),
                  }));
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-indigo-200 font-medium focus:outline-none"
              >
                {CONVERSATION_LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id} className="bg-slate-900 text-slate-100">
                    {l.shortLabel} — {l.label}
                  </option>
                ))}
              </select>
            </div>

            {/* TTS Voice Reading Mode & Auto-Play */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  {db.ttsService?.enabled === false ? (
                    <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                  )}
                  Voice Audio &amp; Auto-Play
                </label>
                {db.ttsService?.enabled !== false && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateDb((prev) => ({
                        ...prev,
                        ttsService: {
                          ...DEFAULT_TTS_SERVICE,
                          ...(prev.ttsService || {}),
                          autoPlay: !prev.ttsService?.autoPlay,
                        },
                      }))
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-medium border transition ${
                      db.ttsService?.autoPlay
                        ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                        : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {db.ttsService?.autoPlay ? 'Auto-Play: ON' : 'Auto-Play: OFF'}
                  </button>
                )}
              </div>
              <select
                value={
                  db.ttsService?.enabled === false
                    ? 'off'
                    : db.ttsService?.readingMode || 'dialogue_only'
                }
                onChange={(e) => {
                  const val = e.target.value;
                  onUpdateDb((prev) => ({
                    ...prev,
                    ttsService: {
                      ...DEFAULT_TTS_SERVICE,
                      ...(prev.ttsService || {}),
                      enabled: val !== 'off',
                      ...(val === 'dialogue_only' || val === 'full_text'
                        ? { readingMode: val as TTSReadingMode }
                        : {}),
                    },
                  }));
                  if (val === 'off') {
                    ttsPlayer.stop();
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-cyan-200 font-medium focus:outline-none"
              >
                <option value="dialogue_only" className="bg-slate-900 text-slate-100">
                  TTS: Dialogue Only (&quot;Quotes&quot;)
                </option>
                <option value="full_text" className="bg-slate-900 text-slate-100">
                  TTS: Full Narration + Quotes
                </option>
                <option value="off" className="bg-slate-900 text-slate-100">
                  TTS: Disabled
                </option>
              </select>
            </div>

            {/* Status HUD Tracker */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  Status HUD &amp; Meter Tracker
                </label>
                {activeSession.statusTrackerMode !== 'off' && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowMobileToolsModal(false);
                      setShowCustomStatusModal(true);
                    }}
                    className="text-[11px] text-emerald-400 hover:underline flex items-center gap-1"
                  >
                    <Sliders className="w-3 h-3" /> Initial Values
                  </button>
                )}
              </div>
              <select
                value={activeSession.statusTrackerMode || 'auto'}
                onChange={(e) => {
                  const nextMode = e.target.value as StatusTrackerMode;
                  const leadChar = sessionCharacters[0] || db.characters[0];
                  const defaultTpl =
                    nextMode !== 'off' && nextMode !== 'auto'
                      ? getDefaultStatusTemplateForMode({
                          mode: nextMode,
                          charName: leadChar?.name || '角色',
                          userName: activePersona.name,
                          language:
                            activeSession.language ||
                            db.defaultLanguage ||
                            'auto',
                        })
                      : activeSession.customStatusTemplate;
                  updateActiveSession((s) => ({
                    ...s,
                    statusTrackerMode: nextMode,
                    customStatusTemplate: defaultTpl
                      ? `<status_bar>\n${defaultTpl.replace(
                          /<\/?status(?:_bar)?>/gi,
                          ''
                        ).trim()}\n</status_bar>`
                      : s.customStatusTemplate,
                  }));
                  if (nextMode !== 'off' && nextMode !== 'auto') {
                    setShowMobileToolsModal(false);
                    setShowCustomStatusModal(true);
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-emerald-200 font-medium focus:outline-none"
              >
                <option value="auto" className="bg-slate-900 text-slate-100">HUD: Auto-Detect</option>
                <option value="rpg_traveler" className="bg-slate-900 text-slate-100">HUD: RPG / Traveler (HP · Stamina · Gear)</option>
                <option value="romance_affection" className="bg-slate-900 text-slate-100">HUD: Romance &amp; Mood (Affection · Trust · Thoughts)</option>
                <option value="intimate_detailed" className="bg-slate-900 text-slate-100">HUD: Detailed Body &amp; Status (Body · Corruption)</option>
                <option value="custom" className="bg-slate-900 text-slate-100">HUD: Custom Template...</option>
                <option value="off" className="bg-slate-900 text-slate-100">HUD: Off</option>
              </select>
            </div>

            {/* ComfyUI Scene Generation */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-fuchsia-400" />
                ComfyUI Scene Workflow
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={
                    db.comfyService.defaultWorkflowId ||
                    db.workflows[0]?.id ||
                    ''
                  }
                  onChange={(e) =>
                    onUpdateDb((prev) => ({
                      ...prev,
                      comfyService: {
                        ...prev.comfyService,
                        defaultWorkflowId: e.target.value,
                      },
                    }))
                  }
                  className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-fuchsia-200 font-medium focus:outline-none"
                >
                  {db.workflows.map((wf) => (
                    <option key={wf.id} value={wf.id} className="bg-slate-900 text-slate-100">
                      {wf.name}
                    </option>
                  ))}
                </select>

                <select
                  value={activeSession.autoImageEveryNTurns || 0}
                  onChange={(e) =>
                    updateActiveSession((s) => ({
                      ...s,
                      autoImageEveryNTurns: parseInt(e.target.value) || 0,
                    }))
                  }
                  className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none"
                >
                  <option value={0}>Auto-Image: Off</option>
                  <option value={1}>Auto-Image: Every Turn</option>
                  <option value={2}>Auto-Image: Every 2 Turns</option>
                  <option value={3}>Auto-Image: Every 3 Turns</option>
                </select>
              </div>
            </div>

            {/* Quick Modals Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsModal(false);
                  setShowMemoryModal(true);
                }}
                className="inline-flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 text-xs font-medium"
              >
                <Brain className="w-4 h-4 text-indigo-400" />
                Story Bible ({(activeSession.storyLore || []).length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsModal(false);
                  setShowGalleryModal(true);
                }}
                className="inline-flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-fuchsia-300 border border-slate-700 text-xs font-medium"
              >
                <ImageIcon className="w-4 h-4 text-fuchsia-400" />
                Scene Gallery
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsModal(false);
                  setShowLlmParamsModal(true);
                }}
                className="inline-flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 text-xs font-medium"
              >
                <Sliders className="w-4 h-4 text-sky-400" />
                LLM Parameters
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsModal(false);
                  handleNewSessionFromCurrent();
                }}
                className="inline-flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-xs font-medium"
              >
                <Plus className="w-4 h-4 text-emerald-400" />
                New Session
              </button>
            </div>

            {/* Reset Story Option */}
            <div className="pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setShowMobileToolsModal(false);
                  handleResetChat();
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-500/30 text-xs font-semibold"
              >
                <RotateCcw className="w-4 h-4" />
                Reset Story to Opening Scene
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Self-Contained Story World, Lore & Memory Bible */}
      {showMemoryModal && activeSession && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-5 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2 text-base">
                  <Brain className="w-5 h-5 text-indigo-400" />
                  Story Bible — {activeSession.title}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Everything here (World Setting, Lore Entries, and Memory) belongs exclusively to this story.
                </p>
              </div>
              <button
                onClick={() => setShowMemoryModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Sub-tabs inside Story Bible */}
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2.5">
              <button
                onClick={() => setStoryBibleTab('world')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  storyBibleTab === 'world'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                1. Story World & Scenario
              </button>
              <button
                onClick={() => setStoryBibleTab('lore')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  storyBibleTab === 'lore'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                2. Story Lore ({(activeSession.storyLore || []).length})
              </button>
              <button
                onClick={() => setStoryBibleTab('memory')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  storyBibleTab === 'memory'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                3. Long-Term Memory ({(activeSession.memoryChapters || []).length} Ch.)
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {storyBibleTab === 'world' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Story Title
                    </label>
                    <BufferedField
                      value={activeSession.title}
                      onCommit={(nextVal) =>
                        updateActiveSession((s) => ({
                          ...s,
                          title: nextVal,
                        }))
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Self-Contained World Setting & Scenario Premise
                    </label>
                    <BufferedField
                      multiline
                      rows={5}
                      value={
                        activeSession.worldSetting ??
                        sessionCharacters[0]?.scenario ??
                        ''
                      }
                      onCommit={(nextVal) =>
                        updateActiveSession((s) => ({
                          ...s,
                          worldSetting: nextVal,
                        }))
                      }
                      placeholder="Describe the setting, time period, world rules, and current situation for this specific story..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Injected directly into the system prompt for this story only—isolated from your other stories.
                    </p>
                  </div>
                </div>
              )}

              {storyBibleTab === 'lore' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-slate-400">
                      Keyword-triggered or constant facts unique to this story:
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleAiExtractStoryLore}
                        disabled={isExtractingLore}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-semibold disabled:opacity-50"
                      >
                        <Sparkles
                          className={`w-3.5 h-3.5 ${
                            isExtractingLore ? 'animate-spin' : ''
                          }`}
                        />
                        {isExtractingLore
                          ? 'AI Scanning Story...'
                          : 'AI Extract Lore from Chat'}
                      </button>
                      <button
                        onClick={() => {
                          const newEntry: LorebookEntry = {
                            id: `slore-${Date.now()}`,
                            name: 'New Story Fact',
                            keys: ['keyword'],
                            content: 'Important lore or location detail in this story.',
                            enabled: true,
                            constant: false,
                            priority: 15,
                          };
                          updateActiveSession((s) => ({
                            ...s,
                            storyLore: [...(s.storyLore || []), newEntry],
                          }));
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Lore
                      </button>
                    </div>
                  </div>

                  {(activeSession.storyLore || []).length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-8 bg-slate-950/50 border border-slate-800/80 rounded-xl">
                      No story-specific lore entries yet. Click "AI Extract Lore from Chat" to automatically discover locations, relics, and facts from your story!
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {(activeSession.storyLore || []).map((entry) => (
                        <div
                          key={entry.id}
                          className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <BufferedField
                              value={entry.name}
                              onCommit={(nextVal) =>
                                updateActiveSession((s) => ({
                                  ...s,
                                  storyLore: (s.storyLore || []).map((en) =>
                                    en.id === entry.id
                                      ? { ...en, name: nextVal }
                                      : en
                                  ),
                                }))
                              }
                              className="text-xs font-semibold text-indigo-300 bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none"
                            />
                            <div className="flex items-center gap-2">
                              <BufferedField
                                value={entry.keys.join(', ')}
                                onCommit={(nextVal) =>
                                  updateActiveSession((s) => ({
                                    ...s,
                                    storyLore: (s.storyLore || []).map((en) =>
                                      en.id === entry.id
                                        ? {
                                            ...en,
                                            keys: nextVal
                                              .split(',')
                                              .map((k) => k.trim())
                                              .filter(Boolean),
                                          }
                                        : en
                                    ),
                                  }))
                                }
                                placeholder="Trigger keywords"
                                className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-slate-200 w-44"
                              />
                              <button
                                onClick={() =>
                                  setConfirmAction({
                                    title: `Delete lore entry "${
                                      entry.name || 'Untitled'
                                    }"?`,
                                    message:
                                      'Remove this Story Lore entry from the Story Bible?',
                                    confirmLabel: 'Delete Entry',
                                    onConfirm: () =>
                                      updateActiveSession((s) => ({
                                        ...s,
                                        storyLore: (s.storyLore || []).filter(
                                          (en) => en.id !== entry.id
                                        ),
                                      })),
                                  })
                                }
                                title="Delete lore entry"
                                className="text-slate-500 hover:text-rose-400 p-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          <BufferedField
                            multiline
                            rows={2}
                            value={entry.content}
                            onCommit={(nextVal) =>
                              updateActiveSession((s) => ({
                                ...s,
                                storyLore: (s.storyLore || []).map((en) =>
                                  en.id === entry.id
                                    ? { ...en, content: nextVal }
                                    : en
                                ),
                              }))
                            }
                            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs text-slate-300"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {storyBibleTab === 'memory' && (
                <div className="space-y-3.5">
                  {/* Low-VRAM Sliding Window & Auto-Summarization Controls */}
                  <div className="bg-slate-950/90 border border-indigo-500/30 rounded-xl p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-semibold text-indigo-300">
                          3-Layer Long-Term Memory &amp; Sliding Context
                        </span>
                        <p className="text-[11px] text-slate-400">
                          Keeps recent messages verbatim, maintains a Rolling Core Synopsis, and permanently archives Episodic Chapters (Turns 1–10, 11–20...) so 100+ turn stories never lose early plot beats.
                        </p>
                      </div>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 font-medium">
                        {(() => {
                          const keep =
                            activeSession.maxRecentMessages === undefined
                              ? 16
                              : activeSession.maxRecentMessages;
                          const total = activeSession.messages.length;
                          const activeCount =
                            keep > 0 ? Math.min(total, keep) : total;
                          const sumIdx = activeSession.summarizedUpToIndex || 0;
                          const chCount = (activeSession.memoryChapters || []).length;
                          return `Sending last ${activeCount} of ${total} turns verbatim${
                            sumIdx > 0
                              ? ` • Turns 1–${sumIdx} archived (${chCount} Ch.)`
                              : ''
                          }`;
                        })()}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-300 mb-1">
                          Keep Recent Verbatim Messages (Sliding Window)
                        </label>
                        <select
                          value={
                            activeSession.maxRecentMessages === undefined
                              ? 16
                              : activeSession.maxRecentMessages
                          }
                          onChange={(e) =>
                            updateActiveSession((s) => ({
                              ...s,
                              maxRecentMessages: Number(e.target.value),
                            }))
                          }
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                        >
                          <option value={8}>
                            Last 8 Messages (Ultra Low VRAM ~2.5k ctx)
                          </option>
                          <option value={12}>
                            Last 12 Messages (Low VRAM ~3.5k ctx)
                          </option>
                          <option value={16}>
                            Last 16 Messages (Recommended Balance ~4.5k ctx)
                          </option>
                          <option value={24}>
                            Last 24 Messages (Extended ~6.5k ctx)
                          </option>
                          <option value={32}>
                            Last 32 Messages (High VRAM ~9k ctx)
                          </option>
                          <option value={0}>
                            Unlimited (Fill Up to Service Token Budget)
                          </option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-300 mb-1">
                          Auto-Archive Chapter &amp; Summarize Aged-Out Turns
                        </label>
                        <select
                          value={
                            activeSession.autoSummarizeEveryNTurns === undefined
                              ? 10
                              : activeSession.autoSummarizeEveryNTurns
                          }
                          onChange={(e) =>
                            updateActiveSession((s) => ({
                              ...s,
                              autoSummarizeEveryNTurns: Number(e.target.value),
                            }))
                          }
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                        >
                          <option value={8}>
                            Every 8 Turns (Frequent Chapter Archiving)
                          </option>
                          <option value={10}>
                            Every 10 Turns (Recommended)
                          </option>
                          <option value={16}>Every 16 Turns</option>
                          <option value={0}>
                            Off (Manual Click / Auto-Recap Snippets Only)
                          </option>
                        </select>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={activeSession.autoExtractLore !== false}
                        onChange={(e) =>
                          updateActiveSession((s) => ({
                            ...s,
                            autoExtractLore: e.target.checked,
                          }))
                        }
                        className="rounded border-slate-700 bg-slate-900 text-indigo-500 focus:ring-0"
                      />
                      <span className="text-[11px] text-slate-300">
                        <strong>Layer 3 · Auto-Extract Story Lore:</strong> Automatically discover &amp; add new NPCs, locations, items, and secrets into Story Lore whenever turns are archived.
                      </span>
                    </label>
                  </div>

                  {/* Evolved Character State (Growth Overrides Turn-1 Baseline) */}
                  <div className="space-y-1.5 bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-semibold text-emerald-300">
                        Evolved Character State (Overrides Day-1 Baseline)
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-emerald-200/80 hidden sm:inline">
                          Always injected near prompt end · Keeps growth permanent
                        </span>
                        <button
                          type="button"
                          onClick={handleSummarizeStoryMemory}
                          disabled={isSummarizingMemory}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white text-[11px] font-medium disabled:opacity-50"
                        >
                          <Sparkles
                            className={`w-3 h-3 ${
                              isSummarizingMemory ? 'animate-spin' : ''
                            }`}
                          />
                          {isSummarizingMemory
                            ? 'Detecting...'
                            : 'Auto-Detect Character Growth'}
                        </button>
                      </div>
                    </div>
                    <BufferedField
                      multiline
                      rows={3}
                      value={activeSession.characterEvolution || ''}
                      onCommit={(nextVal) =>
                        updateActiveSession((s) => ({
                          ...s,
                          characterEvolution: nextVal,
                        }))
                      }
                      placeholder={`Describe how ${
                        sessionCharacters[0]?.name || 'the character'
                      } has personally grown or changed since Turn 1 (e.g. poised confidence after training, calmer demeanor, changed feelings). Auto-updated when archiving memory, or edit anytime.`}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200"
                    />
                  </div>

                  {/* Layer 1: Rolling Core Synopsis */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-300">
                        Layer 1 · Rolling Core Story Synopsis (Always Active)
                      </label>
                      <button
                        onClick={handleSummarizeStoryMemory}
                        disabled={isSummarizingMemory}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-50"
                      >
                        <Sparkles
                          className={`w-3.5 h-3.5 ${
                            isSummarizingMemory ? 'animate-spin' : ''
                          }`}
                        />
                        {isSummarizingMemory
                          ? 'Archiving Chapter & Lore...'
                          : 'Archive Chapter & Compress Memory Now'}
                      </button>
                    </div>
                    <BufferedField
                      multiline
                      rows={5}
                      value={activeSession.memorySummary}
                      onCommit={(nextVal) =>
                        updateActiveSession((s) => ({
                          ...s,
                          memorySummary: nextVal,
                        }))
                      }
                      placeholder="Key overarching plot milestones, relationship status, and active goals remembered across the whole story..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200"
                    />
                  </div>

                  {/* Layer 2: Episodic Chapter Archive */}
                  <div className="space-y-2 pt-1 border-t border-slate-800/80">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                          <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                          Layer 2 · Episodic Chapter Archive (
                          {(activeSession.memoryChapters || []).length})
                        </span>
                        <p className="text-[11px] text-slate-400">
                          Each chapter preserves concrete events from its turn slice forever. Chapters are recalled automatically when their keywords appear in recent turns, or when Pinned.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const chList = activeSession.memoryChapters || [];
                          const nextNum = chList.length + 1;
                          const prevEnd =
                            chList.length > 0
                              ? chList[chList.length - 1].turnRange[1]
                              : 0;
                          const manualCh: StoryMemoryChapter = {
                            id: `chap-manual-${Date.now()}`,
                            title: `Chapter ${nextNum}: Key Milestone`,
                            turnRange: [
                              prevEnd + 1,
                              Math.max(
                                prevEnd + 1,
                                activeSession.messages.length
                              ),
                            ],
                            summary:
                              '- Key event or promise from this part of the story.',
                            keywords: ['milestone'],
                            pinned: false,
                            createdAt: new Date().toISOString(),
                          };
                          updateActiveSession((s) => ({
                            ...s,
                            memoryChapters: [
                              ...(s.memoryChapters || []),
                              manualCh,
                            ],
                          }));
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 text-xs font-medium"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Chapter
                      </button>
                    </div>

                    {(activeSession.memoryChapters || []).length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-5 bg-slate-950/50 border border-slate-800/80 rounded-xl">
                        No episodic chapters archived yet. Chapters are created automatically every {activeSession.autoSummarizeEveryNTurns ?? 10} turns, or click &ldquo;Archive Chapter &amp; Compress Memory Now&rdquo; above!
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {(activeSession.memoryChapters || []).map((ch) => (
                          <div
                            key={ch.id}
                            className={`bg-slate-950 border rounded-xl p-3 space-y-2 ${
                              ch.pinned
                                ? 'border-amber-500/50 bg-amber-950/10'
                                : 'border-slate-800'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                                <span className="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-semibold text-indigo-300 shrink-0">
                                  Turns {ch.turnRange[0]}–{ch.turnRange[1]}
                                </span>
                                <BufferedField
                                  value={ch.title}
                                  onCommit={(nextVal) =>
                                    updateActiveSession((s) => ({
                                      ...s,
                                      memoryChapters: (
                                        s.memoryChapters || []
                                      ).map((item) =>
                                        item.id === ch.id
                                          ? { ...item, title: nextVal }
                                          : item
                                      ),
                                    }))
                                  }
                                  className="flex-1 text-xs font-semibold text-white bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none"
                                />
                              </div>

                              <div className="flex items-center gap-1.5">
                                <BufferedField
                                  value={(ch.keywords || []).join(', ')}
                                  onCommit={(nextVal) =>
                                    updateActiveSession((s) => ({
                                      ...s,
                                      memoryChapters: (
                                        s.memoryChapters || []
                                      ).map((item) =>
                                        item.id === ch.id
                                          ? {
                                              ...item,
                                              keywords: nextVal
                                                .split(',')
                                                .map((k) => k.trim())
                                                .filter(Boolean),
                                            }
                                          : item
                                      ),
                                    }))
                                  }
                                  placeholder="Recall keywords (comma-separated)"
                                  title="When any of these keywords are mentioned in recent chat turns, this chapter is automatically recalled into the LLM prompt!"
                                  className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-slate-200 w-40"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateActiveSession((s) => ({
                                      ...s,
                                      memoryChapters: (
                                        s.memoryChapters || []
                                      ).map((item) =>
                                        item.id === ch.id
                                          ? { ...item, pinned: !item.pinned }
                                          : item
                                      ),
                                    }))
                                  }
                                  title={
                                    ch.pinned
                                      ? 'Pinned: Always injected into prompt. Click to switch to keyword-auto-recall.'
                                      : 'Pin this chapter so it is always injected into the prompt'
                                  }
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition ${
                                    ch.pinned
                                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border-slate-700'
                                  }`}
                                >
                                  <Pin className="w-3 h-3" />
                                  {ch.pinned ? 'Pinned' : 'Pin'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmAction({
                                      title: `Delete "${ch.title}"?`,
                                      message:
                                        'Remove this episodic chapter from the Long-Term Memory archive?',
                                      confirmLabel: 'Delete Chapter',
                                      onConfirm: () =>
                                        updateActiveSession((s) => ({
                                          ...s,
                                          memoryChapters: (
                                            s.memoryChapters || []
                                          ).filter((item) => item.id !== ch.id),
                                        })),
                                    })
                                  }
                                  title="Delete chapter"
                                  className="text-slate-500 hover:text-rose-400 p-1"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <BufferedField
                              multiline
                              rows={3}
                              value={ch.summary}
                              onCommit={(nextVal) =>
                                updateActiveSession((s) => ({
                                  ...s,
                                  memoryChapters: (s.memoryChapters || []).map(
                                    (item) =>
                                      item.id === ch.id
                                        ? { ...item, summary: nextVal }
                                        : item
                                  ),
                                }))
                              }
                              className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs text-slate-300"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-800 pt-3">
              <button
                onClick={() => setShowMemoryModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 text-xs text-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: New Self-Contained Story / Campaign Builder */}
      {showNewGroupModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-400" />
                  Create New Self-Contained Story
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Each story has its own independent World Setting, Lore entries, Opening Scene, and Memory.
                </p>
              </div>
              <button
                onClick={() => setShowNewGroupModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-semibold text-slate-300">
                1. Select Cast (1 for Solo RP, 2+ for Group RP):
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                {db.characters.map((c) => {
                  const checked = selectedGroupCharIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-2.5 p-2 rounded-xl border cursor-pointer ${
                        checked
                          ? 'bg-indigo-950/40 border-indigo-500/50'
                          : 'bg-slate-950 border-slate-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedGroupCharIds((prev) => [...prev, c.id]);
                          } else {
                            setSelectedGroupCharIds((prev) =>
                              prev.filter((id) => id !== c.id)
                            );
                          }
                        }}
                      />
                      {c.referenceImageUrl || c.avatarUrl ? (
                        <img
                          src={c.referenceImageUrl || c.avatarUrl}
                          alt={c.name}
                          className="w-8 h-8 rounded-lg object-cover bg-slate-800 shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                          <User className="w-4 h-4 text-slate-500" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-semibold text-white truncate">
                            {c.name}
                          </p>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border shrink-0 ${
                              formatGenderBadge(c.gender).colorClass
                            }`}
                          >
                            {formatGenderBadge(c.gender).symbol}{' '}
                            {formatGenderBadge(c.gender).label}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">
                          {c.personality}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>

              {/* Step 2: Choose Player Persona ({{user}}) for this Story */}
              <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                    2. Choose Your Player Persona (&#123;&#123;user&#125;&#125;):
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickPersonaTarget('new_story');
                      setQuickPersonaName('');
                      setQuickPersonaGender(activePersona?.gender || 'male');
                      setQuickPersonaDesc('');
                      setShowQuickPersonaModal(true);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-200 border border-emerald-500/40 text-xs font-semibold transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Persona Name
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                  {db.personas.map((p) => {
                    const isSelected = newStoryPersonaId === p.id;
                    return (
                      <label
                        key={p.id}
                        className={`flex items-center gap-2.5 p-2 rounded-xl border cursor-pointer transition ${
                          isSelected
                            ? 'bg-emerald-950/50 border-emerald-500/60'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="newStoryPersona"
                          checked={isSelected}
                          onChange={() => setNewStoryPersonaId(p.id)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-white truncate">
                              {p.name}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border shrink-0 ${
                                formatGenderBadge(p.gender).colorClass
                              }`}
                            >
                              {formatGenderBadge(p.gender).symbol}{' '}
                              {formatGenderBadge(p.gender).label}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate">
                            {p.description}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="bg-indigo-950/25 border border-indigo-500/30 rounded-xl p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-indigo-300">
                    3. Story World, Language &amp; Premise
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs">
                      <Globe className="w-3.5 h-3.5 text-indigo-400" />
                      <select
                        value={newStoryLanguage}
                        onChange={(e) =>
                          setNewStoryLanguage(
                            e.target.value as ConversationLanguage
                          )
                        }
                        className="bg-transparent text-indigo-200 font-medium focus:outline-none cursor-pointer"
                      >
                        {CONVERSATION_LANGUAGES.map((l) => (
                          <option
                            key={l.id}
                            value={l.id}
                            className="bg-slate-900 text-slate-100"
                          >
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={handleAiBuildNewStory}
                      disabled={
                        isGeneratingStoryWorld ||
                        selectedGroupCharIds.length === 0
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition disabled:opacity-40"
                    >
                      <Sparkles
                        className={`w-3.5 h-3.5 ${
                          isGeneratingStoryWorld ? 'animate-spin' : ''
                        }`}
                      />
                      {isGeneratingStoryWorld
                        ? 'AI Generating World & Lore...'
                        : '✨ AI Build World, Lore & Opening'}
                    </button>
                  </div>
                </div>

                <BufferedField
                  value={newStoryTitle}
                  onCommit={(val) => setNewStoryTitle(val)}
                  placeholder="Story Title (or type a brief idea and click 'AI Build World, Lore & Opening')"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                />

                <BufferedField
                  multiline
                  rows={3}
                  value={newStoryWorldSetting}
                  onCommit={(val) => setNewStoryWorldSetting(val)}
                  placeholder="Optional custom World Setting / Scenario for this story (leave blank to use the character's default scenario, or type an idea like 'Cyberpunk neon night market' and click AI Build)..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200"
                />

                {newStoryLore.length > 0 && (
                  <div className="text-[11px] text-emerald-300 bg-emerald-950/30 border border-emerald-500/30 rounded-lg p-2">
                    ✓ AI generated {newStoryLore.length} self-contained Lore entries for this story:{' '}
                    {newStoryLore.map((l) => l.name).join(', ')}
                  </div>
                )}

                {newStoryOpening && (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Custom Opening Scene Greeting:
                    </label>
                    <BufferedField
                      multiline
                      rows={3}
                      value={newStoryOpening}
                      onCommit={(val) => setNewStoryOpening(val)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-300"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowNewGroupModal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateGroupChat}
                disabled={selectedGroupCharIds.length === 0}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white disabled:opacity-40"
              >
                Launch Self-Contained Story
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Quick Create / Switch Player Persona Name */}
      {showQuickPersonaModal && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2 text-sm">
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  Create New Player Persona (&#123;&#123;user&#125;&#125;)
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Create a new persona name &amp; gender and apply it immediately to this story.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowQuickPersonaModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1">
                  Your Name in Story <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={quickPersonaName}
                  onChange={(e) => setQuickPersonaName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && quickPersonaName.trim()) {
                      e.preventDefault();
                      handleConfirmQuickCreatePersona();
                    }
                  }}
                  placeholder="e.g. Alex, 林辰, 陆泽, Kai..."
                  autoFocus
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1">
                  Gender &amp; Pronouns
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'male', label: '♂ Male' },
                      { id: 'female', label: '♀ Female' },
                      { id: 'non-binary', label: '⚧ Non-Binary' },
                    ] as const
                  ).map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setQuickPersonaGender(g.id)}
                      className={`py-1.5 rounded-xl text-xs font-semibold border transition ${
                        quickPersonaGender === g.id
                          ? 'bg-emerald-600/25 text-emerald-200 border-emerald-500/60'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1">
                  Brief Persona Bio / Role (Optional)
                </label>
                <textarea
                  rows={2}
                  value={quickPersonaDesc}
                  onChange={(e) => setQuickPersonaDesc(e.target.value)}
                  placeholder="Optional: Describe your role, appearance, or relationship with the character..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowQuickPersonaModal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmQuickCreatePersona}
                disabled={!quickPersonaName.trim()}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white disabled:opacity-40"
              >
                Save &amp; Use Persona
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Prompt Preview & Workflow Selector (REQ-006) */}
      {promptPreviewTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2 text-sm">
                  <Sliders className="w-4 h-4 text-fuchsia-400" />
                  Scene Prompt Studio & Reference Image Manager
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Configure ComfyUI workflow, upload a 2nd image (&lt;image2&gt;) for Qwen-Image-2.1-Edit, and customize the scene prompt.
                </p>
              </div>
              <button
                onClick={() => setPromptPreviewTarget(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-8">
                  <label className="block text-xs text-slate-400 mb-1">
                    ComfyUI Workflow Profile
                  </label>
                  <select
                    value={draftWorkflowId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      const nextWf = db.workflows.find((w) => w.id === nextId);
                      const nextLength: WorkflowPromptLengthPreset =
                        nextWf?.promptLengthPreset || 'balanced';
                      setDraftWorkflowId(nextId);
                      setDraftPromptLength(nextLength);
                      handleRecraftDraftPrompt(
                        nextId,
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        nextLength
                      );
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                  >
                    {db.workflows.map((wf) => (
                      <option key={wf.id} value={wf.id}>
                        {wf.name} ({wf.promptStyle})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-xs text-slate-400 mb-1">
                    Prompt Detail / Length
                  </label>
                  <select
                    value={draftPromptLength}
                    onChange={(e) => {
                      const nextLen = e.target
                        .value as WorkflowPromptLengthPreset;
                      setDraftPromptLength(nextLen);
                      handleRecraftDraftPrompt(
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        nextLen
                      );
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200"
                  >
                    {WORKFLOW_PROMPT_LENGTH_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Reference Images (<image1> & <image2>) for Qwen-Image-2.1-Edit / Consistency */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/70 border border-slate-800 rounded-xl p-3">
                {/* <image1>: Primary Character Reference */}
                <div className="space-y-2 border border-slate-800/80 rounded-lg p-2.5 bg-slate-900/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-indigo-300">
                      &lt;image1&gt; Character Reference
                    </span>
                    <label className="cursor-pointer px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 transition">
                      Replace &lt;image1&gt;
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => {
                            if (typeof reader.result === 'string') {
                              setDraftPrimaryRefImage(reader.result);
                            }
                          };
                          reader.readAsDataURL(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                  {draftPrimaryRefImage ? (
                    <div className="flex items-center gap-2.5">
                      <img
                        src={draftPrimaryRefImage}
                        alt="image1"
                        className="w-16 h-16 rounded-lg object-cover border border-indigo-500/40 bg-slate-950 shrink-0"
                      />
                      <p className="text-[11px] text-slate-400 leading-snug">
                        Uploaded into ComfyUI <code className="text-indigo-300">images.image_1</code> to preserve character identity.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-300/90 py-3">
                      No character reference image set. Click "Replace &lt;image1&gt;" to upload one.
                    </p>
                  )}
                </div>

                {/* <image2>: Optional 2nd Image for Qwen-Image-2.1-Edit */}
                <div className="space-y-2 border border-fuchsia-500/30 rounded-lg p-2.5 bg-fuchsia-950/10">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-fuchsia-300">
                      &lt;image2&gt; 2nd Image (Optional)
                    </span>
                    <div className="flex items-center gap-1">
                      <label className="cursor-pointer px-2 py-0.5 rounded bg-fuchsia-600 hover:bg-fuchsia-500 text-[11px] font-medium text-white transition">
                        + Upload 2nd Image
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = () => {
                              if (typeof reader.result === 'string') {
                                setDraftSecondaryRefImage(reader.result);
                                handleRecraftDraftPrompt(
                                  draftWorkflowId,
                                  true,
                                  draftSecondImageRole
                                );
                              }
                            };
                            reader.readAsDataURL(file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {draftSecondaryRefImage && (
                        <button
                          onClick={() =>
                            setConfirmAction({
                              title: 'Remove 2nd Reference Image?',
                              message:
                                'Remove <image2> from this prompt and re-craft it for a single reference image?',
                              confirmLabel: 'Remove Image',
                              onConfirm: () => {
                                setDraftSecondaryRefImage('');
                                handleRecraftDraftPrompt(draftWorkflowId, false);
                              },
                            })
                          }
                          className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-rose-950 text-[11px] text-rose-300"
                          title="Remove 2nd image"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {draftSecondaryRefImage ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={draftSecondaryRefImage}
                          alt="image2"
                          className="w-16 h-16 rounded-lg object-cover border border-fuchsia-500/50 bg-slate-950 shrink-0"
                        />
                        <div className="flex-1 min-w-0 space-y-1">
                          <label className="block text-[10px] text-slate-400">
                            What is &lt;image2&gt; used for?
                          </label>
                          <select
                            value={draftSecondImageRole}
                            onChange={(e) => {
                              const nextRole = e.target.value;
                              setDraftSecondImageRole(nextRole);
                              handleRecraftDraftPrompt(
                                draftWorkflowId,
                                true,
                                nextRole
                              );
                            }}
                            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-fuchsia-200"
                          >
                            <option value="Outfit / Clothing Reference to dress the character in">
                              Outfit / Clothing Reference
                            </option>
                            <option value="Pose & Body Posture Reference">
                              Pose & Posture Reference
                            </option>
                            <option value="Second Character / Player Persona in the scene">
                              2nd Person / Player Persona
                            </option>
                            <option value="Background Environment / Scene Reference">
                              Background / Scene Reference
                            </option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-slate-400 leading-snug">
                        Upload an outfit, pose, background, or 2nd character image. RolePlay Studio will auto-connect <code className="text-fuchsia-300">images.image_2</code> and use <code className="text-fuchsia-300">&lt;image1&gt;</code> &amp; <code className="text-fuchsia-300">&lt;image2&gt;</code> tags!
                      </p>
                      {activePersona.avatarUrl && (
                        <button
                          onClick={() => {
                            setDraftSecondaryRefImage(activePersona.avatarUrl);
                            setDraftSecondImageRole(
                              `Second Character / Player Persona (${activePersona.name})`
                            );
                            handleRecraftDraftPrompt(
                              draftWorkflowId,
                              true,
                              `Second Character / Player Persona (${activePersona.name})`
                            );
                          }}
                          className="text-[11px] text-indigo-300 hover:text-indigo-200 underline"
                        >
                          Use Persona Avatar ({activePersona.name}) as &lt;image2&gt;
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* MOSS-Image Spatial Bounding Box Layout Studio */}
              {(() => {
                const selectedWf =
                  db.workflows.find((w) => w.id === draftWorkflowId) ||
                  db.workflows[0];
                const isMossSelected =
                  selectedWf?.promptStyle === 'moss_bbox' ||
                  isMossWorkflow(selectedWf);
                const parsedMoss = parseMossLayoutPrompt(draftPositivePrompt);
                if (!isMossSelected && !parsedMoss) return null;

                const effectiveStoryImageStyle: ImageStylePreset =
                  activeSession?.imageStylePreset ||
                  db.comfyService.defaultImageStyle ||
                  'photography';
                const activeStyleSpec = getImageStylePresetSpec(
                  effectiveStoryImageStyle
                );

                const handleSelectStoryImageStyle = (
                  nextStyleId: ImageStylePreset
                ) => {
                  const nextSpec = getImageStylePresetSpec(nextStyleId);
                  if (activeSession) {
                    updateActiveSession((s) => ({
                      ...s,
                      imageStylePreset: nextStyleId,
                    }));
                  }
                  if (parsedMoss) {
                    setDraftPositivePrompt(
                      serializeMossLayoutPrompt({
                        ...parsedMoss,
                        summary: {
                          ...parsedMoss.summary,
                          meta: [...nextSpec.mossMeta],
                          caption: applyVisualStyleToMossCaption(
                            parsedMoss.summary.caption,
                            nextStyleId
                          ),
                        },
                      })
                    );
                  }
                };

                const canvasDims = resolveWorkflowCanvasSize(selectedWf);
                const applyPresetBoxes = (presetId: string) => {
                  const preset = MOSS_SPATIAL_PRESETS.find(
                    (p) => p.id === presetId
                  );
                  if (!preset) return;
                  const baseCaption =
                    parsedMoss?.summary.caption ||
                    (draftPositivePrompt.trim().startsWith('{')
                      ? `${activeStyleSpec.captionOpener} in the current scene with expressive emotion and atmospheric lighting.`
                      : draftPositivePrompt.trim() ||
                        `${activeStyleSpec.captionOpener} in the current scene.`);
                  const nextItems: MossBoundingBoxItem[] = preset.boxes.map(
                    (pb, i) => {
                      const existingItem = parsedMoss?.items[i];
                      return {
                        label: pb.label,
                        caption:
                          existingItem?.caption ||
                          pb.roleHint,
                        bbox: pctBoxToAbsCentralizedYxyx(
                          pb.pctBox,
                          canvasDims.width,
                          canvasDims.height
                        ),
                      };
                    }
                  );
                  setDraftPositivePrompt(
                    serializeMossLayoutPrompt({
                      summary: {
                        meta: parsedMoss?.summary.meta || [
                          ...activeStyleSpec.mossMeta,
                        ],
                        canvas: 'single',
                        caption: baseCaption,
                      },
                      items: nextItems,
                      bbox_coord_space: 'abs_centralized',
                      bbox_format: 'yxyx',
                    })
                  );
                };

                return (
                  <div className="bg-emerald-950/20 border border-emerald-500/35 rounded-xl p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-emerald-300">
                          🎯 MOSS-Image Spatial Bounding Box Layout
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-emerald-500/30 text-emerald-200">
                          {canvasDims.width}×{canvasDims.height} · abs_centralized · yxyx
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleRecraftDraftPrompt(
                              draftWorkflowId,
                              undefined,
                              undefined,
                              'moss_bbox'
                            )
                          }
                          disabled={isDraftingPrompt}
                          className={`px-2 py-1 rounded text-[11px] font-semibold border transition ${
                            parsedMoss
                              ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/50'
                              : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-emerald-500/40'
                          }`}
                        >
                          ✨ AI Bounding-Box JSON
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (parsedMoss) {
                              setDraftPositivePrompt(parsedMoss.summary.caption);
                            } else {
                              handleRecraftDraftPrompt(
                                draftWorkflowId,
                                undefined,
                                undefined,
                                'natural'
                              );
                            }
                          }}
                          disabled={isDraftingPrompt}
                          className={`px-2 py-1 rounded text-[11px] font-semibold border transition ${
                            !parsedMoss
                              ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/50'
                              : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-indigo-500/40'
                          }`}
                        >
                          Plain Caption
                        </button>
                      </div>
                    </div>

                    {/* Sticky Story Visual Style (summary.meta) Selector */}
                    <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-2 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold text-fuchsia-300">
                          Story Art Style (<code className="text-emerald-300">meta</code> — saved for this story):
                        </span>
                        <div className="flex flex-wrap items-center gap-1">
                          {IMAGE_STYLE_PRESETS.map((preset) => {
                            const isSelected =
                              effectiveStoryImageStyle === preset.id;
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() =>
                                  handleSelectStoryImageStyle(preset.id)
                                }
                                title={`${preset.label} → meta: [${preset.mossMeta.join(', ')}]`}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition ${
                                  isSelected
                                    ? 'bg-fuchsia-500/25 border-fuchsia-400/70 text-fuchsia-100'
                                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-fuchsia-500/40'
                                }`}
                              >
                                {preset.shortLabel}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      {parsedMoss && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                            meta:
                          </span>
                          <BufferedField
                            value={parsedMoss.summary.meta.join(', ')}
                            onCommit={(nextVal) => {
                              const nextMeta = nextVal
                                .split(',')
                                .map((t) => t.trim())
                                .filter(Boolean);
                              setDraftPositivePrompt(
                                serializeMossLayoutPrompt({
                                  ...parsedMoss,
                                  summary: {
                                    ...parsedMoss.summary,
                                    meta:
                                      nextMeta.length > 0
                                        ? nextMeta
                                        : [...activeStyleSpec.mossMeta],
                                  },
                                })
                              );
                            }}
                            placeholder="e.g. anime, digital illustration"
                            className="flex-1 min-w-0 bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-[11px] font-mono text-emerald-200"
                          />
                        </div>
                      )}
                    </div>

                    {/* Quick Layout Presets */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-slate-400 mr-1">
                        Layout Presets:
                      </span>
                      {MOSS_SPATIAL_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => applyPresetBoxes(preset.id)}
                          title={preset.description}
                          className="px-2 py-1 rounded-lg bg-slate-900/90 hover:bg-emerald-900/40 border border-slate-700/80 hover:border-emerald-500/40 text-[10px] font-medium text-slate-200 transition"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    {/* Visual 2D Bounding Box Canvas + Interactive Box List */}
                    {parsedMoss && (
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
                        {/* 2D Spatial Canvas Preview */}
                        <div className="sm:col-span-4 flex flex-col items-center justify-center bg-slate-950/90 border border-slate-800 rounded-xl p-2.5">
                          <div
                            className="relative w-full max-w-[160px] bg-slate-900/90 border border-slate-700 rounded-lg overflow-hidden"
                            style={{
                              aspectRatio: `${canvasDims.width} / ${canvasDims.height}`,
                            }}
                          >
                            {/* Center origin (0,0) crosshair */}
                            <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-slate-700/70 pointer-events-none" />
                            <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-slate-700/70 pointer-events-none" />
                            {parsedMoss.items.map((item, idx) => {
                              const [topPct, leftPct, bottomPct, rightPct] =
                                absCentralizedYxyxToPctBox(
                                  item.bbox,
                                  canvasDims.width,
                                  canvasDims.height
                                );
                              const colorCls =
                                item.label === 'character'
                                  ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200'
                                  : item.label === 'text'
                                  ? 'border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-200'
                                  : 'border-amber-400 bg-amber-500/15 text-amber-200';
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    top: `${topPct}%`,
                                    left: `${leftPct}%`,
                                    height: `${Math.max(8, bottomPct - topPct)}%`,
                                    width: `${Math.max(8, rightPct - leftPct)}%`,
                                  }}
                                  className={`absolute border-2 rounded-md p-1 flex flex-col justify-between overflow-hidden transition-all ${colorCls}`}
                                  title={`#${idx + 1} (${item.label}): ${item.caption}`}
                                >
                                  <span className="text-[9px] font-bold leading-none truncate drop-shadow">
                                    #{idx + 1} {item.label}
                                  </span>
                                  <span className="text-[8px] font-mono opacity-80 leading-none truncate">
                                    [{item.bbox.join(',')}]
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          <span className="text-[10px] text-slate-400 mt-1.5">
                            Center (0,0) · {parsedMoss.items.length} Box
                            {parsedMoss.items.length === 1 ? '' : 'es'}
                          </span>
                        </div>

                        {/* Interactive Box Rows */}
                        <div className="sm:col-span-8 space-y-2 max-h-48 overflow-y-auto pr-1">
                          {parsedMoss.items.map((item, idx) => {
                            const [topPct, leftPct, bottomPct, rightPct] =
                              absCentralizedYxyxToPctBox(
                                item.bbox,
                                canvasDims.width,
                                canvasDims.height
                              );
                            const updateItem = (
                              patch: Partial<MossBoundingBoxItem>
                            ) => {
                              const nextItems = parsedMoss.items.map((it, i) =>
                                i === idx ? { ...it, ...patch } : it
                              );
                              setDraftPositivePrompt(
                                serializeMossLayoutPrompt({
                                  ...parsedMoss,
                                  items: nextItems,
                                })
                              );
                            };
                            const updatePctCoord = (
                              coordIdx: 0 | 1 | 2 | 3,
                              nextVal: number
                            ) => {
                              const nextPct: [number, number, number, number] = [
                                topPct,
                                leftPct,
                                bottomPct,
                                rightPct,
                              ];
                              nextPct[coordIdx] = nextVal;
                              updateItem({
                                bbox: pctBoxToAbsCentralizedYxyx(
                                  nextPct,
                                  canvasDims.width,
                                  canvasDims.height
                                ),
                              });
                            };
                            return (
                              <div
                                key={idx}
                                className="bg-slate-950/90 border border-slate-800 rounded-lg p-2 space-y-1.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-bold text-emerald-300">
                                      Box #{idx + 1}
                                    </span>
                                    <select
                                      value={item.label}
                                      onChange={(e) =>
                                        updateItem({
                                          label: e.target.value as
                                            | 'character'
                                            | 'object'
                                            | 'text',
                                        })
                                      }
                                      className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-200"
                                    >
                                      <option value="character">character</option>
                                      <option value="object">object</option>
                                      <option value="text">text</option>
                                    </select>
                                    <span className="text-[10px] font-mono text-slate-400">
                                      yxyx: [{item.bbox.join(', ')}]
                                    </span>
                                  </div>
                                  {parsedMoss.items.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextItems =
                                          parsedMoss.items.filter(
                                            (_, i) => i !== idx
                                          );
                                        setDraftPositivePrompt(
                                          serializeMossLayoutPrompt({
                                            ...parsedMoss,
                                            items: nextItems,
                                          })
                                        );
                                      }}
                                      className="text-slate-500 hover:text-rose-400 text-[10px]"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                                <BufferedField
                                  value={item.caption}
                                  onCommit={(nextVal) =>
                                    updateItem({ caption: nextVal })
                                  }
                                  placeholder="Describe only what is inside this bounding box (spaces supported)..."
                                  className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-100"
                                />
                                {item.label === 'text' && (
                                  <BufferedField
                                    value={item.text || ''}
                                    onCommit={(nextVal) =>
                                      updateItem({ text: nextVal })
                                    }
                                    placeholder='Exact literal text to render inside this box (e.g. "EXPLORE" or "海蓝大学")...'
                                    className="w-full bg-slate-900 border border-fuchsia-500/40 rounded px-2 py-1 text-[11px] text-fuchsia-200"
                                  />
                                )}
                                <div className="grid grid-cols-4 gap-1.5 text-[10px] text-slate-400">
                                  <label className="flex items-center gap-1">
                                    Top%
                                    <MossCoordNumberInput
                                      value={topPct}
                                      min={0}
                                      max={Math.max(0, bottomPct - 5)}
                                      onCommit={(val) => updatePctCoord(0, val)}
                                    />
                                  </label>
                                  <label className="flex items-center gap-1">
                                    Left%
                                    <MossCoordNumberInput
                                      value={leftPct}
                                      min={0}
                                      max={Math.max(0, rightPct - 5)}
                                      onCommit={(val) => updatePctCoord(1, val)}
                                    />
                                  </label>
                                  <label className="flex items-center gap-1">
                                    Bot%
                                    <MossCoordNumberInput
                                      value={bottomPct}
                                      min={Math.min(100, topPct + 5)}
                                      max={100}
                                      onCommit={(val) => updatePctCoord(2, val)}
                                    />
                                  </label>
                                  <label className="flex items-center gap-1">
                                    Right%
                                    <MossCoordNumberInput
                                      value={rightPct}
                                      min={Math.min(100, leftPct + 5)}
                                      max={100}
                                      onCommit={(val) => updatePctCoord(3, val)}
                                    />
                                  </label>
                                </div>
                              </div>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => {
                              const nextItems: MossBoundingBoxItem[] = [
                                ...parsedMoss.items,
                                {
                                  label: 'object',
                                  caption:
                                    'Foreground prop or secondary scene element.',
                                  bbox: pctBoxToAbsCentralizedYxyx(
                                    [65, 15, 96, 85],
                                    canvasDims.width,
                                    canvasDims.height
                                  ),
                                },
                              ];
                              setDraftPositivePrompt(
                                serializeMossLayoutPrompt({
                                  ...parsedMoss,
                                  items: nextItems,
                                })
                              );
                            }}
                            className="w-full py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-dashed border-slate-700 text-[11px] text-emerald-300 font-medium"
                          >
                            + Add Spatial Bounding Box
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-slate-400">
                    AI-Crafted Positive Image / Edit / MOSS Layout JSON Prompt (Editable)
                  </label>
                  <button
                    onClick={() => handleRecraftDraftPrompt()}
                    disabled={isDraftingPrompt}
                    className="inline-flex items-center gap-1 text-[11px] text-fuchsia-300 hover:text-fuchsia-200 disabled:opacity-40"
                  >
                    <Sparkles
                      className={`w-3 h-3 ${
                        isDraftingPrompt ? 'animate-spin' : ''
                      }`}
                    />
                    {isDraftingPrompt
                      ? 'Crafting...'
                      : draftSecondaryRefImage
                      ? '✨ Re-Craft with <image1> & <image2>'
                      : '✨ Re-Craft Prompt'}
                  </button>
                </div>
                <BufferedField
                  multiline
                  rows={4}
                  value={draftPositivePrompt}
                  onCommit={(nextVal) => setDraftPositivePrompt(nextVal)}
                  disabled={isDraftingPrompt}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-fuchsia-400 shrink-0" />
                <span>
                  Saved locally to PC:{' '}
                  <code className="text-slate-300">data\images\</code> (and{' '}
                  <code className="text-slate-300">ComfyUI\output\</code>)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPromptPreviewTarget(null);
                    setDraftReplaceImageId(null);
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300"
                >
                  Cancel
                </button>
                {draftReplaceImageId && (
                  <button
                    onClick={() => {
                      const target = promptPreviewTarget;
                      const pImg = draftPrimaryRefImage;
                      const sImg = draftSecondaryRefImage;
                      setPromptPreviewTarget(null);
                      setDraftReplaceImageId(null);
                      handleVisualizeMessage(
                        target,
                        draftPositivePrompt,
                        draftWorkflowId,
                        pImg,
                        sImg,
                        undefined
                      );
                    }}
                    disabled={isDraftingPrompt || !draftPositivePrompt.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 disabled:opacity-40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Render as New Copy
                  </button>
                )}
                <button
                  onClick={() => {
                    const target = promptPreviewTarget;
                    const pImg = draftPrimaryRefImage;
                    const sImg = draftSecondaryRefImage;
                    const replaceId = draftReplaceImageId || undefined;
                    setPromptPreviewTarget(null);
                    setDraftReplaceImageId(null);
                    handleVisualizeMessage(
                      target,
                      draftPositivePrompt,
                      draftWorkflowId,
                      pImg,
                      sImg,
                      replaceId
                    );
                  }}
                  disabled={isDraftingPrompt || !draftPositivePrompt.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-xs font-semibold text-white disabled:opacity-40"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {draftReplaceImageId
                    ? 'Replace Image in ComfyUI'
                    : 'Queue in ComfyUI'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lazy-Loaded Modals: Per-Chat Scene Image Gallery & Lightbox */}
      {(showGalleryModal || lightboxImage) && (
        <Suspense fallback={null}>
          <SceneGalleryAndLightboxModals
            activeSession={activeSession}
            showGalleryModal={showGalleryModal}
            onCloseGallery={() => setShowGalleryModal(false)}
            lightboxImage={lightboxImage}
            onSetLightboxImage={setLightboxImage}
            generatingImageForMsgId={generatingImageForMsgId}
            onRegenerateMessageImage={handleRegenerateMessageImage}
            onOpenPromptPreview={handleOpenPromptPreview}
            onDownloadImage={handleDownloadImage}
            onDeleteMessageImage={handleDeleteMessageImage}
          />
        </Suspense>
      )}

      {/* Modal: LLM Generation Parameters (Preset & Custom Parameters) */}
      {showLlmParamsModal && primaryChatLlm && (
        <div
          onClick={() => setShowLlmParamsModal(false)}
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2 text-base">
                  <Sliders className="w-4 h-4 text-sky-400" />
                  LLM Generation Parameters — {primaryChatLlm.name}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>
                    Active Model:{' '}
                    <span className="text-indigo-300 font-medium">
                      {primaryChatLlm.defaultModel || 'Default'}
                    </span>
                  </span>
                  {isChatLlmPinned && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 text-[10px] font-medium">
                      <Pin className="w-2.5 h-2.5" /> Pinned to this chat
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setShowLlmParamsModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <LlmParametersPanel
              service={primaryChatLlm}
              onChange={(patch) =>
                onUpdateDb((prev) => ({
                  ...prev,
                  llmServices: prev.llmServices.map((s) =>
                    s.id === primaryChatLlm.id ? { ...s, ...patch } : s
                  ),
                }))
              }
            />

            <div className="flex justify-end pt-1">
              <button
                onClick={() => setShowLlmParamsModal(false)}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lazy-Loaded Status HUD Starting Values & Field Editor Modal */}
      {showCustomStatusModal && activeSession && (
        <Suspense fallback={null}>
          <StatusHudEditorModal
            activeSession={activeSession}
            leadChar={sessionCharacters[0] || db.characters[0]}
            activePersona={activePersona}
            defaultLanguage={db.defaultLanguage || 'auto'}
            onClose={() => setShowCustomStatusModal(false)}
            onUpdateActiveSession={updateActiveSession}
            onRequestConfirm={setConfirmAction}
          />
        </Suspense>
      )}

      <ConfirmActionModal
        state={confirmAction}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
};
