'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Project, Spec } from '@specwright/shared';
import SpecStudioWizard from '@/components/spec-studio/SpecStudioWizard';

interface ProjectData {
  project: Project;
  spec: Spec | null;
}

export default function SpecEditPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const specId = params.specId as string;

  const [project, setProject] = useState<Project | null>(null);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch project and spec
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

        // Fetch spec
        const specResponse = await fetch(`/api/specs/${specId}`);
        if (!specResponse.ok) {
          if (specResponse.status === 404) {
            throw new Error('Spec not found');
          }
          throw new Error('Failed to load spec');
        }
        const specResult = await specResponse.json();
        setSpec(specResult.spec);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [projectId, specId]);

  const handleComplete = () => {
    // Navigate to spec workspace after completion
    router.push(`/project/${projectId}/spec/${specId}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-neutral-400 font-mono">
          <svg className="animate-spin w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading...
        </div>
      </div>
    );
  }

  if (error || !project || !spec) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-medium text-neutral-100 mb-2 font-mono">
            {error || 'Not found'}
          </h2>
          <Link
            href={`/project/${projectId}`}
            className="text-emerald-400 hover:text-emerald-300 text-sm font-mono"
          >
            Back to project
          </Link>
        </div>
      </div>
    );
  }

  return (
    <SpecStudioWizard
      projectId={projectId}
      projectName={project.name}
      projectDirectory={project.directory}
      specId={specId}
      existingSpec={spec}
      onComplete={handleComplete}
    />
  );
}
