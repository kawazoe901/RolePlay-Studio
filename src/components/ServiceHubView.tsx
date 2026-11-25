import React, { useState, useEffect, useSyncExternalStore } from 'react';
import {
  AppDatabase,
  ImageStylePreset,
  LLMProviderType,
  LLMServiceConfig,
  TTSProviderType,
  TTSReadingMode,
  TTSServiceConfig,
} from '../types';
import { IMAGE_STYLE_PRESETS } from '../services/promptEngine';
import { testLlmService } from '../services/llmService';
import { testComfyService } from '../services/comfyService';
import {
  EDGE_TTS_VOICE_OPTIONS,
  KOKORO_OPENAI_VOICE_OPTIONS,
  testTtsService,
  ttsPlayer,
  uploadReferenceVoiceWav,
} from '../services/ttsService';
import {
  Server,
  Cpu,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Plus,
  Trash2,
  Sparkles,
  Image as ImageIcon,
  Zap,
  Download,
  Upload,
  RotateCcw,
  Database,
  Smartphone,
  Wifi,
  Globe,
  Copy,
  Check,
  Volume2,
  Square,
  Star,
} from 'lucide-react';
import { DEFAULT_DATABASE, DEFAULT_TTS_SERVICE } from '../services/defaultData';
import { LlmParametersPanel } from './LlmParametersPanel';
import { ConfirmActionModal, ConfirmActionState } from './ConfirmActionModal';
import { BufferedField } from './BufferedField';

interface Props {
  db: AppDatabase;
  onUpdateDb: (updater: (prev: AppDatabase) => AppDatabase) => void;
}

export const ServiceHubView: React.FC<Props> = ({ db, onUpdateDb }) => {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [comfyVramNote, setComfyVramNote] = useState<string>('');
  const [ttsStatusNote, setTtsStatusNote] = useState<string>('');
  const ttsSnapshot = useSyncExternalStore(
    ttsPlayer.subscribe,
    ttsPlayer.getSnapshot
  );
  const ttsConfig: TTSServiceConfig = {
    ...DEFAULT_TTS_SERVICE,
    ...(db.ttsService || {}),
  };

  const updateTtsConfig = (patch: Partial<TTSServiceConfig>) => {
    onUpdateDb((prev) => ({
      ...prev,
      ttsService: {
        ...DEFAULT_TTS_SERVICE,
        ...(prev.ttsService || {}),
        ...patch,
      },
    }));
  };

  const handleTestTtsEndpoint = async () => {
    setTestingId('tts');
    const res = await testTtsService(ttsConfig);
    if (res.note) setTtsStatusNote(res.note);
    updateTtsConfig({
      status: res.ok ? 'connected' : 'error',
      lastError: res.error,
    });
    setTestingId(null);
  };
  const [hostInfo, setHostInfo] = useState<{
    port: number;
    interfaces: Array<{ name: string; ip: string; isTailscale: boolean }>;
  } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(
    null
  );
  const [storageStats, setStorageStats] = useState<{
    dbSizeBytes: number;
    backups: Array<{ name: string; sizeBytes: number; mtimeMs: number }>;
    audio: {
      count: number;
      bytes: number;
      wavCount: number;
      wavBytes: number;
      orphanCount: number;
      orphanBytes: number;
    };
    images: {
      count: number;
      bytes: number;
      orphanCount: number;
      orphanBytes: number;
    };
  } | null>(null);
  const [storageBusy, setStorageBusy] = useState<string | null>(null);
  const [storageNote, setStorageNote] = useState<string>('');
  const [selectedBackupName, setSelectedBackupName] = useState<string>('');

  const fetchStorageStats = async () => {
    try {
      const res = await fetch('/api/storage/stats');
      if (res.ok) {
        const data = await res.json();
        setStorageStats(data);
        if (data?.backups?.length && !selectedBackupName) {
          setSelectedBackupName(data.backups[0].name);
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetch('/api/host-info')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.interfaces?.length) {
          setHostInfo(data);
        }
      })
      .catch(() => {});
    void fetchStorageStats();
  }, []);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const runStorageCleanup = async (
    action: 'backup_now' | 'prune_orphans' | 'compress_wavs' | 'restore_backup',
    extra?: Record<string, unknown>
  ) => {
    setStorageBusy(action);
    setStorageNote('');
    try {
      const res = await fetch('/api/storage/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(extra || {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStorageNote(`Error: ${data?.error || res.statusText}`);
      } else if (action === 'backup_now') {
        setStorageNote(
          data.backupName
            ? `Saved rolling snapshot ${data.backupName} in data/backups/.`
            : 'Database snapshot skipped (file too small).'
        );
      } else if (action === 'prune_orphans') {
        setStorageNote(
          `Pruned ${data.deletedAudioCount || 0} orphaned audio & ${data.deletedImageCount || 0} orphaned image files (freed ${formatBytes(data.freedBytes || 0)}).`
        );
      } else if (action === 'compress_wavs') {
        if (data.db) {
          onUpdateDb(() => ({ ...DEFAULT_DATABASE, ...data.db }));
        }
        setStorageNote(
          `Compressed ${data.convertedCount || 0} WAV file(s) to MP3 (freed ${formatBytes(data.freedBytes || 0)}).${
            data.remainingWavs > 0
              ? ` ${data.remainingWavs} WAV file(s) remaining — click again to continue.`
              : ' All cached audio is now compressed.'
          }`
        );
      } else if (action === 'restore_backup' && data.db) {
        onUpdateDb(() => ({ ...DEFAULT_DATABASE, ...data.db }));
        setStorageNote(`Restored database from ${data.filename} (previous state backed up automatically).`);
      }
      await fetchStorageStats();
    } catch (err: any) {
      setStorageNote(`Storage action failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setStorageBusy(null);
    }
  };

  const handleCopyHostUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleTestLlm = async (service: LLMServiceConfig) => {
    setTestingId(service.id);
    const res = await testLlmService(service);
    onUpdateDb((prev) => ({
      ...prev,
      llmServices: prev.llmServices.map((s) =>
        s.id === service.id
          ? {
              ...s,
              status: res.ok ? 'connected' : 'error',
              availableModels: res.ok ? res.models : s.availableModels,
              defaultModel:
                s.defaultModel && res.models.includes(s.defaultModel)
                  ? s.defaultModel
                  : res.models[0] || s.defaultModel,
              lastError: res.error,
            }
          : s
      ),
    }));
    setTestingId(null);
  };

  const handleTestComfy = async () => {
    setTestingId('comfy');
    const res = await testComfyService(db.comfyService);
    if (res.vramInfo) setComfyVramNote(res.vramInfo);
    onUpdateDb((prev) => ({
      ...prev,
      comfyService: {
        ...prev.comfyService,
        status: res.ok ? 'connected' : 'error',
        lastError: res.error,
      },
    }));
    setTestingId(null);
  };

  const handleAddLlmService = () => {
    const newService: LLMServiceConfig = {
      id: `llm-${Date.now()}`,
      name: 'Custom OpenAI-Compatible Service',
      type: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: '',
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
    };
    onUpdateDb((prev) => ({
      ...prev,
      llmServices: [...prev.llmServices, newService],
    }));
  };

  const updateLlmField = (
    id: string,
    patch: Partial<LLMServiceConfig>
  ) => {
    onUpdateDb((prev) => ({
      ...prev,
      llmServices: prev.llmServices.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      ),
    }));
  };

  const removeLlmService = (id: string) => {
    if (db.llmServices.length <= 1) return;
    onUpdateDb((prev) => {
      const remaining = prev.llmServices.filter((s) => s.id !== id);
      return {
        ...prev,
        llmServices: remaining,
        activeChatLlmId:
          prev.activeChatLlmId === id ? remaining[0].id : prev.activeChatLlmId,
        activeHelperLlmId:
          prev.activeHelperLlmId === id
            ? remaining[0].id
            : prev.activeHelperLlmId,
      };
    });
  };

  return (
    <div className="p-3 sm:p-6 max-w-6xl w-full mx-auto space-y-6 sm:space-y-8 overflow-x-hidden">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4 sm:pb-5">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2.5">
            <Server className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-400 shrink-0" />
            <span>Multi-Service AI &amp; ComfyUI Hub</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Connect local LLM servers (Ollama, LM Studio, llama.cpp, vLLM, OpenRouter) and your local ComfyUI instance. All requests route through a built-in CORS-free bridge.
          </p>
        </div>
        <button
          onClick={handleAddLlmService}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition self-start md:self-auto shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add LLM Endpoint
        </button>
      </div>

      {/* Remote Phone Access & Tailscale Host Card */}
      {hostInfo && hostInfo.interfaces.length > 0 && (
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/30 rounded-2xl p-3.5 sm:p-4 shadow-lg space-y-3 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start sm:items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center shrink-0">
                <Smartphone className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white flex flex-wrap items-center gap-2">
                  <span>Remote Host &amp; Phone Access</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                    Host Active (0.0.0.0:{hostInfo.port})
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Open these URLs in your phone browser to role-play on your mobile device (PC handles all AI &amp; image generation):
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {hostInfo.interfaces.map((iface) => {
              const url = `http://${iface.ip}:${hostInfo.port}`;
              const isTailscale = iface.isTailscale;
              return (
                <div
                  key={iface.ip}
                  className={`flex items-center justify-between p-3 rounded-xl border transition ${
                    isTailscale
                      ? 'bg-slate-950/80 border-indigo-500/40 hover:border-indigo-500'
                      : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isTailscale ? (
                      <Globe className="w-4 h-4 text-indigo-400 shrink-0" />
                    ) : (
                      <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-white">
                          {isTailscale ? 'Tailscale VPN (Anywhere)' : `${iface.name} (Local Wi-Fi)`}
                        </span>
                        {isTailscale && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-medium">
                            Tailscale
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-mono text-slate-300 truncate mt-0.5">
                        {url}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopyHostUrl(url)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition shrink-0 ml-2"
                  >
                    {copiedUrl === url ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-300">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Role Assignment Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-900/90 border border-slate-800 rounded-xl p-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-indigo-400 mb-1.5 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            Primary Role-Play Chat LLM
          </label>
          <select
            value={db.activeChatLlmId}
            onChange={(e) =>
              onUpdateDb((prev) => ({ ...prev, activeChatLlmId: e.target.value }))
            }
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
          >
            {db.llmServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.defaultModel || 'No model selected'})
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Used for interactive character responses and multi-character group role-play.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-1.5 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5" />
            Helper & ComfyUI Workflow Analyzer LLM
          </label>
          <select
            value={db.activeHelperLlmId}
            onChange={(e) =>
              onUpdateDb((prev) => ({
                ...prev,
                activeHelperLlmId: e.target.value,
              }))
            }
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
          >
            {db.llmServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.defaultModel || 'No model selected'})
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Used to auto-map ComfyUI workflow JSON nodes, craft scene image prompts, and summarize memory.
          </p>
        </div>
      </div>

      {/* LLM Service Cards */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-indigo-400" />
          LLM Endpoints
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {db.llmServices.map((service) => (
            <div
              key={service.id}
              className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5 sm:p-5 flex flex-col justify-between space-y-4 min-w-0 overflow-hidden"
            >
              <div className="space-y-4 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <BufferedField
                    value={service.name}
                    onCommit={(nextVal) =>
                      updateLlmField(service.id, { name: nextVal })
                    }
                    className="bg-transparent font-semibold text-base text-white border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none px-1 py-0.5 min-w-0 flex-1 w-full sm:w-auto"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    {service.status === 'connected' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                      </span>
                    ) : service.status === 'error' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
                        <AlertCircle className="w-3.5 h-3.5" /> Offline
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-400">
                        Not Tested
                      </span>
                    )}
                    {db.llmServices.length > 1 && (
                      <button
                        onClick={() =>
                          setConfirmAction({
                            title: `Remove "${service.name}"?`,
                            message:
                              'Remove this LLM service endpoint? Any active chat or AI helper assigned to it will fall back to another configured service.',
                            confirmLabel: 'Remove Endpoint',
                            onConfirm: () => removeLlmService(service.id),
                          })
                        }
                        className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg transition"
                        title="Remove endpoint"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Provider Type
                    </label>
                    <select
                      value={service.type}
                      onChange={(e) =>
                        updateLlmField(service.id, {
                          type: e.target.value as LLMProviderType,
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-sm text-slate-200"
                    >
                      <option value="ollama">Ollama (Native API)</option>
                      <option value="lmstudio">LM Studio (/v1)</option>
                      <option value="openai-compatible">OpenAI-Compatible</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-slate-400 mb-1">
                      Base URL
                    </label>
                    <BufferedField
                      value={service.baseUrl}
                      onCommit={(nextVal) =>
                        updateLlmField(service.id, { baseUrl: nextVal })
                      }
                      placeholder="http://127.0.0.1:11434"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono"
                    />
                  </div>
                </div>

                {service.type !== 'ollama' && (
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      API Key (Optional for local servers)
                    </label>
                    <BufferedField
                      type="password"
                      value={service.apiKey || ''}
                      onCommit={(nextVal) =>
                        updateLlmField(service.id, { apiKey: nextVal })
                      }
                      placeholder="sk-..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Active Model ({service.availableModels.length} discovered)
                  </label>
                  <div className="flex gap-2 min-w-0">
                    {service.availableModels.length > 0 ? (
                      <select
                        value={service.defaultModel}
                        onChange={(e) =>
                          updateLlmField(service.id, {
                            defaultModel: e.target.value,
                          })
                        }
                        className="flex-1 min-w-0 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200 truncate"
                      >
                        {service.availableModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <BufferedField
                        value={service.defaultModel}
                        onCommit={(nextVal) =>
                          updateLlmField(service.id, {
                            defaultModel: nextVal,
                          })
                        }
                        placeholder="Click 'Test & Fetch Models' or type model name (e.g. llama3.2:latest)"
                        className="flex-1 min-w-0 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200"
                      />
                    )}
                  </div>
                </div>

                {service.availableModels.length > 0 && (
                  <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-300">
                        <Star className="w-3.5 h-3.5 text-amber-400" />
                        Chat Quick-Switch Favorites
                        <span className="text-slate-500 font-normal">
                          (
                          {(service.quickSwitchModels || []).length > 0
                            ? `${service.quickSwitchModels?.length} selected`
                            : 'All shown'}
                          )
                        </span>
                      </span>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() =>
                            updateLlmField(service.id, {
                              quickSwitchModels: [...service.availableModels],
                            })
                          }
                          className="text-slate-400 hover:text-indigo-300 transition"
                        >
                          Select all
                        </button>
                        {(service.quickSwitchModels || []).length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              updateLlmField(service.id, {
                                quickSwitchModels: [],
                              })
                            }
                            className="text-slate-400 hover:text-rose-300 transition"
                          >
                            Reset (show all)
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-snug">
                      Star your RP models here so coding, vision, or utility models don&apos;t clutter the 1-click switcher inside Chat. Leave empty to show every discovered model.
                    </p>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                      {service.availableModels.map((modelName) => {
                        const isStarred = (
                          service.quickSwitchModels || []
                        ).includes(modelName);
                        return (
                          <button
                            key={modelName}
                            type="button"
                            onClick={() => {
                              const current = service.quickSwitchModels || [];
                              const next = current.includes(modelName)
                                ? current.filter((m) => m !== modelName)
                                : [...current, modelName];
                              updateLlmField(service.id, {
                                quickSwitchModels: next,
                              });
                            }}
                            title={
                              isStarred
                                ? `Remove ${modelName} from Chat Quick-Switch favorites`
                                : `Star ${modelName} for Chat Quick-Switch`
                            }
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition max-w-full ${
                              isStarred
                                ? 'bg-amber-500/15 border-amber-500/50 text-amber-200 font-medium'
                                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                            }`}
                          >
                            <Star
                              className={`w-3 h-3 shrink-0 ${
                                isStarred
                                  ? 'fill-amber-400 text-amber-400'
                                  : 'text-slate-600'
                              }`}
                            />
                            <span className="truncate max-w-[200px]">
                              {modelName}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <LlmParametersPanel
                  service={service}
                  onChange={(patch) => updateLlmField(service.id, patch)}
                />

                {service.lastError && (
                  <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
                    {service.lastError}
                  </p>
                )}
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex justify-end">
                <button
                  onClick={() => handleTestLlm(service)}
                  disabled={testingId === service.id}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium transition disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      testingId === service.id ? 'animate-spin text-indigo-400' : ''
                    }`}
                  />
                  {testingId === service.id
                    ? 'Probing Endpoint...'
                    : 'Test & Fetch Models'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ComfyUI Service Card */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-fuchsia-400" />
          ComfyUI Image Generation Server
        </h2>

        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5 sm:p-5 space-y-4 min-w-0 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-white">
                {db.comfyService.name}
              </h3>
              <p className="text-xs text-slate-400">
                Connects to ComfyUI's REST & history endpoints to execute custom node workflows inside your role-play chats.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
              {db.comfyService.status === 'connected' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {comfyVramNote || 'ComfyUI Connected'}
                </span>
              ) : db.comfyService.status === 'error' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <AlertCircle className="w-3.5 h-3.5" /> Connection Failed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400">
                  Not Tested
                </span>
              )}

              <button
                onClick={handleTestComfy}
                disabled={testingId === 'comfy'}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium transition disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    testingId === 'comfy' ? 'animate-spin' : ''
                  }`}
                />
                Test ComfyUI
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                ComfyUI Server URL
              </label>
              <BufferedField
                value={db.comfyService.baseUrl}
                onCommit={(nextVal) =>
                  onUpdateDb((prev) => ({
                    ...prev,
                    comfyService: {
                      ...prev.comfyService,
                      baseUrl: nextVal,
                    },
                  }))
                }
                placeholder="http://127.0.0.1:8188"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Default Active ComfyUI Workflow Profile
              </label>
              <select
                value={db.comfyService.defaultWorkflowId || ''}
                onChange={(e) =>
                  onUpdateDb((prev) => ({
                    ...prev,
                    comfyService: {
                      ...prev.comfyService,
                      defaultWorkflowId: e.target.value,
                    },
                  }))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
              >
                {db.workflows.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name} ({wf.bindings.length} linked nodes)
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">
                Default Visual / MOSS Art Style (can also be switched per story in Chat)
              </label>
              <select
                value={db.comfyService.defaultImageStyle || 'photography'}
                onChange={(e) =>
                  onUpdateDb((prev) => ({
                    ...prev,
                    comfyService: {
                      ...prev.comfyService,
                      defaultImageStyle: e.target.value as ImageStylePreset,
                    },
                  }))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
              >
                {IMAGE_STYLE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} — MOSS meta: [{preset.mossMeta.join(', ')}]
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Single-GPU Smart VRAM Handoff Toggle */}
          <div className="flex items-start gap-3 bg-slate-950/70 border border-slate-800/90 rounded-lg p-3.5">
            <input
              id="low-vram-toggle"
              type="checkbox"
              checked={db.comfyService.lowVramHandoff}
              onChange={(e) =>
                onUpdateDb((prev) => ({
                  ...prev,
                  comfyService: {
                    ...prev.comfyService,
                    lowVramHandoff: e.target.checked,
                  },
                }))
              }
              className="mt-1 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="low-vram-toggle" className="text-xs text-slate-300 cursor-pointer">
              <span className="font-semibold text-amber-400 inline-flex items-center gap-1">
                <Zap className="w-3.5 h-3.5" /> Single-GPU Smart VRAM Handoff Mode
              </span>
              <span className="block text-slate-400 mt-0.5">
                Automatically unloads the active Ollama model (`keep_alive: 0`) before queueing heavy ComfyUI Flux/SDXL generations, and calls ComfyUI `/free` afterward so your GPU never runs out of VRAM.
              </span>
            </label>
          </div>

          {db.comfyService.lastError && (
            <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
              {db.comfyService.lastError}
            </p>
          )}
        </div>
      </div>

      {/* Text-to-Speech (TTS) & Character Voice Synthesis */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
          <Volume2 className="w-5 h-5 text-cyan-400" />
          Text-to-Speech (TTS) &amp; Character Voice Synthesis
        </h2>

        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5 sm:p-5 space-y-4 min-w-0 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h3 className="font-semibold text-white">
                  Multi-Engine Role-Play Voice Synthesizer
                </h3>
                <label className="inline-flex items-center gap-1.5 text-xs text-cyan-300 cursor-pointer bg-cyan-950/40 border border-cyan-500/30 px-2.5 py-0.5 rounded-full">
                  <input
                    type="checkbox"
                    checked={ttsConfig.enabled}
                    onChange={(e) =>
                      updateTtsConfig({ enabled: e.target.checked })
                    }
                    className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                  />
                  <span>{ttsConfig.enabled ? 'Enabled' : 'Disabled'}</span>
                </label>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Speak character replies aloud with built-in 0-VRAM Edge Neural voices, OpenAI-compatible local TTS (Kokoro / Fish Speech), GPT-SoVITS voice cloning, or Browser Speech.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {ttsConfig.status === 'connected' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {ttsStatusNote || 'TTS Ready'}
                </span>
              ) : ttsConfig.status === 'error' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <AlertCircle className="w-3.5 h-3.5" /> TTS Error
                </span>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  const isSampleZh =
                    ttsConfig.provider === 'gpt-sovits'
                      ? (ttsConfig.gptSovitsPromptLang || 'zh') === 'zh'
                      : ttsConfig.defaultVoiceId.startsWith('zh') ||
                        ttsConfig.defaultVoiceId.startsWith('zf_') ||
                        ttsConfig.defaultVoiceId.startsWith('zm_');
                  const sampleText = isSampleZh
                    ? '*她轻轻放下手中的茶杯，抬起眼睛看向你。* "欢迎来到角色扮演工作室，现在的语音合成已经准备就绪了。"'
                    : '*She sets her quill down beside the open grimoire and looks up.* "Welcome back, traveler. Voice synthesis is connected and ready for our story."';
                  ttsPlayer.toggleOrSpeak({
                    id: 'service-hub-tts-sample',
                    rawText: sampleText,
                    ttsConfig: { ...ttsConfig, cacheAudio: false },
                  });
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition border ${
                  ttsSnapshot.activeId === 'service-hub-tts-sample' &&
                  ttsSnapshot.status !== 'idle'
                    ? 'bg-rose-600/20 border-rose-500/40 text-rose-200 hover:bg-rose-600/30'
                    : 'bg-cyan-600 hover:bg-cyan-500 border-cyan-500 text-white'
                }`}
              >
                {ttsSnapshot.activeId === 'service-hub-tts-sample' &&
                ttsSnapshot.status !== 'idle' ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>
                      {ttsSnapshot.status === 'synthesizing'
                        ? 'Synthesizing...'
                        : 'Stop Sample'}
                    </span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Preview Voice</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleTestTtsEndpoint}
                disabled={testingId === 'tts'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    testingId === 'tts' ? 'animate-spin text-cyan-400' : ''
                  }`}
                />
                Test TTS
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                TTS Engine / Provider
              </label>
              <select
                value={ttsConfig.provider}
                onChange={(e) => {
                  const nextProvider = e.target.value as TTSProviderType;
                  const nextPatch: Partial<TTSServiceConfig> = {
                    provider: nextProvider,
                  };
                  if (nextProvider === 'gpt-sovits') {
                    if (ttsConfig.baseUrl.includes('8880')) {
                      nextPatch.baseUrl = 'http://127.0.0.1:9880';
                    }
                    if (!ttsConfig.gptSovitsRefAudioPath) {
                      nextPatch.gptSovitsRefAudioPath =
                        DEFAULT_TTS_SERVICE.gptSovitsRefAudioPath;
                    }
                    if (!ttsConfig.gptSovitsPromptText) {
                      nextPatch.gptSovitsPromptText =
                        DEFAULT_TTS_SERVICE.gptSovitsPromptText;
                    }
                  } else if (
                    nextProvider === 'openai-compatible' &&
                    ttsConfig.baseUrl.includes('9880')
                  ) {
                    nextPatch.baseUrl = 'http://127.0.0.1:8880/v1';
                  }
                  updateTtsConfig(nextPatch);
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
              >
                <option value="edge-tts">
                  Built-in Edge Neural TTS (0 VRAM · Auto-Fallback on 403)
                </option>
                <option value="google-tts">
                  Google Cloud Stream TTS (0 VRAM · Instant · No 403 Block)
                </option>
                <option value="windows-sapi">
                  Windows Native SAPI TTS (0 VRAM · 100% Offline WAV)
                </option>
                <option value="openai-compatible">
                  OpenAI-Compatible (/v1/audio/speech · Kokoro / Fish Speech)
                </option>
                <option value="gpt-sovits">
                  GPT-SoVITS Local Server (Zero-Shot Cloning · Port 9880)
                </option>
                <option value="browser">
                  Browser Web Speech API (Offline System Voices)
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Default Voice Preset
              </label>
              {ttsConfig.provider === 'edge-tts' ? (
                <select
                  value={ttsConfig.defaultVoiceId || 'auto'}
                  onChange={(e) =>
                    updateTtsConfig({ defaultVoiceId: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                >
                  <option value="auto">
                    Auto-Match Character Gender &amp; Language (Recommended)
                  </option>
                  {EDGE_TTS_VOICE_OPTIONS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              ) : ttsConfig.provider === 'openai-compatible' ? (
                <div className="flex gap-1.5">
                  <select
                    value={
                      KOKORO_OPENAI_VOICE_OPTIONS.some(
                        (v) => v.id === ttsConfig.defaultVoiceId
                      ) || ttsConfig.defaultVoiceId === 'auto'
                        ? ttsConfig.defaultVoiceId
                        : '__custom__'
                    }
                    onChange={(e) => {
                      if (e.target.value !== '__custom__') {
                        updateTtsConfig({ defaultVoiceId: e.target.value });
                      }
                    }}
                    className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200"
                  >
                    <option value="auto">Auto-Match Gender &amp; Language</option>
                    {KOKORO_OPENAI_VOICE_OPTIONS.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                    <option value="__custom__">Custom Voice ID...</option>
                  </select>
                  <BufferedField
                    value={ttsConfig.defaultVoiceId}
                    onCommit={(nextVal) =>
                      updateTtsConfig({ defaultVoiceId: nextVal })
                    }
                    placeholder="af_heart / zf_xiaoxiao"
                    className="w-28 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-slate-200 font-mono"
                  />
                </div>
              ) : ttsConfig.provider === 'gpt-sovits' ? (
                <div className="w-full bg-slate-950/70 border border-slate-800 rounded-lg px-3 py-2 text-xs text-cyan-300/90 truncate">
                  Cloned from Reference WAV below (ignores voice ID)
                </div>
              ) : (
                <BufferedField
                  value={ttsConfig.defaultVoiceId}
                  onCommit={(nextVal) =>
                    updateTtsConfig({ defaultVoiceId: nextVal })
                  }
                  placeholder="auto (or system voice name)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                />
              )}
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Role-Play Reading Mode
              </label>
              <select
                value={ttsConfig.readingMode}
                onChange={(e) =>
                  updateTtsConfig({
                    readingMode: e.target.value as TTSReadingMode,
                  })
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
              >
                <option value="dialogue_only">
                  Dialogue Only ("Spoken Quotes" — Skip *Actions* &amp; HUD)
                </option>
                <option value="full_text">
                  Full Narration + Spoken Dialogue
                </option>
              </select>
            </div>
          </div>

          {/* Provider-specific settings for OpenAI-Compatible or GPT-SoVITS */}
          {ttsConfig.provider === 'openai-compatible' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  TTS Server Base URL (/v1)
                </label>
                <BufferedField
                  value={ttsConfig.baseUrl}
                  onCommit={(nextVal) => updateTtsConfig({ baseUrl: nextVal })}
                  placeholder="http://127.0.0.1:8880/v1"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  TTS Model Name
                </label>
                <BufferedField
                  value={ttsConfig.model}
                  onCommit={(nextVal) => updateTtsConfig({ model: nextVal })}
                  placeholder="kokoro / tts-1 / fish-speech"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  API Key (Optional for local servers)
                </label>
                <BufferedField
                  type="password"
                  value={ttsConfig.apiKey || ''}
                  onCommit={(nextVal) => updateTtsConfig({ apiKey: nextVal })}
                  placeholder="Leave blank for local Kokoro/Fish"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                />
              </div>
            </div>
          )}

          {ttsConfig.provider === 'gpt-sovits' && (
            <div className="space-y-3 bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-800/70">
                <span className="text-[11px] text-slate-400">
                  Tip: When using your own custom <code className="text-cyan-300">.wav</code> file, either enter its <strong>exact spoken words</strong> in Transcript below or <strong>leave Transcript blank</strong> (Reference-Free Mode) to prevent gibberish.
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      updateTtsConfig({
                        gptSovitsRefAudioPath:
                          'I:\\GPT-SoVITS\\voices\\default_ref_zh.wav',
                        gptSovitsPromptText:
                          '你好，欢迎来到角色扮演工作室，今天你想聊些什么呢？',
                        gptSovitsPromptLang: 'zh',
                      })
                    }
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-cyan-300 transition"
                  >
                    Starter Chinese WAV
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateTtsConfig({
                        gptSovitsRefAudioPath:
                          'I:\\GPT-SoVITS\\voices\\default_ref_en.wav',
                        gptSovitsPromptText:
                          'Hello, welcome to RolePlay Studio. What kind of story would you like to explore today?',
                        gptSovitsPromptLang: 'en',
                      })
                    }
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-emerald-300 transition"
                  >
                    Starter English WAV
                  </button>
                  <button
                    type="button"
                    onClick={() => updateTtsConfig({ gptSovitsPromptText: '' })}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-amber-300 transition"
                  >
                    Clear Transcript (Reference-Free Mode)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    GPT-SoVITS Server URL (api_v2.py)
                  </label>
                  <BufferedField
                    value={ttsConfig.baseUrl}
                    onCommit={(nextVal) => updateTtsConfig({ baseUrl: nextVal })}
                    placeholder="http://127.0.0.1:9880"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Default Reference Audio Path (on Host PC)
                  </label>
                  <div className="flex gap-1.5">
                    <BufferedField
                      value={ttsConfig.gptSovitsRefAudioPath || ''}
                      onCommit={(nextPath) => {
                        const norm = nextPath.replace(/\//g, '\\').toLowerCase();
                        const patch: Partial<TTSServiceConfig> = {
                          gptSovitsRefAudioPath: nextPath,
                        };
                        const starterZh =
                          '你好，欢迎来到角色扮演工作室，今天你想聊些什么呢？';
                        const starterEn =
                          'Hello, welcome to RolePlay Studio. What kind of story would you like to explore today?';
                        if (
                          !norm.endsWith('default_ref_zh.wav') &&
                          !norm.endsWith('default_ref_en.wav') &&
                          (ttsConfig.gptSovitsPromptText === starterZh ||
                            ttsConfig.gptSovitsPromptText === starterEn)
                        ) {
                          patch.gptSovitsPromptText = '';
                        }
                        updateTtsConfig(patch);
                      }}
                      placeholder="I:\GPT-SoVITS\voices\default_ref_zh.wav"
                      className="flex-1 min-w-0 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
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
                            const savedPath = await uploadReferenceVoiceWav(file);
                            const starterZh =
                              '你好，欢迎来到角色扮演工作室，今天你想聊些什么呢？';
                            const starterEn =
                              'Hello, welcome to RolePlay Studio. What kind of story would you like to explore today?';
                            const currentPrompt =
                              ttsConfig.gptSovitsPromptText || '';
                            updateTtsConfig({
                              gptSovitsRefAudioPath: savedPath,
                              ...(currentPrompt === starterZh ||
                              currentPrompt === starterEn
                                ? { gptSovitsPromptText: '' }
                                : {}),
                            });
                          } catch (err: any) {
                            alert(
                              err?.message || 'Failed to upload reference WAV'
                            );
                          } finally {
                            e.target.value = '';
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Reference Audio Transcript (Optional — leave blank if unknown)
                  </label>
                  <BufferedField
                    value={ttsConfig.gptSovitsPromptText || ''}
                    onCommit={(nextVal) =>
                      updateTtsConfig({ gptSovitsPromptText: nextVal })
                    }
                    placeholder="Leave blank for Reference-Free cloning, or enter exact words spoken in WAV"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Reference Audio Language (prompt_lang)
                  </label>
                  <select
                    value={ttsConfig.gptSovitsPromptLang || 'zh'}
                    onChange={(e) => {
                      const nextLang = e.target.value;
                      const norm = (ttsConfig.gptSovitsRefAudioPath || '')
                        .replace(/\//g, '\\')
                        .toLowerCase();
                      const patch: Partial<TTSServiceConfig> = {
                        gptSovitsPromptLang: nextLang,
                      };
                      if (
                        nextLang === 'en' &&
                        norm.endsWith('default_ref_zh.wav')
                      ) {
                        patch.gptSovitsRefAudioPath =
                          'I:\\GPT-SoVITS\\voices\\default_ref_en.wav';
                        patch.gptSovitsPromptText =
                          'Hello, welcome to RolePlay Studio. What kind of story would you like to explore today?';
                      } else if (
                        nextLang === 'zh' &&
                        norm.endsWith('default_ref_en.wav')
                      ) {
                        patch.gptSovitsRefAudioPath =
                          'I:\\GPT-SoVITS\\voices\\default_ref_zh.wav';
                        patch.gptSovitsPromptText =
                          '你好，欢迎来到角色扮演工作室，今天你想聊些什么呢？';
                      }
                      updateTtsConfig(patch);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200"
                  >
                    <option value="zh">Chinese (zh)</option>
                    <option value="en">English (en)</option>
                    <option value="ja">Japanese (ja)</option>
                    <option value="ko">Korean (ko)</option>
                  </select>
                </div>
              </div>

              {/* GPT-SoVITS Sampling & Pause Controls */}
              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-cyan-300">
                    Voice Sampling &amp; Breathing / Stop Control
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      updateTtsConfig({
                        gptSovitsTopK: 5,
                        gptSovitsTopP: 0.85,
                        gptSovitsTemperature: 0.8,
                        gptSovitsRepetitionPenalty: 1.35,
                        gptSovitsFragmentInterval: 0.15,
                        gptSovitsTextSplitMethod: 'cut2',
                      })
                    }
                    className="text-[11px] text-slate-400 hover:text-cyan-300 transition"
                  >
                    Reset Smooth Defaults (cut2 + top_k=5)
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-2 sm:col-span-2">
                    <label className="block text-[11px] text-slate-300 mb-1">
                      Text Splitting Method (<code className="text-cyan-300">text_split_method</code>)
                    </label>
                    <select
                      value={ttsConfig.gptSovitsTextSplitMethod || 'cut2'}
                      onChange={(e) =>
                        updateTtsConfig({
                          gptSovitsTextSplitMethod: e.target.value as any,
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-200"
                    >
                      <option value="cut2">
                        cut2 — Smooth 50+ Char Chunks (Recommended · Fixes Comma Stops &amp; Breaths)
                      </option>
                      <option value="cut1">
                        cut1 — Group Every 4 Clauses (Longer Flow)
                      </option>
                      <option value="cut4">
                        cut4 — Split Only by English Period (.)
                      </option>
                      <option value="cut3">
                        cut3 — Split Only by Chinese Period (。)
                      </option>
                      <option value="cut0">
                        cut0 — No Split (Whole Message at Once)
                      </option>
                      <option value="cut5">
                        cut5 — Raw API Default (Splits Every Comma — Choppy)
                      </option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                  <div className="bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-2">
                    <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                      <span>top_k</span>
                      <span className="text-cyan-300 font-mono">
                        {ttsConfig.gptSovitsTopK ?? 5}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={30}
                      step={1}
                      value={ttsConfig.gptSovitsTopK ?? 5}
                      onChange={(e) =>
                        updateTtsConfig({
                          gptSovitsTopK: parseInt(e.target.value, 10),
                        })
                      }
                      className="w-full accent-cyan-500"
                    />
                  </div>
                  <div className="bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-2">
                    <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                      <span>top_p</span>
                      <span className="text-cyan-300 font-mono">
                        {(ttsConfig.gptSovitsTopP ?? 0.85).toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={1.0}
                      step={0.05}
                      value={ttsConfig.gptSovitsTopP ?? 0.85}
                      onChange={(e) =>
                        updateTtsConfig({
                          gptSovitsTopP: parseFloat(e.target.value),
                        })
                      }
                      className="w-full accent-cyan-500"
                    />
                  </div>
                  <div className="bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-2">
                    <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                      <span>temp</span>
                      <span className="text-cyan-300 font-mono">
                        {(ttsConfig.gptSovitsTemperature ?? 0.8).toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.3}
                      max={1.2}
                      step={0.05}
                      value={ttsConfig.gptSovitsTemperature ?? 0.8}
                      onChange={(e) =>
                        updateTtsConfig({
                          gptSovitsTemperature: parseFloat(e.target.value),
                        })
                      }
                      className="w-full accent-cyan-500"
                    />
                  </div>
                  <div className="bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-2">
                    <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                      <span>rep_pen</span>
                      <span className="text-cyan-300 font-mono">
                        {(ttsConfig.gptSovitsRepetitionPenalty ?? 1.35).toFixed(
                          2
                        )}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1.0}
                      max={1.8}
                      step={0.05}
                      value={ttsConfig.gptSovitsRepetitionPenalty ?? 1.35}
                      onChange={(e) =>
                        updateTtsConfig({
                          gptSovitsRepetitionPenalty: parseFloat(
                            e.target.value
                          ),
                        })
                      }
                      className="w-full accent-cyan-500"
                    />
                  </div>
                  <div className="bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-2 col-span-2 md:col-span-1">
                    <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                      <span>chunk gap</span>
                      <span className="text-cyan-300 font-mono">
                        {(ttsConfig.gptSovitsFragmentInterval ?? 0.15).toFixed(
                          2
                        )}
                        s
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={0.5}
                      step={0.05}
                      value={ttsConfig.gptSovitsFragmentInterval ?? 0.15}
                      onChange={(e) =>
                        updateTtsConfig({
                          gptSovitsFragmentInterval: parseFloat(e.target.value),
                        })
                      }
                      className="w-full accent-cyan-500"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-snug">
                  Lower <code className="text-slate-300">top_k</code> (3–5), <code className="text-slate-300">temp</code> (0.7–0.85), and <code className="text-slate-300">chunk gap</code> (0.10–0.15s) reduce stray breathing and awkward pauses vs the API&apos;s raw defaults (<code className="text-slate-400">top_k=15, temp=1.0, gap=0.30s</code>).
                </p>
              </div>
            </div>
          )}

          {/* Speed, Pitch & Caching Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div className="flex items-center gap-4 bg-slate-950/60 border border-slate-800/80 rounded-lg px-3.5 py-2.5">
              <div className="flex-1">
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>Speech Speed</span>
                  <span className="font-mono text-cyan-300">
                    {(ttsConfig.speed || 1.0).toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={0.6}
                  max={1.5}
                  step={0.05}
                  value={ttsConfig.speed || 1.0}
                  onChange={(e) =>
                    updateTtsConfig({ speed: parseFloat(e.target.value) })
                  }
                  className="w-full accent-cyan-500"
                />
              </div>

              <div className="flex-1">
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>Voice Pitch</span>
                  <span className="font-mono text-cyan-300">
                    {(ttsConfig.pitch || 0) >= 0
                      ? `+${ttsConfig.pitch || 0}Hz`
                      : `${ttsConfig.pitch || 0}Hz`}
                  </span>
                </div>
                <input
                  type="range"
                  min={-15}
                  max={15}
                  step={1}
                  value={ttsConfig.pitch || 0}
                  onChange={(e) =>
                    updateTtsConfig({ pitch: parseInt(e.target.value, 10) })
                  }
                  className="w-full accent-cyan-500"
                />
              </div>
            </div>

            <div className="flex flex-col justify-center gap-2 bg-slate-950/60 border border-slate-800/80 rounded-lg px-3.5 py-2.5">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ttsConfig.cacheAudio}
                  onChange={(e) =>
                    updateTtsConfig({ cacheAudio: e.target.checked })
                  }
                  className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                />
                <span>
                  Cache audio in <code className="text-cyan-300">data/audio/</code> (instant replay &amp; Tailscale phone streaming)
                </span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ttsConfig.multiVoiceNpc !== false}
                  onChange={(e) =>
                    updateTtsConfig({ multiVoiceNpc: e.target.checked })
                  }
                  className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                />
                <span>
                  Multi-Voice NPC Detection (auto-switch voice when secondary NPCs or other characters speak in a turn)
                </span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ttsConfig.autoPlay}
                  onChange={(e) =>
                    updateTtsConfig({ autoPlay: e.target.checked })
                  }
                  className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                />
                <span>
                  Auto-play new character replies automatically when streaming finishes
                </span>
              </label>
            </div>
          </div>

          {(ttsConfig.lastError || ttsSnapshot.error) && (
            <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
              {ttsSnapshot.error || ttsConfig.lastError}
            </p>
          )}
        </div>
      </div>

      {/* Workspace Backup, Export & Restore (TASK-022) */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
          <Database className="w-5 h-5 text-emerald-400" />
          Workspace Backup & Data Portability
        </h2>

        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-white text-sm">
              Full Local Database Snapshot
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Export or restore all Characters ({db.characters.length}), ComfyUI Workflows ({db.workflows.length}), Lorebooks ({db.lorebooks.length}), and Chat Histories ({db.chats.length}) as a single portable JSON file.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(db, null, 2)], {
                  type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `roleplay-studio-backup-${new Date()
                  .toISOString()
                  .slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
            >
              <Download className="w-3.5 h-3.5" />
              Export Backup
            </button>

            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition">
              <Upload className="w-3.5 h-3.5 text-indigo-400" />
              Restore Backup
              <input
                type="file"
                accept=".json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const parsed = JSON.parse(await file.text());
                    if (Array.isArray(parsed.characters) && Array.isArray(parsed.workflows)) {
                      onUpdateDb(() => ({ ...DEFAULT_DATABASE, ...parsed }));
                    }
                  } catch {
                    // ignore invalid file
                  }
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>

            <button
              onClick={() =>
                setConfirmAction({
                  title: 'Reset Workspace Defaults?',
                  message:
                    'Restore starter characters, ComfyUI workflows, lorebooks, and service settings? All custom characters, chats, and settings not exported will be overwritten.',
                  confirmLabel: 'Reset Defaults',
                  tone: 'warning',
                  onConfirm: () => onUpdateDb(() => DEFAULT_DATABASE),
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-950 hover:bg-rose-950/50 text-slate-400 hover:text-rose-300 border border-slate-800 text-xs transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Defaults
            </button>
          </div>
        </div>

        {/* Storage, Automatic Rolling Backups & Audio Cache Manager */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-white text-sm">
                Disk Protection, Rolling Backups &amp; Audio Cache Manager
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Database saves are atomic with automatic rolling snapshots in <code className="text-emerald-300">data/backups/</code>. New GPT-SoVITS WAV audio is auto-compressed to MP3 via ffmpeg (~90% smaller).
              </p>
            </div>
            <button
              onClick={() => void fetchStorageStats()}
              disabled={storageBusy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition self-start sm:self-auto"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${storageBusy ? 'animate-spin' : ''}`} />
              Refresh Stats
            </button>
          </div>

          {storageStats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-3">
                <div className="text-[11px] text-slate-400">Live Database</div>
                <div className="text-sm font-semibold text-white mt-0.5">
                  {formatBytes(storageStats.dbSizeBytes)}
                </div>
                <div className="text-[11px] text-emerald-400/90 mt-0.5">
                  {storageStats.backups.length} rolling backup{storageStats.backups.length === 1 ? '' : 's'}
                </div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-3">
                <div className="text-[11px] text-slate-400">Audio Cache</div>
                <div className="text-sm font-semibold text-white mt-0.5">
                  {formatBytes(storageStats.audio.bytes)}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {storageStats.audio.count} files · {storageStats.audio.wavCount} uncompressed WAV
                </div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-3">
                <div className="text-[11px] text-slate-400">Orphaned Audio</div>
                <div className="text-sm font-semibold text-amber-300 mt-0.5">
                  {formatBytes(storageStats.audio.orphanBytes)}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {storageStats.audio.orphanCount} unreferenced file{storageStats.audio.orphanCount === 1 ? '' : 's'}
                </div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-3">
                <div className="text-[11px] text-slate-400">Image Cache</div>
                <div className="text-sm font-semibold text-white mt-0.5">
                  {formatBytes(storageStats.images.bytes)}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {storageStats.images.count} files · {storageStats.images.orphanCount} orphaned
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => void runStorageCleanup('backup_now')}
              disabled={storageBusy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-medium transition"
            >
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              {storageBusy === 'backup_now' ? 'Saving Snapshot...' : 'Snapshot Backup Now'}
            </button>

            <button
              onClick={() =>
                setConfirmAction({
                  title: 'Compress Cached WAV Files to MP3?',
                  message: `Convert up to 120 uncompressed .wav files in data/audio/ to .mp3 (~90% smaller) and automatically update chat references in your database? Currently ${storageStats?.audio.wavCount || 0} WAV files (${formatBytes(storageStats?.audio.wavBytes || 0)}).`,
                  confirmLabel: 'Compress to MP3',
                  tone: 'warning',
                  onConfirm: () => void runStorageCleanup('compress_wavs', { batchSize: 120 }),
                })
              }
              disabled={storageBusy !== null || !storageStats || storageStats.audio.wavCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/90 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-semibold transition"
            >
              <Zap className="w-3.5 h-3.5" />
              {storageBusy === 'compress_wavs'
                ? 'Compressing WAV → MP3...'
                : `Compress WAV → MP3 (${storageStats?.audio.wavCount || 0})`}
            </button>

            <button
              onClick={() =>
                setConfirmAction({
                  title: 'Prune Orphaned Cached Media?',
                  message: `Delete ${storageStats?.audio.orphanCount || 0} orphaned audio files (${formatBytes(storageStats?.audio.orphanBytes || 0)}) and ${storageStats?.images.orphanCount || 0} orphaned images (${formatBytes(storageStats?.images.orphanBytes || 0)}) that are no longer referenced by any chat, character, or persona?`,
                  confirmLabel: 'Prune Orphans',
                  tone: 'warning',
                  onConfirm: () => void runStorageCleanup('prune_orphans', { includeImages: true }),
                })
              }
              disabled={
                storageBusy !== null ||
                !storageStats ||
                (storageStats.audio.orphanCount === 0 && storageStats.images.orphanCount === 0)
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 disabled:opacity-40 text-amber-200 text-xs font-medium transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {storageBusy === 'prune_orphans'
                ? 'Pruning...'
                : `Prune Orphans (${(storageStats?.audio.orphanCount || 0) + (storageStats?.images.orphanCount || 0)})`}
            </button>
          </div>

          {storageStats && storageStats.backups.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-slate-800/80">
              <span className="text-xs text-slate-400 shrink-0">Rolling Backup Restore:</span>
              <select
                value={selectedBackupName || storageStats.backups[0].name}
                onChange={(e) => setSelectedBackupName(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                {storageStats.backups.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name} ({formatBytes(b.sizeBytes)})
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const target = selectedBackupName || storageStats.backups[0].name;
                  setConfirmAction({
                    title: 'Restore Rolling Backup?',
                    message: `Replace the live database with ${target}? A safety snapshot of your current database will be saved first.`,
                    confirmLabel: 'Restore Snapshot',
                    tone: 'warning',
                    onConfirm: () => void runStorageCleanup('restore_backup', { filename: target }),
                  });
                }}
                disabled={storageBusy !== null}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-emerald-700/80 disabled:opacity-50 text-slate-200 hover:text-white text-xs font-medium transition shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {storageBusy === 'restore_backup' ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          )}

          {storageNote && (
            <p className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-900/50 rounded-lg px-3 py-2">
              {storageNote}
            </p>
          )}
        </div>
      </div>

      <ConfirmActionModal
        state={confirmAction}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
};
