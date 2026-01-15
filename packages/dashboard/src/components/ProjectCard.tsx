'use client';

import type { Project } from '@glm/shared';
import Link from 'next/link';
import { Play, Trash2 } from 'lucide-react';

export interface ChunkStats {
  total: number;
  completed: number;
  failed: number;
  running: number;
}

interface ProjectCardProps {
  project: Project;
  chunkStats?: ChunkStats;
  onDelete?: (id: string) => void;
  onRunAll?: (id: string) => void;
}

export default function ProjectCard({ project, chunkStats, onDelete, onRunAll }: ProjectCardProps) {
  const timeAgo = getTimeAgo(project.updatedAt);
  const hasChunks = chunkStats && chunkStats.total > 0;
  const progress = hasChunks ? (chunkStats.completed / chunkStats.total) * 100 : 0;

  return (
    <Link
      href={`/project/${project.id}`}
      className="block group"
    >
      <div className="bg-neutral-900/50 border border-neutral-800 rounded-md p-4 hover:border-emerald-500/50 hover:bg-neutral-900/80 transition-all duration-200">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-sm text-neutral-100 truncate group-hover:text-emerald-400 transition-colors font-mono">
              {project.name}
            </h3>
            {project.description && (
              <p className="text-xs text-neutral-500 mt-1 line-clamp-2 font-mono">
                {project.description}
              </p>
            )}
          </div>

          {/* Quick action buttons */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.preventDefault()}>
            {onRunAll && hasChunks && chunkStats.completed < chunkStats.total && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRunAll(project.id);
                }}
                className="p-1.5 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors"
                title="Run all chunks"
              >
                <Play className="w-3.5 h-3.5" fill="currentColor" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(project.id);
                }}
                className="p-1.5 text-neutral-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                title="Delete project"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Chunk progress indicator */}
        {hasChunks && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-neutral-500 font-mono">
                {chunkStats.completed}/{chunkStats.total} chunks
              </span>
              {chunkStats.running > 0 && (
                <span className="text-[10px] text-amber-400 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  running
                </span>
              )}
              {chunkStats.failed > 0 && chunkStats.running === 0 && (
                <span className="text-[10px] text-red-400 font-mono">
                  {chunkStats.failed} failed
                </span>
              )}
            </div>
            <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  chunkStats.failed > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center gap-4 text-[10px] text-neutral-600 font-mono">
          <div className="flex items-center gap-1.5 truncate">
            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="truncate">{project.directory}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{timeAgo}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return new Date(timestamp).toLocaleDateString();
}
