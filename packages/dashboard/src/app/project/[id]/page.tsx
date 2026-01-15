'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Project, Spec, Chunk, ChunkToolCall } from '@glm/shared';
import SpecEditor from '@/components/SpecEditor';
import ChunkList from '@/components/ChunkList';
import ExecutionPanel from '@/components/ExecutionPanel';
import ResizeHandle from '@/components/ResizeHandle';
import { useExecution } from '@/hooks/useExecution';

interface ProjectData {
  project: Project;
  spec: Spec | null;
}

interface ChunkHistory {
  chunk: Chunk;
  toolCalls: ChunkToolCall[];
}

export default function ProjectWorkspace() {
  const params = useParams();
  const projectId = params.id as string;

  const [data, setData] = useState<ProjectData | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChunk, setSelectedChunk] = useState<Chunk | null>(null);
  const [chunkHistory, setChunkHistory] = useState<ChunkHistory | null>(null);

  // Panel sizes (in percentage for horizontal, pixels for vertical)
  const [leftPanelWidth, setLeftPanelWidth] = useState(50);
  const [specPanelHeight, setSpecPanelHeight] = useState(60); // percentage of left column
  const containerRef = useRef<HTMLDivElement>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);

  const { state: executionState, runChunk, abortChunk } = useExecution();

  // Handle horizontal resize (left/right columns)
  const handleHorizontalResize = useCallback((delta: number) => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.offsetWidth;
    const deltaPercent = (delta / containerWidth) * 100;
    setLeftPanelWidth(prev => Math.min(80, Math.max(20, prev + deltaPercent)));
  }, []);

  // Handle vertical resize (spec/chunks in left column)
  const handleVerticalResize = useCallback((delta: number) => {
    if (!leftColumnRef.current) return;
    const columnHeight = leftColumnRef.current.offsetHeight;
    const deltaPercent = (delta / columnHeight) * 100;
    setSpecPanelHeight(prev => Math.min(80, Math.max(20, prev + deltaPercent)));
  }, []);

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

  // Handle selecting a chunk to view its history
  const handleSelectChunk = useCallback(async (chunk: Chunk) => {
    setSelectedChunk(chunk);
    // Only load history for completed/failed chunks
    if (chunk.status === 'completed' || chunk.status === 'failed' || chunk.status === 'cancelled') {
      try {
        const response = await fetch(`/api/chunks/${chunk.id}`);
        if (response.ok) {
          const data = await response.json();
          setChunkHistory({ chunk: data.chunk, toolCalls: data.toolCalls });
        }
      } catch (err) {
        console.error('Failed to load chunk history:', err);
      }
    } else {
      setChunkHistory(null);
    }
  }, []);

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

  if (error || !data) {
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

  const { project, spec } = data;

  // Determine what to show in the execution panel
  const isCurrentlyRunning = executionState.isRunning && executionState.chunkId;
  const displayChunk = isCurrentlyRunning
    ? chunks.find(c => c.id === executionState.chunkId) || selectedChunk
    : selectedChunk;

  // Use execution state for running chunks, history for completed ones
  const displayToolCalls = isCurrentlyRunning
    ? executionState.toolCalls
    : (chunkHistory?.toolCalls || []);
  const displayOutput = isCurrentlyRunning
    ? executionState.output
    : (chunkHistory?.chunk.output || '');
  // Show execution state error first (for connection errors), then history error
  const displayError = executionState.error
    || (isCurrentlyRunning ? null : (chunkHistory?.chunk.error || null));

  return (
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
          <p className="text-[10px] text-neutral-600 font-mono hidden md:block">
            {project.directory}
          </p>
          {executionState.isRunning && (
            <div className="flex items-center gap-2 text-xs font-mono">
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-400">running</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content - Two Column Layout */}
      <div ref={containerRef} className="flex-1 flex min-h-0">
        {/* Left Column - Spec & Chunks */}
        <div
          ref={leftColumnRef}
          className="flex flex-col min-h-0"
          style={{ width: `${leftPanelWidth}%` }}
        >
          {/* Spec Section */}
          <div
            className="p-4 overflow-auto"
            style={{ height: `${specPanelHeight}%` }}
          >
            {spec && (
              <SpecEditor
                spec={spec}
                projectId={projectId}
                onUpdate={handleSpecUpdate}
              />
            )}
          </div>

          {/* Vertical Resize Handle */}
          <ResizeHandle direction="vertical" onResize={handleVerticalResize} />

          {/* Chunks Section */}
          <div
            className="p-4 min-h-0 overflow-auto"
            style={{ height: `${100 - specPanelHeight}%` }}
          >
            <ChunkList
              projectId={projectId}
              chunks={chunks}
              onChunksChange={handleChunksChange}
              onRunChunk={handleRunChunk}
              onSelectChunk={handleSelectChunk}
              runningChunkId={executionState.chunkId}
              selectedChunkId={selectedChunk?.id}
            />
          </div>
        </div>

        {/* Horizontal Resize Handle */}
        <ResizeHandle direction="horizontal" onResize={handleHorizontalResize} />

        {/* Right Column - Execution */}
        <div
          className="flex flex-col min-h-0"
          style={{ width: `${100 - leftPanelWidth}%` }}
        >
          <div className="flex-1 p-4 overflow-auto">
            <ExecutionPanel
              chunk={displayChunk || null}
              toolCalls={displayToolCalls}
              output={displayOutput}
              error={displayError}
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
