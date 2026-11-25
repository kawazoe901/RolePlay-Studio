import React, { useEffect } from 'react';
import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react';

export interface ConfirmActionState {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: 'danger' | 'warning';
  onConfirm: () => void;
}

interface ConfirmActionModalProps {
  state: ConfirmActionState | null;
  onClose: () => void;
}

/**
 * Reusable confirmation dialog for destructive deletes and resets across the app.
 */
export const ConfirmActionModal: React.FC<ConfirmActionModalProps> = ({
  state,
  onClose,
}) => {
  useEffect(() => {
    if (!state) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, onClose]);

  if (!state) return null;

  const isWarning = state.tone === 'warning';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-4 sm:p-5 space-y-4 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
              isWarning
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                : 'bg-rose-500/15 border-rose-500/40 text-rose-400'
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm sm:text-base font-bold text-white break-words">
              {state.title}
            </h3>
            <p className="text-xs text-slate-300 mt-1.5 leading-relaxed break-words">
              {state.message}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 shrink-0"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const fn = state.onConfirm;
              onClose();
              fn();
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-white text-xs font-semibold transition ${
              isWarning
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-rose-600 hover:bg-rose-500'
            }`}
          >
            {isWarning ? (
              <RotateCcw className="w-3.5 h-3.5" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            {state.confirmLabel || (isWarning ? 'Confirm Reset' : 'Delete')}
          </button>
        </div>
      </div>
    </div>
  );
};
