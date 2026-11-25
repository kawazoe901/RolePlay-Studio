import React, { useState, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import {
  AppDatabase,
  CharacterCardV2,
  CharacterGender,
  CharacterVoiceConfig,
  ConversationLanguage,
  Lorebook,
  LorebookEntry,
  StatusTrackerMode,
  TTSProviderType,
} from '../types';
import {
  EDGE_TTS_VOICE_OPTIONS,
  KOKORO_OPENAI_VOICE_OPTIONS,
  ttsPlayer,
  uploadReferenceVoiceWav,
} from '../services/ttsService';
import {
  exportCharacterCardV2Json,
  importCharacterCardFile,
} from '../utils/characterCard';
import {
  CONVERSATION_LANGUAGES,
  aiGenerateCharacterProfile,
  aiGenerateCharacterStatusHud,
  cleanCharacterTag,
  extractCoreAppearanceTraits,
  formatGenderBadge,
} from '../services/promptEngine';
import {
  ParsedStatusField,
  getDefaultStatusTemplateForMode,
  getStatusStartingPresets,
  isNumericStatusField,
  parseStatusTemplateRows,
  serializeStatusTemplateRows,
} from '../utils/statusTracker';
import { executeComfyWorkflow } from '../services/comfyService';
import {
  Users,
  User,
  Upload,
  Download,
  Plus,
  Trash2,
  BookOpen,
  UserCheck,
  Sparkles,
  Search,
  MessageSquare,
  X,
  Edit3,
  Play,
  Image as ImageIcon,
  Wand2,
  Maximize2,
  Minimize2,
  Tag,
  Activity,
  Globe,
  Volume2,
  Square,
} from 'lucide-react';
import { ConfirmActionModal, ConfirmActionState } from './ConfirmActionModal';
import { BufferedField } from './BufferedField';

interface Props {
  db: AppDatabase;
  onUpdateDb: (updater: (prev: AppDatabase) => AppDatabase) => void;
  onStartChatWithCharacter: (
    charId: string,
    overridePersonaId?: string
  ) => void;
  onResumeChat: (chatId: string) => void;
}

export const CharactersAndLoreView: React.FC<Props> = ({
  db,
  onUpdateDb,
  onStartChatWithCharacter,
  onResumeChat,
}) => {
  const [subTab, setSubTab] = useState<'characters' | 'personas' | 'lorebooks'>(
    'characters'
  );
  // Null = Grid Gallery View; String = Clicked Character Detail Modal
  const [detailCharId, setDetailCharId] = useState<string | null>(null);
  const [detailSubTab, setDetailSubTab] = useState<
    'overview' | 'visual' | 'prompts'
  >('overview');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [selectedGender, setSelectedGender] = useState<'all' | CharacterGender>(
    'all'
  );
  const [importNotice, setImportNotice] = useState<string>('');
  const [isGeneratingPortrait, setIsGeneratingPortrait] =
    useState<boolean>(false);
  const [portraitStatus, setPortraitStatus] = useState<string>('');

  // AI Character Auto-Generation Modal & State
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newCharName, setNewCharName] = useState<string>('');
  const [newCharGender, setNewCharGender] =
    useState<CharacterGender>('female');
  const [newCharBriefDesc, setNewCharBriefDesc] = useState<string>('');
  const [newCharLanguage, setNewCharLanguage] = useState<
    ConversationLanguage | ''
  >('');
  const [autoGeneratePortraitAfter, setAutoGeneratePortraitAfter] =
    useState<boolean>(false);
  const [isAutoGeneratingChar, setIsAutoGeneratingChar] =
    useState<boolean>(false);
  const [isSideCardExpanded, setIsSideCardExpanded] = useState<boolean>(false);
  const [drawerWidth, setDrawerWidth] = useState<number>(680);
  const [newTagInput, setNewTagInput] = useState<string>('');
  const [previewImageModal, setPreviewImageModal] = useState<{
    src: string;
    name: string;
  } | null>(null);
  const [deleteTargetChar, setDeleteTargetChar] =
    useState<CharacterCardV2 | null>(null);
  const [deleteSoloChatsWithChar, setDeleteSoloChatsWithChar] =
    useState<boolean>(false);
  const [isGeneratingHud, setIsGeneratingHud] = useState<boolean>(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(
    null
  );
  const ttsSnapshot = useSyncExternalStore(
    ttsPlayer.subscribe,
    ttsPlayer.getSnapshot
  );

  const handleConfirmDeleteCharacter = () => {
    if (!deleteTargetChar) return;
    const idToRemove = deleteTargetChar.id;
    const shouldDeleteSolo = deleteSoloChatsWithChar;

    setDeleteTargetChar(null);
    setDeleteSoloChatsWithChar(false);
    if (detailCharId === idToRemove) {
      setDetailCharId(null);
    }

    onUpdateDb((prev) => {
      const nextCharacters = prev.characters.filter((c) => c.id !== idToRemove);
      const nextChats = prev.chats.flatMap((chat) => {
        const includesTarget = chat.characterIds.includes(idToRemove);
        if (!includesTarget) return [chat];

        const isSoloWithTarget =
          !chat.isGroup &&
          chat.characterIds.every((id) => id === idToRemove);
        if (shouldDeleteSolo && isSoloWithTarget) {
          return [];
        }

        const remainingIds = chat.characterIds.filter(
          (id) => id !== idToRemove
        );
        return [
          {
            ...chat,
            characterIds: remainingIds,
            isGroup: remainingIds.length > 1 ? chat.isGroup : false,
          },
        ];
      });

      const activeStillExists = nextChats.some(
        (c) => c.id === prev.activeChatId
      );
      return {
        ...prev,
        characters: nextCharacters,
        chats: nextChats,
        activeChatId: activeStillExists
          ? prev.activeChatId
          : nextChats[0]?.id || '',
      };
    });
  };

  const handleDownloadPortrait = (src: string, charName: string) => {
    const safeName =
      charName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '') || 'character';
    const dataUrlMatch = src.match(/^data:image\/([a-z0-9+.-]+);/i);
    const urlExtMatch = src.match(/\.([a-z0-9]+)(?:[?#]|$)/i);
    const rawExt = (dataUrlMatch?.[1] || urlExtMatch?.[1] || 'png').toLowerCase();
    const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;

    const a = document.createElement('a');
    a.href = src;
    a.download = `${safeName}_portrait.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleStartResizeDrawer = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = drawerWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const nextWidth = Math.min(
        Math.max(420, startWidth + delta),
        window.innerWidth - 80
      );
      setDrawerWidth(nextWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const storedActiveChar = detailCharId
    ? db.characters.find((c) => c.id === detailCharId) || null
    : null;

  const [localCharDraft, setLocalCharDraft] =
    useState<CharacterCardV2 | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftRef = useRef<CharacterCardV2 | null>(null);

  // Flush any pending draft to AppDatabase
  const flushDraftToDb = () => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    const pending = pendingDraftRef.current;
    if (pending) {
      pendingDraftRef.current = null;
      onUpdateDb((prev) => ({
        ...prev,
        characters: prev.characters.map((c) =>
          c.id === pending.id ? pending : c
        ),
      }));
    }
  };

  useEffect(() => {
    flushDraftToDb();
    setLocalCharDraft(storedActiveChar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailCharId]);

  useEffect(() => {
    return () => {
      flushDraftToDb();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeChar =
    localCharDraft && localCharDraft.id === detailCharId
      ? localCharDraft
      : storedActiveChar;

  // Gather all unique tags across characters for the filter bar (clean, no underscores)
  const allTags = useMemo(
    () =>
      Array.from(
        new Set(
          db.characters
            .flatMap((c) => c.tags || [])
            .map((t) => cleanCharacterTag(t).toLowerCase())
            .filter(Boolean)
        )
      ),
    [db.characters]
  );

  const filteredCharacters = useMemo(
    () =>
      db.characters.filter((char) => {
        const matchesSearch =
          !searchQuery.trim() ||
          char.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          char.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          char.personality.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesTag =
          selectedTag === 'all' ||
          (char.tags || []).some(
            (t) => cleanCharacterTag(t).toLowerCase() === selectedTag
          );
        const matchesGender =
          selectedGender === 'all' ||
          (char.gender || 'female') === selectedGender;
        return matchesSearch && matchesTag && matchesGender;
      }),
    [db.characters, searchQuery, selectedTag, selectedGender]
  );

  const updateActiveChar = (patch: Partial<CharacterCardV2>) => {
    if (!activeChar) return;
    const nextChar: CharacterCardV2 = { ...activeChar, ...patch };
    setLocalCharDraft(nextChar);
    pendingDraftRef.current = nextChar;

    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      const toCommit = pendingDraftRef.current;
      pendingDraftRef.current = null;
      if (toCommit) {
        onUpdateDb((prev) => ({
          ...prev,
          characters: prev.characters.map((c) =>
            c.id === toCommit.id ? toCommit : c
          ),
        }));
      }
    }, 220);
  };

  const handleImportCard = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportNotice('');
    try {
      const card = await importCharacterCardFile(file);
      onUpdateDb((prev) => ({
        ...prev,
        characters: [card, ...prev.characters],
      }));
      setDetailCharId(card.id);
      setImportNotice(`Imported V2 character card "${card.name}"!`);
    } catch (err: any) {
      setImportNotice(
        `Import error: ${err?.message || 'Invalid V2 PNG/JSON card'}`
      );
    }
    e.target.value = '';
  };

  const handleCreateCharacter = () => {
    setNewCharName('');
    setNewCharGender('female');
    setNewCharBriefDesc('');
    setNewCharLanguage('');
    setDetailCharId(null);
    setShowCreateModal(true);
  };

  const handleCreateBlankCharacter = () => {
    const baseTag =
      newCharGender === 'female'
        ? '1girl, solo'
        : newCharGender === 'male'
        ? '1boy, solo'
        : '1person, solo';
    const newChar: CharacterCardV2 = {
      id: `char-${Date.now()}`,
      name: newCharName.trim() || 'New Character',
      gender: newCharGender,
      description:
        newCharBriefDesc.trim() ||
        '{{char}} is a mysterious figure with an untold past.',
      personality: 'Curious, expressive, observant.',
      scenario: '{{user}} meets {{char}} for the first time.',
      first_mes:
        '*{{char}} turns toward {{user}} with a warm smile.*\n\n"Hello there! I wasn\'t expecting company today."',
      mes_example: '',
      creator_notes: '',
      system_prompt:
        'Stay strictly in character as {{char}}. Write physical actions, sensory descriptions, and silent internal thoughts in *asterisks* (or brief inner thoughts in *single quotes* inside asterisks), and reserve double quotation marks ("...") strictly for words actually spoken out loud—never put unspoken thoughts inside double quotes.',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: ['original'],
      avatarUrl: '',
      visualPrompt: `${baseTag}, detailed anime portrait, expressive eyes, soft cinematic lighting`,
      ...(newCharLanguage ? { defaultLanguage: newCharLanguage } : {}),
    };
    onUpdateDb((prev) => ({
      ...prev,
      characters: [newChar, ...prev.characters],
    }));
    setShowCreateModal(false);
    setDetailCharId(newChar.id);
    setDetailSubTab('overview');
  };

  const handleAiCreateNewCharacter = async () => {
    if (!newCharName.trim() || !newCharBriefDesc.trim() || isAutoGeneratingChar)
      return;
    setIsAutoGeneratingChar(true);
    setImportNotice('');
    try {
      const helperLlm =
        db.llmServices.find((s) => s.id === db.activeHelperLlmId) ||
        db.llmServices.find((s) => s.id === db.activeChatLlmId) ||
        db.llmServices[0];

      const generated = await aiGenerateCharacterProfile({
        llmService: helperLlm,
        name: newCharName.trim(),
        gender: newCharGender,
        briefDescription: newCharBriefDesc.trim(),
      });

      const createdChar: CharacterCardV2 = {
        id: `char-${Date.now()}`,
        name: newCharName.trim(),
        gender: newCharGender,
        description: generated.description,
        personality: generated.personality,
        scenario: generated.scenario,
        first_mes: generated.first_mes,
        mes_example: generated.mes_example,
        creator_notes: `Auto-generated from concept: ${newCharBriefDesc.trim()}`,
        system_prompt: generated.system_prompt,
        post_history_instructions: '',
        alternate_greetings: [],
        tags: generated.tags,
        avatarUrl: '',
        visualPrompt: generated.visualPrompt,
        defaultStatusTrackerMode: generated.defaultStatusTrackerMode,
        defaultCustomStatusTemplate: generated.defaultCustomStatusTemplate,
        ...(newCharLanguage ? { defaultLanguage: newCharLanguage } : {}),
      };

      onUpdateDb((prev) => ({
        ...prev,
        characters: [createdChar, ...prev.characters],
      }));
      setShowCreateModal(false);
      setDetailCharId(createdChar.id);
      setDetailSubTab('overview');
      setImportNotice(
        `✨ AI auto-generated all character fields for "${createdChar.name}"!`
      );

      // If user checked "Also generate portrait with ComfyUI", queue the portrait render right away
      // Prefer a text-to-image workflow (non-edit_instruction) for initial portrait generation since a brand-new character has no reference image yet
      if (autoGeneratePortraitAfter) {
        const defaultWf =
          db.workflows.find((w) => w.id === db.comfyService.defaultWorkflowId) ||
          db.workflows[0];
        const workflow =
          defaultWf?.promptStyle === 'edit_instruction'
            ? db.workflows.find((w) => w.promptStyle !== 'edit_instruction') ||
              defaultWf
            : defaultWf;
        if (workflow) {
          setIsGeneratingPortrait(true);
          setPortraitStatus('Preparing ComfyUI portrait...');
          try {
            const primaryLlm =
              db.llmServices.find((s) => s.id === db.activeChatLlmId) ||
              db.llmServices[0];
            const res = await executeComfyWorkflow(db.comfyService, workflow, {
              positivePrompt: createdChar.visualPrompt,
              negativePrompt: workflow.defaultNegativePrompt,
              width: workflow.defaultWidth,
              height: workflow.defaultHeight,
              activeLlmService: primaryLlm,
              onProgress: (status) => setPortraitStatus(status),
            });
            onUpdateDb((prev) => ({
              ...prev,
              characters: prev.characters.map((c) =>
                c.id === createdChar.id
                  ? {
                      ...c,
                      avatarUrl: res.imageUrl,
                      referenceImageUrl: res.imageUrl,
                    }
                  : c
              ),
            }));
          } catch (imgErr: any) {
            setImportNotice(
              `Character created, but ComfyUI portrait failed: ${imgErr?.message}`
            );
          } finally {
            setIsGeneratingPortrait(false);
            setPortraitStatus('');
          }
        }
      }
    } catch (err: any) {
      setImportNotice(
        `AI Character Generation failed: ${
          err?.message || 'Check your LLM connection in Service Hub.'
        }`
      );
    } finally {
      setIsAutoGeneratingChar(false);
    }
  };

  const handleAiAutoFillExistingCharacter = async () => {
    if (!activeChar || isAutoGeneratingChar) return;
    if (!activeChar.name.trim() || !activeChar.description.trim()) {
      setImportNotice(
        'Please enter a Character Name and a brief Description first so AI can auto-fill the rest.'
      );
      return;
    }
    setIsAutoGeneratingChar(true);
    setImportNotice('');
    try {
      const helperLlm =
        db.llmServices.find((s) => s.id === db.activeHelperLlmId) ||
        db.llmServices.find((s) => s.id === db.activeChatLlmId) ||
        db.llmServices[0];

      const generated = await aiGenerateCharacterProfile({
        llmService: helperLlm,
        name: activeChar.name.trim(),
        gender: activeChar.gender || 'female',
        briefDescription: activeChar.description.trim(),
      });

      updateActiveChar({
        description: generated.description,
        personality: generated.personality,
        scenario: generated.scenario,
        first_mes: generated.first_mes,
        mes_example: generated.mes_example,
        system_prompt: generated.system_prompt,
        tags: generated.tags,
        visualPrompt: generated.visualPrompt,
      });
      setImportNotice(
        `✨ AI auto-filled Personality, World Scenario, Opening Greeting, Visual Prompt & Tags for "${activeChar.name}"!`
      );
    } catch (err: any) {
      setImportNotice(
        `AI Auto-Fill error: ${
          err?.message || 'Ensure your local LLM is connected.'
        }`
      );
    } finally {
      setIsAutoGeneratingChar(false);
    }
  };

  const handleGenerateCharacterPortrait = async () => {
    if (!activeChar || isGeneratingPortrait) return;
    const hasExistingRef = Boolean(
      activeChar.referenceImageUrl || activeChar.avatarUrl
    );
    const defaultWf =
      db.workflows.find((w) => w.id === activeChar.preferredWorkflowId) ||
      db.workflows.find((w) => w.id === db.comfyService.defaultWorkflowId) ||
      db.workflows[0];
    // If character has no reference image yet, prefer a text-to-image workflow (e.g. Moss / SDXL) over an image-edit workflow
    const workflow =
      !hasExistingRef && defaultWf?.promptStyle === 'edit_instruction'
        ? db.workflows.find((w) => w.promptStyle !== 'edit_instruction') ||
          defaultWf
        : defaultWf;
    if (!workflow) {
      setImportNotice('No ComfyUI workflow configured.');
      return;
    }

    setIsGeneratingPortrait(true);
    setPortraitStatus('Preparing ComfyUI portrait...');
    try {
      const primaryLlm =
        db.llmServices.find((s) => s.id === db.activeChatLlmId) ||
        db.llmServices[0];

      const promptText =
        activeChar.visualPrompt?.trim() ||
        `Detailed portrait of ${activeChar.name}, ${activeChar.description}`;

      const result = await executeComfyWorkflow(db.comfyService, workflow, {
        positivePrompt: promptText,
        negativePrompt: workflow.defaultNegativePrompt,
        characterReferenceImageUrl:
          activeChar.referenceImageUrl || activeChar.avatarUrl,
        width: workflow.defaultWidth,
        height: workflow.defaultHeight,
        activeLlmService: primaryLlm,
        onProgress: (status) => setPortraitStatus(status),
      });

      updateActiveChar({
        avatarUrl: result.imageUrl,
        referenceImageUrl: result.imageUrl,
      });
      setPortraitStatus('');
    } catch (err: any) {
      setImportNotice(
        `Portrait generation failed: ${err?.message || 'ComfyUI error'}`
      );
      setPortraitStatus('');
    } finally {
      setIsGeneratingPortrait(false);
    }
  };

  const handleAddLoreEntry = (lorebookId: string) => {
    const entry: LorebookEntry = {
      id: `le-${Date.now()}`,
      name: 'New Lore Entry',
      keys: ['keyword1', 'keyword2'],
      content:
        'World info injected when any trigger keyword appears in recent chat messages.',
      enabled: true,
      constant: false,
      priority: 10,
    };
    onUpdateDb((prev) => ({
      ...prev,
      lorebooks: prev.lorebooks.map((lb) =>
        lb.id === lorebookId ? { ...lb, entries: [...lb.entries, entry] } : lb
      ),
    }));
  };

  return (
    <div className="p-3 sm:p-6 max-w-7xl w-full mx-auto space-y-4 sm:space-y-6 overflow-x-hidden">
      {/* Top Sub-Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 border-b border-slate-800 pb-3.5 sm:pb-4">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            onClick={() => setSubTab('characters')}
            className={`inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition ${
              subTab === 'characters'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950'
                : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            Characters ({db.characters.length})
          </button>
          <button
            onClick={() => setSubTab('personas')}
            className={`inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition ${
              subTab === 'personas'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950'
                : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            My Personas ({db.personas.length})
          </button>
          <button
            onClick={() => setSubTab('lorebooks')}
            className={`inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition ${
              subTab === 'lorebooks'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950'
                : 'bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            World Templates ({db.lorebooks.length})
          </button>
        </div>

        {subTab === 'characters' && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            {/* Quick Active Persona Switcher right in the Character Hub */}
            <div
              title="Choose which Player Persona ({{user}}) you play as by default when starting a new chat"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-emerald-500/40 text-xs"
            >
              <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-slate-400 hidden sm:inline">Playing as:</span>
              <select
                value={db.activePersonaId}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '__manage__') {
                    setSubTab('personas');
                    return;
                  }
                  onUpdateDb((prev) => ({
                    ...prev,
                    activePersonaId: val,
                  }));
                }}
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
                  value="__manage__"
                  className="bg-slate-900 text-indigo-300 font-semibold"
                >
                  + Create / Edit Personas...
                </option>
              </select>
            </div>

            <label className="cursor-pointer inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition border border-slate-700">
              <Upload className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-400 shrink-0" />
              <span>Import V2 Card (PNG / JSON)</span>
              <input
                type="file"
                accept=".png,.json"
                onChange={handleImportCard}
                className="hidden"
              />
            </label>
            <button
              onClick={handleCreateCharacter}
              className="inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shadow-md shadow-indigo-950"
            >
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              Create Character
            </button>
          </div>
        )}
      </div>

      {importNotice && (
        <div className="bg-indigo-950/50 border border-indigo-500/40 text-indigo-200 rounded-xl px-4 py-2.5 text-xs flex items-center justify-between">
          <span>{importNotice}</span>
          <button
            onClick={() => setImportNotice('')}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TAB 1: CHARACTER PORTRAIT GRID GALLERY (ooaa.ai style) */}
      {subTab === 'characters' && (
        <div className="space-y-5">
          {/* Search, Gender & Tag Filter Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search characters, personalities, worlds..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Gender Quick Filter */}
              <div className="flex flex-wrap items-center w-full sm:w-auto bg-slate-900 border border-slate-800 rounded-xl p-1 gap-1">
                {(
                  [
                    { id: 'all', label: 'All Genders' },
                    { id: 'female', label: '♀ Female' },
                    { id: 'male', label: '♂ Male' },
                    { id: 'non-binary', label: '⚧ Non-Binary' },
                  ] as const
                ).map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setSelectedGender(g.id)}
                    className={`px-2 sm:px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                      selectedGender === g.id
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedTag('all')}
                className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition shrink-0 ${
                  selectedTag === 'all'
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-950'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                All Tags
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(tag)}
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium capitalize transition shrink-0 ${
                    selectedTag === tag
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-950'
                      : 'bg-slate-900/90 text-slate-300 hover:text-white hover:border-indigo-500/50 border border-slate-800'
                  }`}
                >
                  <span className="text-indigo-400/80">#</span>
                  {cleanCharacterTag(tag)}
                </button>
              ))}
            </div>
          </div>

          {/* Portrait Card Grid (Full-page scrollable at any length) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 sm:gap-5">
            {filteredCharacters.map((char) => {
              const charSessions = db.chats.filter((ch) =>
                ch.characterIds.includes(char.id)
              );
              const portraitSrc = char.referenceImageUrl || char.avatarUrl;
              const genderBadge = formatGenderBadge(char.gender);
              const isSelected = activeChar?.id === char.id;

              return (
                <div
                  key={char.id}
                  onClick={() => {
                    setShowCreateModal(false);
                    setDetailCharId(char.id);
                    setDetailSubTab('overview');
                  }}
                  className={`group relative aspect-[4/5] sm:aspect-[3/4] rounded-xl sm:rounded-2xl overflow-hidden bg-slate-900 border cursor-pointer transition-all duration-300 shadow-lg flex flex-col justify-end min-w-0 ${
                    isSelected
                      ? 'border-indigo-500 ring-2 ring-indigo-500/50 shadow-indigo-950/60'
                      : 'border-slate-800/90 hover:border-indigo-500/70 hover:shadow-indigo-950/40'
                  }`}
                >
                  {/* Full Bleed Portrait Image or Blank Profile Placeholder */}
                  {portraitSrc ? (
                    <img
                      src={portraitSrc}
                      alt={char.name}
                      className="absolute inset-0 w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-b from-slate-800/80 via-slate-900 to-slate-950 flex flex-col items-center justify-center pb-10 sm:pb-12 text-slate-600 group-hover:text-slate-500 transition-colors">
                      <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-slate-800/90 border border-slate-700/80 flex items-center justify-center mb-1.5 sm:mb-2 shadow-inner">
                        <User className="w-7 h-7 sm:w-10 sm:h-10 text-slate-500" />
                      </div>
                      <span className="text-[10px] sm:text-[11px] font-medium text-slate-500">
                        No Portrait
                      </span>
                    </div>
                  )}

                  {/* Top Badges */}
                  <div className="absolute top-2 left-2 right-2 sm:top-3 sm:left-3 sm:right-3 flex items-center justify-between gap-1 z-10 min-w-0">
                    <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 min-w-0">
                      <span
                        className={`px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold border backdrop-blur-sm shadow whitespace-nowrap ${genderBadge.colorClass}`}
                      >
                        {genderBadge.symbol} {genderBadge.label}
                      </span>
                      {char.defaultLanguage && char.defaultLanguage !== 'auto' && (
                        <span className="px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-semibold bg-sky-500/20 text-sky-200 border border-sky-400/40 backdrop-blur-sm shadow whitespace-nowrap">
                          {CONVERSATION_LANGUAGES.find(
                            (l) => l.id === char.defaultLanguage
                          )?.shortLabel || char.defaultLanguage}
                        </span>
                      )}
                      {charSessions.length > 0 && (
                        <span className="px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-semibold bg-indigo-600/90 text-white backdrop-blur-sm shadow whitespace-nowrap">
                          {charSessions.length}{' '}
                          {charSessions.length === 1 ? 'Story' : 'Stories'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {portraitSrc && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewImageModal({
                              src: portraitSrc,
                              name: char.name,
                            });
                          }}
                          title="View full image & download"
                          className="opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-1.5 rounded-full bg-slate-950/80 hover:bg-slate-900 text-slate-200 hover:text-white border border-white/15 backdrop-blur-sm shadow-lg"
                        >
                          <Maximize2 className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (charSessions.length > 0) {
                            onResumeChat(charSessions[0].id);
                          } else {
                            onStartChatWithCharacter(char.id);
                          }
                        }}
                        title="Jump straight into Role-Play Chat"
                        className="hidden sm:flex opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold items-center gap-1 shadow-lg shrink-0"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        Chat
                      </button>
                    </div>
                  </div>

                  {/* Bottom Gradient Overlay with Name, Tags & Bio Teaser */}
                  <div className="relative z-10 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent pt-8 sm:pt-14 pb-2.5 sm:pb-3.5 px-2.5 sm:px-3.5 space-y-1 sm:space-y-1.5 min-w-0">
                    <h3 className="font-bold text-xs sm:text-base text-white leading-tight truncate group-hover:text-indigo-300 transition-colors">
                      {char.name}
                    </h3>

                    {char.tags && char.tags.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 min-w-0">
                        {char.tags.slice(0, 3).map((tag, idx) => (
                          <span
                            key={idx}
                            className={`${
                              idx >= 2 ? 'hidden sm:inline-flex' : 'inline-flex'
                            } items-center gap-0.5 px-1.5 sm:px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-100 border border-indigo-400/30 backdrop-blur-md text-[9px] sm:text-[10px] font-medium capitalize shadow-sm max-w-full truncate`}
                          >
                            <span className="text-indigo-300/80">#</span>
                            <span className="truncate">{cleanCharacterTag(tag)}</span>
                          </span>
                        ))}
                        {char.tags.length > 2 && (
                          <span className="sm:hidden px-1.5 py-0.5 rounded-full bg-slate-800/90 text-slate-300 border border-slate-700 text-[9px] font-semibold">
                            +{char.tags.length - 2}
                          </span>
                        )}
                        {char.tags.length > 3 && (
                          <span className="hidden sm:inline-block px-1.5 py-0.5 rounded-full bg-slate-800/90 text-slate-300 border border-slate-700 text-[9px] font-semibold">
                            +{char.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}

                    <p className="text-[10px] sm:text-[11px] text-slate-300/90 line-clamp-1 sm:line-clamp-2 leading-snug">
                      {char.personality || char.description}
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Add Character Card Tile */}
            <div
              onClick={handleCreateCharacter}
              className={`aspect-[4/5] sm:aspect-[3/4] rounded-xl sm:rounded-2xl border-2 border-dashed cursor-pointer transition flex flex-col items-center justify-center gap-2 sm:gap-3 p-3 sm:p-4 text-center group ${
                showCreateModal
                  ? 'border-fuchsia-500 bg-fuchsia-950/20'
                  : 'border-slate-800 hover:border-indigo-500/60 bg-slate-900/30 hover:bg-slate-900/60'
              }`}
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-slate-800 group-hover:bg-indigo-600/20 flex items-center justify-center transition">
                <Plus className="w-5 h-5 sm:w-6 sm:h-6 text-slate-400 group-hover:text-indigo-400" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-semibold text-slate-200 group-hover:text-white">
                  Create Character
                </p>
                <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5 line-clamp-2">
                  AI Auto-Generate or import V2 card
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT-SIDE SLIDE-OVER DRAWER (Pinned to viewport right edge, draggable width, never closes on accidental outside drag) */}
          {(showCreateModal || activeChar) && (
            <aside
              style={{
                width: isSideCardExpanded ? 'min(92vw, 980px)' : `${drawerWidth}px`,
              }}
              className="fixed top-14 right-0 bottom-0 md:bottom-7 z-50 md:z-40 max-w-full bg-slate-900 border-l border-slate-700/90 shadow-2xl shadow-black/80 flex flex-col transition-[width] duration-75"
            >
              {/* Draggable Left Resize Handle Bar */}
              <div
                onMouseDown={handleStartResizeDrawer}
                title="Drag left or right to resize drawer width"
                className="hidden md:block absolute left-0 top-0 bottom-0 w-2 -ml-1 cursor-ew-resize hover:bg-indigo-500/60 active:bg-indigo-500 transition-colors z-50"
              />

              {/* DRAWER MODE 1: CREATE CHARACTER WITH AI AUTO-GENERATION */}
              {showCreateModal && (
                <div className="flex flex-col h-full overflow-hidden">
                  <div className="p-3.5 sm:p-5 bg-slate-950/90 border-b border-slate-800 flex items-start justify-between gap-2 sm:gap-3 shrink-0">
                    <div className="min-w-0">
                      <h3 className="font-bold text-white text-sm sm:text-base flex items-center gap-2">
                        <Wand2 className="w-4 h-4 sm:w-5 sm:h-5 text-fuchsia-400 shrink-0" />
                        <span className="truncate">Create Character with AI Auto-Generation</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        Enter a <strong>Character Name</strong>,{' '}
                        <strong>Gender</strong>, and a{' '}
                        <strong>Brief Description</strong>. The AI will automatically generate all required character fields.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setIsSideCardExpanded((v) => !v)}
                        title={
                          isSideCardExpanded
                            ? 'Restore drawer width'
                            : 'Expand drawer wider'
                        }
                        className="hidden md:inline-flex p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
                      >
                        {isSideCardExpanded ? (
                          <Minimize2 className="w-4 h-4" />
                        ) : (
                          <Maximize2 className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() =>
                          !isAutoGeneratingChar && setShowCreateModal(false)
                        }
                        title="Close drawer"
                        className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
                    <div>
                      <label className="block text-xs font-semibold text-slate-200 mb-1">
                        1. Character Name <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={newCharName}
                        onChange={(e) => setNewCharName(e.target.value)}
                        placeholder="e.g. Evelyn Cross, Aria Nocturne, 柳如烟, 沈夜..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                        2. Character Gender
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {(
                          [
                            {
                              id: 'female',
                              label: '♀ Female',
                              activeCls:
                                'bg-pink-500/20 text-pink-200 border-pink-500/50',
                            },
                            {
                              id: 'male',
                              label: '♂ Male',
                              activeCls:
                                'bg-sky-500/20 text-sky-200 border-sky-500/50',
                            },
                            {
                              id: 'non-binary',
                              label: '⚧ Non-Binary',
                              activeCls:
                                'bg-violet-500/20 text-violet-200 border-violet-500/50',
                            },
                            {
                              id: 'other',
                              label: '• Other',
                              activeCls:
                                'bg-slate-700 text-slate-100 border-slate-600',
                            },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setNewCharGender(opt.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                              newCharGender === opt.id
                                ? opt.activeCls
                                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-200 mb-1">
                        3. Brief Character Description / Concept{' '}
                        <span className="text-rose-400">*</span>
                      </label>
                      <textarea
                        rows={6}
                        value={newCharBriefDesc}
                        onChange={(e) => setNewCharBriefDesc(e.target.value)}
                        placeholder="Describe who they are, how they look, their personality or relationship with you (e.g. 'A sharp-tongued cyberpunk bounty hunter with neon-blue hair who owes you a life debt', or write in Chinese)..."
                        className="w-full resize-y bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 mb-1.5">
                        <Globe className="w-3.5 h-3.5 text-sky-400" />
                        4. Default Chat Language (Optional)
                      </label>
                      <select
                        value={newCharLanguage}
                        onChange={(e) =>
                          setNewCharLanguage(
                            e.target.value as ConversationLanguage | ''
                          )
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="">
                          Follow Workspace Default (
                          {CONVERSATION_LANGUAGES.find(
                            (l) => l.id === (db.defaultLanguage || 'auto')
                          )?.shortLabel || 'Auto'}
                          )
                        </option>
                        {CONVERSATION_LANGUAGES.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="flex items-center gap-2.5 cursor-pointer bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={autoGeneratePortraitAfter}
                        onChange={(e) =>
                          setAutoGeneratePortraitAfter(e.target.checked)
                        }
                        className="rounded border-slate-700"
                      />
                      <span>
                        Also render a character portrait in{' '}
                        <strong>ComfyUI</strong> automatically after the AI fills
                        the profile
                      </span>
                    </label>
                  </div>

                  <div className="p-5 bg-slate-950/90 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleCreateBlankCharacter}
                      disabled={isAutoGeneratingChar}
                      className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition disabled:opacity-40"
                    >
                      Skip AI & Open Blank Form
                    </button>

                    <button
                      type="button"
                      onClick={handleAiCreateNewCharacter}
                      disabled={
                        isAutoGeneratingChar ||
                        !newCharName.trim() ||
                        !newCharBriefDesc.trim()
                      }
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 text-white text-xs font-bold transition shadow-lg shadow-indigo-950 disabled:opacity-40"
                    >
                      <Wand2
                        className={`w-4 h-4 ${
                          isAutoGeneratingChar ? 'animate-spin' : ''
                        }`}
                      />
                      {isAutoGeneratingChar
                        ? 'AI Generating Character Profile...'
                        : '✨ AI Auto-Generate Character'}
                    </button>
                  </div>
                </div>
              )}

              {/* DRAWER MODE 2: CHARACTER DETAIL & EDITOR */}
              {activeChar && !showCreateModal && (
                <div className="flex flex-col h-full overflow-hidden">
                  {/* Top Drawer Header Bar */}
                  <div className="p-3 sm:p-5 bg-slate-950/90 border-b border-slate-800 flex items-start justify-between gap-2 sm:gap-4 shrink-0 max-h-[48vh] overflow-y-auto sm:max-h-none sm:overflow-visible">
                    <div className="flex items-start gap-2.5 sm:gap-4 flex-1 min-w-0">
                      {/* Compact Portrait Preview with Generate / Upload actions */}
                      <div className="relative w-16 h-[88px] sm:w-24 sm:h-32 rounded-xl overflow-hidden border border-slate-800 bg-slate-900 shrink-0 flex flex-col items-center justify-center group">
                        {activeChar.referenceImageUrl || activeChar.avatarUrl ? (
                          <>
                            <img
                              src={
                                activeChar.referenceImageUrl ||
                                activeChar.avatarUrl
                              }
                              alt={activeChar.name}
                              onClick={() =>
                                setPreviewImageModal({
                                  src:
                                    activeChar.referenceImageUrl ||
                                    activeChar.avatarUrl,
                                  name: activeChar.name,
                                })
                              }
                              title="Click to expand full portrait"
                              className="w-full h-full object-cover cursor-pointer"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewImageModal({
                                  src:
                                    activeChar.referenceImageUrl ||
                                    activeChar.avatarUrl,
                                  name: activeChar.name,
                                })
                              }
                              title="Expand full portrait & download"
                              className="absolute top-1 right-1 p-1 rounded-md bg-slate-950/80 hover:bg-slate-900 text-slate-200 hover:text-white border border-white/15 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shadow"
                            >
                              <Maximize2 className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                            </button>
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center text-center p-2">
                            <User className="w-8 h-8 text-slate-500 mb-1" />
                            <span className="text-[10px] text-slate-500">
                              Blank Pic
                            </span>
                          </div>
                        )}

                        {isGeneratingPortrait && (
                          <div className="absolute inset-0 bg-slate-950/85 flex flex-col items-center justify-center p-1 text-center">
                            <Sparkles className="w-4 h-4 text-fuchsia-400 animate-spin" />
                            <span className="text-[9px] text-fuchsia-200 mt-1 leading-tight">
                              {portraitStatus || 'Rendering...'}
                            </span>
                          </div>
                        )}

                        <div className="absolute inset-x-1 bottom-1 flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={handleGenerateCharacterPortrait}
                            disabled={isGeneratingPortrait}
                            title="Generate Character Portrait with ComfyUI"
                            className="flex-1 inline-flex items-center justify-center gap-0.5 py-1 rounded bg-fuchsia-600/90 hover:bg-fuchsia-500 text-white text-[9px] font-semibold shadow disabled:opacity-40"
                          >
                            <Sparkles className="w-2.5 h-2.5" />
                            Gen
                          </button>
                          <label
                            title="Upload Character Portrait Image"
                            className="flex-1 cursor-pointer inline-flex items-center justify-center gap-0.5 py-1 rounded bg-slate-950/90 hover:bg-indigo-600 text-white text-[9px] font-medium border border-slate-700 shadow"
                          >
                            <ImageIcon className="w-2.5 h-2.5" />
                            Up
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                  const dataUrl = String(reader.result);
                                  updateActiveChar({
                                    avatarUrl: dataUrl,
                                    referenceImageUrl: dataUrl,
                                  });
                                };
                                reader.readAsDataURL(file);
                                e.target.value = '';
                              }}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </div>

                      {/* Name, Gender & Tags */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2">
                          <BufferedField
                            value={activeChar.name}
                            onCommit={(nextVal) =>
                              updateActiveChar({ name: nextVal })
                            }
                            className="text-base sm:text-xl font-bold text-white bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none w-full min-w-0"
                          />
                          <Edit3 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        </div>

                        {/* Character Gender Selector */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-slate-400 mr-0.5">
                            Gender:
                          </span>
                          {(
                            [
                              {
                                id: 'female',
                                label: '♀ Female',
                                activeCls:
                                  'bg-pink-500/20 text-pink-200 border-pink-500/50',
                              },
                              {
                                id: 'male',
                                label: '♂ Male',
                                activeCls:
                                  'bg-sky-500/20 text-sky-200 border-sky-500/50',
                              },
                              {
                                id: 'non-binary',
                                label: '⚧ Non-Binary',
                                activeCls:
                                  'bg-violet-500/20 text-violet-200 border-violet-500/50',
                              },
                              {
                                id: 'other',
                                label: '• Other',
                                activeCls:
                                  'bg-slate-700 text-slate-100 border-slate-600',
                              },
                            ] as const
                          ).map((opt) => {
                            const isSelected =
                              (activeChar.gender || 'female') === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  let nextVisual = activeChar.visualPrompt || '';
                                  if (
                                    opt.id === 'female' &&
                                    /^1boy\b/i.test(nextVisual)
                                  ) {
                                    nextVisual = nextVisual.replace(
                                      /^1boy\b/i,
                                      '1girl'
                                    );
                                  } else if (
                                    opt.id === 'male' &&
                                    /^1girl\b/i.test(nextVisual)
                                  ) {
                                    nextVisual = nextVisual.replace(
                                      /^1girl\b/i,
                                      '1boy'
                                    );
                                  }
                                  updateActiveChar({
                                    gender: opt.id,
                                    visualPrompt: nextVisual,
                                  });
                                }}
                                className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border transition ${
                                  isSelected
                                    ? opt.activeCls
                                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>

                        {/* Interactive Tag Pills Editor (no underscores, click × to remove, type + Enter to add) */}
                        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2 flex flex-wrap items-center gap-1.5">
                          <Tag className="w-3.5 h-3.5 text-indigo-400 ml-1 shrink-0" />
                          {(activeChar.tags || []).map((rawTag, idx) => {
                            const label = cleanCharacterTag(rawTag);
                            return (
                              <span
                                key={`${label}-${idx}`}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-indigo-500/20 to-fuchsia-500/15 text-indigo-200 border border-indigo-500/35 text-[11px] font-medium capitalize shadow-sm"
                              >
                                <span className="text-indigo-400/80">#</span>
                                {label}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmAction({
                                      title: `Remove tag "#${label}"?`,
                                      message: `Remove tag "#${label}" from ${activeChar.name}?`,
                                      confirmLabel: 'Remove Tag',
                                      onConfirm: () =>
                                        updateActiveChar({
                                          tags: (activeChar.tags || []).filter(
                                            (_, i) => i !== idx
                                          ),
                                        }),
                                    })
                                  }
                                  title={`Remove tag "${label}"`}
                                  className="text-indigo-300/70 hover:text-rose-300 ml-0.5"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            );
                          })}
                          <input
                            type="text"
                            value={newTagInput}
                            onChange={(e) => setNewTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ',') {
                                e.preventDefault();
                                const parts = newTagInput
                                  .split(',')
                                  .map((t) => cleanCharacterTag(t))
                                  .filter(Boolean);
                                if (parts.length > 0) {
                                  const existing = (activeChar.tags || []).map(
                                    (t) => cleanCharacterTag(t)
                                  );
                                  const merged = Array.from(
                                    new Set([...existing, ...parts])
                                  );
                                  updateActiveChar({ tags: merged });
                                  setNewTagInput('');
                                }
                              } else if (
                                e.key === 'Backspace' &&
                                !newTagInput &&
                                (activeChar.tags || []).length > 0
                              ) {
                                updateActiveChar({
                                  tags: (activeChar.tags || []).slice(0, -1),
                                });
                              }
                            }}
                            onBlur={() => {
                              const parts = newTagInput
                                .split(',')
                                .map((t) => cleanCharacterTag(t))
                                .filter(Boolean);
                              if (parts.length > 0) {
                                const existing = (activeChar.tags || []).map(
                                  (t) => cleanCharacterTag(t)
                                );
                                const merged = Array.from(
                                  new Set([...existing, ...parts])
                                );
                                updateActiveChar({ tags: merged });
                                setNewTagInput('');
                              }
                            }}
                            placeholder="+ Add tag (press Enter)..."
                            className="bg-transparent text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none min-w-[85px] sm:min-w-[130px] flex-1 px-1 py-0.5"
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          <div
                            title={`Choose which Player Persona ({{user}}) to use with ${activeChar.name}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-emerald-500/40 text-xs"
                          >
                            <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span className="text-slate-400 text-[11px]">As:</span>
                            <select
                              value={
                                activeChar.defaultPersonaId &&
                                db.personas.some(
                                  (p) => p.id === activeChar.defaultPersonaId
                                )
                                  ? activeChar.defaultPersonaId
                                  : db.activePersonaId
                              }
                              onChange={(e) => {
                                const nextPid = e.target.value;
                                if (nextPid === '__new_persona__') {
                                  setDetailCharId(null);
                                  setSubTab('personas');
                                  return;
                                }
                                updateActiveChar({
                                  defaultPersonaId: nextPid,
                                });
                              }}
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
                                value="__new_persona__"
                                className="bg-slate-900 text-indigo-300 font-semibold"
                              >
                                + Create New Persona...
                              </option>
                            </select>
                          </div>

                          <button
                            onClick={() => {
                              const chosenPid =
                                activeChar.defaultPersonaId &&
                                db.personas.some(
                                  (p) => p.id === activeChar.defaultPersonaId
                                )
                                  ? activeChar.defaultPersonaId
                                  : db.activePersonaId;
                              flushDraftToDb();
                              onStartChatWithCharacter(
                                activeChar.id,
                                chosenPid
                              );
                            }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            Start New Story Session
                          </button>
                          <button
                            onClick={() => exportCharacterCardV2Json(activeChar)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium border border-slate-800"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Export V2 JSON
                          </button>
                          {db.characters.length > 1 && (
                            <button
                              onClick={() => {
                                setDeleteSoloChatsWithChar(false);
                                setDeleteTargetChar(activeChar);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 text-xs border border-slate-800"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expand / Close Drawer Buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setIsSideCardExpanded((v) => !v)}
                        title={
                          isSideCardExpanded
                            ? 'Restore drawer width'
                            : 'Expand drawer wider'
                        }
                        className="hidden md:inline-flex p-1.5 rounded-lg bg-slate-800/80 text-slate-400 hover:text-white"
                      >
                        {isSideCardExpanded ? (
                          <Minimize2 className="w-4 h-4" />
                        ) : (
                          <Maximize2 className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => setDetailCharId(null)}
                        title="Close character drawer"
                        className="p-1.5 rounded-lg bg-slate-800/80 text-slate-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Scrollable Body of the Slide-Over Drawer */}
                  <div className="p-3.5 sm:p-5 overflow-y-auto space-y-4 flex-1">
                    {/* Existing Story Sessions with this Character */}
                    <div className="bg-indigo-950/25 border border-indigo-500/30 rounded-xl p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                          Existing Story Sessions (
                          {
                            db.chats.filter((ch) =>
                              ch.characterIds.includes(activeChar.id)
                            ).length
                          }
                          )
                        </span>
                        <button
                          onClick={() => {
                            const chosenPid =
                              activeChar.defaultPersonaId &&
                              db.personas.some(
                                (p) => p.id === activeChar.defaultPersonaId
                              )
                                ? activeChar.defaultPersonaId
                                : db.activePersonaId;
                            flushDraftToDb();
                            onStartChatWithCharacter(activeChar.id, chosenPid);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-300 hover:text-white"
                        >
                          <Plus className="w-3.5 h-3.5" /> New Session
                        </button>
                      </div>

                      {db.chats.filter((ch) =>
                        ch.characterIds.includes(activeChar.id)
                      ).length === 0 ? (
                        <p className="text-xs text-slate-400">
                          No active story sessions with {activeChar.name} yet.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                          {db.chats
                            .filter((ch) =>
                              ch.characterIds.includes(activeChar.id)
                            )
                            .map((session) => (
                              <div
                                key={session.id}
                                onClick={() => onResumeChat(session.id)}
                                className="p-2 rounded-xl bg-slate-950/90 border border-slate-800 hover:border-indigo-500/60 cursor-pointer flex items-center justify-between gap-2 transition"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-white truncate">
                                    {session.title}
                                  </p>
                                  <p className="text-[10px] text-slate-400 truncate">
                                    {session.messages.length} turns •{' '}
                                    {(session.storyLore || []).length} lore items
                                  </p>
                                </div>
                                <span className="px-2 py-0.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold shrink-0">
                                  Resume →
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    {/* Detail Editor Tabs */}
                    <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2.5">
                      <button
                        onClick={() => setDetailSubTab('overview')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                          detailSubTab === 'overview'
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Character & World Scenario
                      </button>
                      <button
                        onClick={() => setDetailSubTab('visual')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                          detailSubTab === 'visual'
                            ? 'bg-fuchsia-600/20 text-fuchsia-300 border border-fuchsia-500/30'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
                        ComfyUI Visual Consistency
                      </button>
                      <button
                        onClick={() => setDetailSubTab('prompts')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                          detailSubTab === 'prompts'
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Greeting & System Prompts
                      </button>
                    </div>

                    {/* Sub-tab 1: Character & World Scenario */}
                    {detailSubTab === 'overview' && (
                      <div className="space-y-3.5">
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                            <label className="block text-xs font-semibold text-slate-300">
                              Character Description (<code>{'{{char}}'}</code> /{' '}
                              <code>{'{{user}}'}</code>)
                            </label>
                            <button
                              type="button"
                              onClick={handleAiAutoFillExistingCharacter}
                              disabled={isAutoGeneratingChar}
                              title="Provide a Name and brief Description, then click to let AI auto-fill Personality, World Scenario, Opening Greeting, Visual Tags & Example Dialogue"
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:from-indigo-500 hover:to-fuchsia-500 text-white text-xs font-semibold transition shadow disabled:opacity-40"
                            >
                              <Wand2
                                className={`w-3.5 h-3.5 ${
                                  isAutoGeneratingChar ? 'animate-spin' : ''
                                }`}
                              />
                              {isAutoGeneratingChar
                                ? 'AI Generating All Fields...'
                                : '✨ AI Auto-Fill All Fields from Name & Description'}
                            </button>
                          </div>
                          <BufferedField
                            multiline
                            rows={4}
                            value={activeChar.description}
                            onCommit={(nextVal) =>
                              updateActiveChar({ description: nextVal })
                            }
                            placeholder="Write a brief concept or description of this character, then click '✨ AI Auto-Fill All Fields' above to generate everything automatically..."
                            className="w-full resize-y bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 leading-relaxed"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1">
                            Personality
                          </label>
                          <BufferedField
                            multiline
                            rows={3}
                            value={activeChar.personality}
                            onCommit={(nextVal) =>
                              updateActiveChar({ personality: nextVal })
                            }
                            className="w-full resize-y bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1">
                            Default World Setting & Scenario
                          </label>
                          <BufferedField
                            multiline
                            rows={3}
                            value={activeChar.scenario}
                            onCommit={(nextVal) =>
                              updateActiveChar({ scenario: nextVal })
                            }
                            className="w-full resize-y bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200"
                          />
                        </div>

                        {/* Default Chat Language Preset for 1-on-1 Chats */}
                        <div className="bg-sky-950/20 border border-sky-500/30 rounded-xl p-3.5 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-sky-300">
                              <Globe className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                              Default Chat Language (Auto-used in 1-on-1 Chats)
                            </span>
                            <select
                              value={activeChar.defaultLanguage || ''}
                              onChange={(e) => {
                                const val = e.target.value as
                                  | ConversationLanguage
                                  | '';
                                updateActiveChar({
                                  defaultLanguage: val || undefined,
                                });
                              }}
                              className="w-full sm:w-auto sm:min-w-[230px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-sky-200 font-medium focus:outline-none focus:border-sky-500"
                            >
                              <option value="">
                                Follow Workspace Default (
                                {CONVERSATION_LANGUAGES.find(
                                  (l) => l.id === (db.defaultLanguage || 'auto')
                                )?.shortLabel || 'Auto'}
                                )
                              </option>
                              {CONVERSATION_LANGUAGES.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            New 1-on-1 chats with {activeChar.name} will
                            automatically start in this language (great for
                            mixing Chinese &amp; English character cards).
                          </p>
                        </div>

                        {/* Character Voice Preset (TTS) */}
                        {(() => {
                          const charVoice: CharacterVoiceConfig =
                            activeChar.voiceConfig || {};
                          const activeProvider: TTSProviderType =
                            charVoice.provider ||
                            db.ttsService?.provider ||
                            'edge-tts';
                          const updateCharVoice = (
                            patch: Partial<CharacterVoiceConfig>
                          ) => {
                            const merged: CharacterVoiceConfig = {
                              ...charVoice,
                              ...patch,
                            };
                            // Clean empty fields
                            if (!merged.provider) delete merged.provider;
                            if (!merged.voiceId) delete merged.voiceId;
                            if (!merged.refAudioPath) delete merged.refAudioPath;
                            if (!merged.refPromptText) delete merged.refPromptText;
                            if (!merged.refPromptLang) delete merged.refPromptLang;
                            updateActiveChar({
                              voiceConfig:
                                Object.keys(merged).length > 0
                                  ? merged
                                  : undefined,
                            });
                          };
                          const previewId = `char-voice-preview-${activeChar.id}`;
                          const isPreviewActive =
                            ttsSnapshot.activeId === previewId &&
                            ttsSnapshot.status !== 'idle';

                          return (
                            <div className="bg-cyan-950/20 border border-cyan-500/30 rounded-xl p-3.5 space-y-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
                                  <Volume2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                  Character Voice Preset (TTS)
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    ttsPlayer.toggleOrSpeak({
                                      id: previewId,
                                      rawText:
                                        activeChar.first_mes ||
                                        `"Hello, I am ${activeChar.name}."`,
                                      ttsConfig: db.ttsService,
                                      character: activeChar,
                                      languageHint:
                                        activeChar.defaultLanguage ||
                                        db.defaultLanguage,
                                    })
                                  }
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition border ${
                                    isPreviewActive
                                      ? 'bg-rose-600/20 border-rose-500/40 text-rose-200 hover:bg-rose-600/30'
                                      : 'bg-cyan-600/20 hover:bg-cyan-600/35 border-cyan-500/40 text-cyan-200'
                                  }`}
                                >
                                  {isPreviewActive ? (
                                    <>
                                      <Square className="w-3 h-3 fill-current" />
                                      <span>
                                        {ttsSnapshot.status === 'synthesizing'
                                          ? 'Synthesizing...'
                                          : 'Stop Preview'}
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <Volume2 className="w-3 h-3" />
                                      <span>Preview Opening Line</span>
                                    </>
                                  )}
                                </button>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div>
                                  <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                                    Voice Selection
                                  </label>
                                  {activeProvider === 'edge-tts' ? (
                                    <select
                                      value={charVoice.voiceId || ''}
                                      onChange={(e) =>
                                        updateCharVoice({
                                          voiceId: e.target.value || undefined,
                                        })
                                      }
                                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-cyan-200 focus:outline-none focus:border-cyan-500"
                                    >
                                      <option value="">
                                        Auto-Match Gender &amp; Language
                                      </option>
                                      {EDGE_TTS_VOICE_OPTIONS.map((v) => (
                                        <option key={v.id} value={v.id}>
                                          {v.label}
                                        </option>
                                      ))}
                                    </select>
                                  ) : activeProvider === 'openai-compatible' ? (
                                    <div className="flex gap-1.5">
                                      <select
                                        value={
                                          KOKORO_OPENAI_VOICE_OPTIONS.some(
                                            (v) => v.id === charVoice.voiceId
                                          ) || !charVoice.voiceId
                                            ? charVoice.voiceId || ''
                                            : '__custom__'
                                        }
                                        onChange={(e) => {
                                          if (e.target.value !== '__custom__') {
                                            updateCharVoice({
                                              voiceId:
                                                e.target.value || undefined,
                                            });
                                          }
                                        }}
                                        className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-cyan-200"
                                      >
                                        <option value="">
                                          Auto-Match Default
                                        </option>
                                        {KOKORO_OPENAI_VOICE_OPTIONS.map((v) => (
                                          <option key={v.id} value={v.id}>
                                            {v.label}
                                          </option>
                                        ))}
                                        <option value="__custom__">
                                          Custom Voice ID...
                                        </option>
                                      </select>
                                      <BufferedField
                                        value={charVoice.voiceId || ''}
                                        onCommit={(nextVal) =>
                                          updateCharVoice({
                                            voiceId: nextVal || undefined,
                                          })
                                        }
                                        placeholder="Voice ID"
                                        className="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 font-mono"
                                      />
                                    </div>
                                  ) : (
                                    <BufferedField
                                      value={charVoice.voiceId || ''}
                                      onCommit={(nextVal) =>
                                        updateCharVoice({
                                          voiceId: nextVal || undefined,
                                        })
                                      }
                                      placeholder="Optional voice name override"
                                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                                    />
                                  )}
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                                      Speed ({(charVoice.speed ?? db.ttsService?.speed ?? 1.0).toFixed(2)}x)
                                    </label>
                                    <input
                                      type="range"
                                      min={0.6}
                                      max={1.5}
                                      step={0.05}
                                      value={
                                        charVoice.speed ??
                                        db.ttsService?.speed ??
                                        1.0
                                      }
                                      onChange={(e) =>
                                        updateCharVoice({
                                          speed: parseFloat(e.target.value),
                                        })
                                      }
                                      className="w-full accent-cyan-500 mt-1.5"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">
                                      Pitch ({(charVoice.pitch ?? db.ttsService?.pitch ?? 0) >= 0 ? `+${charVoice.pitch ?? db.ttsService?.pitch ?? 0}` : charVoice.pitch ?? db.ttsService?.pitch ?? 0}Hz)
                                    </label>
                                    <input
                                      type="range"
                                      min={-15}
                                      max={15}
                                      step={1}
                                      value={
                                        charVoice.pitch ??
                                        db.ttsService?.pitch ??
                                        0
                                      }
                                      onChange={(e) =>
                                        updateCharVoice({
                                          pitch: parseInt(e.target.value, 10),
                                        })
                                      }
                                      className="w-full accent-cyan-500 mt-1.5"
                                    />
                                  </div>
                                </div>
                              </div>

                              {activeProvider === 'gpt-sovits' && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                  <div className="flex gap-1.5">
                                    <BufferedField
                                      value={charVoice.refAudioPath || ''}
                                      onCommit={(nextVal) =>
                                        updateCharVoice({
                                          refAudioPath:
                                            nextVal || undefined,
                                        })
                                      }
                                      placeholder="Character ref_audio_path (e.g. I:\GPT-SoVITS\voices\char.wav)"
                                      className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono"
                                    />
                                    <label className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-cyan-300 cursor-pointer transition shrink-0">
                                      <Upload className="w-3.5 h-3.5" />
                                      <span>Browse WAV</span>
                                      <input
                                        type="file"
                                        accept=".wav,audio/wav"
                                        className="hidden"
                                        onChange={async (e) => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;
                                          try {
                                            const savedPath =
                                              await uploadReferenceVoiceWav(
                                                file
                                              );
                                            updateCharVoice({
                                              refAudioPath: savedPath,
                                            });
                                          } catch (err: any) {
                                            alert(
                                              err?.message ||
                                                'Failed to upload reference WAV'
                                            );
                                          } finally {
                                            e.target.value = '';
                                          }
                                        }}
                                      />
                                    </label>
                                  </div>
                                  <BufferedField
                                    value={charVoice.refPromptText || ''}
                                    onCommit={(nextVal) =>
                                      updateCharVoice({
                                        refPromptText:
                                          nextVal || undefined,
                                      })
                                    }
                                    placeholder="Optional transcript (leave blank for Reference-Free cloning)"
                                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                                  />
                                </div>
                              )}

                              <p className="text-[11px] text-slate-400">
                                Saved with {activeChar.name}&apos;s Character Card (and exported in V2 JSON). Used automatically when speaking replies in 1-on-1 and Group Chats.
                              </p>
                            </div>
                          );
                        })()}

                        {/* Default Status HUD for 1-on-1 Chats */}
                        {(() => {
                          const hudMode: StatusTrackerMode =
                            activeChar.defaultStatusTrackerMode || 'auto';
                          const effectiveCharLang =
                            activeChar.defaultLanguage || db.defaultLanguage;
                          const activePersonaName =
                            db.personas.find(
                              (p) => p.id === db.activePersonaId
                            )?.name || '{{user}}';
                          const hasTemplate =
                            hudMode !== 'auto' && hudMode !== 'off';
                          const currentRawTpl =
                            activeChar.defaultCustomStatusTemplate ||
                            (hasTemplate
                              ? `<status_bar>\n${getDefaultStatusTemplateForMode({
                                  mode: hudMode,
                                  charName: activeChar.name,
                                  userName: '{{user}}',
                                  language: effectiveCharLang,
                                })}\n</status_bar>`
                              : '');
                          const hudRows = hasTemplate
                            ? parseStatusTemplateRows(currentRawTpl)
                            : [];
                          const startingPresets = hasTemplate
                            ? getStatusStartingPresets({
                                mode: hudMode,
                                charName: activeChar.name,
                                userName: '{{user}}',
                                language: effectiveCharLang,
                              })
                            : [];

                          const saveHudRows = (
                            nextRows: ParsedStatusField[]
                          ) => {
                            const body = serializeStatusTemplateRows(nextRows);
                            updateActiveChar({
                              defaultCustomStatusTemplate: `<status_bar>\n${body}\n</status_bar>`,
                            });
                          };

                          const handleAiGenerateHud = async () => {
                            if (isGeneratingHud) return;
                            setIsGeneratingHud(true);
                            try {
                              const helperLlm =
                                db.llmServices.find(
                                  (s) => s.id === db.activeHelperLlmId
                                ) ||
                                db.llmServices.find(
                                  (s) => s.id === db.activeChatLlmId
                                ) ||
                                db.llmServices[0];
                              const res = await aiGenerateCharacterStatusHud({
                                llmService: helperLlm,
                                char: activeChar,
                              });
                              updateActiveChar({
                                defaultStatusTrackerMode: res.mode,
                                defaultCustomStatusTemplate: res.template,
                              });
                            } catch (err: any) {
                              setImportNotice(
                                `Status HUD generation error: ${err?.message || 'LLM error'}`
                              );
                            } finally {
                              setIsGeneratingHud(false);
                            }
                          };

                          return (
                            <div className="bg-emerald-950/15 border border-emerald-500/30 rounded-xl p-3.5 space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <h4 className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                                    <Activity className="w-3.5 h-3.5 shrink-0" />
                                    <span>
                                      Default Status HUD (Auto-used in 1-on-1 Chats)
                                    </span>
                                  </h4>
                                  <p className="text-[11px] text-slate-400 mt-0.5">
                                    Appears automatically on the opening greeting
                                    whenever you start a 1-on-1 chat with{' '}
                                    {activeChar.name} (persona:{' '}
                                    <code>{activePersonaName}</code>).
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={handleAiGenerateHud}
                                  disabled={isGeneratingHud}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600/80 to-indigo-600/80 hover:from-emerald-500 hover:to-indigo-500 text-white text-[11px] font-semibold transition disabled:opacity-40 shrink-0"
                                >
                                  <Wand2
                                    className={`w-3 h-3 ${
                                      isGeneratingHud ? 'animate-spin' : ''
                                    }`}
                                  />
                                  {isGeneratingHud
                                    ? 'Generating HUD...'
                                    : 'AI Auto-Generate HUD'}
                                </button>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <label className="text-[11px] text-slate-400 font-medium shrink-0">
                                  HUD Mode:
                                </label>
                                <select
                                  value={hudMode}
                                  onChange={(e) => {
                                    const nextMode = e.target
                                      .value as StatusTrackerMode;
                                    if (
                                      nextMode === 'auto' ||
                                      nextMode === 'off'
                                    ) {
                                      updateActiveChar({
                                        defaultStatusTrackerMode: nextMode,
                                      });
                                    } else {
                                      const tpl =
                                        getDefaultStatusTemplateForMode({
                                          mode: nextMode,
                                          charName: activeChar.name,
                                          userName: '{{user}}',
                                          language:
                                            activeChar.defaultLanguage ||
                                            db.defaultLanguage,
                                        });
                                      updateActiveChar({
                                        defaultStatusTrackerMode: nextMode,
                                        defaultCustomStatusTemplate: `<status_bar>\n${tpl}\n</status_bar>`,
                                      });
                                    }
                                  }}
                                  className="flex-1 min-w-[180px] bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-emerald-200 font-medium focus:outline-none focus:border-emerald-500"
                                >
                                  <option value="auto">
                                    Auto-Detect (No fixed opening HUD)
                                  </option>
                                  <option value="off">Off (Disabled)</option>
                                  <option value="rpg_traveler">
                                    RPG / Traveler (HP · Stamina · Gear)
                                  </option>
                                  <option value="romance_affection">
                                    Romance &amp; Mood (Affection · Trust · Thoughts)
                                  </option>
                                  <option value="intimate_detailed">
                                    Intimate / Detailed Meters
                                  </option>
                                  <option value="custom">
                                    Custom Character HUD
                                  </option>
                                </select>
                              </div>

                              {hasTemplate && (
                                <>
                                  {startingPresets.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
                                        Presets:
                                      </span>
                                      {startingPresets.map((preset) => (
                                        <button
                                          key={preset.id}
                                          type="button"
                                          title={preset.description}
                                          onClick={() =>
                                            updateActiveChar({
                                              defaultCustomStatusTemplate: `<status_bar>\n${preset.template}\n</status_bar>`,
                                            })
                                          }
                                          className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-emerald-950/60 border border-slate-800 hover:border-emerald-500/40 text-[10px] text-slate-300 hover:text-emerald-200 transition"
                                        >
                                          {preset.label}
                                        </button>
                                      ))}
                                    </div>
                                  )}

                                  <div className="space-y-1.5 max-h-60 overflow-y-auto pr-0.5">
                                    {hudRows.map((row, idx) => {
                                      const numInfo = isNumericStatusField(
                                        row.key,
                                        row.value
                                      );
                                      return (
                                        <div
                                          key={idx}
                                          className="flex flex-col sm:flex-row sm:items-center gap-1.5 bg-slate-950/90 border border-slate-800 rounded-lg p-2"
                                        >
                                          <div className="flex items-center gap-1.5 min-w-0 sm:w-44 shrink-0">
                                            <BufferedField
                                              value={row.key}
                                              onCommit={(nextKey) => {
                                                const next = hudRows.map(
                                                  (r, i) =>
                                                    i === idx
                                                      ? {
                                                          ...r,
                                                          key: nextKey,
                                                        }
                                                      : r
                                                );
                                                saveHudRows(next);
                                              }}
                                              placeholder="Field"
                                              className="min-w-0 flex-1 bg-slate-900 border border-slate-700/80 rounded px-2 py-1 text-[11px] font-semibold text-emerald-300 focus:outline-none focus:border-emerald-500"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const next = hudRows.map(
                                                  (r, i) =>
                                                    i === idx
                                                      ? {
                                                          ...r,
                                                          value:
                                                            numInfo.isNumeric
                                                              ? 'Normal'
                                                              : '50/100',
                                                        }
                                                      : r
                                                );
                                                saveHudRows(next);
                                              }}
                                              className={`px-1.5 py-1 rounded text-[10px] font-semibold border shrink-0 ${
                                                numInfo.isNumeric
                                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                                                  : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/35'
                                              }`}
                                            >
                                              {numInfo.isNumeric
                                                ? 'Meter'
                                                : 'Text'}
                                            </button>
                                          </div>

                                          {numInfo.isNumeric ? (
                                            <div className="flex-1 flex items-center gap-2 min-w-0">
                                              <input
                                                type="range"
                                                min={0}
                                                max={numInfo.max || 100}
                                                value={Math.max(
                                                  0,
                                                  Math.min(
                                                    numInfo.max || 100,
                                                    numInfo.current
                                                  )
                                                )}
                                                onChange={(e) => {
                                                  const clamped = Math.max(
                                                    0,
                                                    Math.min(
                                                      numInfo.max || 100,
                                                      Number(e.target.value) ||
                                                        0
                                                    )
                                                  );
                                                  const formatted =
                                                    numInfo.hasSlashMax
                                                      ? `${clamped}/${numInfo.max}`
                                                      : `${clamped}`;
                                                  const next = hudRows.map(
                                                    (r, i) =>
                                                      i === idx
                                                        ? {
                                                            ...r,
                                                            value: formatted,
                                                          }
                                                        : r
                                                  );
                                                  saveHudRows(next);
                                                }}
                                                className="flex-1 min-w-0 accent-emerald-500 cursor-pointer"
                                              />
                                              <input
                                                type="number"
                                                min={0}
                                                max={numInfo.max || 100}
                                                value={Math.max(
                                                  0,
                                                  Math.min(
                                                    numInfo.max || 100,
                                                    numInfo.current
                                                  )
                                                )}
                                                onChange={(e) => {
                                                  const clamped = Math.max(
                                                    0,
                                                    Math.min(
                                                      numInfo.max || 100,
                                                      Number(e.target.value) ||
                                                        0
                                                    )
                                                  );
                                                  const formatted =
                                                    numInfo.hasSlashMax
                                                      ? `${clamped}/${numInfo.max}`
                                                      : `${clamped}`;
                                                  const next = hudRows.map(
                                                    (r, i) =>
                                                      i === idx
                                                        ? {
                                                            ...r,
                                                            value: formatted,
                                                          }
                                                        : r
                                                  );
                                                  saveHudRows(next);
                                                }}
                                                className="w-12 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-center font-bold text-white shrink-0"
                                              />
                                              <span className="text-[11px] font-bold text-slate-400 shrink-0">
                                                /
                                              </span>
                                              <input
                                                type="number"
                                                min={1}
                                                max={99999}
                                                title="Maximum meter cap (e.g. 5 for 5/5, 10 for 10/10, 100 for 100/100)"
                                                value={numInfo.max || 100}
                                                onChange={(e) => {
                                                  const nextMax = Math.max(
                                                    1,
                                                    Math.min(
                                                      99999,
                                                      Math.round(
                                                        Number(e.target.value) ||
                                                          1
                                                      )
                                                    )
                                                  );
                                                  const nextCur = Math.max(
                                                    0,
                                                    Math.min(
                                                      nextMax,
                                                      numInfo.current
                                                    )
                                                  );
                                                  const formatted = `${nextCur}/${nextMax}`;
                                                  const next = hudRows.map(
                                                    (r, i) =>
                                                      i === idx
                                                        ? {
                                                            ...r,
                                                            value: formatted,
                                                          }
                                                        : r
                                                  );
                                                  saveHudRows(next);
                                                }}
                                                className="w-14 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-center font-bold text-emerald-300 shrink-0"
                                              />
                                            </div>
                                          ) : (
                                            <BufferedField
                                              value={row.value}
                                              onCommit={(nextVal) => {
                                                const next = hudRows.map(
                                                  (r, i) =>
                                                    i === idx
                                                      ? {
                                                          ...r,
                                                          value: nextVal,
                                                        }
                                                      : r
                                                );
                                                saveHudRows(next);
                                              }}
                                              placeholder="Starting value..."
                                              className="flex-1 min-w-0 bg-slate-900 border border-slate-700/80 rounded px-2 py-1 text-[11px] text-slate-100 focus:outline-none focus:border-emerald-500"
                                            />
                                          )}

                                          <button
                                            type="button"
                                            onClick={() =>
                                              setConfirmAction({
                                                title: `Remove "${
                                                  row.key || 'Field'
                                                }"?`,
                                                message: `Remove this status field from ${activeChar.name}'s default Status HUD?`,
                                                confirmLabel: 'Remove Field',
                                                onConfirm: () =>
                                                  saveHudRows(
                                                    hudRows.filter(
                                                      (_, i) => i !== idx
                                                    )
                                                  ),
                                              })
                                            }
                                            title="Remove field"
                                            className="p-1 text-slate-500 hover:text-rose-400 self-end sm:self-center shrink-0"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>

                                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        saveHudRows([
                                          ...hudRows,
                                          { key: 'New Meter', value: '50/100' },
                                        ])
                                      }
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-slate-700 text-[11px] font-medium transition"
                                    >
                                      <Plus className="w-3 h-3" />
                                      Add Field
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmAction({
                                          title: 'Reset Default Status HUD?',
                                          message: `Reset ${activeChar.name}'s customized Status HUD fields back to the default template for "${hudMode}"?`,
                                          confirmLabel: 'Reset HUD',
                                          tone: 'warning',
                                          onConfirm: () => {
                                            const tpl =
                                              getDefaultStatusTemplateForMode({
                                                mode: hudMode,
                                                charName: activeChar.name,
                                                userName: '{{user}}',
                                                language:
                                            activeChar.defaultLanguage ||
                                            db.defaultLanguage,
                                              });
                                            updateActiveChar({
                                              defaultCustomStatusTemplate: `<status_bar>\n${tpl}\n</status_bar>`,
                                            });
                                          },
                                        })
                                      }
                                      className="text-[11px] text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline"
                                    >
                                      Reset to Mode Default
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Sub-tab 2: ComfyUI Visual Consistency */}
                    {detailSubTab === 'visual' && (
                      <div className="bg-fuchsia-950/20 border border-fuchsia-500/30 rounded-xl p-4 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/80 border border-cyan-500/30 rounded-xl p-3.5">
                          <div className="flex items-center gap-3">
                            {activeChar.referenceImageUrl ||
                            activeChar.avatarUrl ? (
                              <img
                                src={
                                  activeChar.referenceImageUrl ||
                                  activeChar.avatarUrl
                                }
                                alt="Character Reference"
                                onClick={() =>
                                  setPreviewImageModal({
                                    src:
                                      activeChar.referenceImageUrl ||
                                      activeChar.avatarUrl,
                                    name: activeChar.name,
                                  })
                                }
                                title="Click to expand reference image"
                                className="w-14 h-14 rounded-xl object-cover bg-slate-900 border border-cyan-500/40 shrink-0 cursor-pointer hover:border-cyan-400 transition"
                              />
                            ) : (
                              <div className="w-14 h-14 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center shrink-0">
                                <User className="w-6 h-6 text-slate-500" />
                              </div>
                            )}
                            <div>
                              <p className="text-xs font-semibold text-cyan-200">
                                Character Consistency Reference Image (ComfyUI{' '}
                                <code>LoadImage</code>)
                              </p>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                Automatically uploaded to ComfyUI when using{' '}
                                <strong>Qwen-Image-2.1-Edit</strong> or{' '}
                                <strong>Moss</strong> reference workflows to keep
                                the character's exact face and outfit consistent.
                              </p>
                            </div>
                          </div>
                          <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-200 border border-cyan-500/30 text-xs font-medium shrink-0">
                            <Upload className="w-3.5 h-3.5" />
                            Upload Ref PNG
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                  updateActiveChar({
                                    referenceImageUrl: String(reader.result),
                                  });
                                };
                                reader.readAsDataURL(file);
                                e.target.value = '';
                              }}
                              className="hidden"
                            />
                          </label>
                        </div>

                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="block text-xs font-semibold text-fuchsia-200">
                              Visual Appearance Tags / Base Description
                            </label>
                            <button
                              type="button"
                              onClick={() =>
                                updateActiveChar({
                                  visualPrompt: extractCoreAppearanceTraits(
                                    activeChar.visualPrompt,
                                    activeChar.gender
                                  ),
                                })
                              }
                              title="Strip static studio backgrounds, poses (e.g. 'sitting on stool'), and quality boilerplate so chat scene generation focuses on the live chat action"
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-fuchsia-600/20 hover:bg-fuchsia-600/30 text-fuchsia-200 border border-fuchsia-500/30 text-[11px] font-medium transition"
                            >
                              <Sparkles className="w-3 h-3" />
                              Trim to Core Physical Traits
                            </button>
                          </div>
                          <BufferedField
                            multiline
                            rows={3}
                            value={activeChar.visualPrompt}
                            onCommit={(nextVal) =>
                              updateActiveChar({ visualPrompt: nextVal })
                            }
                            placeholder="1girl, long black hair, soft brown eyes, slender figure, white silk shirt..."
                            className="w-full resize-y bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100"
                          />
                          <div className="bg-slate-950/70 border border-slate-800/90 rounded-lg px-3 py-2 text-[11px] text-slate-400 space-y-1">
                            <p>
                              <span className="text-fuchsia-300 font-semibold">
                                Chat Scene Auto-Filter Active:
                              </span>{' '}
                              Even if this box is long or includes a portrait pose/background, chat scene generation automatically extracts only permanent physical traits so it never overrides your live role-play scene:
                            </p>
                            <p className="font-mono text-[10px] text-emerald-300/90 truncate">
                              → {extractCoreAppearanceTraits(activeChar.visualPrompt, activeChar.gender)}
                            </p>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Image URL / Data URI (Optional direct link)
                          </label>
                          <BufferedField
                            value={activeChar.avatarUrl}
                            onCommit={(nextVal) =>
                              updateActiveChar({ avatarUrl: nextVal })
                            }
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300"
                          />
                        </div>
                      </div>
                    )}

                    {/* Sub-tab 3: Greeting & System Prompts */}
                    {detailSubTab === 'prompts' && (
                      <div className="space-y-3.5">
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1">
                            First Message (Opening Scene Greeting)
                          </label>
                          <BufferedField
                            multiline
                            rows={4}
                            value={activeChar.first_mes}
                            onCommit={(nextVal) =>
                              updateActiveChar({ first_mes: nextVal })
                            }
                            className="w-full resize-y bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1">
                            System Prompt Override
                          </label>
                          <BufferedField
                            multiline
                            rows={4}
                            value={activeChar.system_prompt}
                            onCommit={(nextVal) =>
                              updateActiveChar({ system_prompt: nextVal })
                            }
                            className="w-full resize-y bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1">
                            Example Dialogue (<code>mes_example</code>)
                          </label>
                          <BufferedField
                            multiline
                            rows={4}
                            value={activeChar.mes_example}
                            onCommit={(nextVal) =>
                              updateActiveChar({ mes_example: nextVal })
                            }
                            className="w-full resize-y bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      )}

      {/* TAB 2: USER PERSONAS */}
      {subTab === 'personas' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <p className="text-sm text-slate-400">
              Define who you play as (<code>{'{{user}}'}</code>) and your gender so characters address you and react to you naturally in role-play.
            </p>
            <button
              onClick={() => {
                const id = `persona-${Date.now()}`;
                onUpdateDb((prev) => ({
                  ...prev,
                  personas: [
                    ...prev.personas,
                    {
                      id,
                      name: 'New Persona',
                      gender: 'male',
                      description: 'A mysterious adventurer.',
                      visualPrompt: '1boy, dark cloak, cinematic lighting',
                      avatarUrl: '',
                    },
                  ],
                  activePersonaId: id,
                }));
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium self-start sm:self-auto shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add Persona
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {db.personas.map((p) => {
              const isActive = db.activePersonaId === p.id;
              return (
                <div
                  key={p.id}
                  className={`p-3.5 sm:p-4 rounded-xl border space-y-3 min-w-0 ${
                    isActive
                      ? 'bg-slate-900 border-indigo-500/60'
                      : 'bg-slate-900/50 border-slate-800'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <label
                        title="Click to upload persona profile image"
                        className="cursor-pointer relative w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0 hover:border-indigo-500 transition"
                      >
                        {p.avatarUrl ? (
                          <img
                            src={p.avatarUrl}
                            alt={p.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <User className="w-5 h-5 text-slate-500" />
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              const dataUrl = String(reader.result);
                              onUpdateDb((prev) => ({
                                ...prev,
                                personas: prev.personas.map((item) =>
                                  item.id === p.id
                                    ? { ...item, avatarUrl: dataUrl }
                                    : item
                                ),
                              }));
                            };
                            reader.readAsDataURL(file);
                            e.target.value = '';
                          }}
                          className="hidden"
                        />
                      </label>
                      <BufferedField
                        value={p.name}
                        onCommit={(nextVal) =>
                          onUpdateDb((prev) => ({
                            ...prev,
                            personas: prev.personas.map((item) =>
                              item.id === p.id
                                ? { ...item, name: nextVal }
                                : item
                            ),
                          }))
                        }
                        className="font-semibold text-white bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none min-w-0 flex-1 w-full"
                      />
                    </div>
                    <button
                      onClick={() =>
                        onUpdateDb((prev) => ({
                          ...prev,
                          activePersonaId: p.id,
                        }))
                      }
                      className={`px-3 py-1 rounded-lg text-xs font-medium shrink-0 ${
                        isActive
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {isActive ? '✓ Active Persona' : 'Set Active'}
                    </button>
                  </div>

                  {/* Persona Gender Selector */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 mr-1">
                      Your Gender:
                    </span>
                    {(
                      [
                        {
                          id: 'female',
                          label: '♀ Female',
                          activeCls:
                            'bg-pink-500/20 text-pink-200 border-pink-500/50',
                        },
                        {
                          id: 'male',
                          label: '♂ Male',
                          activeCls:
                            'bg-sky-500/20 text-sky-200 border-sky-500/50',
                        },
                        {
                          id: 'non-binary',
                          label: '⚧ Non-Binary',
                          activeCls:
                            'bg-violet-500/20 text-violet-200 border-violet-500/50',
                        },
                        {
                          id: 'other',
                          label: '• Other',
                          activeCls:
                            'bg-slate-700 text-slate-100 border-slate-600',
                        },
                      ] as const
                    ).map((opt) => {
                      const selected = (p.gender || 'male') === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            onUpdateDb((prev) => ({
                              ...prev,
                              personas: prev.personas.map((item) => {
                                if (item.id !== p.id) return item;
                                let nextVisual = item.visualPrompt || '';
                                if (
                                  opt.id === 'female' &&
                                  /^1boy\b/i.test(nextVisual)
                                ) {
                                  nextVisual = nextVisual.replace(
                                    /^1boy\b/i,
                                    '1girl'
                                  );
                                } else if (
                                  opt.id === 'male' &&
                                  /^1girl\b/i.test(nextVisual)
                                ) {
                                  nextVisual = nextVisual.replace(
                                    /^1girl\b/i,
                                    '1boy'
                                  );
                                }
                                return {
                                  ...item,
                                  gender: opt.id,
                                  visualPrompt: nextVisual,
                                };
                              }),
                            }))
                          }
                          className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border transition ${
                            selected
                              ? opt.activeCls
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Persona Bio / Backstory
                    </label>
                    <BufferedField
                      multiline
                      rows={2}
                      value={p.description}
                      onCommit={(nextVal) =>
                        onUpdateDb((prev) => ({
                          ...prev,
                          personas: prev.personas.map((item) =>
                            item.id === p.id
                              ? { ...item, description: nextVal }
                              : item
                          ),
                        }))
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Visual Prompt Tags (for ComfyUI scenes)
                    </label>
                    <BufferedField
                      value={p.visualPrompt}
                      onCommit={(nextVal) =>
                        onUpdateDb((prev) => ({
                          ...prev,
                          personas: prev.personas.map((item) =>
                            item.id === p.id
                              ? { ...item, visualPrompt: nextVal }
                              : item
                          ),
                        }))
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: WORLD TEMPLATES / LOREBOOKS */}
      {subTab === 'lorebooks' && (
        <div className="space-y-6">
          {db.lorebooks.map((lb: Lorebook) => (
            <div
              key={lb.id}
              className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 sm:p-5 space-y-4 min-w-0"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-white text-base">{lb.name}</h3>
                  <p className="text-xs text-slate-400">{lb.description}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium">
                    <Upload className="w-3.5 h-3.5 text-indigo-400" />
                    Import World Info JSON
                    <input
                      type="file"
                      accept=".json"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const raw = JSON.parse(await file.text());
                          const rawEntries = raw.entries
                            ? Array.isArray(raw.entries)
                              ? raw.entries
                              : Object.values(raw.entries)
                            : [];
                          const importedEntries: LorebookEntry[] =
                            rawEntries.map((item: any, idx: number) => ({
                              id: `le-${Date.now()}-${idx}`,
                              name:
                                item.comment ||
                                item.name ||
                                `Lore Entry #${idx + 1}`,
                              keys: Array.isArray(item.key)
                                ? item.key
                                : Array.isArray(item.keys)
                                ? item.keys
                                : String(item.key || '')
                                    .split(',')
                                    .map((k: string) => k.trim())
                                    .filter(Boolean),
                              content: item.content || '',
                              enabled: item.disable ? false : true,
                              constant: Boolean(item.constant),
                              priority: Number(
                                item.order ?? item.priority ?? 10
                              ),
                            }));
                          onUpdateDb((prev) => ({
                            ...prev,
                            lorebooks: prev.lorebooks.map((book) =>
                              book.id === lb.id
                                ? {
                                    ...book,
                                    entries: [
                                      ...book.entries,
                                      ...importedEntries,
                                    ],
                                  }
                                : book
                            ),
                          }));
                        } catch {
                          // ignore malformed json
                        }
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </label>
                  <button
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(lb, null, 2)], {
                        type: 'application/json',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${lb.name
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '_')}_lorebook.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export
                  </button>
                  <button
                    onClick={() => handleAddLoreEntry(lb.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Entry
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {lb.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="bg-slate-950/80 border border-slate-800 rounded-lg p-3.5 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <BufferedField
                        value={entry.name}
                        onCommit={(nextVal) =>
                          onUpdateDb((prev) => ({
                            ...prev,
                            lorebooks: prev.lorebooks.map((book) =>
                              book.id === lb.id
                                ? {
                                    ...book,
                                    entries: book.entries.map((en) =>
                                      en.id === entry.id
                                        ? { ...en, name: nextVal }
                                        : en
                                    ),
                                  }
                                : book
                            ),
                          }))
                        }
                        className="font-semibold text-xs text-indigo-300 bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none min-w-0 flex-1 w-full sm:w-auto"
                      />
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs w-full sm:w-auto">
                        <label className="inline-flex items-center gap-1.5 text-slate-400 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={entry.constant}
                            onChange={(e) =>
                              onUpdateDb((prev) => ({
                                ...prev,
                                lorebooks: prev.lorebooks.map((book) =>
                                  book.id === lb.id
                                    ? {
                                        ...book,
                                        entries: book.entries.map((en) =>
                                          en.id === entry.id
                                            ? {
                                                ...en,
                                                constant: e.target.checked,
                                              }
                                            : en
                                        ),
                                      }
                                    : book
                                ),
                              }))
                            }
                          />
                          Always Active
                        </label>
                        <BufferedField
                          value={entry.keys.join(', ')}
                          onCommit={(nextVal) =>
                            onUpdateDb((prev) => ({
                              ...prev,
                              lorebooks: prev.lorebooks.map((book) =>
                                book.id === lb.id
                                  ? {
                                      ...book,
                                      entries: book.entries.map((en) =>
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
                                    }
                                  : book
                              ),
                            }))
                          }
                          placeholder="Trigger keywords (comma-separated)"
                          className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 w-full sm:w-64"
                        />
                      </div>
                    </div>
                    <BufferedField
                      multiline
                      rows={2}
                      value={entry.content}
                      onCommit={(nextVal) =>
                        onUpdateDb((prev) => ({
                          ...prev,
                          lorebooks: prev.lorebooks.map((book) =>
                            book.id === lb.id
                              ? {
                                  ...book,
                                  entries: book.entries.map((en) =>
                                    en.id === entry.id
                                      ? { ...en, content: nextVal }
                                      : en
                                  ),
                                }
                              : book
                          ),
                        }))
                      }
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs text-slate-300"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full-Size Character Portrait Lightbox Modal */}
      {previewImageModal && (
        <div
          onClick={() => setPreviewImageModal(null)}
          className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl max-h-[92vh] flex flex-col"
          >
            <div className="relative bg-black flex items-center justify-center flex-1 min-h-0 overflow-hidden">
              <img
                src={previewImageModal.src}
                alt={previewImageModal.name}
                className="max-h-[75vh] w-auto max-w-full mx-auto object-contain"
              />
              <button
                type="button"
                onClick={() => setPreviewImageModal(null)}
                title="Close full image"
                className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-900/85 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3.5 sm:p-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-white text-sm truncate min-w-0">
                {previewImageModal.name}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadPortrait(
                      previewImageModal.src,
                      previewImageModal.name
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Image
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewImageModal(null)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Character Delete Confirmation Modal */}
      {deleteTargetChar && (() => {
        const linkedChats = db.chats.filter((chat) =>
          chat.characterIds.includes(deleteTargetChar.id)
        );
        const soloChats = linkedChats.filter(
          (chat) =>
            !chat.isGroup &&
            chat.characterIds.every((id) => id === deleteTargetChar.id)
        );
        const groupChatsCount = linkedChats.length - soloChats.length;
        const portrait =
          deleteTargetChar.referenceImageUrl || deleteTargetChar.avatarUrl;

        return (
          <div
            onClick={() => setDeleteTargetChar(null)}
            className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-4 sm:p-5 space-y-4 shadow-2xl"
            >
              <div className="flex items-start gap-3">
                {portrait ? (
                  <img
                    src={portrait}
                    alt={deleteTargetChar.name}
                    className="w-12 h-14 rounded-xl object-cover border border-slate-700 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-14 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                    <User className="w-5 h-5 text-slate-400" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm sm:text-base font-bold text-white break-words">
                    Delete "{deleteTargetChar.name}"?
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {linkedChats.length === 0
                      ? 'No chat sessions are currently linked to this character.'
                      : `Found ${soloChats.length} solo 1-on-1 ${
                          soloChats.length === 1 ? 'chat' : 'chats'
                        }${
                          groupChatsCount > 0
                            ? ` and ${groupChatsCount} group ${
                                groupChatsCount === 1 ? 'chat' : 'chats'
                              }`
                            : ''
                        } referencing this character.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteTargetChar(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {soloChats.length > 0 && (
                <label className="flex items-start gap-2.5 bg-slate-950/80 border border-slate-800 rounded-xl p-3 cursor-pointer hover:border-rose-500/40 transition">
                  <input
                    type="checkbox"
                    checked={deleteSoloChatsWithChar}
                    onChange={(e) =>
                      setDeleteSoloChatsWithChar(e.target.checked)
                    }
                    className="mt-0.5 rounded border-slate-700 bg-slate-900 text-rose-500 accent-rose-500 shrink-0"
                  />
                  <div className="text-xs leading-relaxed">
                    <span className="font-semibold text-slate-200 block">
                      Also delete {soloChats.length} solo{' '}
                      {soloChats.length === 1 ? 'story chat' : 'story chats'}{' '}
                      with {deleteTargetChar.name}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Leave unchecked to keep past messages &amp; images as a
                      read-only archive.
                    </span>
                  </div>
                </label>
              )}

              {groupChatsCount > 0 && (
                <p className="text-[11px] text-indigo-300/90 bg-indigo-950/30 border border-indigo-500/30 rounded-xl px-3 py-2 leading-relaxed">
                  Group chats ({groupChatsCount}) will not be deleted —{' '}
                  {deleteTargetChar.name} will be removed from the active cast
                  while keeping past dialogue intact.
                </p>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDeleteTargetChar(null)}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteCharacter}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Character
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <ConfirmActionModal
        state={confirmAction}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
};
