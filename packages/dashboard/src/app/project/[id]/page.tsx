'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Project, Spec, Chunk } from '@glm/shared';
import SpecEditor from '@/components/SpecEditor';
import ChunkList from '@/components/ChunkList';
import ExecutionPanel from '@/components/ExecutionPanel';
import { useExecution } from '@/hooks/useExecution';

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
  const [selectedChunk, setSelectedChunk] = useState<Chunk | null>(null);

  const { state: executionState, runChunk, abortChunk } = useExecution();

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
    // Update selected chunk if it was updated
    if (selectedChunk) {
      const updated = updatedChunks.find(c => c.id === selectedChunk.id);
      if (updated) setSelectedChunk(updated);
    }
  }, [selectedChunk]);

  // Handle running a chunk
  const handleRunChunk = useCallback(async (chunk: Chunk) => {
    setSelectedChunk(chunk);
    try {
      await runChunk(chunk.id);
      // Refresh chunks to get updated status
      const response = await fetch(`/api/projects/${projectId}/chunks`);
      if (response.ok) {
        const updatedChunks = await response.json();
        setChunks(updatedChunks);
      }
    } catch (err) {
      console.error('Failed to run chunk:', err);
    }
  }, [runChunk, projectId]);

  // Handle cancelling execution
  const handleCancelExecution = useCallback(async () => {
    if (executionState.chunkId) {
      try {
        await abortChunk(executionState.chunkId);
        // Refresh chunks
        const response = await fetch(`/api/projects/${projectId}/chunks`);
        if (response.ok) {
          const updatedChunks = await response.json();
          setChunks(updatedChunks);
        }
      } catch (err) {
        console.error('Failed to abort chunk:', err);
      }
    }
  }, [abortChunk, executionState.chunkId, projectId]);

  // Sync chunk status from execution state
  useEffect(() => {
    if (executionState.chunkId && executionState.status) {
      setChunks(prev => prev.map(c =>
        c.id === executionState.chunkId
          ? { ...c, status: executionState.status! }
          : c
      ));
    }
  }, [executionState.chunkId, executionState.status]);

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

  // Get the chunk being executed for the panel
  const executingChunk = executionState.chunkId
    ? chunks.find(c => c.id === executionState.chunkId) || selectedChunk
    : selectedChunk;

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
          {executionState.isRunning && (
            <div className="flex items-center gap-2 text-sm text-blue-400">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Running...
            </div>
          )}
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
              runningChunkId={executionState.chunkId}
            />
          </div>
        </div>

        {/* Right Column - Execution */}
        <div className="w-1/2 flex flex-col min-h-0">
          <div className="flex-1 p-6 overflow-auto">
            <ExecutionPanel
              chunk={executingChunk || null}
              toolCalls={executionState.toolCalls}
              output={executionState.output}
              error={executionState.error}
              isRunning={executionState.isRunning}
              startedAt={executionState.startedAt}
              onCancel={executionState.isRunning ? handleCancelExecution : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
