'use client';

import type { Chunk } from '@glm/shared';

interface ChunkItemProps {
  chunk: Chunk;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  isRunning: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRun: () => void;
}

const statusConfig = {
  pending: {
    icon: '○',
    color: 'text-gray-400',
    bg: 'bg-gray-800',
    label: 'Pending',
  },
  running: {
    icon: '◐',
    color: 'text-blue-400',
    bg: 'bg-blue-900/30',
    label: 'Running',
  },
  completed: {
    icon: '✓',
    color: 'text-green-400',
    bg: 'bg-green-900/30',
    label: 'Completed',
  },
  failed: {
    icon: '✕',
    color: 'text-red-400',
    bg: 'bg-red-900/30',
    label: 'Failed',
  },
};

export default function ChunkItem({
  chunk,
  index,
  isFirst,
  isLast,
  isRunning,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onRun,
}: ChunkItemProps) {
  const status = statusConfig[chunk.status];
  const canRun = chunk.status === 'pending' || chunk.status === 'failed';

  return (
    <div className={`${status.bg} border border-gray-800 rounded-lg p-3 group`}>
      <div className="flex items-start gap-3">
        {/* Status indicator */}
        <div className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full ${status.color} font-medium text-sm`}>
          {isRunning ? (
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
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
            <span className="text-xs text-gray-500 font-mono">{index + 1}.</span>
            <h4 className="font-medium text-gray-200 truncate">{chunk.title}</h4>
          </div>
          <p className="text-sm text-gray-400 mt-1 line-clamp-2">{chunk.description}</p>

          {/* Status info */}
          {chunk.status === 'completed' && chunk.completedAt && (
            <p className="text-xs text-gray-500 mt-2">
              Completed {new Date(chunk.completedAt).toLocaleTimeString()}
            </p>
          )}
          {chunk.status === 'failed' && chunk.error && (
            <p className="text-xs text-red-400 mt-2 line-clamp-1">
              Error: {chunk.error}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Move up */}
          <button
            onClick={onMoveUp}
            disabled={isFirst || isRunning}
            className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move up"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>

          {/* Move down */}
          <button
            onClick={onMoveDown}
            disabled={isLast || isRunning}
            className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Edit */}
          <button
            onClick={onEdit}
            disabled={isRunning}
            className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {/* Delete */}
          <button
            onClick={onDelete}
            disabled={isRunning}
            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>

          {/* Run/Retry */}
          {canRun && (
            <button
              onClick={onRun}
              disabled={isRunning}
              className="p-1.5 text-green-500 hover:text-green-400 hover:bg-gray-700 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={chunk.status === 'failed' ? 'Retry' : 'Run'}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}

          {/* Stop (when running) */}
          {chunk.status === 'running' && (
            <button
              className="p-1.5 text-red-500 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
              title="Stop"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
