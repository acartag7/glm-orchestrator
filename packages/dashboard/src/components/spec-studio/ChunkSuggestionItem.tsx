'use client';

import { useState } from 'react';
import type { ChunkSuggestion } from '@specwright/shared';

interface ChunkSuggestionItemProps {
  chunk: ChunkSuggestion;
  onToggle: () => void;
  onEdit: (title: string, description: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}

export default function ChunkSuggestionItem({
  chunk,
  onToggle,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: ChunkSuggestionItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(chunk.title);
  const [editDescription, setEditDescription] = useState(chunk.description);

  const handleSave = () => {
    onEdit(editTitle, editDescription);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditTitle(chunk.title);
    setEditDescription(chunk.description);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="bg-neutral-900 border border-emerald-500/40 rounded-md p-4 space-y-3 shadow-lg shadow-emerald-500/5">
        <div className="space-y-1">
          <label className="block text-[10px] text-neutral-500 font-mono uppercase tracking-wider">
            Title
          </label>
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Chunk title"
            className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-md text-neutral-200 placeholder:text-neutral-700 font-mono text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] text-neutral-500 font-mono uppercase tracking-wider">
            Description
          </label>
          <textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Detailed instructions for what should be done..."
            className="w-full min-h-[80px] px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-md text-neutral-300 placeholder:text-neutral-700 font-mono text-xs focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 resize-y"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-neutral-800">
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 text-neutral-500 hover:text-neutral-200 font-mono text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!editTitle.trim()}
            className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-md font-mono text-xs hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Changes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${chunk.selected ? 'bg-neutral-900/50' : 'bg-neutral-950/50 opacity-60'} border border-neutral-800 rounded-md p-3 group`}>
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={onToggle}
          className={`flex-shrink-0 w-5 h-5 flex items-center justify-center font-mono text-sm ${
            chunk.selected ? 'text-emerald-400' : 'text-neutral-600'
          }`}
        >
          {chunk.selected ? '☑' : '☐'}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-neutral-600 font-mono">{chunk.order}.</span>
            <h4 className="text-sm font-medium text-neutral-200 font-mono truncate">{chunk.title}</h4>
          </div>
          <p className="text-xs text-neutral-500 mt-1 font-mono line-clamp-2">{chunk.description}</p>
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Move up */}
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="p-1 text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move up"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>

          {/* Move down */}
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="p-1 text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Edit */}
          <button
            onClick={() => setIsEditing(true)}
            className="p-1 text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 rounded transition-colors"
            title="Edit"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {/* Delete */}
          <button
            onClick={onDelete}
            className="p-1 text-neutral-600 hover:text-red-400 hover:bg-neutral-800 rounded transition-colors"
            title="Delete"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
