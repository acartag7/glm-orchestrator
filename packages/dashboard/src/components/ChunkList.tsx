'use client';

import { useState, useCallback } from 'react';
import type { Chunk } from '@glm/shared';
import ChunkItem from './ChunkItem';
import ChunkEditor from './ChunkEditor';

interface ChunkListProps {
  projectId: string;
  chunks: Chunk[];
  onChunksChange?: (chunks: Chunk[]) => void;
  onRunChunk?: (chunk: Chunk) => void;
  runningChunkId?: string | null;
}

export default function ChunkList({
  projectId,
  chunks,
  onChunksChange,
  onRunChunk,
  runningChunkId,
}: ChunkListProps) {
  const [editingChunk, setEditingChunk] = useState<Chunk | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Create new chunk
  const handleCreate = useCallback(async (data: { title: string; description: string }) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/projects/${projectId}/chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create chunk');
      }

      const newChunk = await response.json();
      onChunksChange?.([...chunks, newChunk]);
      setIsCreating(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create chunk');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, chunks, onChunksChange]);

  // Update chunk
  const handleUpdate = useCallback(async (chunk: Chunk, data: { title: string; description: string }) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/projects/${projectId}/chunks/${chunk.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update chunk');
      }

      const updatedChunk = await response.json();
      onChunksChange?.(chunks.map(c => c.id === chunk.id ? updatedChunk : c));
      setEditingChunk(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update chunk');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, chunks, onChunksChange]);

  // Delete chunk
  const handleDelete = useCallback(async (chunk: Chunk) => {
    if (!confirm(`Delete "${chunk.title}"?`)) return;

    try {
      setIsLoading(true);
      const response = await fetch(`/api/projects/${projectId}/chunks/${chunk.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete chunk');
      }

      onChunksChange?.(chunks.filter(c => c.id !== chunk.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete chunk');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, chunks, onChunksChange]);

  // Move chunk up/down
  const handleMove = useCallback(async (chunk: Chunk, direction: 'up' | 'down') => {
    const currentIndex = chunks.findIndex(c => c.id === chunk.id);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= chunks.length) return;

    // Swap chunks in order
    const newChunks = [...chunks];
    [newChunks[currentIndex], newChunks[newIndex]] = [newChunks[newIndex], newChunks[currentIndex]];

    // Update local state first for immediate feedback
    onChunksChange?.(newChunks);

    // Persist to server
    try {
      const response = await fetch(`/api/projects/${projectId}/chunks/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunkIds: newChunks.map(c => c.id) }),
      });

      if (!response.ok) {
        // Revert on error
        onChunksChange?.(chunks);
        throw new Error('Failed to reorder');
      }

      const updatedChunks = await response.json();
      onChunksChange?.(updatedChunks);
    } catch (err) {
      console.error('Failed to reorder chunks:', err);
    }
  }, [projectId, chunks, onChunksChange]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Chunks ({chunks.length})
        </h2>
        <button
          onClick={() => setIsCreating(true)}
          disabled={isLoading}
          className="text-xs bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Chunk
        </button>
      </div>

      {/* Chunks list */}
      <div className="flex-1 overflow-auto min-h-0 space-y-2">
        {chunks.length === 0 ? (
          <div className="bg-gray-900/50 border border-dashed border-gray-700 rounded-lg p-8 text-center">
            <p className="text-gray-500 text-sm">
              No chunks yet. Break your spec into executable tasks.
            </p>
          </div>
        ) : (
          chunks.map((chunk, index) => (
            <ChunkItem
              key={chunk.id}
              chunk={chunk}
              index={index}
              isFirst={index === 0}
              isLast={index === chunks.length - 1}
              isRunning={runningChunkId === chunk.id}
              onEdit={() => setEditingChunk(chunk)}
              onDelete={() => handleDelete(chunk)}
              onMoveUp={() => handleMove(chunk, 'up')}
              onMoveDown={() => handleMove(chunk, 'down')}
              onRun={() => onRunChunk?.(chunk)}
            />
          ))
        )}
      </div>

      {/* Create modal */}
      {isCreating && (
        <ChunkEditor
          onSubmit={handleCreate}
          onCancel={() => setIsCreating(false)}
          isLoading={isLoading}
        />
      )}

      {/* Edit modal */}
      {editingChunk && (
        <ChunkEditor
          chunk={editingChunk}
          onSubmit={(data) => handleUpdate(editingChunk, data)}
          onCancel={() => setEditingChunk(null)}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}
