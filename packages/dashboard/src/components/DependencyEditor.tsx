'use client';

import { useState, useCallback } from 'react';
import type { Chunk } from '@glm/shared';

interface DependencyEditorProps {
  chunk: Chunk;
  allChunks: Chunk[];
  onSave: (dependencies: string[]) => Promise<void>;
  onCancel: () => void;
}

export default function DependencyEditor({
  chunk,
  allChunks,
  onSave,
  onCancel,
}: DependencyEditorProps) {
  const [selectedDeps, setSelectedDeps] = useState<Set<string>>(
    new Set(chunk.dependencies)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter out the current chunk and show other chunks
  const availableChunks = allChunks.filter(c => c.id !== chunk.id);

  const handleToggle = useCallback((id: string) => {
    setSelectedDeps(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onSave(Array.from(selectedDeps));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save dependencies');
      setIsLoading(false);
    }
  }, [selectedDeps, onSave]);

  const statusIcon = {
    pending: '○',
    running: '◐',
    completed: '✓',
    failed: '✕',
    cancelled: '⊘',
  };

  const statusColor = {
    pending: 'text-neutral-500',
    running: 'text-amber-400',
    completed: 'text-emerald-400',
    failed: 'text-red-400',
    cancelled: 'text-amber-400',
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg w-full max-w-md mx-4 shadow-xl">
        {/* Header */}
        <div className="px-4 py-3 border-b border-neutral-800">
          <h3 className="text-sm font-medium text-neutral-100 font-mono">
            Edit Dependencies
          </h3>
          <p className="text-xs text-neutral-500 font-mono mt-0.5">
            for &quot;{chunk.title}&quot;
          </p>
        </div>

        {/* Content */}
        <div className="p-4 max-h-80 overflow-auto">
          {availableChunks.length === 0 ? (
            <p className="text-xs text-neutral-500 font-mono text-center py-4">
              No other chunks available
            </p>
          ) : (
            <div className="space-y-1">
              <p className="text-[10px] text-neutral-600 font-mono uppercase tracking-wide mb-2">
                Select chunks this task depends on:
              </p>
              {availableChunks.map((c, index) => (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                    selectedDeps.has(c.id)
                      ? 'bg-emerald-500/10 border border-emerald-500/30'
                      : 'bg-neutral-800/50 border border-transparent hover:bg-neutral-800'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedDeps.has(c.id)}
                    onChange={() => handleToggle(c.id)}
                    className="w-4 h-4 rounded border-neutral-600 bg-neutral-800 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 focus:ring-offset-neutral-900"
                  />
                  <span className={`${statusColor[c.status]} text-xs`}>
                    {statusIcon[c.status]}
                  </span>
                  <span className="text-neutral-500 text-[10px] font-mono w-4">
                    {index + 1}.
                  </span>
                  <span className="text-sm text-neutral-200 font-mono truncate flex-1">
                    {c.title}
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded-md">
              <p className="text-xs text-red-400 font-mono">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-neutral-800 flex items-center justify-between">
          <div className="text-[10px] text-neutral-600 font-mono">
            {selectedDeps.size} dependencies selected
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="px-3 py-1.5 text-neutral-400 hover:text-neutral-200 border border-neutral-700 hover:border-neutral-600 rounded-md font-mono text-xs transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading}
              className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 rounded-md font-mono text-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
