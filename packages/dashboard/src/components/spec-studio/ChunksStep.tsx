'use client';

import { useState } from 'react';
import type { ChunkSuggestion } from '@specwright/shared';
import ChunkSuggestionItem from './ChunkSuggestionItem';

export interface GitOptions {
  createCommit: boolean;
  createPR: boolean;
}

interface ChunksStepProps {
  chunks: ChunkSuggestion[];
  onChunksChange: (chunks: ChunkSuggestion[]) => void;
  onBack: () => void;
  onComplete: (gitOptions: GitOptions) => void;
  isCompleting: boolean;
}

export default function ChunksStep({
  chunks,
  onChunksChange,
  onBack,
  onComplete,
  isCompleting,
}: ChunksStepProps) {
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [gitOptions, setGitOptions] = useState<GitOptions>({
    createCommit: false,
    createPR: false,
  });

  const selectedCount = chunks.filter((c) => c.selected).length;

  const handleComplete = () => {
    onComplete(gitOptions);
  };

  const handleToggle = (chunkId: string) => {
    onChunksChange(
      chunks.map((c) => (c.id === chunkId ? { ...c, selected: !c.selected } : c))
    );
  };

  const handleEdit = (chunkId: string, title: string, description: string) => {
    onChunksChange(
      chunks.map((c) => (c.id === chunkId ? { ...c, title, description } : c))
    );
  };

  const handleDelete = (chunkId: string) => {
    onChunksChange(chunks.filter((c) => c.id !== chunkId));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newChunks = [...chunks];
    [newChunks[index - 1], newChunks[index]] = [newChunks[index], newChunks[index - 1]];
    // Update order values
    newChunks.forEach((c, i) => (c.order = i + 1));
    onChunksChange(newChunks);
  };

  const handleMoveDown = (index: number) => {
    if (index === chunks.length - 1) return;
    const newChunks = [...chunks];
    [newChunks[index], newChunks[index + 1]] = [newChunks[index + 1], newChunks[index]];
    // Update order values
    newChunks.forEach((c, i) => (c.order = i + 1));
    onChunksChange(newChunks);
  };

  const handleAddCustom = () => {
    if (!customTitle.trim()) return;

    const newChunk: ChunkSuggestion = {
      id: `custom_${Date.now()}`,
      title: customTitle.trim(),
      description: customDescription.trim(),
      selected: true,
      order: chunks.length + 1,
    };

    onChunksChange([...chunks, newChunk]);
    setCustomTitle('');
    setCustomDescription('');
    setIsAddingCustom(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-neutral-100 font-mono mb-2">
          Suggested implementation chunks
        </h2>
        <p className="text-sm text-neutral-500 font-mono">
          Select the chunks you want to create. You can edit or add custom chunks.
        </p>
      </div>

      {/* Chunk List */}
      <div className="space-y-2">
        {chunks.map((chunk, index) => (
          <ChunkSuggestionItem
            key={chunk.id}
            chunk={chunk}
            onToggle={() => handleToggle(chunk.id)}
            onEdit={(title, description) => handleEdit(chunk.id, title, description)}
            onDelete={() => handleDelete(chunk.id)}
            onMoveUp={() => handleMoveUp(index)}
            onMoveDown={() => handleMoveDown(index)}
            isFirst={index === 0}
            isLast={index === chunks.length - 1}
          />
        ))}
      </div>

      {chunks.length === 0 && (
        <div className="text-center py-8">
          <p className="text-neutral-500 font-mono text-sm">No chunks generated yet.</p>
        </div>
      )}

      {/* Add Custom Chunk */}
      {isAddingCustom ? (
        <div className="bg-neutral-900 border border-emerald-500/40 rounded-md p-4 space-y-3 shadow-lg shadow-emerald-500/5">
          <div className="space-y-1">
            <label className="block text-[10px] text-neutral-500 font-mono uppercase tracking-wider">
              Title
            </label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="New chunk title"
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-md text-neutral-200 placeholder:text-neutral-700 font-mono text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] text-neutral-500 font-mono uppercase tracking-wider">
              Description
            </label>
            <textarea
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              placeholder="Detailed instructions for what should be done..."
              className="w-full min-h-[80px] px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-md text-neutral-300 placeholder:text-neutral-700 font-mono text-xs focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 resize-y"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-neutral-800">
            <button
              onClick={() => {
                setIsAddingCustom(false);
                setCustomTitle('');
                setCustomDescription('');
              }}
              className="px-3 py-1.5 text-neutral-500 hover:text-neutral-200 font-mono text-xs transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddCustom}
              disabled={!customTitle.trim()}
              className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-md font-mono text-xs hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Chunk
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsAddingCustom(true)}
          className="w-full px-3 py-2 border border-dashed border-neutral-800 rounded-md text-neutral-500 hover:text-neutral-300 hover:border-neutral-600 font-mono text-sm transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add custom chunk
        </button>
      )}

      {/* Git Options */}
      <div className="pt-4 border-t border-neutral-800">
        <label className="block text-sm text-neutral-400 font-mono mb-3">
          After all chunks complete:
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={gitOptions.createCommit}
              onChange={(e) => setGitOptions(prev => ({ ...prev, createCommit: e.target.checked }))}
              className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-emerald-500 focus:ring-emerald-500/20 focus:ring-offset-0"
            />
            <span className="text-sm text-neutral-400 group-hover:text-neutral-300 font-mono transition-colors">
              Create commit
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={gitOptions.createPR}
              onChange={(e) => setGitOptions(prev => ({ ...prev, createPR: e.target.checked }))}
              className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-emerald-500 focus:ring-emerald-500/20 focus:ring-offset-0"
            />
            <span className="text-sm text-neutral-400 group-hover:text-neutral-300 font-mono transition-colors">
              Create PR
            </span>
          </label>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4">
        <button
          onClick={onBack}
          disabled={isCompleting}
          className="px-4 py-2 text-neutral-400 hover:text-neutral-200 font-mono text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <div className="flex items-center gap-4">
          <span className="text-xs text-neutral-500 font-mono">
            {selectedCount} chunk{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handleComplete}
            disabled={selectedCount === 0 || isCompleting}
            className="px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-md font-mono text-sm hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isCompleting ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating...
              </>
            ) : (
              <>
                Create & Start
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
