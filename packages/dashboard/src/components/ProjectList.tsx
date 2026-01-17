'use client';

import type { Project } from '@specwright/shared';
import ProjectCard, { type ChunkStats } from './ProjectCard';
import { Terminal } from 'lucide-react';

interface ProjectListProps {
  projects: Project[];
  projectStats?: Record<string, ChunkStats>;
  onDelete?: (id: string) => void;
  onRunAll?: (id: string) => void;
  onCreateClick?: () => void;
}

export default function ProjectList({ projects, projectStats, onDelete, onRunAll, onCreateClick }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-md bg-emerald-500/10 border border-emerald-500/20 mb-4">
          <Terminal className="w-6 h-6 text-emerald-400" />
        </div>
        <h3 className="text-sm font-medium text-neutral-300 mb-2 font-mono">no projects yet</h3>
        <p className="text-xs text-neutral-500 mb-6 max-w-sm mx-auto font-mono">
          create your first project to start writing specs and executing them with ai.
        </p>
        {onCreateClick && (
          <button
            onClick={onCreateClick}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-mono rounded-md transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            create project
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          chunkStats={projectStats?.[project.id]}
          onDelete={onDelete}
          onRunAll={onRunAll}
        />
      ))}
    </div>
  );
}
