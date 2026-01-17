'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Project, Spec, SpecStatus } from '@specwright/shared';
import SpecCard from '@/components/SpecCard';
import ErrorBoundary from '@/components/ErrorBoundary';
import ConfirmModal from '@/components/ConfirmModal';

interface SpecWithCounts extends Spec {
  chunkCount: number;
  completedChunkCount: number;
}

interface ProjectData {
  project: Project;
  spec: Spec | null;
}

export default function ProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [specs, setSpecs] = useState<SpecWithCounts[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingSpec, setIsCreatingSpec] = useState(false);
  const [deleteConfirmSpec, setDeleteConfirmSpec] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch project and specs
  useEffect(() => {
    async function fetchData() {
      try {
        setIsLoading(true);

        // Fetch project
        const projectResponse = await fetch(`/api/projects/${projectId}`);
        if (!projectResponse.ok) {
          if (projectResponse.status === 404) {
            throw new Error('Project not found');
          }
          throw new Error('Failed to load project');
        }
        const projectResult: ProjectData = await projectResponse.json();
        setProject(projectResult.project);

        // Fetch specs
        const specsResponse = await fetch(`/api/projects/${projectId}/specs`);
        if (specsResponse.ok) {
          const specsResult: SpecWithCounts[] = await specsResponse.json();
          setSpecs(specsResult);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [projectId]);

  // Handle creating a new spec
  const handleCreateSpec = useCallback(async () => {
    if (isCreatingSpec) return;

    try {
      setIsCreatingSpec(true);

      // Create a new spec with default title
      const response = await fetch(`/api/projects/${projectId}/specs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Spec' }),
      });

      if (!response.ok) {
        throw new Error('Failed to create spec');
      }

      const newSpec: Spec = await response.json();

      // Navigate to Spec Studio for this new spec
      router.push(`/project/${projectId}/spec/${newSpec.id}/edit`);
    } catch (err) {
      console.error('Error creating spec:', err);
      alert('Failed to create spec');
    } finally {
      setIsCreatingSpec(false);
    }
  }, [projectId, isCreatingSpec, router]);

  // Handle deleting a spec - show confirmation modal
  const handleDeleteSpec = useCallback((specId: string) => {
    setDeleteConfirmSpec(specId);
  }, []);

  // Actually delete the spec after confirmation
  const confirmDeleteSpec = useCallback(async () => {
    if (!deleteConfirmSpec) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/specs/${deleteConfirmSpec}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete spec');
      }

      // Remove from local state
      setSpecs(prev => prev.filter(s => s.id !== deleteConfirmSpec));
      setDeleteConfirmSpec(null);
    } catch (err) {
      console.error('Error deleting spec:', err);
      alert('Failed to delete spec');
    } finally {
      setIsDeleting(false);
    }
  }, [deleteConfirmSpec]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-neutral-400 font-mono">
          <svg className="animate-spin w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading project...
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-medium text-neutral-100 mb-2 font-mono">
            {error || 'Project not found'}
          </h2>
          <Link
            href="/"
            className="text-emerald-400 hover:text-emerald-300 text-sm font-mono"
          >
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  // Count specs by status
  const runningCount = specs.filter(s => s.status === 'running').length;
  const completedCount = specs.filter(s => s.status === 'completed' || s.status === 'merged').length;

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-neutral-950 flex flex-col bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]">
      {/* Header */}
      <header className="border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-6 py-3 flex items-center gap-4">
          <Link
            href="/"
            className="p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-md transition-colors"
            title="Back to projects"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div className="flex items-center gap-2 text-sm font-mono">
            <span className="text-neutral-500">/</span>
            <span className="text-neutral-400">project</span>
            <span className="text-neutral-500">/</span>
            <span className="text-neutral-100">{project.name}</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={handleCreateSpec}
            disabled={isCreatingSpec}
            className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 rounded-md font-mono text-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {isCreatingSpec ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Spec
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {/* Project Info */}
        <div className="mb-6">
          <p className="text-xs text-neutral-600 font-mono mb-2">{project.directory}</p>
          {project.description && (
            <p className="text-sm text-neutral-400 font-mono">{project.description}</p>
          )}
        </div>

        {/* Stats */}
        {specs.length > 0 && (
          <div className="flex items-center gap-4 mb-6 text-xs font-mono">
            <span className="text-neutral-500">
              {specs.length} spec{specs.length !== 1 ? 's' : ''}
            </span>
            {runningCount > 0 && (
              <span className="text-amber-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                {runningCount} running
              </span>
            )}
            {completedCount > 0 && (
              <span className="text-emerald-400">
                {completedCount} completed
              </span>
            )}
          </div>
        )}

        {/* Specs List */}
        <div className="space-y-3">
          <h2 className="text-xs text-neutral-500 font-mono uppercase tracking-wider mb-3">Specs</h2>

          {specs.length === 0 ? (
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-md p-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-neutral-800 flex items-center justify-center">
                <svg className="w-6 h-6 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-neutral-300 font-mono mb-2">No specs yet</h3>
              <p className="text-xs text-neutral-500 font-mono mb-4">
                Create your first spec to start building
              </p>
              <button
                onClick={handleCreateSpec}
                disabled={isCreatingSpec}
                className="px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 rounded-md font-mono text-xs transition-colors disabled:opacity-50"
              >
                Create First Spec
              </button>
            </div>
          ) : (
            specs.map(spec => (
              <SpecCard
                key={spec.id}
                spec={spec}
                projectId={projectId}
                onDelete={handleDeleteSpec}
              />
            ))
          )}
        </div>

        {/* Add Spec Button (bottom) */}
        {specs.length > 0 && (
          <button
            onClick={handleCreateSpec}
            disabled={isCreatingSpec}
            className="mt-4 w-full py-3 border border-dashed border-neutral-800 hover:border-neutral-700 rounded-md text-neutral-500 hover:text-neutral-300 font-mono text-xs transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Spec
          </button>
        )}
      </main>

      {/* Delete Spec Confirmation Modal */}
      {deleteConfirmSpec && (
        <ConfirmModal
          title="Delete Spec"
          message="Are you sure you want to delete this spec? This will also delete all its chunks."
          confirmLabel="delete"
          onConfirm={confirmDeleteSpec}
          onCancel={() => setDeleteConfirmSpec(null)}
          isDanger
          isLoading={isDeleting}
        />
      )}
    </div>
    </ErrorBoundary>
  );
}
