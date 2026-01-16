'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Terminal, Cpu } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { useWorkers } from '@/hooks/useWorkers';
import ProjectList from '@/components/ProjectList';
import CreateProjectModal from '@/components/CreateProjectModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import type { ChunkStats } from '@/components/ProjectCard';

export default function Home() {
  const router = useRouter();
  const { projects, isLoading, error, createProject, deleteProject } = useProjects();
  const { state: workersState } = useWorkers();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [projectStats, setProjectStats] = useState<Record<string, ChunkStats>>({});

  // Fetch chunk stats for all projects
  useEffect(() => {
    async function fetchStats() {
      if (projects.length === 0) return;

      const stats: Record<string, ChunkStats> = {};
      await Promise.all(
        projects.map(async (project) => {
          try {
            const response = await fetch(`/api/projects/${project.id}/chunks`);
            if (response.ok) {
              const chunks = await response.json();
              stats[project.id] = {
                total: chunks.length,
                completed: chunks.filter((c: { status: string }) => c.status === 'completed').length,
                failed: chunks.filter((c: { status: string }) => c.status === 'failed').length,
                running: chunks.filter((c: { status: string }) => c.status === 'running').length,
              };
            }
          } catch {
            // Ignore errors for individual projects
          }
        })
      );
      setProjectStats(stats);
    }

    fetchStats();
  }, [projects]);

  // Handle run all chunks for a project
  const handleRunAll = useCallback((projectId: string) => {
    // Navigate to project page (run all will be handled there)
    router.push(`/project/${projectId}`);
  }, [router]);

  const handleCreate = async (data: { name: string; directory: string; description?: string }) => {
    try {
      setIsCreating(true);
      const project = await createProject(data);
      setIsModalOpen(false);
      router.push(`/project/${project.id}`);
    } catch (err) {
      console.error('Failed to create project:', err);
      alert(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      return;
    }

    try {
      await deleteProject(id);
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Failed to delete project:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  return (
    <ErrorBoundary>
    <main className="min-h-screen bg-neutral-950 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]">
      {/* Header */}
      <header className="border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Terminal icon logo */}
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <Terminal className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-sm font-medium text-neutral-100 font-mono">
                spec-driven-dev
              </h1>
              <p className="text-[10px] text-neutral-500 font-mono">
                write specs, break into chunks, execute with ai
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/workers"
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-neutral-800/50 hover:bg-neutral-800 text-neutral-300 border border-neutral-700 text-xs font-mono rounded-md transition-colors"
            >
              <Cpu className="w-3.5 h-3.5" />
              workers
              {workersState.activeCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium bg-emerald-500/20 text-emerald-400 rounded-full">
                  {workersState.activeCount}
                </span>
              )}
            </Link>
            <button
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-mono rounded-md transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              new project
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 bg-red-900/20 border border-red-800/50 rounded-md p-4 text-xs text-red-400 font-mono">
            {error.message}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-3 text-neutral-400 font-mono text-sm">
              <svg className="animate-spin w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              loading projects...
            </div>
          </div>
        ) : (
          <ProjectList
            projects={projects}
            projectStats={projectStats}
            onDelete={handleDelete}
            onRunAll={handleRunAll}
            onCreateClick={() => setIsModalOpen(true)}
          />
        )}

        {/* Delete confirmation tooltip */}
        {deleteConfirm && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-neutral-900 border border-neutral-800 rounded-md px-4 py-3 shadow-xl flex items-center gap-4 z-50">
            <span className="text-xs text-neutral-300 font-mono">click delete again to confirm</span>
            <button
              onClick={() => setDeleteConfirm(null)}
              className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors font-mono"
            >
              cancel
            </button>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreate}
        isLoading={isCreating}
      />
    </main>
    </ErrorBoundary>
  );
}
