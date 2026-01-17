'use client';

import { useState, useEffect, useRef } from 'react';
import type { Chunk } from '@specwright/shared';

interface ChunkEditorProps {
  chunk?: Chunk;
  onSubmit: (data: { title: string; description: string }) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export default function ChunkEditor({
  chunk,
  onSubmit,
  onCancel,
  isLoading = false,
}: ChunkEditorProps) {
  const [title, setTitle] = useState(chunk?.title ?? '');
  const [description, setDescription] = useState(chunk?.description ?? '');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!chunk;

  useEffect(() => {
    // Focus the title input when modal opens
    setTimeout(() => titleInputRef.current?.focus(), 100);
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    onSubmit({
      title: title.trim(),
      description: description.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-lg shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
            <h2 className="text-sm font-medium text-neutral-100 font-mono">
              {isEditing ? 'edit chunk' : 'new chunk'}
            </h2>
            <button
              onClick={onCancel}
              className="p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-md transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="px-6 py-5 space-y-4">
              {/* Title */}
              <div>
                <label htmlFor="title" className="block text-xs font-mono text-neutral-400 mb-1.5">
                  title
                </label>
                <input
                  ref={titleInputRef}
                  type="text"
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Setup database schema"
                  className="w-full px-3 py-2 bg-neutral-800/50 border border-neutral-700 rounded-md text-neutral-100 placeholder-neutral-600 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-shadow"
                  required
                  disabled={isLoading}
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="description" className="block text-xs font-mono text-neutral-400 mb-1.5">
                  description
                  <span className="text-neutral-600 font-normal ml-1">(what should the AI do?)</span>
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Create a SQLite database with tables for users, posts, and comments. Include proper indexes and foreign key constraints."
                  rows={4}
                  className="w-full px-3 py-2 bg-neutral-800/50 border border-neutral-700 rounded-md text-neutral-100 placeholder-neutral-600 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-shadow resize-none"
                  required
                  disabled={isLoading}
                />
                <p className="mt-1.5 text-[10px] text-neutral-600 font-mono">
                  Be specific about what files to create/modify and the expected outcome.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-800 bg-neutral-900/50">
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-1.5 text-xs font-mono text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded-md transition-colors"
                disabled={isLoading}
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim() || !description.trim() || isLoading}
                className="px-3 py-1.5 text-xs font-mono bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:border-neutral-700 rounded-md transition-colors flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {isEditing ? 'saving...' : 'creating...'}
                  </>
                ) : (
                  isEditing ? 'save changes' : 'create chunk'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
