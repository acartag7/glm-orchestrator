'use client';

import Link from 'next/link';
import type { Spec, SpecStatus } from '@glm/shared';

interface SpecWithCounts extends Spec {
  chunkCount: number;
  completedChunkCount: number;
}

interface SpecCardProps {
  spec: SpecWithCounts;
  projectId: string;
  onDelete?: (specId: string) => void;
}

const statusConfig: Record<string, { icon: string; label: string; colors: string }> = {
  draft: {
    icon: '○',
    label: 'Draft',
    colors: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20',
  },
  ready: {
    icon: '◉',
    label: 'Ready',
    colors: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  },
  in_progress: {
    icon: '◐',
    label: 'In Progress',
    colors: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
  running: {
    icon: '◐',
    label: 'Running',
    colors: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
  review: {
    icon: '◎',
    label: 'Review',
    colors: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
  completed: {
    icon: '✓',
    label: 'Done',
    colors: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  },
  merged: {
    icon: '✓',
    label: 'Merged',
    colors: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  },
};

const defaultStatus = {
  icon: '?',
  label: 'Unknown',
  colors: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20',
};

export default function SpecCard({ spec, projectId, onDelete }: SpecCardProps) {
  const status = statusConfig[spec.status] || defaultStatus;
  const hasChunks = spec.chunkCount > 0;
  const progress = hasChunks ? `${spec.completedChunkCount}/${spec.chunkCount}` : '0/0';
  const isRunning = spec.status === 'running';

  return (
    <Link
      href={`/project/${projectId}/spec/${spec.id}`}
      className="block group"
    >
      <div className="bg-neutral-900/50 border border-neutral-800 rounded-md p-4 hover:border-neutral-700 hover:bg-neutral-900/70 transition-all">
        <div className="flex items-start gap-3">
          {/* Status icon */}
          <div className={`flex-shrink-0 w-6 h-6 flex items-center justify-center font-mono text-sm ${status.colors.split(' ')[1]}`}>
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
            <div className="flex items-center gap-2 justify-between">
              <h3 className="text-sm font-medium text-neutral-100 font-mono truncate">
                {spec.title}
              </h3>
              <span className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-mono rounded border ${status.colors}`}>
                {status.label}
              </span>
            </div>

            <div className="flex items-center gap-3 mt-2">
              {/* Chunk progress */}
              <span className="text-xs text-neutral-500 font-mono">
                {progress} chunks
              </span>

              {/* Progress bar */}
              {hasChunks && (
                <div className="flex-1 h-1 bg-neutral-800 rounded-full overflow-hidden max-w-24">
                  <div
                    className="h-full bg-emerald-500/50 transition-all"
                    style={{ width: `${(spec.completedChunkCount / spec.chunkCount) * 100}%` }}
                  />
                </div>
              )}

              {/* Branch/PR info */}
              {spec.branchName && (
                <span className="text-[10px] text-neutral-600 font-mono truncate max-w-32">
                  {spec.branchName}
                </span>
              )}
              {spec.prNumber && (
                <span className="text-[10px] text-blue-400 font-mono">
                  PR #{spec.prNumber}
                </span>
              )}
            </div>
          </div>

          {/* Delete button */}
          {onDelete && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(spec.id);
              }}
              className="flex-shrink-0 p-1.5 text-neutral-600 hover:text-red-400 hover:bg-neutral-800 rounded transition-colors opacity-0 group-hover:opacity-100"
              title="Delete spec"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}
