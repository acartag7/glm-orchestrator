'use client';

import type { Chunk, ReviewStatus } from '@glm/shared';

interface ChunkItemProps {
  chunk: Chunk;
  chunkMap?: Map<string, Chunk>;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  isRunning: boolean;
  isSelected?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRun: () => void;
  onClick?: () => void;
  onEditDependencies?: () => void;
}

const statusConfig = {
  pending: {
    icon: '○',
    color: 'text-neutral-500',
    bg: 'bg-neutral-900/50',
    label: 'Pending',
  },
  running: {
    icon: '◐',
    color: 'text-amber-400',
    bg: 'bg-amber-900/20',
    label: 'Running',
  },
  completed: {
    icon: '✓',
    color: 'text-emerald-400',
    bg: 'bg-emerald-900/20',
    label: 'Completed',
  },
  failed: {
    icon: '✕',
    color: 'text-red-400',
    bg: 'bg-red-900/20',
    label: 'Failed',
  },
  cancelled: {
    icon: '⊘',
    color: 'text-amber-400',
    bg: 'bg-amber-900/10',
    label: 'Cancelled',
  },
};

const reviewConfig: Record<ReviewStatus, { icon: string; color: string; label: string }> = {
  pass: {
    icon: '✓',
    color: 'text-emerald-400',
    label: 'Passed',
  },
  needs_fix: {
    icon: '⚠',
    color: 'text-amber-400',
    label: 'Needs Fix',
  },
  fail: {
    icon: '✕',
    color: 'text-red-400',
    label: 'Failed',
  },
};

// Truncate text to ~100 chars
function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

export default function ChunkItem({
  chunk,
  chunkMap,
  index,
  isFirst,
  isLast,
  isRunning,
  isSelected,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onRun,
  onClick,
  onEditDependencies,
}: ChunkItemProps) {
  const status = statusConfig[chunk.status];
  const canRun = chunk.status === 'pending' || chunk.status === 'failed' || chunk.status === 'cancelled';

  // Check if all dependencies are completed
  const allDepsCompleted = chunk.dependencies.every(depId => {
    const dep = chunkMap?.get(depId);
    return dep?.status === 'completed';
  });

  // Check if blocked (has uncompleted dependencies)
  const isBlocked = chunk.dependencies.length > 0 && !allDepsCompleted && chunk.status !== 'completed' && chunk.status !== 'running';

  // Get dependency details
  const deps = chunk.dependencies.map(depId => {
    const dep = chunkMap?.get(depId);
    return {
      id: depId,
      title: dep?.title || depId,
      status: dep?.status || 'pending',
    };
  });

  return (
    <div
      className={`${status.bg} border ${isSelected ? 'border-emerald-500/50' : 'border-neutral-800'} rounded-md p-2.5 group cursor-pointer hover:border-neutral-700 transition-colors`}
      onClick={onClick}
    >
      <div className="flex items-start gap-2.5">
        {/* Status indicator */}
        <div className={`flex-shrink-0 w-5 h-5 flex items-center justify-center ${status.color} font-mono text-xs`}>
          {isRunning ? (
            <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            status.icon
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-neutral-600 font-mono">{index + 1}.</span>
            <h4 className="text-sm font-medium text-neutral-200 font-mono truncate">{chunk.title}</h4>
          </div>
          <p className="text-xs text-neutral-500 mt-1 font-mono" title={chunk.description}>
            {truncateText(chunk.description, 80)}
          </p>

          {/* Dependencies with inline status */}
          {deps.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              <div className="text-[10px] font-mono text-neutral-500">
                ↪ depends on:{' '}
                {deps.slice(0, 2).map((dep, idx) => (
                  <span key={dep.id}>
                    <span className={dep.status === 'completed' ? 'text-emerald-400' : 'text-neutral-500'}>
                      {dep.status === 'completed' ? '✓' : '○'}
                    </span>
                    <span className={dep.status === 'completed' ? 'text-neutral-400' : 'text-neutral-500'}>
                      {' '}{dep.title.length > 20 ? dep.title.slice(0, 18) + '...' : dep.title}
                    </span>
                    {idx < Math.min(deps.length, 2) - 1 && <span className="text-neutral-600">, </span>}
                  </span>
                ))}
                {deps.length > 2 && (
                  <span className="text-neutral-600"> +{deps.length - 2}</span>
                )}
              </div>
              {/* Can run / Blocked indicator */}
              {allDepsCompleted && canRun && (
                <div className="text-[10px] font-mono text-emerald-400">
                  ✓ Can run now
                </div>
              )}
              {isBlocked && (
                <div className="text-[10px] font-mono text-neutral-500">
                  ⏳ Blocked
                </div>
              )}
            </div>
          )}

          {/* Status info */}
          {chunk.status === 'completed' && chunk.completedAt && (
            <div className="flex items-center gap-2 mt-1.5">
              <p className="text-[10px] text-neutral-600 font-mono">
                completed {new Date(chunk.completedAt).toLocaleTimeString()}
              </p>
              {/* Review status indicator */}
              {chunk.reviewStatus && (
                <span
                  className={`text-[10px] font-mono flex items-center gap-1 ${reviewConfig[chunk.reviewStatus].color}`}
                  title={chunk.reviewFeedback}
                >
                  <span>{reviewConfig[chunk.reviewStatus].icon}</span>
                  <span className="lowercase">{reviewConfig[chunk.reviewStatus].label}</span>
                </span>
              )}
            </div>
          )}
          {chunk.status === 'failed' && chunk.error && (
            <p className="text-[10px] text-red-400 mt-1.5 font-mono truncate">
              error: {chunk.error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          {/* Move up */}
          <button
            onClick={onMoveUp}
            disabled={isFirst || isRunning}
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
            disabled={isLast || isRunning}
            className="p-1 text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Edit */}
          <button
            onClick={onEdit}
            disabled={isRunning}
            className="p-1 text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Edit"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {/* Dependencies */}
          {onEditDependencies && (
            <button
              onClick={onEditDependencies}
              disabled={isRunning}
              className={`p-1 hover:bg-neutral-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                chunk.dependencies.length > 0 ? 'text-emerald-500 hover:text-emerald-400' : 'text-neutral-600 hover:text-neutral-300'
              }`}
              title="Dependencies"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </button>
          )}

          {/* Delete */}
          <button
            onClick={onDelete}
            disabled={isRunning}
            className="p-1 text-neutral-600 hover:text-red-400 hover:bg-neutral-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Delete"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>

          {/* Run/Retry */}
          {canRun && (
            <button
              onClick={onRun}
              disabled={isRunning}
              className="p-1 text-emerald-500 hover:text-emerald-400 hover:bg-neutral-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={chunk.status === 'failed' ? 'Retry' : 'Run'}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}

          {/* Stop (when running) */}
          {chunk.status === 'running' && (
            <button
              className="p-1 text-red-500 hover:text-red-400 hover:bg-neutral-800 rounded transition-colors"
              title="Stop"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
