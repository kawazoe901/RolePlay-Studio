import React, { useState } from 'react';
import {
  AppDatabase,
  ComfyNodeBinding,
  ComfyWorkflowProfile,
  WorkflowParameterRole,
  WorkflowPromptLengthPreset,
  WorkflowPromptStyle,
} from '../types';
import { WORKFLOW_PROMPT_LENGTH_PRESETS } from '../services/promptEngine';
import {
  aiAnalyzeComfyWorkflow,
  executeComfyWorkflow,
  fetchComfyModels,
  heuristicMapWorkflow,
  normalizeComfyWorkflowJson,
  summarizeComfyWorkflowGraph,
} from '../services/comfyService';
import {
  Workflow,
  Upload,
  Sparkles,
  Play,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Sliders,
  MessageSquareCode,
  Code2,
  RefreshCw,
} from 'lucide-react';
import { ConfirmActionModal, ConfirmActionState } from './ConfirmActionModal';
import { STARTER_WORKFLOW_TEMPLATES } from '../services/defaultData';
import { BufferedField } from './BufferedField';

interface Props {
  db: AppDatabase;
  onUpdateDb: (updater: (prev: AppDatabase) => AppDatabase) => void;
}

const ALL_ROLES: { role: WorkflowParameterRole; label: string; badge: string }[] = [
  { role: 'character_ref_image', label: 'Character Ref Image (LoadImage)', badge: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40' },
  { role: 'secondary_ref_image', label: '2nd Ref / Scene Image (LoadImage)', badge: 'bg-teal-500/15 text-teal-300 border-teal-500/30' },
  { role: 'positive_prompt', label: 'Prompt / Qwen Edit Instruction', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  { role: 'negative_prompt', label: 'Negative Prompt', badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  { role: 'seed', label: 'Seed / Noise Seed', badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  { role: 'guidance_or_denoise', label: 'Guidance / Edit Denoise', badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  { role: 'width', label: 'Latent Width', badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  { role: 'height', label: 'Latent Height', badge: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  { role: 'steps', label: 'Sampler Steps', badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  { role: 'cfg', label: 'CFG Scale', badge: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  { role: 'checkpoint', label: 'Model / UNET / Qwen / Moss', badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  { role: 'lora', label: 'LoRA Loader', badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  { role: 'output_image', label: 'Output Image Node', badge: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30' },
];

export const ComfyWorkflowStudioView: React.FC<Props> = ({ db, onUpdateDb }) => {
  const [selectedId, setSelectedId] = useState<string>(
    db.workflows[0]?.id || ''
  );
  const [aiInstruction, setAiInstruction] = useState<string>('');
  const [aiStatusText, setAiStatusText] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [uploadWarning, setUploadWarning] = useState<string>('');
  const [showRawJson, setShowRawJson] = useState<boolean>(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(
    null
  );
  const [comfyModels, setComfyModels] = useState<{
    checkpoints: string[];
    loras: string[];
  }>({ checkpoints: [], loras: [] });
  const [fetchingModels, setFetchingModels] = useState<boolean>(false);

  // Live Test Render State
  const [testPrompt, setTestPrompt] = useState<string>(
    'Keep the exact character identity, silver braided hair, and silver-rimmed glasses from the reference image. Place her inside a rain-lit clockwork observatory holding a glowing sapphire Star-Core relic, dramatic lighting.'
  );
  const [testRefCharId, setTestRefCharId] = useState<string>(
    db.characters[0]?.id || ''
  );
  const [isTestingRender, setIsTestingRender] = useState<boolean>(false);
  const [renderStatus, setRenderStatus] = useState<string>('');
  const [testResultImage, setTestResultImage] = useState<string>('');
  const [renderError, setRenderError] = useState<string>('');

  const activeWorkflow =
    db.workflows.find((w) => w.id === selectedId) || db.workflows[0];

  const helperLlm =
    db.llmServices.find((s) => s.id === db.activeHelperLlmId) ||
    db.llmServices[0];

  const nodeSummaries = activeWorkflow
    ? summarizeComfyWorkflowGraph(activeWorkflow.rawApiJson)
    : [];

  const updateActiveWorkflow = (
    updater: (wf: ComfyWorkflowProfile) => ComfyWorkflowProfile
  ) => {
    if (!activeWorkflow) return;
    onUpdateDb((prev) => ({
      ...prev,
      workflows: prev.workflows.map((w) =>
        w.id === activeWorkflow.id ? updater(w) : w
      ),
    }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadWarning('');
    try {
      const text = await file.text();
      const rawJson = JSON.parse(text);
      const normalized = normalizeComfyWorkflowJson(rawJson);
      if (normalized.warning) {
        setUploadWarning(normalized.warning);
      }

      const initialBindings = heuristicMapWorkflow(normalized.apiJson);
      const newWf: ComfyWorkflowProfile = {
        id: `wf-${Date.now()}`,
        name: file.name.replace(/\.json$/i, ''),
        description: `Imported from ${file.name} (${Object.keys(normalized.apiJson).length} nodes)`,
        promptStyle: 'tags',
        rawApiJson: normalized.apiJson,
        bindings: initialBindings,
        defaultNegativePrompt:
          'lowres, bad anatomy, bad hands, worst quality, low quality, blurry',
        defaultWidth: 832,
        defaultHeight: 1216,
        createdAt: new Date().toISOString(),
      };

      onUpdateDb((prev) => ({
        ...prev,
        workflows: [newWf, ...prev.workflows],
        comfyService: {
          ...prev.comfyService,
          defaultWorkflowId: newWf.id,
        },
      }));
      setSelectedId(newWf.id);
      setAiStatusText(
        `Imported "${newWf.name}" and auto-detected ${initialBindings.length} node bindings via graph analysis. You can refine with AI below!`
      );
    } catch (err: any) {
      setUploadWarning(
        `Failed to parse workflow JSON: ${err?.message || 'Invalid JSON'}`
      );
    }
    e.target.value = '';
  };

  const handleRunAiMapper = async () => {
    if (!activeWorkflow) return;
    setIsAnalyzing(true);
    setAiStatusText('AI Assistant is inspecting workflow nodes and connections...');
    try {
      const res = await aiAnalyzeComfyWorkflow(
        activeWorkflow.rawApiJson,
        helperLlm,
        aiInstruction.trim() || undefined
      );
      updateActiveWorkflow((wf) => ({
        ...wf,
        bindings: res.bindings,
        promptStyle: res.detectedStyle,
      }));
      setAiStatusText(res.aiSummary);
      setAiInstruction('');
    } catch (err: any) {
      setAiStatusText(`Analysis note: ${err?.message || 'Completed with heuristics'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleManualBindingChange = (
    role: WorkflowParameterRole,
    nodeId: string,
    inputKey: string
  ) => {
    if (!activeWorkflow) return;
    const targetNode = nodeSummaries.find((n) => n.nodeId === nodeId);
    if (!targetNode) {
      // Remove binding if cleared
      updateActiveWorkflow((wf) => ({
        ...wf,
        bindings: wf.bindings.filter((b) => b.role !== role),
      }));
      return;
    }

    const validKey =
      inputKey ||
      Object.keys(targetNode.primitiveInputs)[0] ||
      (role === 'output_image' ? 'images' : 'text');

    const newBinding: ComfyNodeBinding = {
      role,
      nodeId: targetNode.nodeId,
      nodeTitle: targetNode.title,
      classType: targetNode.classType,
      inputKey: validKey,
      currentValue: targetNode.primitiveInputs[validKey] as
        | string
        | number
        | undefined,
      confidence: 'manual',
      reasoning: 'Manually selected by user',
    };

    updateActiveWorkflow((wf) => {
      const others = wf.bindings.filter((b) => b.role !== role);
      return { ...wf, bindings: [...others, newBinding] };
    });
  };

  const handleTestRender = async () => {
    if (!activeWorkflow) return;
    setIsTestingRender(true);
    setRenderError('');
    setRenderStatus('Sending workflow to ComfyUI...');
    const testChar =
      db.characters.find((c) => c.id === testRefCharId) || db.characters[0];
    try {
      const result = await executeComfyWorkflow(
        db.comfyService,
        activeWorkflow,
        {
          positivePrompt: testPrompt,
          negativePrompt: activeWorkflow.defaultNegativePrompt,
          characterReferenceImageUrl:
            testChar?.referenceImageUrl || testChar?.avatarUrl,
          width: activeWorkflow.defaultWidth,
          height: activeWorkflow.defaultHeight,
          activeLlmService: helperLlm,
          onProgress: (msg) => setRenderStatus(msg),
        }
      );
      setTestResultImage(result.imageUrl);
      setRenderStatus(
        `Completed! Seed: ${result.seed}${
          result.referenceUsed ? ' (Character Ref Image Uploaded ✓)' : ''
        }`
      );
    } catch (err: any) {
      setRenderError(
        err?.message ||
          'Could not execute workflow. Make sure ComfyUI is running at ' +
            db.comfyService.baseUrl
      );
    } finally {
      setIsTestingRender(false);
    }
  };

  return (
    <div className="p-3 sm:p-6 max-w-7xl w-full mx-auto space-y-5 sm:space-y-6 overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 border-b border-slate-800 pb-4 sm:pb-5">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2.5">
            <Workflow className="w-5 h-5 sm:w-6 sm:h-6 text-fuchsia-400 shrink-0" />
            <span>AI-Assisted ComfyUI Workflow Linker</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Import your own ComfyUI workflow JSON. Our hybrid Graph Tracer + Local LLM Assistant automatically links your prompt, seed, resolution, and output nodes.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-sm font-medium transition shadow-lg shadow-fuchsia-950/50">
            <Upload className="w-4 h-4" />
            Import ComfyUI JSON
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {uploadWarning && (
        <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-xl p-3.5 text-xs">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{uploadWarning}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6">
        {/* Left Sidebar: Saved Workflows */}
        <div className="lg:col-span-3 space-y-3 min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-1">
            Workflow Profiles ({db.workflows.length})
          </h2>
          <div className="space-y-2">
            {db.workflows.map((wf) => {
              const isSelected = wf.id === activeWorkflow?.id;
              const isDefault = db.comfyService.defaultWorkflowId === wf.id;
              return (
                <div
                  key={wf.id}
                  onClick={() => setSelectedId(wf.id)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition ${
                    isSelected
                      ? 'bg-slate-900 border-fuchsia-500/60 shadow-md'
                      : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-sm text-white leading-snug">
                      {wf.name}
                    </h3>
                    {db.workflows.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmAction({
                            title: `Delete workflow "${wf.name}"?`,
                            message:
                              'Remove this ComfyUI workflow profile and its node bindings? Characters referencing it will fall back to the default workflow.',
                            confirmLabel: 'Delete Workflow',
                            onConfirm: () => {
                              onUpdateDb((prev) => {
                                const remaining = prev.workflows.filter(
                                  (w) => w.id !== wf.id
                                );
                                if (selectedId === wf.id) {
                                  setSelectedId(remaining[0]?.id || '');
                                }
                                const isStarter = STARTER_WORKFLOW_TEMPLATES.some(
                                  (tpl) => tpl.id === wf.id
                                );
                                const nextDismissed = isStarter
                                  ? Array.from(
                                      new Set([
                                        ...(prev.dismissedStarterWorkflowIds || []),
                                        wf.id,
                                      ])
                                    )
                                  : prev.dismissedStarterWorkflowIds;
                                return {
                                  ...prev,
                                  workflows: remaining,
                                  ...(nextDismissed
                                    ? { dismissedStarterWorkflowIds: nextDismissed }
                                    : {}),
                                  characters: prev.characters.map((c) =>
                                    c.preferredWorkflowId === wf.id
                                      ? { ...c, preferredWorkflowId: undefined }
                                      : c
                                  ),
                                  comfyService: {
                                    ...prev.comfyService,
                                    defaultWorkflowId:
                                      prev.comfyService.defaultWorkflowId === wf.id
                                        ? remaining[0]?.id || ''
                                        : prev.comfyService.defaultWorkflowId,
                                  },
                                };
                              });
                            },
                          });
                        }}
                        title="Delete workflow"
                        className="text-slate-500 hover:text-rose-400 p-0.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                    {wf.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-2.5">
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {wf.bindings.length} mapped nodes
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300">
                      {wf.promptStyle === 'edit_instruction'
                        ? 'Qwen-2.1-Edit / Consistency'
                        : wf.promptStyle === 'moss_bbox'
                        ? 'MOSS Bounding Box JSON'
                        : wf.promptStyle === 'anima_xl'
                        ? 'Anima XL Hybrid'
                        : wf.promptStyle === 'natural'
                        ? 'Moss / Flux Natural'
                        : wf.promptStyle === 'sdxl_natural'
                        ? 'SDXL / Natural'
                        : wf.promptStyle === 'sdxl_hybrid'
                        ? 'SDXL / Hybrid'
                        : 'SDXL / Tags'}
                    </span>
                    {wf.promptLengthPreset &&
                      wf.promptLengthPreset !== 'balanced' && (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 capitalize">
                          {wf.promptLengthPreset}
                        </span>
                      )}
                    {isDefault && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                        Default
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main Studio Area */}
        {activeWorkflow && (
          <div className="lg:col-span-9 space-y-5 sm:space-y-6 min-w-0">
            {/* Workflow Metadata & AI Assistant Bar */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 sm:p-5 space-y-4 min-w-0 overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <BufferedField
                    value={activeWorkflow.name}
                    onCommit={(nextVal) =>
                      updateActiveWorkflow((wf) => ({
                        ...wf,
                        name: nextVal,
                      }))
                    }
                    className="text-base sm:text-lg font-bold text-white bg-transparent border-b border-transparent hover:border-slate-700 focus:border-fuchsia-500 focus:outline-none w-full min-w-0"
                  />
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-400">
                    <span>
                      Total Graph Nodes: <strong className="text-slate-200">{nodeSummaries.length}</strong>
                    </span>
                    <span className="hidden sm:inline">•</span>
                    <label className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto min-w-0">
                      <span className="shrink-0">Prompt Style:</span>
                      <select
                        value={activeWorkflow.promptStyle}
                        onChange={(e) =>
                          updateActiveWorkflow((wf) => ({
                            ...wf,
                            promptStyle: e.target.value as WorkflowPromptStyle,
                          }))
                        }
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 max-w-full w-full sm:w-auto min-w-0 truncate"
                      >
                        <option value="edit_instruction">
                          Qwen-Image-2.1-Edit / Kontext (Character Reference + Scene Edit Instruction)
                        </option>
                        <option value="moss_bbox">
                          MOSS-Image — Spatial Bounding Box Layout JSON (abs_centralized yxyx)
                        </option>
                        <option value="anima_xl">
                          Anima XL — Hybrid Anime Tags + Natural Language (Qwen3-0.6B)
                        </option>
                        <option value="natural">
                          Moss / Flux.1 / SD3.5 (Natural Language Scene Prose)
                        </option>
                        <option value="sdxl_natural">
                          SDXL — Natural Language Scene Prose (CLIP-G)
                        </option>
                        <option value="sdxl_hybrid">
                          SDXL / Illustrious — Core Tags + Natural Language (Hybrid)
                        </option>
                        <option value="tags">
                          SDXL / Illustrious / Pony (Danbooru Tags)
                        </option>
                      </select>
                    </label>
                    <label className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto min-w-0">
                      <span className="shrink-0">Prompt Detail:</span>
                      <select
                        value={activeWorkflow.promptLengthPreset || 'balanced'}
                        onChange={(e) =>
                          updateActiveWorkflow((wf) => ({
                            ...wf,
                            promptLengthPreset: e.target
                              .value as WorkflowPromptLengthPreset,
                          }))
                        }
                        title={
                          WORKFLOW_PROMPT_LENGTH_PRESETS.find(
                            (p) =>
                              p.id ===
                              (activeWorkflow.promptLengthPreset || 'balanced')
                          )?.description
                        }
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 max-w-full w-full sm:w-auto min-w-0"
                      >
                        {WORKFLOW_PROMPT_LENGTH_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={() =>
                      onUpdateDb((prev) => ({
                        ...prev,
                        comfyService: {
                          ...prev.comfyService,
                          defaultWorkflowId: activeWorkflow.id,
                        },
                      }))
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                      db.comfyService.defaultWorkflowId === activeWorkflow.id
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {db.comfyService.defaultWorkflowId === activeWorkflow.id
                      ? '✓ Active Default Workflow'
                      : 'Set as Default'}
                  </button>
                  <button
                    onClick={() => setShowRawJson(!showRawJson)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    {showRawJson ? 'Hide Graph JSON' : 'Inspect JSON'}
                  </button>
                </div>
              </div>

              {/* Conversational AI Workflow Linker Box */}
              <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    AI Workflow Linker Assistant ({helperLlm?.name || 'Heuristic Engine'})
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <MessageSquareCode className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={aiInstruction}
                      onChange={(e) => setAiInstruction(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleRunAiMapper()}
                      placeholder="Optional instruction to AI (e.g. 'Use node 6 for positive prompt and node 12 for LoRA')..."
                      className="w-full bg-slate-950/90 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-400"
                    />
                  </div>
                  <button
                    onClick={handleRunAiMapper}
                    disabled={isAnalyzing}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition disabled:opacity-50 shrink-0"
                  >
                    <Sparkles
                      className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`}
                    />
                    {isAnalyzing
                      ? 'Analyzing Graph...'
                      : aiInstruction.trim()
                      ? 'Apply AI Remap'
                      : 'AI Auto-Detect Nodes'}
                  </button>
                </div>

                {aiStatusText && (
                  <p className="text-xs text-indigo-200 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    {aiStatusText}
                  </p>
                )}
              </div>

              {showRawJson && (
                <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] text-slate-300 font-mono max-h-64 max-w-full overflow-auto">
                  {JSON.stringify(activeWorkflow.rawApiJson, null, 2)}
                </pre>
              )}
            </div>

            {/* Parameter Node Bindings Table */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 sm:p-5 space-y-4 min-w-0 overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h3 className="font-semibold text-white flex items-center gap-2 text-sm">
                  <Sliders className="w-4 h-4 text-fuchsia-400" />
                  Linked Workflow Parameters
                </h3>
                <button
                  onClick={async () => {
                    setFetchingModels(true);
                    const res = await fetchComfyModels(db.comfyService);
                    setComfyModels(res);
                    setFetchingModels(false);
                  }}
                  disabled={fetchingModels}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      fetchingModels ? 'animate-spin text-fuchsia-400' : ''
                    }`}
                  />
                  Fetch ComfyUI Checkpoints & LoRAs (
                  {comfyModels.checkpoints.length + comfyModels.loras.length})
                </button>
              </div>

              <div className="space-y-2.5">
                {ALL_ROLES.map(({ role, label, badge }) => {
                  const existing = activeWorkflow.bindings.find(
                    (b) => b.role === role
                  );
                  const selectedNode = nodeSummaries.find(
                    (n) => n.nodeId === existing?.nodeId
                  );
                  const availableKeys = selectedNode
                    ? role === 'output_image'
                      ? ['images', ...Object.keys(selectedNode.primitiveInputs)]
                      : Object.keys(selectedNode.primitiveInputs)
                    : [];

                  return (
                    <div
                      key={role}
                      className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-slate-950/70 border border-slate-800/90 rounded-lg p-3"
                    >
                      <div className="md:col-span-3 flex items-center gap-2">
                        <span
                          className={`text-xs font-medium px-2.5 py-1 rounded border ${badge}`}
                        >
                          {label}
                        </span>
                      </div>

                      {/* Target Node Selector */}
                      <div className="md:col-span-4">
                        <select
                          value={existing?.nodeId || ''}
                          onChange={(e) =>
                            handleManualBindingChange(role, e.target.value, '')
                          }
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                        >
                          <option value="">— Not Linked —</option>
                          {nodeSummaries.map((n) => (
                            <option key={n.nodeId} value={n.nodeId}>
                              #{n.nodeId} — {n.title} ({n.classType})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Target Input Key Selector */}
                      <div className="md:col-span-2">
                        {existing && (
                          <select
                            value={existing.inputKey}
                            onChange={(e) =>
                              handleManualBindingChange(
                                role,
                                existing.nodeId,
                                e.target.value
                              )
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono"
                          >
                            {availableKeys.map((k) => (
                              <option key={k} value={k}>
                                .{k}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Current Value / AI Reasoning */}
                      <div className="md:col-span-3 text-xs text-slate-400 break-words sm:truncate min-w-0">
                        {existing ? (
                          role === 'checkpoint' &&
                          comfyModels.checkpoints.length > 0 ? (
                            <select
                              value={String(existing.currentValue || '')}
                              onChange={(e) => {
                                const val = e.target.value;
                                updateActiveWorkflow((wf) => {
                                  const nextJson = JSON.parse(
                                    JSON.stringify(wf.rawApiJson)
                                  );
                                  if (nextJson[existing.nodeId]?.inputs) {
                                    nextJson[existing.nodeId].inputs[
                                      existing.inputKey
                                    ] = val;
                                  }
                                  return {
                                    ...wf,
                                    rawApiJson: nextJson,
                                    bindings: wf.bindings.map((b) =>
                                      b.role === role
                                        ? { ...b, currentValue: val }
                                        : b
                                    ),
                                  };
                                });
                              }}
                              className="w-full bg-slate-900 border border-purple-500/40 rounded px-2 py-1 text-xs text-purple-200"
                            >
                              {comfyModels.checkpoints.map((ck) => (
                                <option key={ck} value={ck}>
                                  {ck}
                                </option>
                              ))}
                            </select>
                          ) : role === 'lora' &&
                            comfyModels.loras.length > 0 ? (
                            <select
                              value={String(existing.currentValue || '')}
                              onChange={(e) => {
                                const val = e.target.value;
                                updateActiveWorkflow((wf) => {
                                  const nextJson = JSON.parse(
                                    JSON.stringify(wf.rawApiJson)
                                  );
                                  if (nextJson[existing.nodeId]?.inputs) {
                                    nextJson[existing.nodeId].inputs[
                                      existing.inputKey
                                    ] = val;
                                  }
                                  return {
                                    ...wf,
                                    rawApiJson: nextJson,
                                    bindings: wf.bindings.map((b) =>
                                      b.role === role
                                        ? { ...b, currentValue: val }
                                        : b
                                    ),
                                  };
                                });
                              }}
                              className="w-full bg-slate-900 border border-purple-500/40 rounded px-2 py-1 text-xs text-purple-200"
                            >
                              {comfyModels.loras.map((lr) => (
                                <option key={lr} value={lr}>
                                  {lr}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span title={existing.reasoning}>
                              {existing.currentValue !== undefined ? (
                                <code className="text-slate-300 bg-slate-900 px-1.5 py-0.5 rounded">
                                  {String(existing.currentValue).slice(0, 38)}
                                </code>
                              ) : (
                                existing.reasoning
                              )}
                            </span>
                          )
                        ) : (
                          <span className="text-slate-600 italic">
                            Optional / Unbound
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live Workflow Test Sandbox */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 sm:p-5 space-y-4 min-w-0 overflow-hidden">
              <h3 className="font-semibold text-white flex items-center gap-2 text-sm">
                <Play className="w-4 h-4 text-emerald-400" />
                Test Linked Workflow in ComfyUI
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-8 space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Character Reference Image to Upload (for Qwen-Image-2.1-Edit / Moss / IPAdapter `LoadImage` node)
                    </label>
                    <select
                      value={testRefCharId}
                      onChange={(e) => setTestRefCharId(e.target.value)}
                      className="w-full bg-slate-950 border border-cyan-500/40 rounded-lg px-3 py-1.5 text-xs text-cyan-200 mb-2"
                    >
                      {db.characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          Use Character Reference: {c.name}{' '}
                          {c.referenceImageUrl ? '(Custom Ref Sheet)' : '(Avatar)'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Test Positive Prompt / Qwen-Image-2.1-Edit Instruction
                    </label>
                    <textarea
                      rows={2}
                      value={testPrompt}
                      onChange={(e) => setTestPrompt(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label className="block text-xs text-slate-400">
                        Default Negative Prompt
                      </label>
                      {activeWorkflow.promptStyle === 'anima_xl' && (
                        <button
                          type="button"
                          onClick={() =>
                            updateActiveWorkflow((wf) => ({
                              ...wf,
                              defaultNegativePrompt:
                                'worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration',
                            }))
                          }
                          className="text-[11px] text-indigo-300 hover:text-indigo-200 underline"
                        >
                          Use Compact Anima Negative
                        </button>
                      )}
                    </div>
                    <BufferedField
                      value={activeWorkflow.defaultNegativePrompt}
                      onCommit={(nextVal) =>
                        updateActiveWorkflow((wf) => ({
                          ...wf,
                          defaultNegativePrompt: nextVal,
                        }))
                      }
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300"
                    />
                    {activeWorkflow.promptStyle === 'anima_xl' && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        Anima Guidebook tip: keep negative prompts minimal (avoid bloated SDXL walls) and prefix any custom artist tags with <code className="text-slate-300">@</code>. *(For Anima-Aesthetic variants, score tags can be omitted.)*
                      </p>
                    )}
                    {(activeWorkflow.promptStyle === 'sdxl_natural' ||
                      activeWorkflow.promptStyle === 'sdxl_hybrid') && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        SDXL tip: {activeWorkflow.promptStyle === 'sdxl_natural' ? 'Natural prose (40–65 words) works best for SDXL base, Juggernaut XL, RealVisXL, and modern realistic/semi-realistic fine-tunes.' : 'Hybrid mode pairs 8–12 concise Danbooru anchor tags with 1–2 sentences of natural scene prose—ideal for Illustrious, NoobAI, and WAI-Illustrious SDXL.'}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <button
                      onClick={handleTestRender}
                      disabled={isTestingRender}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {isTestingRender
                        ? 'Rendering in ComfyUI...'
                        : 'Queue Test Render'}
                    </button>
                    {renderStatus && (
                      <span className="text-xs text-slate-300">
                        {renderStatus}
                      </span>
                    )}
                  </div>

                  {renderError && (
                    <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg p-2.5">
                      {renderError}
                    </p>
                  )}
                </div>

                <div className="md:col-span-4 flex items-center justify-center bg-slate-950 border border-slate-800 rounded-xl min-h-[180px] overflow-hidden">
                  {testResultImage ? (
                    <img
                      src={testResultImage}
                      alt="ComfyUI Test Output"
                      className="max-h-60 w-auto object-contain rounded"
                    />
                  ) : (
                    <span className="text-xs text-slate-500 text-center px-4">
                      Test output image from ComfyUI will appear here
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmActionModal
        state={confirmAction}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
};
