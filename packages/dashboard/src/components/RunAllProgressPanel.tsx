'use client';

import type { ChunkToolCall, ReviewStatus } from '@glm/shared';

interface ChunkStatus {
  chunkId: string;
  title: string;
  status: 'pending' | 'executing' | 'reviewing' | 'passed' | 'needs_fix' | 'failed';
  output?: string;
  reviewStatus?: ReviewStatus;
  reviewFeedback?: string;
  fixChunkId?: string;
}

interface RunAllProgressPanelProps {
  isRunning: boolean;
  currentStep: 'executing' | 'reviewing' | 'fix' | null;
  progress: {
    current: number;
    total: number;
    passed: number;
    failed: number;
    fixes: number;
  };
  chunkStatuses: ChunkStatus[];
  currentToolCalls: ChunkToolCall[];
  error: string | null;
  onStop: () => void;
  onClose: () => void;
}

export default function RunAllProgressPanel({
  isRunning,
  currentStep,
  progress,
  chunkStatuses,
  currentToolCalls,
  error,
  onStop,
  onClose,
}: RunAllProgressPanelProps) {
  // Get current chunk
  const currentChunk = chunkStatuses.find(
    c => c.status === 'executing' || c.status === 'reviewing'
  );

  // Get status icon
  const getStatusIcon = (status: ChunkStatus['status']) => {
    switch (status) {
      case 'pending':
        return <span className="text-neutral-500">○</span>;
      case 'executing':
        return <span className="text-amber-400 animate-pulse">◐</span>;
      case 'reviewing':
        return <span className="text-violet-400 animate-pulse">◎</span>;
      case 'passed':
        return <span className="text-emerald-400">✓</span>;
      case 'needs_fix':
        return <span className="text-amber-400">⚠</span>;
      case 'failed':
        return <span className="text-red-400">✕</span>;
    }
  };

  // Get status text
  const getStatusText = (status: ChunkStatus['status']) => {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'executing':
        return 'Executing';
      case 'reviewing':
        return 'Reviewing';
      case 'passed':
        return 'Passed';
      case 'needs_fix':
        return 'Needs Fix';
      case 'failed':
        return 'Failed';
    }
  };

  // Get step label
  const getStepLabel = () => {
    if (!currentStep) return 'Idle';
    switch (currentStep) {
      case 'executing':
        return 'Executing...';
      case 'reviewing':
        return 'Reviewing with Opus...';
      case 'fix':
        return 'Running fix chunk...';
    }
  };

  const isComplete = !isRunning && chunkStatuses.length > 0;
  const allPassed = progress.failed === 0 && progress.passed > 0;

  return (
    <div className="bg-neutral-900/80 border border-neutral-800 rounded-lg flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <button
              onClick={onClose}
              className="h-3 w-3 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors"
              title="Close"
            />
            <div className="h-3 w-3 rounded-full bg-amber-500/80" />
            <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
          </div>
          <span className="font-mono text-sm text-neutral-300">
            RUN ALL
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-neutral-400">
            Progress: {progress.current}/{progress.total}
          </span>
          {isRunning && (
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono text-xs text-emerald-400">
                {getStepLabel()}
              </span>
            </div>
          )}
          {isComplete && (
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${allPassed ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className={`font-mono text-xs ${allPassed ? 'text-emerald-400' : 'text-red-400'}`}>
                {allPassed ? 'Complete' : 'Failed'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Progress Stats */}
      <div className="px-4 py-2 border-b border-neutral-800 flex gap-6 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <span className="text-emerald-400">✓</span>
          <span className="text-neutral-400">Passed:</span>
          <span className="text-neutral-200">{progress.passed}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-red-400">✕</span>
          <span className="text-neutral-400">Failed:</span>
          <span className="text-neutral-200">{progress.failed}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-amber-400">⚠</span>
          <span className="text-neutral-400">Fixes:</span>
          <span className="text-neutral-200">{progress.fixes}</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 border-b border-neutral-800 bg-red-500/10">
          <div className="flex items-start gap-2 text-xs font-mono">
            <span className="text-red-400">error</span>
            <span className="text-red-300">{error}</span>
          </div>
        </div>
      )}

      {/* Chunk List */}
      <div className="flex-1 overflow-auto min-h-0 p-3">
        <div className="space-y-1">
          {chunkStatuses.map((chunk, index) => (
            <div
              key={chunk.chunkId}
              className={`flex items-center gap-3 px-3 py-2 rounded font-mono text-xs ${
                chunk.status === 'executing' || chunk.status === 'reviewing'
                  ? 'bg-neutral-800/80 border border-neutral-700'
                  : ''
              }`}
            >
              <span className="w-4">{getStatusIcon(chunk.status)}</span>
              <span className="text-neutral-500 w-6">{index + 1}.</span>
              <span className="flex-1 text-neutral-200 truncate">
                {chunk.title}
              </span>
              <span
                className={`text-xs ${
                  chunk.status === 'passed'
                    ? 'text-emerald-400'
                    : chunk.status === 'failed'
                    ? 'text-red-400'
                    : chunk.status === 'needs_fix'
                    ? 'text-amber-400'
                    : chunk.status === 'executing' || chunk.status === 'reviewing'
                    ? 'text-violet-400'
                    : 'text-neutral-500'
                }`}
              >
                {getStatusText(chunk.status)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Current Tool Calls */}
      {currentToolCalls.length > 0 && (
        <div className="border-t border-neutral-800">
          <div className="px-4 py-2 border-b border-neutral-800/50">
            <span className="font-mono text-xs text-neutral-400">
              Current: {currentChunk?.title || 'Unknown'}
            </span>
          </div>
          <div className="max-h-32 overflow-auto p-3">
            <div className="space-y-1">
              {currentToolCalls.map((toolCall) => (
                <div
                  key={toolCall.id}
                  className="flex items-center gap-3 font-mono text-xs"
                >
                  <span
                    className={
                      toolCall.status === 'running'
                        ? 'text-amber-400 animate-pulse'
                        : toolCall.status === 'completed'
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }
                  >
                    {toolCall.status === 'running'
                      ? '◐'
                      : toolCall.status === 'completed'
                      ? '✓'
                      : '✕'}
                  </span>
                  <span className="text-neutral-300">{toolCall.tool}</span>
                  {(() => {
                    const filePath = toolCall.input && typeof toolCall.input === 'object' && 'file_path' in toolCall.input
                      ? String(toolCall.input.file_path)
                      : null;
                    return filePath ? (
                      <span className="text-neutral-500 truncate">
                        {filePath.split('/').pop()}
                      </span>
                    ) : null;
                  })()}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="px-4 py-3 border-t border-neutral-800 flex items-center gap-3">
        {isRunning ? (
          <button
            onClick={onStop}
            className="px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 rounded-md font-mono text-xs transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-neutral-800 text-neutral-300 border border-neutral-700 hover:bg-neutral-700 rounded-md font-mono text-xs transition-colors"
          >
            Close
          </button>
        )}
        {isComplete && allPassed && (
          <span className="font-mono text-xs text-emerald-400">
            All chunks completed successfully!
          </span>
        )}
      </div>
    </div>
  );
}
