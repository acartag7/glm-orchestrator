'use client';

import { useEffect, useRef } from 'react';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDanger?: boolean;
  isLoading?: boolean;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'confirm',
  cancelLabel = 'cancel',
  onConfirm,
  onCancel,
  isDanger = false,
  isLoading = false,
}: ConfirmModalProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // Focus confirm button when modal opens
  useEffect(() => {
    setTimeout(() => confirmButtonRef.current?.focus(), 100);
  }, []);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onCancel();
      } else if (e.key === 'Enter' && !isLoading) {
        e.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, onConfirm, isLoading]);

  const confirmStyles = isDanger
    ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/30'
    : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={!isLoading ? onCancel : undefined}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
            <h2 className="text-sm font-medium text-neutral-100 font-mono">
              {title}
            </h2>
            <button
              onClick={onCancel}
              disabled={isLoading}
              className="p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-md transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-5">
            <p className="text-sm text-neutral-300 font-mono">{message}</p>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-800 bg-neutral-900/50">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs font-mono text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-md transition-colors disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmButtonRef}
              type="button"
              onClick={onConfirm}
              disabled={isLoading}
              className={`px-3 py-1.5 text-xs font-mono border rounded-md transition-colors flex items-center gap-2 disabled:opacity-50 ${confirmStyles}`}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  processing...
                </>
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
