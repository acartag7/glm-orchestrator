'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Project, Spec, Chunk, ChunkToolCall } from '@glm/shared';
import SpecEditor from '@/components/SpecEditor';
import ChunkList from '@/components/ChunkList';
import ExecutionPanel from '@/components/ExecutionPanel';
import RunAllProgressPanel from '@/components/RunAllProgressPanel';
import SpecCompletePanel from '@/components/SpecCompletePanel';
import ResizeHandle from '@/components/ResizeHandle';
import { useExecution } from '@/hooks/useExecution';
import { useRunAll } from '@/hooks/useRunAll';
import { useWorkers } from '@/hooks/useWorkers';

interface ChunkHistory {
  chunk: Chunk;
  toolCalls: ChunkToolCall[];
}

export default function SpecWorkspace() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const specId = params.specId as string;

  const [project, setProject] = useState<Project | null>(null);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChunk, setSelectedChunk] = useState<Chunk | null>(null);
  const [chunkHistory, setChunkHistory] = useState<ChunkHistory | null>(null);
  const [showRunAllPanel, setShowRunAllPanel] = useState(false);
  const [showCompletePanel, setShowCompletePanel] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);

  // Run All state
  const {
    state: runAllState,
    chunkStatuses,
    currentToolCalls: runAllToolCalls,
    startRunAll,
    stopRunAll,
    reset: resetRunAll,
  } = useRunAll(specId);

  // Panel sizes
  const [leftPanelWidth, setLeftPanelWidth] = useState(50);
  const [specPanelHeight, setSpecPanelHeight] = useState(60);
  const containerRef = useRef<HTMLDivElement>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);

  const { state: executionState, runChunk, abortChunk, reviewChunk, clearReview } = useExecution();
  const { startWorker, state: workersState, addToQueue } = useWorkers();

  // Handle horizontal resize
  const handleHorizontalResize = useCallback((delta: number) => {
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.offsetWidth;
    const deltaPercent = (delta / containerWidth) * 100;
    setLeftPanelWidth(prev => Math.min(80, Math.max(20, prev + deltaPercent)));
  }, []);

  // Handle vertical resize
  const handleVerticalResize = useCallback((delta: number) => {
    if (!leftColumnRef.current) return;
    const columnHeight = leftColumnRef.current.offsetHeight;
    const deltaPercent = (delta / columnHeight) * 100;
    setSpecPanelHeight(prev => Math.min(80, Math.max(20, prev + deltaPercent)));
  }, []);

  // Fetch project, spec, and chunks
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
        const projectResult = await projectResponse.json();
        setProject(projectResult.project);

        // Fetch spec with chunks
        const specResponse = await fetch(`/api/specs/${specId}`);
        if (!specResponse.ok) {
          if (specResponse.status === 404) {
            throw new Error('Spec not found');
          }
          throw new Error('Failed to load spec');
        }
        const specResult = await specResponse.json();
        setSpec(specResult.spec);
        setChunks(specResult.chunks);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [projectId, specId]);

  // Handle spec updates
  const handleSpecUpdate = useCallback((updatedSpec: Spec) => {
    setSpec(updatedSpec);
  }, []);

  // Handle chunks updates
  const handleChunksChange = useCallback((updatedChunks: Chunk[]) => {
    setChunks(updatedChunks);
    if (selectedChunk) {
      const updated = updatedChunks.find(c => c.id === selectedChunk.id);
      if (updated) setSelectedChunk(updated);
    }
  }, [selectedChunk]);

  // Handle selecting a chunk to view its history
  const handleSelectChunk = useCallback(async (chunk: Chunk) => {
    setSelectedChunk(chunk);
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
      // Refresh chunks
      const response = await fetch(`/api/specs/${specId}/chunks`);
      if (response.ok) {
        const updatedChunks = await response.json();
        setChunks(updatedChunks);
      }
    } catch (err) {
      console.error('Failed to run chunk:', err);
    }
  }, [runChunk, specId]);

  // Handle cancelling execution
  const handleCancelExecution = useCallback(async () => {
    if (executionState.chunkId) {
      try {
        await abortChunk(executionState.chunkId);
        // Refresh chunks
        const response = await fetch(`/api/specs/${specId}/chunks`);
        if (response.ok) {
          const updatedChunks = await response.json();
          setChunks(updatedChunks);
        }
      } catch (err) {
        console.error('Failed to abort chunk:', err);
      }
    }
  }, [abortChunk, executionState.chunkId, specId]);

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

  // Refresh chunks after review (to get updated review status and any new fix chunks)
  const refreshChunks = useCallback(async () => {
    try {
      const response = await fetch(`/api/specs/${specId}/chunks`);
      if (response.ok) {
        const updatedChunks = await response.json();
        setChunks(updatedChunks);
      }
    } catch (err) {
      console.error('Failed to refresh chunks:', err);
    }
  }, [specId]);

  // Handle reviewing a completed chunk
  const handleReviewChunk = useCallback(async () => {
    if (!selectedChunk) return;
    try {
      await reviewChunk(selectedChunk.id);
      await refreshChunks();
    } catch (err) {
      console.error('Failed to review chunk:', err);
    }
  }, [selectedChunk, reviewChunk, refreshChunks]);

  // Handle running a fix chunk
  const handleRunFix = useCallback(async (fixChunkId: string) => {
    try {
      await refreshChunks();
      const fixChunk = chunks.find(c => c.id === fixChunkId);
      if (fixChunk) {
        setSelectedChunk(fixChunk);
        await runChunk(fixChunkId);
        await refreshChunks();
      }
    } catch (err) {
      console.error('Failed to run fix chunk:', err);
    }
  }, [chunks, runChunk, refreshChunks]);

  // Handle skipping review (clear review state)
  const handleSkipReview = useCallback(() => {
    clearReview();
  }, [clearReview]);

  // Handle marking a chunk as done (clear review and move on)
  const handleMarkDone = useCallback(() => {
    clearReview();
  }, [clearReview]);

  // Handle Run All
  const handleRunAll = useCallback(async () => {
    setShowRunAllPanel(true);
    await startRunAll();
    // Refresh chunks after run all completes
    await refreshChunks();
  }, [startRunAll, refreshChunks]);

  // Handle Run in Background (creates a worker)
  const handleRunInBackground = useCallback(async () => {
    try {
      if (!workersState.hasCapacity) {
        // Add to queue if at capacity
        const result = await addToQueue(specId);
        if (result) {
          alert('Added to worker queue. Will start when a slot is available.');
        }
      } else {
        const worker = await startWorker(specId);
        if (worker) {
          router.push('/workers');
        }
      }
    } catch (err) {
      console.error('Failed to start background worker:', err);
      alert(err instanceof Error ? err.message : 'Failed to start worker');
    }
  }, [specId, startWorker, addToQueue, workersState.hasCapacity, router]);

  // Handle closing Run All panel
  const handleCloseRunAll = useCallback(() => {
    setShowRunAllPanel(false);
    resetRunAll();
    // Refresh chunks to get latest status
    refreshChunks();
  }, [resetRunAll, refreshChunks]);

  // Watch for run all completion to refresh chunks and show complete panel
  useEffect(() => {
    if (!runAllState.isRunning && showRunAllPanel && runAllState.progress.current > 0) {
      refreshChunks();
    }
  }, [runAllState.isRunning, showRunAllPanel, runAllState.progress.current, refreshChunks]);

  // Check if all chunks are completed to show completion panel
  const allChunksCompleted = chunks.length > 0 && chunks.every(c => c.status === 'completed');
  const hasPassedReview = chunks.every(c => c.reviewStatus === 'pass' || c.reviewStatus === undefined);
  const showCompletionState = allChunksCompleted && hasPassedReview && !executionState.isRunning && !runAllState.isRunning;

  // Auto-show complete panel when Run All finishes successfully
  useEffect(() => {
    if (showCompletionState && !showCompletePanel && showRunAllPanel && !runAllState.isRunning) {
      setShowCompletePanel(true);
      setShowRunAllPanel(false);
    }
  }, [showCompletionState, showCompletePanel, showRunAllPanel, runAllState.isRunning]);

  // Refresh spec data
  const refreshSpec = useCallback(async () => {
    try {
      const response = await fetch(`/api/specs/${specId}`);
      if (response.ok) {
        const data = await response.json();
        setSpec(data.spec);
      }
    } catch (err) {
      console.error('Failed to refresh spec:', err);
    }
  }, [specId]);

  // Git handlers
  const handleCreateBranch = useCallback(async () => {
    setGitError(null);
    try {
      const response = await fetch(`/api/specs/${specId}/git/branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create branch');
      }
      await refreshSpec();
    } catch (err) {
      setGitError(err instanceof Error ? err.message : 'Failed to create branch');
      throw err;
    }
  }, [specId, refreshSpec]);

  const handleCommitOnly = useCallback(async () => {
    setGitError(null);
    try {
      const response = await fetch(`/api/specs/${specId}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create commit');
      }
    } catch (err) {
      setGitError(err instanceof Error ? err.message : 'Failed to create commit');
      throw err;
    }
  }, [specId]);

  const handleCreatePR = useCallback(async () => {
    setGitError(null);
    try {
      const response = await fetch(`/api/specs/${specId}/git/pr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create PR');
      }
      await refreshSpec();
    } catch (err) {
      setGitError(err instanceof Error ? err.message : 'Failed to create PR');
      throw err;
    }
  }, [specId, refreshSpec]);

  const handleMarkMerged = useCallback(async () => {
    setGitError(null);
    try {
      const response = await fetch(`/api/specs/${specId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'merged' }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update spec');
      }
      setSpec(data);
    } catch (err) {
      setGitError(err instanceof Error ? err.message : 'Failed to mark as merged');
      throw err;
    }
  }, [specId]);

  const handleSkipGit = useCallback(() => {
    setShowCompletePanel(false);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-neutral-400 font-mono">
          <svg className="animate-spin w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading spec...
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

  // Determine what to show in the execution panel
  const isCurrentlyRunning = executionState.isRunning && executionState.chunkId;
  const displayChunk = isCurrentlyRunning
    ? chunks.find(c => c.id === executionState.chunkId) || selectedChunk
    : selectedChunk;

  const displayToolCalls = isCurrentlyRunning
    ? executionState.toolCalls
    : (chunkHistory?.toolCalls || []);
  const displayOutput = isCurrentlyRunning
    ? executionState.output
    : (chunkHistory?.chunk.output || '');
  const displayError = executionState.error
    || (isCurrentlyRunning ? null : (chunkHistory?.chunk.error || null));

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]">
      {/* Header */}
      <header className="border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-6 py-3 flex items-center gap-4">
          <Link
            href={`/project/${projectId}`}
            className="p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-md transition-colors"
            title="Back to specs"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div className="flex items-center gap-2 text-sm font-mono">
            <span className="text-neutral-500">/</span>
            <span className="text-neutral-400">project</span>
            <span className="text-neutral-500">/</span>
            <span className="text-neutral-400">{project.name}</span>
            <span className="text-neutral-500">/</span>
            <span className="text-neutral-100 truncate max-w-48">{spec.title}</span>
          </div>

          {/* Git status indicators */}
          {spec.branchName && (
            <span className="flex items-center gap-1.5 text-xs text-neutral-500 font-mono bg-neutral-800/50 px-2 py-1 rounded">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              {spec.branchName}
            </span>
          )}

          {spec.prUrl && (
            <a
              href={spec.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-mono bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20 transition-colors"
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              PR #{spec.prNumber}
            </a>
          )}

          {spec.status === 'merged' && (
            <span className="flex items-center gap-1.5 text-xs text-violet-400 font-mono bg-violet-500/10 px-2 py-1 rounded border border-violet-500/20">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              merged
            </span>
          )}

          <div className="flex-1" />
          <Link
            href={`/project/${projectId}/spec/${specId}/edit`}
            className="px-3 py-1.5 text-neutral-400 hover:text-neutral-200 border border-neutral-800 hover:border-neutral-700 rounded-md font-mono text-xs transition-colors flex items-center gap-1.5"
            title="Edit spec in Studio wizard"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit in Studio
          </Link>
          <button
            onClick={handleRunAll}
            disabled={runAllState.isRunning || executionState.isRunning || chunks.filter(c => c.status === 'pending' || c.status === 'failed' || c.status === 'cancelled').length === 0}
            className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-md font-mono text-xs transition-colors flex items-center gap-1.5"
            title="Run all pending chunks sequentially"
          >
            {runAllState.isRunning ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Running {runAllState.progress.current}/{runAllState.progress.total}...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Run All
              </>
            )}
          </button>
          <button
            onClick={handleRunInBackground}
            disabled={runAllState.isRunning || executionState.isRunning || chunks.filter(c => c.status === 'pending' || c.status === 'failed' || c.status === 'cancelled').length === 0}
            className="px-3 py-1.5 bg-neutral-800/50 text-neutral-300 border border-neutral-700 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-md font-mono text-xs transition-colors flex items-center gap-1.5"
            title="Run in background worker"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
            Background
          </button>
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
            <SpecEditor
              spec={spec}
              onUpdate={handleSpecUpdate}
            />
          </div>

          {/* Vertical Resize Handle */}
          <ResizeHandle direction="vertical" onResize={handleVerticalResize} />

          {/* Chunks Section */}
          <div
            className="p-4 min-h-0 overflow-auto"
            style={{ height: `${100 - specPanelHeight}%` }}
          >
            <ChunkList
              specId={specId}
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

        {/* Right Column - Execution or Run All Progress */}
        <div
          className="flex flex-col min-h-0"
          style={{ width: `${100 - leftPanelWidth}%` }}
        >
          <div className="flex-1 p-4 overflow-auto">
            {showRunAllPanel ? (
              <RunAllProgressPanel
                isRunning={runAllState.isRunning}
                currentStep={runAllState.currentStep}
                progress={runAllState.progress}
                chunkStatuses={chunkStatuses}
                currentToolCalls={runAllToolCalls}
                error={runAllState.error}
                onStop={stopRunAll}
                onClose={handleCloseRunAll}
              />
            ) : showCompletePanel || (showCompletionState && !spec.prUrl) ? (
              <SpecCompletePanel
                spec={spec}
                project={project}
                onCreatePR={handleCreatePR}
                onCommitOnly={handleCommitOnly}
                onSkip={handleSkipGit}
                onMarkMerged={handleMarkMerged}
                onCreateBranch={handleCreateBranch}
              />
            ) : (
              <ExecutionPanel
                chunk={displayChunk || null}
                toolCalls={displayToolCalls}
                output={displayOutput}
                error={displayError}
                isRunning={executionState.isRunning}
                startedAt={executionState.startedAt}
                onCancel={executionState.isRunning ? handleCancelExecution : undefined}
                isReviewing={executionState.isReviewing}
                reviewResult={executionState.reviewResult}
                fixChunkId={executionState.fixChunkId}
                onReview={handleReviewChunk}
                onRunFix={handleRunFix}
                onSkipReview={handleSkipReview}
                onMarkDone={handleMarkDone}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
