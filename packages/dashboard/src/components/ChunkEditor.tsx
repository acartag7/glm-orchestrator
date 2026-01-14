'use client';

import { useState, useEffect, useRef } from 'react';
import type { Chunk } from '@glm/shared';

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
          className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-xl shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
            <h2 className="text-lg font-semibold text-gray-100">
              {isEditing ? 'Edit Chunk' : 'New Chunk'}
            </h2>
            <button
              onClick={onCancel}
              className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="px-6 py-5 space-y-4">
              {/* Title */}
              <div>
                <label htmlFor="title" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Title
                </label>
                <input
                  ref={titleInputRef}
                  type="text"
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Setup database schema"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
                  required
                  disabled={isLoading}
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-300 mb-1.5">
                  Description
                  <span className="text-gray-500 font-normal ml-1">(what should the AI do?)</span>
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Create a SQLite database with tables for users, posts, and comments. Include proper indexes and foreign key constraints."
                  rows={4}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow resize-none"
                  required
                  disabled={isLoading}
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  Be specific about what files to create/modify and the expected outcome.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800 bg-gray-900/50">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition-colors"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim() || !description.trim() || isLoading}
                className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-400 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {isEditing ? 'Saving...' : 'Creating...'}
                  </>
                ) : (
                  isEditing ? 'Save Changes' : 'Create Chunk'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
