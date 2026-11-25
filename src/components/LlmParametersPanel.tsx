import React, { useState } from 'react';
import { LLMServiceConfig } from '../types';
import { HelpCircle, RotateCcw } from 'lucide-react';
import { ConfirmActionModal, ConfirmActionState } from './ConfirmActionModal';

interface Props {
  service: LLMServiceConfig;
  onChange: (patch: Partial<LLMServiceConfig>) => void;
}

interface SliderRowProps {
  label: string;
  tooltip: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange: (val: number) => void;
}

const ParameterSliderRow: React.FC<SliderRowProps> = ({
  label,
  tooltip,
  value,
  min,
  max,
  step,
  defaultValue,
  onChange,
}) => {
  const defaultPercent = Math.min(
    100,
    Math.max(0, ((defaultValue - min) / (max - min)) * 100)
  );

  return (
    <div className="grid grid-cols-12 items-center gap-x-2 gap-y-1.5 sm:gap-3 py-1.5">
      {/* Label + Tooltip Icon */}
      <div className="col-span-8 sm:col-span-4 flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-100 min-w-0">
        <span className="truncate">{label}</span>
        <span
          title={tooltip}
          className="text-slate-400 hover:text-slate-200 cursor-help shrink-0"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </span>
      </div>

      {/* Numeric Box (right of label on mobile, 3rd column on desktop) */}
      <div className="col-span-4 sm:col-span-2 sm:order-3">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            if (!Number.isNaN(parsed)) {
              onChange(parsed);
            }
          }}
          className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-2 sm:px-2.5 py-1 sm:py-1.5 text-xs sm:text-sm text-slate-100 font-medium focus:outline-none text-right sm:text-left"
        />
      </div>

      {/* Slider with "Default" marker underneath */}
      <div className="col-span-12 sm:col-span-6 sm:order-2 relative pb-4">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-400"
        />
        <button
          type="button"
          onClick={() => onChange(defaultValue)}
          style={{ left: `${defaultPercent}%` }}
          title={`Click to reset ${label} to default (${defaultValue})`}
          className="absolute bottom-0 -translate-x-1/2 text-[10px] text-slate-500 hover:text-indigo-300 transition cursor-pointer select-none whitespace-nowrap"
        >
          Default
        </button>
      </div>
    </div>
  );
};

export const LlmParametersPanel: React.FC<Props> = ({ service, onChange }) => {
  const mode = service.parameterMode || 'preset';
  const temperature = service.temperature ?? 0.8;
  const repetitionPenalty = service.repetitionPenalty ?? 1.1;
  const topP = service.topP ?? 0.9;
  const topK = service.topK ?? 30;
  const maxTokens = service.maxTokens ?? 1024;
  const isAutoContext = service.contextSizeAuto ?? true;
  const contextSelectValue = isAutoContext
    ? 'auto'
    : String(service.contextLength || 8192);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(
    null
  );

  const applyPreset = (
    preset: 'default' | 'creative' | 'focused' | 'narrative'
  ) => {
    if (preset === 'default') {
      onChange({
        presetName: 'default',
        temperature: 0.8,
        repetitionPenalty: 1.1,
        topP: 0.9,
        topK: 30,
        maxTokens: 1024,
        contextSizeAuto: true,
      });
    } else if (preset === 'creative') {
      onChange({
        presetName: 'creative',
        temperature: 1.05,
        repetitionPenalty: 1.15,
        topP: 0.95,
        topK: 50,
        maxTokens: 1536,
      });
    } else if (preset === 'focused') {
      onChange({
        presetName: 'focused',
        temperature: 0.65,
        repetitionPenalty: 1.08,
        topP: 0.85,
        topK: 20,
        maxTokens: 1024,
      });
    } else if (preset === 'narrative') {
      onChange({
        presetName: 'narrative',
        temperature: 0.88,
        repetitionPenalty: 1.12,
        topP: 0.92,
        topK: 40,
        maxTokens: 2048,
      });
    }
  };

  return (
    <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 sm:p-4 space-y-4">
      {/* Top Segmented Tabs: Preset Parameters | Custom Parameters */}
      <div className="grid grid-cols-2 rounded-xl bg-slate-900/90 p-1 border border-slate-800">
        <button
          type="button"
          onClick={() => onChange({ parameterMode: 'preset' })}
          className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-semibold transition border ${
            mode === 'preset'
              ? 'bg-slate-950 text-white border-sky-500/80 shadow-sm'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          Preset Parameters
        </button>
        <button
          type="button"
          onClick={() => onChange({ parameterMode: 'custom' })}
          className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-semibold transition border ${
            mode === 'custom'
              ? 'bg-slate-950 text-white border-sky-500/80 shadow-sm'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          Custom Parameters
        </button>
      </div>

      {/* Quick Role-Play Preset Selector Pills when in Preset Mode */}
      {mode === 'preset' && (
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-800/80">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'default', label: 'Default (Balanced)' },
                { id: 'creative', label: 'Creative & Expressive' },
                { id: 'focused', label: 'Focused In-Character' },
                { id: 'narrative', label: 'Long Story (2048 tok)' },
              ] as const
            ).map((p) => {
              const active = (service.presetName || 'default') === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() =>
              setConfirmAction({
                title: 'Reset LLM Parameter Sliders?',
                message:
                  'Reset Temperature, Repetition Penalty, Top-P, Top-K, Max Tokens, and Context Size back to the Default preset?',
                confirmLabel: 'Reset Defaults',
                tone: 'warning',
                onConfirm: () => applyPreset('default'),
              })
            }
            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
            title="Reset all sliders to Default"
          >
            <RotateCcw className="w-3 h-3" />
            Reset Defaults
          </button>
        </div>
      )}

      {/* Core Sampling Sliders (Matches Screenshot) */}
      <div className="space-y-1">
        <ParameterSliderRow
          label="Temperature"
          tooltip="Controls randomness and creativity. Higher values (0.9–1.2) make responses more imaginative; lower values (0.5–0.7) make replies more predictable."
          value={temperature}
          min={0.1}
          max={1.6}
          step={0.05}
          defaultValue={0.8}
          onChange={(val) => onChange({ temperature: val })}
        />

        <ParameterSliderRow
          label="Repetition Penalty"
          tooltip="Penalizes repeated words and phrases so the character doesn't loop or repeat the same actions. Default is 1.1."
          value={repetitionPenalty}
          min={1.0}
          max={1.5}
          step={0.02}
          defaultValue={1.1}
          onChange={(val) => onChange({ repetitionPenalty: val })}
        />

        <ParameterSliderRow
          label="Top P"
          tooltip="Nucleus sampling threshold. Limits token choices to the top P cumulative probability mass. Default is 0.9."
          value={topP}
          min={0.1}
          max={1.0}
          step={0.05}
          defaultValue={0.9}
          onChange={(val) => onChange({ topP: val })}
        />

        <ParameterSliderRow
          label="Top K"
          tooltip="Limits sampling at each step to the top K most likely tokens. Default is 30."
          value={topK}
          min={1}
          max={100}
          step={1}
          defaultValue={30}
          onChange={(val) => onChange({ topK: Math.round(val) })}
        />

        <ParameterSliderRow
          label="Max Response Tokens"
          tooltip="Maximum number of tokens the AI can generate in a single reply. Default is 1024."
          value={maxTokens}
          min={128}
          max={4096}
          step={64}
          defaultValue={1024}
          onChange={(val) => onChange({ maxTokens: Math.round(val) })}
        />

        {/* Local LLM Context Size Dropdown */}
        <div className="grid grid-cols-12 items-center gap-2 sm:gap-3 pt-2">
          <div className="col-span-12 sm:col-span-4 flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-100">
            <span>Local LLM Context Size</span>
            <span
              title="Controls how much conversation history and lore is kept in context (num_ctx). Set to Auto to let Ollama/LM Studio manage context automatically."
              className="text-slate-400 hover:text-slate-200 cursor-help shrink-0"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="col-span-12 sm:col-span-8">
            <select
              value={contextSelectValue}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'auto') {
                  onChange({ contextSizeAuto: true });
                } else {
                  onChange({
                    contextSizeAuto: false,
                    contextLength: parseInt(val, 10) || 8192,
                  });
                }
              }}
              className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs sm:text-sm text-slate-100 font-semibold focus:outline-none"
            >
              <option value="auto">Auto</option>
              <option value="2048">2048 tokens (Low VRAM)</option>
              <option value="4096">4096 tokens (4K Standard)</option>
              <option value="8192">8192 tokens (8K Recommended)</option>
              <option value="16384">16384 tokens (16K Extended Story)</option>
              <option value="32768">32768 tokens (32K Deep Lore)</option>
              <option value="65536">65536 tokens (64K Ultra Context)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Extra Advanced Controls shown in "Custom Parameters" Tab */}
      {mode === 'custom' && (
        <div className="pt-3 border-t border-slate-800/90 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-400 mb-2">
            Advanced Custom Sampler Controls
          </p>

          <ParameterSliderRow
            label="Min P"
            tooltip="Minimum probability scaled relative to the most likely token. Helps keep high-temperature role-play coherent."
            value={service.minP ?? 0.05}
            min={0.0}
            max={0.5}
            step={0.01}
            defaultValue={0.05}
            onChange={(val) => onChange({ minP: val })}
          />

          <ParameterSliderRow
            label="Presence Penalty"
            tooltip="Encourages the model to introduce new topics and scene details rather than dwelling on the same subject."
            value={service.presencePenalty ?? 0.0}
            min={0.0}
            max={1.5}
            step={0.05}
            defaultValue={0.0}
            onChange={(val) => onChange({ presencePenalty: val })}
          />

          <ParameterSliderRow
            label="Frequency Penalty"
            tooltip="Reduces verbatim word repetition based on how frequently a token has appeared so far."
            value={service.frequencyPenalty ?? 0.0}
            min={0.0}
            max={1.5}
            step={0.05}
            defaultValue={0.0}
            onChange={(val) => onChange({ frequencyPenalty: val })}
          />

          <div className="flex items-center justify-between gap-3 pt-2 text-xs text-slate-300">
            <div className="min-w-0">
              <span className="font-semibold text-slate-200">
                Reasoning / Chain-of-Thought (<code>&lt;think&gt;</code>)
              </span>
              <p className="text-[11px] text-slate-500">
                Keep Off for Qwen3 / DeepSeek role-play so tokens go directly into dialogue instead of internal thinking.
              </p>
            </div>
            <input
              type="checkbox"
              checked={Boolean(service.enableThinking)}
              onChange={(e) => onChange({ enableThinking: e.target.checked })}
              className="w-4 h-4 accent-indigo-500 shrink-0"
            />
          </div>
        </div>
      )}

      <ConfirmActionModal
        state={confirmAction}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
};
