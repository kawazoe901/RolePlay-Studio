import React, { Suspense, lazy, useEffect, useState, useSyncExternalStore } from 'react';
import { AppDatabase, ChatSession, ConversationLanguage } from './types';
import { DEFAULT_DATABASE } from './services/defaultData';
import { loadDatabase, saveDatabase } from './services/storage';
import { CONVERSATION_LANGUAGES, replaceMacros } from './services/promptEngine';
import {
  appendStatusBarToGreeting,
  resolveCharacterInitialStatusConfig,
} from './utils/statusTracker';
import { aiTaskQueue } from './services/aiTaskQueue';

const ChatWorkspaceView = lazy(() =>
  import('./components/ChatWorkspaceView').then((m) => ({
    default: m.ChatWorkspaceView,
  }))
);
const ComfyWorkflowStudioView = lazy(() =>
  import('./components/ComfyWorkflowStudioView').then((m) => ({
    default: m.ComfyWorkflowStudioView,
  }))
);
const CharactersAndLoreView = lazy(() =>
  import('./components/CharactersAndLoreView').then((m) => ({
    default: m.CharactersAndLoreView,
  }))
);
const ServiceHubView = lazy(() =>
  import('./components/ServiceHubView').then((m) => ({
    default: m.ServiceHubView,
  }))
);
const GuideAndFaqView = lazy(() =>
  import('./components/GuideAndFaqView').then((m) => ({
    default: m.GuideAndFaqView,
  }))
);
import {
  MessageSquare,
  Workflow,
  Users,
  Server,
  Sparkles,
  CheckCircle2,
  CircleDot,
  Layers,
  X,
  Globe,
  HelpCircle,
} from 'lucide-react';

type NavTab = 'chat' | 'workflows' | 'characters' | 'services' | 'guide';

export const App: React.FC = () => {
  const [db, setDb] = useState<AppDatabase>(DEFAULT_DATABASE);
  const [activeTab, setActiveTab] = useState<NavTab>('characters');
  const [loaded, setLoaded] = useState<boolean>(false);
  const [showQueuePopover, setShowQueuePopover] = useState<boolean>(false);

  const queueSnapshot = useSyncExternalStore(
    aiTaskQueue.subscribe,
    aiTaskQueue.getSnapshot
  );

  useEffect(() => {
    loadDatabase().then((initial) => {
      setDb(initial);
      setLoaded(true);
    });
  }, []);

  const handleUpdateDb = (updater: (prev: AppDatabase) => AppDatabase) => {
    setDb((prev) => {
      const next = updater(prev);
      saveDatabase(next);
      return next;
    });
  };

  const handleResumeChat = (chatId: string) => {
    handleUpdateDb((prev) => ({
      ...prev,
      activeChatId: chatId,
    }));
    setActiveTab('chat');
  };

  const handleStartChatWithCharacter = (
    charId: string,
    overridePersonaId?: string
  ) => {
    const char = db.characters.find((c) => c.id === charId);
    if (!char) return;
    const targetPersonaId =
      overridePersonaId || char.defaultPersonaId || db.activePersonaId;
    const persona =
      db.personas.find((p) => p.id === targetPersonaId) || db.personas[0];
    const effectiveLanguage: ConversationLanguage =
      char.defaultLanguage || db.defaultLanguage || 'auto';
    const initialStatus = resolveCharacterInitialStatusConfig({
      char,
      userName: persona.name,
      language: effectiveLanguage,
    });

    const newChat: ChatSession = {
      id: `chat-${Date.now()}`,
      title: `Story with ${char.name}`,
      isGroup: false,
      characterIds: [char.id],
      personaId: persona.id,
      language: effectiveLanguage,
      statusTrackerMode: initialStatus.statusTrackerMode,
      ...(initialStatus.customStatusTemplate
        ? { customStatusTemplate: initialStatus.customStatusTemplate }
        : {}),
      worldSetting: replaceMacros(char.scenario, char.name, persona.name),
      storyLore: [],
      lorebookIds: [],
      groupTurnMode: 'natural',
      memorySummary: '',
      autoImageEveryNTurns: 0,
      updatedAt: new Date().toISOString(),
      messages: [
        {
          id: `msg-init-${Date.now()}`,
          role: 'assistant',
          speakerId: char.id,
          speakerName: char.name,
          speakerAvatar: char.avatarUrl,
          swipes: [
            appendStatusBarToGreeting(
              replaceMacros(char.first_mes, char.name, persona.name),
              initialStatus.initialStatusBarBlock
            ),
            ...(char.alternate_greetings || []).map((g) =>
              appendStatusBarToGreeting(
                replaceMacros(g, char.name, persona.name),
                initialStatus.initialStatusBarBlock
              )
            ),
          ],
          activeSwipeIndex: 0,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    handleUpdateDb((prev) => ({
      ...prev,
      chats: [newChat, ...prev.chats],
      activeChatId: newChat.id,
    }));
    setActiveTab('chat');
  };

  const primaryLlm =
    db.llmServices.find((s) => s.id === db.activeChatLlmId) ||
    db.llmServices[0];

  if (!loaded) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center">
        <span className="text-sm text-slate-400">Loading RolePlay Studio...</span>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] max-h-[100dvh] bg-slate-950 text-slate-100 flex flex-col overflow-hidden">
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/90 backdrop-blur px-3 sm:px-4 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-600 flex items-center justify-center shadow-md shadow-indigo-950 shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight text-white block sm:inline">
                RolePlay Studio
              </span>
              <span className="hidden sm:inline-block ml-2 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                Local AI + ComfyUI
              </span>
            </div>
          </div>

          {/* Desktop Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-1">
            <button
              onClick={() => setActiveTab('characters')}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === 'characters'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Characters &amp; World Hub
            </button>

            <button
              onClick={() => setActiveTab('chat')}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === 'chat'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Role-Play Chat ({db.chats.length})
            </button>

            <button
              onClick={() => setActiveTab('workflows')}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === 'workflows'
                  ? 'bg-fuchsia-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Workflow className="w-3.5 h-3.5" />
              ComfyUI AI Workflow Linker
            </button>

            <button
              onClick={() => setActiveTab('services')}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === 'services'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              Service Hub
            </button>

            <button
              onClick={() => setActiveTab('guide')}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === 'guide'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              Guide &amp; FAQ
            </button>
          </nav>
        </div>

        {/* Mobile Header Right: Quick Queue Indicator */}
        <div className="md:hidden flex items-center gap-2">
          <button
            onClick={() => setShowQueuePopover((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition border ${
              queueSnapshot.activeTask
                ? 'bg-indigo-950/90 text-indigo-200 border-indigo-500/50 animate-pulse'
                : 'bg-slate-900 border-slate-800 text-slate-400'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-[10px] font-medium">
              {queueSnapshot.activeTask ? 'AI Running' : 'GPU Idle'}
            </span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden w-full max-w-full pb-16 md:pb-7 flex flex-col">
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
              Loading workspace...
            </div>
          }
        >
          {activeTab === 'chat' && (
            <ChatWorkspaceView db={db} onUpdateDb={handleUpdateDb} />
          )}
          {activeTab === 'workflows' && (
            <ComfyWorkflowStudioView db={db} onUpdateDb={handleUpdateDb} />
          )}
          {activeTab === 'characters' && (
            <CharactersAndLoreView
              db={db}
              onUpdateDb={handleUpdateDb}
              onStartChatWithCharacter={handleStartChatWithCharacter}
              onResumeChat={handleResumeChat}
            />
          )}
          {activeTab === 'services' && (
            <ServiceHubView db={db} onUpdateDb={handleUpdateDb} />
          )}
          {activeTab === 'guide' && (
            <GuideAndFaqView onNavigateTab={(tab) => setActiveTab(tab)} />
          )}
        </Suspense>
      </main>

      {/* Mobile Bottom Navigation Bar (Phone Screens < md) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800/90 px-2 py-1.5 flex items-center justify-around shadow-2xl safe-area-bottom select-none">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-xl transition min-w-[54px] ${
            activeTab === 'chat'
              ? 'text-indigo-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <MessageSquare className="w-5 h-5" />
            {db.chats.length > 0 && (
              <span className="absolute -top-1 -right-2 px-1 py-0.2 bg-indigo-600 text-[9px] font-bold text-white rounded-full leading-tight">
                {db.chats.length}
              </span>
            )}
          </div>
          <span className="text-[10px]">Chat</span>
        </button>

        <button
          onClick={() => setActiveTab('characters')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-xl transition min-w-[54px] ${
            activeTab === 'characters'
              ? 'text-indigo-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-5 h-5" />
          <span className="text-[10px]">Cast</span>
        </button>

        <button
          onClick={() => setActiveTab('workflows')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-xl transition min-w-[54px] ${
            activeTab === 'workflows'
              ? 'text-fuchsia-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Workflow className="w-5 h-5" />
          <span className="text-[10px]">ComfyUI</span>
        </button>

        <button
          onClick={() => setActiveTab('services')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-xl transition min-w-[54px] ${
            activeTab === 'services'
              ? 'text-indigo-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Server className="w-5 h-5" />
          <span className="text-[10px]">Services</span>
        </button>

        <button
          onClick={() => setActiveTab('guide')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-xl transition min-w-[54px] ${
            activeTab === 'guide'
              ? 'text-emerald-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <HelpCircle className="w-5 h-5" />
          <span className="text-[10px]">Guide</span>
        </button>
      </nav>

      {/* Desktop Bottom Status Footer Bar (Queue, LLM, ComfyUI) */}
      <footer className="hidden md:flex fixed bottom-0 left-0 right-0 h-7 border-t border-slate-800/90 bg-slate-900/95 backdrop-blur px-4 items-center justify-between text-[11px] text-slate-400 z-40 select-none">
        {/* Left: Sequential AI Task Queue Status */}
        <div className="relative flex items-center gap-3">
          <button
            onClick={() => setShowQueuePopover((prev) => !prev)}
            title="Sequential AI GPU Queue — ensures LLM text and ComfyUI image generation run one at a time so your PC never hangs"
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded transition ${
              queueSnapshot.activeTask
                ? 'bg-indigo-950/90 text-indigo-200 border border-indigo-500/50'
                : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers
              className={`w-3 h-3 ${
                queueSnapshot.activeTask
                  ? 'text-indigo-400 animate-pulse'
                  : 'text-emerald-400'
              }`}
            />
            {queueSnapshot.activeTask ? (
              <span className="max-w-[260px] truncate font-medium">
                {queueSnapshot.activeTask.label}
                {queueSnapshot.activeTask.detail
                  ? ` — ${queueSnapshot.activeTask.detail}`
                  : ''}
              </span>
            ) : (
              <span>AI Queue: Idle (1-by-1 Safe)</span>
            )}
            {queueSnapshot.pendingTasks.length > 0 && (
              <span className="px-1.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold">
                +{queueSnapshot.pendingTasks.length} Queued
              </span>
            )}
          </button>

          {showQueuePopover && (
            <div className="absolute bottom-8 left-0 w-80 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-3.5 space-y-2.5 z-50">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div>
                  <p className="font-bold text-white text-xs">
                    Sequential AI & ComfyUI Queue
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Runs LLM text and ComfyUI images one at a time to protect GPU VRAM.
                  </p>
                </div>
                <button
                  onClick={() => setShowQueuePopover(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {queueSnapshot.activeTask ? (
                <div className="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/40 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                      Running Now
                    </span>
                    <span className="text-[10px] text-emerald-400 animate-pulse">
                      ● Active
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-white">
                    {queueSnapshot.activeTask.label}
                  </p>
                  {queueSnapshot.activeTask.detail && (
                    <p className="text-[11px] text-slate-300">
                      {queueSnapshot.activeTask.detail}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-400 py-2 text-center">
                  No active GPU tasks running.
                </p>
              )}

              {queueSnapshot.pendingTasks.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-[11px] text-amber-300">
                    <span className="font-semibold">
                      Waiting in Queue ({queueSnapshot.pendingTasks.length})
                    </span>
                    <button
                      onClick={() => aiTaskQueue.clearPendingQueue()}
                      className="text-[10px] text-rose-400 hover:text-rose-300"
                    >
                      Cancel All
                    </button>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {queueSnapshot.pendingTasks.map((t, i) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-950 border border-slate-800"
                      >
                        <div className="min-w-0">
                          <p className="text-xs text-slate-200 truncate">
                            #{i + 1} • {t.label}
                          </p>
                        </div>
                        <button
                          onClick={() => aiTaskQueue.cancelPendingTask(t.id)}
                          title="Remove from queue"
                          className="text-slate-500 hover:text-rose-400 p-0.5"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Conversation Language, LLM & ComfyUI Status Indicators */}
        <div className="flex items-center gap-3.5">
          <div
            title="Default & Active Conversation Language"
            className="inline-flex items-center gap-1 text-slate-300"
          >
            <Globe className="w-3 h-3 text-indigo-400" />
            <span className="text-slate-400">Lang:</span>
            <select
              value={
                db.chats.find((c) => c.id === db.activeChatId)?.language ||
                db.defaultLanguage ||
                'auto'
              }
              onChange={(e) => {
                const lang = e.target.value as ConversationLanguage;
                handleUpdateDb((prev) => ({
                  ...prev,
                  defaultLanguage: lang,
                  chats: prev.chats.map((c) =>
                    c.id === prev.activeChatId ? { ...c, language: lang } : c
                  ),
                }));
              }}
              className="bg-transparent text-indigo-300 font-medium focus:outline-none cursor-pointer"
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

          <span className="text-slate-700">|</span>

          <button
            onClick={() => setActiveTab('services')}
            className="inline-flex items-center gap-1.5 hover:text-slate-200 transition"
          >
            {primaryLlm?.status === 'connected' ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <CircleDot className="w-3 h-3 text-amber-400" />
            )}
            <span>
              LLM:{' '}
              <strong className="font-medium text-slate-300">
                {primaryLlm?.defaultModel || primaryLlm?.name}
              </strong>
            </span>
          </button>

          <span className="text-slate-700">|</span>

          <button
            onClick={() => setActiveTab('workflows')}
            className="inline-flex items-center gap-1.5 hover:text-slate-200 transition"
          >
            {db.comfyService.status === 'connected' ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <CircleDot className="w-3 h-3 text-fuchsia-400" />
            )}
            <span>
              ComfyUI:{' '}
              <strong className="font-medium text-slate-300">
                {db.workflows.length} workflows
              </strong>
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
};
