import React from 'react';
import {
  CharacterCardV2,
  ChatSession,
  ConversationLanguage,
  StatusTrackerMode,
  UserPersona,
} from '../types';
import {
  ParsedStatusField,
  getDefaultStatusTemplateForMode,
  getStatusStartingPresets,
  isHateOrHostilityMeterKey,
  isNumericStatusField,
  parseStatusTemplateRows,
  replaceMessageStatusBarBlock,
  serializeStatusTemplateRows,
} from '../utils/statusTracker';
import { BufferedField } from './BufferedField';
import { ConfirmActionState } from './ConfirmActionModal';
import { Activity, Flame, Plus, Trash2, X } from 'lucide-react';

interface Props {
  activeSession: ChatSession;
  leadChar: CharacterCardV2 | undefined;
  activePersona: UserPersona;
  defaultLanguage: ConversationLanguage;
  onClose: () => void;
  onUpdateActiveSession: (updater: (s: ChatSession) => ChatSession) => void;
  onRequestConfirm: (state: ConfirmActionState) => void;
}

export const StatusHudEditorModal: React.FC<Props> = ({
  activeSession,
  leadChar,
  activePersona,
  defaultLanguage,
  onClose,
  onUpdateActiveSession,
  onRequestConfirm,
}) => {
  const currentMode: StatusTrackerMode =
    activeSession.statusTrackerMode &&
    activeSession.statusTrackerMode !== 'off' &&
    activeSession.statusTrackerMode !== 'auto'
      ? activeSession.statusTrackerMode
      : 'intimate_detailed';
  const effectiveLang = activeSession.language || defaultLanguage || 'auto';

  const currentRawTemplate =
    activeSession.customStatusTemplate ||
    `<status_bar>\n${getDefaultStatusTemplateForMode({
      mode: currentMode,
      charName: leadChar?.name || '角色',
      userName: activePersona.name,
      language: effectiveLang,
    })}\n</status_bar>`;

  const rows = parseStatusTemplateRows(currentRawTemplate);
  const startingPresets = getStatusStartingPresets({
    mode: currentMode,
    charName: leadChar?.name || '角色',
    userName: activePersona.name,
    language: effectiveLang,
  });

  const updateRows = (nextRows: ParsedStatusField[]) => {
    const body = serializeStatusTemplateRows(nextRows);
    onUpdateActiveSession((s) => ({
      ...s,
      customStatusTemplate: `<status_bar>\n${body}\n</status_bar>`,
    }));
  };

  const handleApplyToCurrentMessageNow = () => {
    const validRows = rows.filter((r) => r.key.trim());
    if (validRows.length === 0) {
      onClose();
      return;
    }
    const body = serializeStatusTemplateRows(validRows);
    const fullBlock = `<status_bar>\n${body}\n</status_bar>`;
    onUpdateActiveSession((s) => {
      let lastAsstIdx = -1;
      for (let i = s.messages.length - 1; i >= 0; i--) {
        if (s.messages[i].role === 'assistant') {
          lastAsstIdx = i;
          break;
        }
      }
      const nextMessages =
        lastAsstIdx >= 0
          ? s.messages.map((m, idx) => {
              if (idx !== lastAsstIdx) return m;
              const curText = m.swipes[m.activeSwipeIndex] || '';
              const nextText = replaceMessageStatusBarBlock(curText, validRows);
              return {
                ...m,
                swipes: m.swipes.map((sw, sIdx) =>
                  sIdx === m.activeSwipeIndex ? nextText : sw
                ),
              };
            })
          : s.messages;
      return {
        ...s,
        statusTrackerMode:
          !s.statusTrackerMode ||
          s.statusTrackerMode === 'off' ||
          s.statusTrackerMode === 'auto'
            ? currentMode
            : s.statusTrackerMode,
        customStatusTemplate: fullBlock,
        messages: nextMessages,
      };
    });
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-5 space-y-4 shadow-2xl max-h-[90vh] flex flex-col"
      >
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-bold text-white text-base">
                Set Status HUD Default / Starting Values &amp; Fields
              </h3>
              <p className="text-[11px] text-slate-400">
                Set your exact starting meter numbers (e.g. 0 Corruption / 15
                Affection / 100 HP) and tracked fields so the AI never guesses
                random numbers.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 1. Starting Value Presets */}
        <div className="space-y-1.5 shrink-0">
          <span className="text-[11px] font-semibold text-emerald-300">
            1. Quick Starting Value Presets (Click to Load):
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {startingPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  onUpdateActiveSession((s) => ({
                    ...s,
                    customStatusTemplate: `<status_bar>\n${preset.template}\n</status_bar>`,
                  }))
                }
                className="text-left p-2.5 rounded-xl bg-slate-950 hover:bg-emerald-950/40 border border-slate-800 hover:border-emerald-500/40 transition"
              >
                <div className="text-xs font-bold text-emerald-300">
                  {preset.label}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                  {preset.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 2. Visual Sliders & Field Rows Editor */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 border-y border-slate-800 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <span className="text-[11px] font-semibold text-slate-300">
              2. Customize Fields &amp; Starting Meter Numbers:
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  updateRows([
                    ...rows,
                    {
                      key: 'New Field',
                      value: 'Initial status description...',
                    },
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
                  updateRows([...rows, { key: 'New Meter', value: '0/100' }])
                }
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-[11px] font-medium"
              >
                <Plus className="w-3 h-3" />
                Add Meter (0–100)
              </button>
              {(() => {
                const hasHate = rows.some((r) =>
                  isHateOrHostilityMeterKey(r.key)
                );
                return (
                  <button
                    type="button"
                    onClick={() => {
                      if (hasHate) {
                        updateRows(
                          rows.filter((r) => !isHateOrHostilityMeterKey(r.key))
                        );
                        return;
                      }
                      const hasChinese = rows.some((r) =>
                        /[\u4e00-\u9fa5]/.test(r.key)
                      );
                      updateRows([
                        ...rows,
                        {
                          key: hasChinese ? '厌恶值' : 'Hate',
                          value: '0/100',
                        },
                      ]);
                    }}
                    title={
                      hasHate
                        ? 'Click to remove the Hate / Game Over meter and keep this chat Unlimited'
                        : 'Optional: Add a Hate / Hostility meter (0/100) to this chat — if it reaches 100/100, the chat locks with a Game Over!'
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
            </div>
          </div>

          {rows.map((row, idx) => {
            const numInfo = isNumericStatusField(row.key, row.value);
            return (
              <div
                key={idx}
                className="flex flex-col sm:flex-row sm:items-center gap-2 bg-slate-950/90 border border-slate-800 rounded-xl p-2"
              >
                <div className="flex items-center gap-1.5 shrink-0">
                  <BufferedField
                    value={row.key}
                    onCommit={(nextKey) => {
                      updateRows(
                        rows.map((r, i) =>
                          i === idx ? { ...r, key: nextKey } : r
                        )
                      );
                    }}
                    placeholder="Field Name"
                    className="w-full sm:w-32 bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs font-semibold text-emerald-300 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      updateRows(
                        rows.map((r, i) =>
                          i === idx
                            ? {
                                ...r,
                                value: numInfo.isNumeric
                                  ? 'Initial status...'
                                  : '0/100',
                              }
                            : r
                        )
                      );
                    }}
                    title={
                      numInfo.isNumeric
                        ? 'Currently a Meter Slider — click to switch to Text Field'
                        : 'Currently a Text Field — click to switch to Meter Slider'
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
                        updateRows(
                          rows.map((r, i) =>
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
                        updateRows(
                          rows.map((r, i) =>
                            i === idx ? { ...r, value: formatted } : r
                          )
                        );
                      }}
                      className="w-14 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-xs text-center font-bold text-white shrink-0"
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
                        updateRows(
                          rows.map((r, i) =>
                            i === idx ? { ...r, value: formatted } : r
                          )
                        );
                      }}
                      className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-1.5 py-1 text-xs text-center font-bold text-emerald-300 shrink-0"
                    />
                  </div>
                ) : (
                  <BufferedField
                    value={row.value}
                    onCommit={(nextVal) => {
                      updateRows(
                        rows.map((r, i) =>
                          i === idx ? { ...r, value: nextVal } : r
                        )
                      );
                    }}
                    placeholder="Starting value or description (use e.g. 0/100 for a meter)"
                    className="flex-1 bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                )}

                <button
                  type="button"
                  onClick={() =>
                    onRequestConfirm({
                      title: `Remove "${row.key || 'Field'}"?`,
                      message:
                        'Remove this field from the session Status HUD template?',
                      confirmLabel: 'Remove Field',
                      onConfirm: () =>
                        updateRows(rows.filter((_, i) => i !== idx)),
                    })
                  }
                  title="Remove field"
                  className="text-slate-500 hover:text-rose-400 p-1 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}

          {/* Collapsible Raw Template View for bulk copy/paste */}
          <details className="pt-2 text-xs text-slate-400">
            <summary className="cursor-pointer hover:text-slate-200 font-medium">
              Advanced: Edit Raw [Key|Value] Text Directly
            </summary>
            <BufferedField
              multiline
              rows={7}
              value={currentRawTemplate}
              onCommit={(nextVal) =>
                onUpdateActiveSession((s) => ({
                  ...s,
                  customStatusTemplate: nextVal,
                }))
              }
              className="mt-2 w-full font-mono text-xs bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </details>
        </div>

        {/* 3. Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-slate-400">
            Tip: You can also click <strong>Edit Values</strong> on any Status
            HUD card in chat at any time!
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
            >
              Save Baseline Only
            </button>
            <button
              type="button"
              onClick={handleApplyToCurrentMessageNow}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md"
            >
              Apply to Current Turn Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
