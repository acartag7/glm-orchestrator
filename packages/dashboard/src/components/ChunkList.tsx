'use client';

import { useState, useCallback } from 'react';
import type { Chunk } from '@glm/shared';
import ChunkItem from './ChunkItem';
import ChunkEditor from './ChunkEditor';
import ChunkGraph from './ChunkGraph';
import ExecutionPlan from './ExecutionPlan';
import ViewModeToggle, { type ViewMode } from './ViewModeToggle';
import DependencyEditor from './DependencyEditor';

interface ChunkListProps {
  specId: string;
  chunks: Chunk[];
  onChunksChange?: (chunks: Chunk[]) => void;
  onRunChunk?: (chunk: Chunk) => void;
  onRunAll?: () => void;
  onSelectChunk?: (chunk: Chunk) => void;
  runningChunkId?: string | null;
  selectedChunkId?: string;
  isRunAllRunning?: boolean;
}

export default function ChunkList({
  specId,
  chunks,
  onChunksChange,
  onRunChunk,
  onRunAll,
  onSelectChunk,
  runningChunkId,
  selectedChunkId,
  isRunAllRunning,
}: ChunkListProps) {
  const [editingChunk, setEditingChunk] = useState<Chunk | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingDependenciesChunk, setEditingDependenciesChunk] = useState<Chunk | null>(null);

  // Create chunk map for dependency lookups
  const chunkMap = new Map(chunks.map(c => [c.id, c]));

  // Create new chunk
  const handleCreate = useCallback(async (data: { title: string; description: string }) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/specs/${specId}/chunks`, {
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
  }, [specId, chunks, onChunksChange]);

  // Update chunk
  const handleUpdate = useCallback(async (chunk: Chunk, data: { title: string; description: string }) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/chunks/${chunk.id}`, {
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
  }, [chunks, onChunksChange]);

  // Delete chunk
  const handleDelete = useCallback(async (chunk: Chunk) => {
    if (!confirm(`Delete "${chunk.title}"?`)) return;

    try {
      setIsLoading(true);
      const response = await fetch(`/api/chunks/${chunk.id}`, {
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
  }, [chunks, onChunksChange]);

  // Update chunk dependencies
  const handleUpdateDependencies = useCallback(async (dependencies: string[]) => {
    if (!editingDependenciesChunk) return;

    try {
      setIsLoading(true);
      const response = await fetch(`/api/chunks/${editingDependenciesChunk.id}/dependencies`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependencies }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update dependencies');
      }

      const updatedChunk = await response.json();
      onChunksChange?.(chunks.map(c => c.id === editingDependenciesChunk.id ? updatedChunk : c));
      setEditingDependenciesChunk(null);
    } catch (err) {
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [editingDependenciesChunk, chunks, onChunksChange]);

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
      const response = await fetch(`/api/specs/${specId}/chunks/reorder`, {
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
  }, [specId, chunks, onChunksChange]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-mono text-neutral-500 uppercase tracking-wide">
            chunks ({chunks.length})
          </h2>
          <ViewModeToggle viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>
        <button
          onClick={() => setIsCreating(true)}
          disabled={isLoading}
          className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 px-2 py-0.5 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          add chunk
        </button>
      </div>

      {/* Chunks view */}
      <div className="flex-1 overflow-auto min-h-0">
        {viewMode === 'list' && (
          <div className="space-y-1.5">
            {chunks.length === 0 ? (
              <div className="bg-neutral-900/50 border border-dashed border-neutral-800 rounded-md p-6 text-center">
                <p className="text-neutral-600 text-xs font-mono">
                  no chunks yet. break your spec into executable tasks.
                </p>
              </div>
            ) : (
              chunks.map((chunk, index) => (
                <ChunkItem
                  key={chunk.id}
                  chunk={chunk}
                  chunkMap={chunkMap}
                  index={index}
                  isFirst={index === 0}
                  isLast={index === chunks.length - 1}
                  isRunning={runningChunkId === chunk.id}
                  isSelected={selectedChunkId === chunk.id}
                  onEdit={() => setEditingChunk(chunk)}
                  onDelete={() => handleDelete(chunk)}
                  onMoveUp={() => handleMove(chunk, 'up')}
                  onMoveDown={() => handleMove(chunk, 'down')}
                  onRun={() => onRunChunk?.(chunk)}
                  onClick={() => onSelectChunk?.(chunk)}
                  onEditDependencies={() => setEditingDependenciesChunk(chunk)}
                />
              ))
            )}
          </div>
        )}
        {viewMode === 'graph' && (
          <ChunkGraph
            chunks={chunks}
            onChunkClick={(chunk) => onSelectChunk?.(chunk)}
            onRunChunk={(chunk) => onRunChunk?.(chunk)}
            runningChunkId={runningChunkId ?? undefined}
            selectedChunkId={selectedChunkId}
          />
        )}
        {viewMode === 'plan' && (
          <ExecutionPlan
            chunks={chunks}
            onRunAll={onRunAll}
            isRunning={isRunAllRunning}
          />
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

      {/* Dependencies editor modal */}
      {editingDependenciesChunk && (
        <DependencyEditor
          chunk={editingDependenciesChunk}
          allChunks={chunks}
          onSave={handleUpdateDependencies}
          onCancel={() => setEditingDependenciesChunk(null)}
        />
      )}
    </div>
  );
}
