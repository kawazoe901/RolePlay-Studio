import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Flame,
  Sliders,
  Check,
  X,
  Plus,
  Trash2,
  Clock,
  MapPin,
  Shirt,
  Sparkles,
  Heart,
  Shield,
  Zap,
  Activity,
  Users,
  Brain,
  LayoutGrid,
  Minimize2,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { ConfirmActionModal, ConfirmActionState } from './ConfirmActionModal';
import {
  ParsedStatusBlock,
  ParsedStatusField,
  ParsedStatusMeter,
  isHateOrHostilityMeterKey,
  isNumericStatusField,
  parseStatusTemplateRows,
} from '../utils/statusTracker';

interface Props {
  speakerName: string;
  parsed: ParsedStatusBlock;
  rawMessageText?: string;
  onSaveStatusRows?: (updatedRows: ParsedStatusField[]) => void;
}

const METER_THEME: Record<
  ParsedStatusMeter['colorScheme'],
  {
    text: string;
    ringStroke: string;
    segmentActive: string;
    cardBorder: string;
    cardBg: string;
    badgeBg: string;
  }
> = {
  rose: {
    text: 'text-rose-300',
    ringStroke: '#fb7185',
    segmentActive: 'bg-gradient-to-t from-rose-600 to-pink-400 shadow-sm shadow-rose-500/50',
    cardBorder: 'border-rose-500/25 hover:border-rose-500/45',
    cardBg: 'from-rose-950/35 via-slate-900/90 to-slate-950',
    badgeBg: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  fuchsia: {
    text: 'text-fuchsia-300',
    ringStroke: '#e879f9',
    segmentActive:
      'bg-gradient-to-t from-fuchsia-600 to-pink-400 shadow-sm shadow-fuchsia-500/50',
    cardBorder: 'border-fuchsia-500/25 hover:border-fuchsia-500/45',
    cardBg: 'from-fuchsia-950/35 via-slate-900/90 to-slate-950',
    badgeBg: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  },
  emerald: {
    text: 'text-emerald-300',
    ringStroke: '#34d399',
    segmentActive:
      'bg-gradient-to-t from-emerald-600 to-teal-300 shadow-sm shadow-emerald-500/50',
    cardBorder: 'border-emerald-500/25 hover:border-emerald-500/45',
    cardBg: 'from-emerald-950/35 via-slate-900/90 to-slate-950',
    badgeBg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  amber: {
    text: 'text-amber-300',
    ringStroke: '#fbbf24',
    segmentActive:
      'bg-gradient-to-t from-amber-500 to-yellow-300 shadow-sm shadow-amber-500/50',
    cardBorder: 'border-amber-500/25 hover:border-amber-500/45',
    cardBg: 'from-amber-950/35 via-slate-900/90 to-slate-950',
    badgeBg: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  sky: {
    text: 'text-sky-300',
    ringStroke: '#38bdf8',
    segmentActive:
      'bg-gradient-to-t from-sky-500 to-cyan-300 shadow-sm shadow-sky-500/50',
    cardBorder: 'border-sky-500/25 hover:border-sky-500/45',
    cardBg: 'from-sky-950/35 via-slate-900/90 to-slate-950',
    badgeBg: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  indigo: {
    text: 'text-indigo-300',
    ringStroke: '#818cf8',
    segmentActive:
      'bg-gradient-to-t from-indigo-500 to-violet-300 shadow-sm shadow-indigo-500/50',
    cardBorder: 'border-indigo-500/25 hover:border-indigo-500/45',
    cardBg: 'from-indigo-950/35 via-slate-900/90 to-slate-950',
    badgeBg: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
};

function getMeterTierLabel(pct: number, key: string): string {
  const k = key.toLowerCase();
  if (isHateOrHostilityMeterKey(k)) {
    if (pct >= 100) return '💀 GAME OVER · Broken';
    if (pct >= 80) return '⚠️ DANGER · Near Limit';
    if (pct >= 50) return 'Hostile · Resentful';
    if (pct >= 25) return 'Displeased · Guarded';
    if (pct > 0) return 'Slightly Annoyed';
    return 'Calm · No Resentment';
  }
  const isVital =
    k.includes('hp') ||
    k.includes('生命') ||
    k.includes('体力') ||
    k.includes('stamina') ||
    k.includes('health');
  if (isVital) {
    if (pct <= 0) return '💀 GAME OVER · Fallen';
    if (pct >= 85) return 'Peak';
    if (pct >= 55) return 'Steady';
    if (pct >= 25) return 'Fatigued';
    return 'Critical';
  }
  if (pct >= 90) return 'MAX · Devoted';
  if (pct >= 70) return 'Lv.4 · Deep';
  if (pct >= 45) return 'Lv.3 · Heated';
  if (pct >= 20) return 'Lv.2 · Warming';
  if (pct > 0) return 'Lv.1 · Guarded';
  return 'Lv.0 · Zero';
}

function pickMeterIcon(colorScheme: ParsedStatusMeter['colorScheme']) {
  switch (colorScheme) {
    case 'rose':
      return <Flame className="w-3.5 h-3.5 text-rose-400" />;
    case 'fuchsia':
      return <Heart className="w-3.5 h-3.5 text-fuchsia-400" />;
    case 'emerald':
      return <Shield className="w-3.5 h-3.5 text-emerald-400" />;
    case 'amber':
      return <Zap className="w-3.5 h-3.5 text-amber-400" />;
    default:
      return <Activity className="w-3.5 h-3.5 text-sky-400" />;
  }
}

function buildInitialEditableRows(
  parsed: ParsedStatusBlock,
  rawMessageText?: string
): ParsedStatusField[] {
  if (rawMessageText) {
    const statusMatch = rawMessageText.match(
      /<status(?:_bar)?>([\s\S]*?)<\/status(?:_bar)?>/i
    );
    if (statusMatch) {
      const fromRaw = parseStatusTemplateRows(statusMatch[0]);
      if (fromRaw.length > 0) return fromRaw;
    }
  }

  const rows: ParsedStatusField[] = [];
  if (parsed.metaFields.time) {
    rows.push({ key: 'Time', value: parsed.metaFields.time });
  }
  if (parsed.metaFields.location) {
    rows.push({ key: 'Location', value: parsed.metaFields.location });
  }
  if (parsed.metaFields.outfit) {
    rows.push({ key: 'Outfit', value: parsed.metaFields.outfit });
  }
  for (const c of parsed.conditionFields) {
    rows.push({ key: c.key, value: c.value });
  }
  if (parsed.memoryField) {
    rows.push({
      key: parsed.memoryField.key,
      value: parsed.memoryField.value,
    });
  }
  for (const r of parsed.relationshipFields) {
    rows.push({ key: r.key, value: r.value });
  }
  if (parsed.thoughtField) {
    rows.push({
      key: parsed.thoughtField.key,
      value: parsed.thoughtField.value,
    });
  }
  for (const m of parsed.statusMeters) {
    const clamped = Math.max(0, Math.min(m.max || 100, m.value));
    rows.push({
      key: m.key,
      value: m.max !== 100 ? `${clamped}/${m.max}` : `${clamped}`,
    });
  }
  if (parsed.stage) {
    rows.push({ key: 'Stage', value: parsed.stage });
  }
  return rows;
}

export const MessageStatusHudCard: React.FC<Props> = ({
  speakerName,
  parsed,
  rawMessageText,
  onSaveStatusRows,
}) => {
  const [isStatusBarExpanded, setIsStatusBarExpanded] = useState(true);
  const [isCompactMode, setIsCompactMode] = useState(false);
  const [isEditingValues, setIsEditingValues] = useState(false);
  const [draftRows, setDraftRows] = useState<ParsedStatusField[]>([]);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(
    null
  );

  if (!parsed.hasStatus) return null;

  const allMeters: ParsedStatusMeter[] = [
    ...parsed.statusMeters,
    ...parsed.variableMeters.filter(
      (vm) =>
        !parsed.statusMeters.some(
          (sm) => sm.key.toLowerCase() === vm.key.toLowerCase()
        )
    ),
  ];

  const hasStatusBarCard =
    Boolean(parsed.stage) ||
    Boolean(parsed.metaFields.time) ||
    Boolean(parsed.metaFields.location) ||
    Boolean(parsed.metaFields.outfit) ||
    parsed.conditionFields.length > 0 ||
    Boolean(parsed.memoryField) ||
    parsed.relationshipFields.length > 0 ||
    Boolean(parsed.thoughtField) ||
    allMeters.length > 0;

  if (!hasStatusBarCard) return null;

  const handleOpenEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftRows(buildInitialEditableRows(parsed, rawMessageText));
    setIsStatusBarExpanded(true);
    setIsEditingValues(true);
  };

  const handleSaveEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSaveStatusRows) {
      onSaveStatusRows(draftRows.filter((r) => r.key.trim()));
    }
    setIsEditingValues(false);
  };

  /**
   * 1-click quick nudge (+5 or -5) directly on a meter card without opening the full editor
   */
  const handleQuickNudgeMeter = (meterKey: string, deltaAmount: number) => {
    if (!onSaveStatusRows) return;
    const baseRows = buildInitialEditableRows(parsed, rawMessageText);
    const updated = baseRows.map((row) => {
      if (row.key.trim().toLowerCase() !== meterKey.trim().toLowerCase()) {
        return row;
      }
      const numInfo = isNumericStatusField(row.key, row.value);
      if (!numInfo.isNumeric) return row;
      const nextVal = Math.max(
        0,
        Math.min(numInfo.max || 100, numInfo.current + deltaAmount)
      );
      return {
        ...row,
        value: numInfo.hasSlashMax ? `${nextVal}/${numInfo.max}` : `${nextVal}`,
      };
    });
    onSaveStatusRows(updated);
  };

  return (
    <div className="mt-3.5 select-text">
      <div className="relative rounded-2xl border border-slate-800/90 bg-gradient-to-b from-slate-900/95 via-slate-950/95 to-slate-950 shadow-2xl overflow-hidden">
        {/* Subtle top accent glow bar */}
        <div className="h-0.5 w-full bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-emerald-400 opacity-80" />

        {/* Top Telemetry Header Bar */}
        <div
          onClick={() =>
            !isEditingValues && setIsStatusBarExpanded((prev) => !prev)
          }
          className="px-3 sm:px-4 py-2.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-slate-900/60 transition"
        >
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5 min-w-0 max-w-full">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-bold text-xs sm:text-sm text-white tracking-wide truncate max-w-[160px] sm:max-w-none">
              {speakerName}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-300 border border-slate-700/80 shrink-0">
              Live HUD
            </span>
            {parsed.stage && !isEditingValues && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500/15 to-rose-500/15 border border-amber-500/35 text-[11px] font-semibold text-amber-200 max-w-full truncate">
                <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="truncate">{parsed.stage}</span>
              </span>
            )}
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 shrink-0"
          >
            {!isEditingValues && isStatusBarExpanded && (
              <button
                type="button"
                onClick={() => setIsCompactMode((prev) => !prev)}
                title={
                  isCompactMode
                    ? 'Switch to Full Bento Dossier View'
                    : 'Switch to Compact 1-Line Strip View'
                }
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] font-medium transition"
              >
                {isCompactMode ? (
                  <>
                    <LayoutGrid className="w-3 h-3 text-indigo-400" />
                    <span className="hidden sm:inline">Full View</span>
                  </>
                ) : (
                  <>
                    <Minimize2 className="w-3 h-3 text-slate-400" />
                    <span className="hidden sm:inline">Compact</span>
                  </>
                )}
              </button>
            )}

            {onSaveStatusRows && !isEditingValues && (
              <button
                type="button"
                onClick={handleOpenEditor}
                title="Edit Status Values & Meters — override any meter number or status field so the AI continues from your exact values on the next turn"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/35 text-[11px] font-medium transition"
              >
                <Sliders className="w-3 h-3" />
                <span>Edit Values</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsStatusBarExpanded((prev) => !prev)}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800/60"
              title={
                isStatusBarExpanded
                  ? 'Collapse Status HUD'
                  : 'Expand Status HUD'
              }
            >
              {isStatusBarExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* INLINE SLIDER & FIELD EDITOR MODE */}
        {isStatusBarExpanded && isEditingValues && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="p-4 space-y-3 bg-slate-950 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
              <div>
                <span className="font-semibold text-emerald-300">
                  Edit Live Status &amp; Meter Values
                </span>
                <p className="text-[11px] text-slate-400">
                  Drag sliders or edit text below. The AI will strictly follow
                  these updated numbers and states on the next turn!
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setDraftRows((prev) => [
                      ...prev,
                      { key: 'New Field', value: 'Status description...' },
                    ])
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 text-[11px] font-medium"
                >
                  <Plus className="w-3 h-3" />
                  Add Text Field
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDraftRows((prev) => [
                      ...prev,
                      { key: 'New Meter', value: '50/100' },
                    ])
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-[11px] font-medium"
                >
                  <Plus className="w-3 h-3" />
                  Add Meter (0–100)
                </button>
                {(() => {
                  const hasHate = draftRows.some((r) =>
                    isHateOrHostilityMeterKey(r.key)
                  );
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        setDraftRows((prev) => {
                          if (
                            prev.some((r) => isHateOrHostilityMeterKey(r.key))
                          ) {
                            return prev.filter(
                              (r) => !isHateOrHostilityMeterKey(r.key)
                            );
                          }
                          const hasChinese = prev.some((r) =>
                            /[\u4e00-\u9fa5]/.test(r.key)
                          );
                          const hateKey = hasChinese ? '厌恶值' : 'Hate';
                          return [...prev, { key: hateKey, value: '0/100' }];
                        })
                      }
                      title={
                        hasHate
                          ? 'Click to remove the Hate / Game Over meter and return to Unlimited Chat'
                          : 'Optional: Add a Hate / Hostility meter (0/100) to this chat — if it reaches 100/100, the story triggers Game Over!'
                      }
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition ${
                        hasHate
                          ? 'bg-rose-600/30 hover:bg-rose-600/45 text-rose-200 border-rose-500/60'
                          : 'bg-rose-950/60 hover:bg-rose-900/70 text-rose-300 border-rose-500/40'
                      }`}
                    >
                      <Flame className="w-3 h-3 text-rose-400" />
                      {hasHate
                        ? '✓ Hate Meter ON (Click to Remove)'
                        : '+ Hate Meter (Opt-In Game Over)'}
                    </button>
                  );
                })()}
                <button
                  type="button"
                  onClick={handleSaveEditor}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold"
                >
                  <Check className="w-3.5 h-3.5" />
                  Save Values
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingValues(false)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {draftRows.map((row, idx) => {
                const numInfo = isNumericStatusField(row.key, row.value);
                return (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-xl p-2"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 sm:flex-initial">
                      <input
                        type="text"
                        value={row.key}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraftRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, key: val } : r
                            )
                          );
                        }}
                        placeholder="Field Name"
                        className="w-full sm:w-32 bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs font-semibold text-emerald-300 focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setDraftRows((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? {
                                    ...r,
                                    value: numInfo.isNumeric
                                      ? 'Normal status'
                                      : '50/100',
                                  }
                                : r
                            )
                          );
                        }}
                        title={
                          numInfo.isNumeric
                            ? 'Currently a Numeric Meter (X/Max) — click to switch to Text Field'
                            : 'Currently a Text Field — click to switch to Numeric Meter (X/Max)'
                        }
                        className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition shrink-0 ${
                          numInfo.isNumeric
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35 hover:bg-emerald-500/25'
                            : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/35 hover:bg-indigo-500/25'
                        }`}
                      >
                        {numInfo.isNumeric ? 'Meter' : 'Text'}
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
                            Math.min(numInfo.max || 100, numInfo.current)
                          )}
                          onChange={(e) => {
                            const maxVal = numInfo.max || 100;
                            const nextNum = Math.max(
                              0,
                              Math.min(maxVal, Number(e.target.value) || 0)
                            );
                            const formatted = `${nextNum}/${maxVal}`;
                            setDraftRows((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, value: formatted } : r
                              )
                            );
                          }}
                          className="flex-1 min-w-0 accent-emerald-500 cursor-pointer"
                        />
                        <input
                          type="number"
                          min={0}
                          max={numInfo.max || 100}
                          title="Current meter value"
                          value={Math.max(
                            0,
                            Math.min(numInfo.max || 100, numInfo.current)
                          )}
                          onChange={(e) => {
                            const maxVal = numInfo.max || 100;
                            const nextNum = Math.max(
                              0,
                              Math.min(maxVal, Number(e.target.value) || 0)
                            );
                            const formatted = `${nextNum}/${maxVal}`;
                            setDraftRows((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, value: formatted } : r
                              )
                            );
                          }}
                          className="w-14 bg-slate-950 border border-slate-700 rounded-lg px-1.5 py-1 text-xs text-center font-bold text-white shrink-0"
                        />
                        <span className="text-xs font-bold text-slate-400 shrink-0">
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
                              Math.min(99999, Math.round(Number(e.target.value) || 1))
                            );
                            const nextCur = Math.max(
                              0,
                              Math.min(nextMax, numInfo.current)
                            );
                            const formatted = `${nextCur}/${nextMax}`;
                            setDraftRows((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, value: formatted } : r
                              )
                            );
                          }}
                          className="w-14 bg-slate-950 border border-slate-700 rounded-lg px-1.5 py-1 text-xs text-center font-bold text-emerald-300 shrink-0"
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={row.value}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraftRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, value: val } : r
                            )
                          );
                        }}
                        placeholder="Status description or meter (e.g. 60/100)"
                        className="flex-1 bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setConfirmAction({
                          title: `Remove "${row.key || 'Field'}"?`,
                          message:
                            'Remove this status field from this message’s HUD?',
                          confirmLabel: 'Remove Field',
                          onConfirm: () =>
                            setDraftRows((prev) =>
                              prev.filter((_, i) => i !== idx)
                            ),
                        })
                      }
                      title="Remove field"
                      className="text-slate-500 hover:text-rose-400 p-1 shrink-0 self-end sm:self-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* COMPACT 1-LINE STRIP MODE */}
        {isStatusBarExpanded && !isEditingValues && isCompactMode && (
          <div className="px-3 sm:px-4 py-2.5 flex flex-wrap items-center gap-2 text-xs">
            {parsed.metaFields.location && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 max-w-full break-words">
                <MapPin className="w-3 h-3 text-indigo-400 shrink-0" />
                <span className="break-words">{parsed.metaFields.location}</span>
              </span>
            )}
            {parsed.metaFields.time && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 max-w-full break-words">
                <Clock className="w-3 h-3 text-sky-400 shrink-0" />
                <span className="break-words">{parsed.metaFields.time}</span>
              </span>
            )}
            {allMeters.map((m, idx) => {
              const theme = METER_THEME[m.colorScheme] || METER_THEME.rose;
              return (
                <span
                  key={idx}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-medium ${theme.badgeBg}`}
                >
                  {pickMeterIcon(m.colorScheme)}
                  <span>{m.key}:</span>
                  <strong className="text-white">
                    {Math.min(m.max || 100, m.value)}/{m.max || 100}
                  </strong>
                  {m.delta !== undefined && m.delta !== 0 && (
                    <span
                      className={`text-[10px] font-bold ${
                        m.delta > 0 ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      ({m.delta > 0 ? `+${m.delta}` : m.delta})
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {/* FULL BENTO DOSSIER VIEW */}
        {isStatusBarExpanded && !isEditingValues && !isCompactMode && (
          <div className="p-3 sm:p-4 space-y-3 sm:space-y-3.5 text-xs">
            {/* 1. Interactive Bento Meter Gauges (Radial Ring + 10-Segment Bar + Quick +/-5 Nudge) */}
            {allMeters.length > 0 && (
              <div
                className={`grid grid-cols-1 ${
                  allMeters.length === 1
                    ? 'sm:grid-cols-1'
                    : allMeters.length === 2
                    ? 'sm:grid-cols-2'
                    : 'sm:grid-cols-3'
                } gap-2.5`}
              >
                {allMeters.map((meter, idx) => {
                  const maxVal = meter.max || 100;
                  const pct = Math.max(
                    0,
                    Math.min(100, Math.round((meter.value / maxVal) * 100))
                  );
                  const theme =
                    METER_THEME[meter.colorScheme] || METER_THEME.rose;
                  const radius = 18;
                  const circumference = 2 * Math.PI * radius;
                  const dashOffset =
                    circumference - (pct / 100) * circumference;
                  const totalSegments =
                    maxVal >= 2 && maxVal <= 10 ? Math.round(maxVal) : 10;
                  const activeSegments =
                    maxVal >= 2 && maxVal <= 10
                      ? Math.max(0, Math.min(totalSegments, Math.round(meter.value)))
                      : Math.round(pct / 10);
                  const nudgeStep =
                    maxVal <= 20 ? 1 : maxVal <= 50 ? 2 : 5;
                  const tierLabel = getMeterTierLabel(pct, meter.key);

                  return (
                    <div
                      key={idx}
                      className={`group relative rounded-xl border bg-gradient-to-br ${theme.cardBg} ${theme.cardBorder} p-3 transition flex flex-col justify-between gap-2.5`}
                    >
                      <div className="flex items-center justify-between gap-2.5">
                        {/* Left: Circular SVG Radial Gauge */}
                        <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
                          <svg
                            className="w-12 h-12 -rotate-90"
                            viewBox="0 0 44 44"
                          >
                            <circle
                              cx="22"
                              cy="22"
                              r={radius}
                              fill="none"
                              stroke="#1e293b"
                              strokeWidth="4"
                            />
                            <circle
                              cx="22"
                              cy="22"
                              r={radius}
                              fill="none"
                              stroke={theme.ringStroke}
                              strokeWidth="4"
                              strokeLinecap="round"
                              strokeDasharray={circumference}
                              strokeDashoffset={dashOffset}
                              className="transition-all duration-700"
                            />
                          </svg>
                          <span className="absolute text-[11px] font-extrabold text-white">
                            {Math.min(maxVal, meter.value)}
                          </span>
                        </div>

                        {/* Middle: Meter Name, Tier Badge & Delta */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {pickMeterIcon(meter.colorScheme)}
                            <span
                              className={`font-bold text-xs truncate ${theme.text}`}
                            >
                              {meter.key}
                            </span>
                            {meter.delta !== undefined && meter.delta !== 0 && (
                              <span
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                  meter.delta > 0
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                }`}
                              >
                                {meter.delta > 0 ? (
                                  <TrendingUp className="w-2.5 h-2.5" />
                                ) : (
                                  <TrendingDown className="w-2.5 h-2.5" />
                                )}
                                {meter.delta > 0
                                  ? `+${meter.delta}`
                                  : meter.delta}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center justify-between gap-2 mt-1 min-w-0">
                            <span className="text-[10px] text-slate-400 font-medium truncate">
                              {tierLabel}
                            </span>
                            <span className="text-[10px] text-slate-400 shrink-0">
                              {Math.min(maxVal, meter.value)} / {maxVal}
                            </span>
                          </div>

                          {meter.reason && (
                            <p className="text-[10px] text-slate-300/90 truncate mt-0.5">
                              {meter.reason}
                            </p>
                          )}
                        </div>

                        {/* Right: Quick Micro-Nudge Buttons on Hover (auto-scaled to Max: ±1 for /5 or /10, ±5 for /100) */}
                        {onSaveStatusRows && (
                          <div className="opacity-0 group-hover:opacity-100 transition flex flex-col gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                handleQuickNudgeMeter(meter.key, nudgeStep)
                              }
                              title={`Increase ${meter.key} by +${nudgeStep}`}
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-emerald-600 text-[10px] font-bold text-emerald-300 hover:text-white border border-slate-700"
                            >
                              +{nudgeStep}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleQuickNudgeMeter(meter.key, -nudgeStep)
                              }
                              title={`Decrease ${meter.key} by -${nudgeStep}`}
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-rose-600 text-[10px] font-bold text-rose-300 hover:text-white border border-slate-700"
                            >
                              -{nudgeStep}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Bottom: Illuminated RPG Energy Bar (discrete N segments for /2../10, 10 segments for /100) */}
                      <div
                        className="grid gap-1 pt-0.5"
                        style={{
                          gridTemplateColumns: `repeat(${totalSegments}, minmax(0, 1fr))`,
                        }}
                      >
                        {Array.from({ length: totalSegments }).map(
                          (_, segIdx) => {
                            const isLit = segIdx < activeSegments;
                            return (
                              <div
                                key={segIdx}
                                className={`h-1.5 rounded-sm transition-all duration-500 ${
                                  isLit ? theme.segmentActive : 'bg-slate-800/80'
                                }`}
                              />
                            );
                          }
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 2. Scene Telemetry Ribbon (Time, Location, Outfit / Attire Pills) */}
            {(parsed.metaFields.time ||
              parsed.metaFields.location ||
              parsed.metaFields.outfit) && (
              <div className="flex flex-wrap items-center gap-2">
                {parsed.metaFields.time && (
                  <div className="inline-flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800/90 text-slate-200 max-w-full min-w-0">
                    <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span className="text-[11px] text-slate-400 font-medium shrink-0">
                      Time
                    </span>
                    <span className="text-xs font-semibold text-white break-words min-w-0">
                      {parsed.metaFields.time}
                    </span>
                  </div>
                )}

                {parsed.metaFields.location && (
                  <div className="inline-flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800/90 text-slate-200 max-w-full min-w-0">
                    <MapPin className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="text-[11px] text-slate-400 font-medium shrink-0">
                      Location
                    </span>
                    <span className="text-xs font-semibold text-white break-words min-w-0">
                      {parsed.metaFields.location}
                    </span>
                  </div>
                )}

                {parsed.metaFields.outfit && (
                  <div className="inline-flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800/90 text-slate-200 flex-1 min-w-0 sm:min-w-[220px] max-w-full">
                    <Shirt className="w-3.5 h-3.5 text-fuchsia-400 shrink-0" />
                    <span className="text-[11px] text-slate-400 font-medium shrink-0">
                      Attire
                    </span>
                    <span className="text-xs text-slate-100 break-words min-w-0">
                      {parsed.metaFields.outfit}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 3. Telepathic Inner Monologue / Psychology Card */}
            {parsed.thoughtField && (
              <div className="relative rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-fuchsia-950/25 to-slate-900/90 p-3 flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/35 flex items-center justify-center shrink-0 mt-0.5">
                  <Brain className="w-3.5 h-3.5 text-indigo-300" />
                </div>
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-300/90">
                    Inner Monologue ({parsed.thoughtField.key})
                  </div>
                  <p className="text-xs text-slate-100 italic leading-relaxed">
                    “
                    {parsed.thoughtField.value.replace(
                      /^[“"「]|[”"」]$/g,
                      ''
                    )}
                    ”
                  </p>
                </div>
              </div>
            )}

            {/* 4. Bento Split: Condition & Body Chips + Interpersonal Attitude Radar */}
            {(parsed.conditionFields.length > 0 ||
              parsed.memoryField ||
              parsed.relationshipFields.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                {/* Left / Main Bento: Physical & Condition Status Chips */}
                {(parsed.conditionFields.length > 0 || parsed.memoryField) && (
                  <div
                    className={`${
                      parsed.relationshipFields.length > 0
                        ? 'lg:col-span-7'
                        : 'lg:col-span-12'
                    } bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 space-y-2.5`}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <Activity className="w-3.5 h-3.5 text-rose-400" />
                      <span>Condition &amp; Body Telemetry</span>
                    </div>

                    {parsed.conditionFields.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {parsed.conditionFields.map((field, idx) => (
                          <div
                            key={idx}
                            className="bg-slate-950/80 border border-slate-800/80 rounded-lg px-2.5 py-2 flex flex-col gap-0.5 min-w-0"
                          >
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide break-words">
                              {field.key}
                            </span>
                            <span className="text-xs text-rose-200/95 font-medium leading-snug break-words">
                              {field.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {parsed.memoryField && (
                      <div className="rounded-lg bg-purple-950/30 border border-purple-500/30 px-3 py-2 flex items-start gap-2 min-w-0">
                        <Sparkles className="w-3.5 h-3.5 text-purple-300 shrink-0 mt-0.5" />
                        <div className="text-xs leading-relaxed min-w-0 break-words">
                          <span className="font-semibold text-purple-300 mr-1.5">
                            {parsed.memoryField.key}:
                          </span>
                          <span className="italic text-purple-200/95">
                            {parsed.memoryField.value}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Right Bento: Interpersonal Attitude Radar */}
                {parsed.relationshipFields.length > 0 && (
                  <div
                    className={`${
                      parsed.conditionFields.length > 0 || parsed.memoryField
                        ? 'lg:col-span-5'
                        : 'lg:col-span-12'
                    } bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 space-y-2.5 min-w-0`}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <Users className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Interpersonal Radar</span>
                    </div>

                    <div className="space-y-2">
                      {parsed.relationshipFields.map((rel, idx) => (
                        <div
                          key={idx}
                          className="bg-slate-950/80 border border-slate-800/80 rounded-lg px-3 py-2 space-y-0.5 min-w-0"
                        >
                          <div className="text-[11px] font-bold text-indigo-300 break-words">
                            {rel.key}
                          </div>
                          <div className="text-xs text-slate-200 leading-snug break-words">
                            {rel.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
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
