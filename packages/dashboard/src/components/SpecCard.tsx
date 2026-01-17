'use client';

import { useId } from 'react';
import Link from 'next/link';
import type { Spec, SpecStatus } from '@specwright/shared';

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
  const prIconId = useId();
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

              {/* Worktree indicator (ORC-29) */}
              {spec.worktreePath && !spec.prMerged && (
                <span
                  className="text-[10px] text-blue-400 font-mono flex items-center gap-1"
                  title={`Worktree: ${spec.worktreePath}`}
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 2a2 2 0 00-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V4a2 2 0 00-2-2H5zm2.5 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6.207.293a1 1 0 00-1.414 0l-6 6a1 1 0 101.414 1.414l6-6a1 1 0 000-1.414zM12.5 10a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" clipRule="evenodd" />
                  </svg>
                  worktree
                </span>
              )}

              {/* PR merged indicator (ORC-29) */}
              {spec.prMerged && (
                <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  merged
                </span>
              )}

              {/* Branch/PR info */}
              {spec.branchName && (
                <span className="text-[10px] text-neutral-600 font-mono truncate max-w-32">
                  {spec.branchName}
                </span>
              )}
              {spec.prUrl ? (
                <a
                  href={spec.prUrl}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(spec.prUrl, '_blank', 'noopener,noreferrer');
                  }}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 font-mono inline-flex items-center gap-1"
                >
                  <svg
                    className="w-3 h-3"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                    role="img"
                    aria-labelledby={prIconId}
                  >
                    <title id={prIconId}>Pull request</title>
                    <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
                  </svg>
                  PR #{spec.prNumber}
                </a>
              ) : spec.prNumber && (
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
