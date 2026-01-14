'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Project, Spec, Chunk } from '@glm/shared';
import SpecEditor from '@/components/SpecEditor';
import ChunkList from '@/components/ChunkList';

interface ProjectData {
  project: Project;
  spec: Spec | null;
}

export default function ProjectWorkspace() {
  const params = useParams();
  const projectId = params.id as string;

  const [data, setData] = useState<ProjectData | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningChunkId, setRunningChunkId] = useState<string | null>(null);

  // Fetch project and chunks
  useEffect(() => {
    async function fetchData() {
      try {
        setIsLoading(true);

        // Fetch project and spec
        const projectResponse = await fetch(`/api/projects/${projectId}`);
        if (!projectResponse.ok) {
          if (projectResponse.status === 404) {
            throw new Error('Project not found');
          }
          throw new Error('Failed to load project');
        }
        const projectResult = await projectResponse.json();
        setData(projectResult);

        // Fetch chunks
        const chunksResponse = await fetch(`/api/projects/${projectId}/chunks`);
        if (chunksResponse.ok) {
          const chunksResult = await chunksResponse.json();
          setChunks(chunksResult);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [projectId]);

  // Handle spec updates
  const handleSpecUpdate = useCallback((updatedSpec: Spec) => {
    setData(prev => prev ? { ...prev, spec: updatedSpec } : null);
  }, []);

  // Handle chunks updates
  const handleChunksChange = useCallback((updatedChunks: Chunk[]) => {
    setChunks(updatedChunks);
  }, []);

  // Handle running a chunk (placeholder - execution will be Day 3)
  const handleRunChunk = useCallback((chunk: Chunk) => {
    alert(`Execution coming in Day 3!\n\nWill run: "${chunk.title}"`);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-400">
          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading project...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-200 mb-2">
            {error || 'Project not found'}
          </h2>
          <Link
            href="/"
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const { project, spec } = data;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-6 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
            title="Back to projects"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-gray-100 truncate">
              {project.name}
            </h1>
            <p className="text-xs text-gray-500 truncate font-mono">
              {project.directory}
            </p>
          </div>
        </div>
      </header>

      {/* Main Content - Two Column Layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left Column - Spec & Chunks */}
        <div className="w-1/2 border-r border-gray-800 flex flex-col min-h-0">
          {/* Spec Section */}
          <div className="flex-1 p-6 border-b border-gray-800 min-h-0 overflow-auto">
            {spec && (
              <SpecEditor
                spec={spec}
                projectId={projectId}
                onUpdate={handleSpecUpdate}
              />
            )}
          </div>

          {/* Chunks Section */}
          <div className="flex-1 p-6 min-h-0 overflow-auto">
            <ChunkList
              projectId={projectId}
              chunks={chunks}
              onChunksChange={handleChunksChange}
              onRunChunk={handleRunChunk}
              runningChunkId={runningChunkId}
            />
          </div>
        </div>

        {/* Right Column - Execution */}
        <div className="w-1/2 flex flex-col min-h-0">
          <div className="flex-1 p-6 overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
                Execution
              </h2>
            </div>
            <div className="bg-gray-900/50 border border-dashed border-gray-700 rounded-lg p-8 text-center h-[calc(100%-2rem)] flex items-center justify-center">
              <div>
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-800 mb-4">
                  <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-gray-400 text-sm mb-2">
                  Select a chunk and click run to see execution progress here.
                </p>
                <p className="text-gray-600 text-xs">
                  (Execution view coming in Day 3)
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
