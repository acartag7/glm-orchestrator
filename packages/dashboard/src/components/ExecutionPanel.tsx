'use client';

import { useEffect, useState } from 'react';
import type { Chunk, ChunkToolCall, ChunkStatus } from '@glm/shared';

interface ExecutionPanelProps {
  chunk: Chunk | null;
  toolCalls: ChunkToolCall[];
  output: string;
  error: string | null;
  isRunning: boolean;
  startedAt: number | null;
  onCancel?: () => void;
}

const statusColors: Record<ChunkToolCall['status'], string> = {
  running: 'text-blue-400',
  completed: 'text-green-400',
  error: 'text-red-400',
};

export default function ExecutionPanel({
  chunk,
  toolCalls,
  output,
  error,
  isRunning,
  startedAt,
  onCancel,
}: ExecutionPanelProps) {
  const [elapsed, setElapsed] = useState(0);

  // Update elapsed time
  useEffect(() => {
    if (!isRunning || !startedAt) {
      setElapsed(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, startedAt]);

  // Format elapsed time
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  if (!chunk) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Execution
          </h2>
        </div>
        <div className="flex-1 bg-gray-900/50 border border-dashed border-gray-700 rounded-lg p-8 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-800 mb-4">
              <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm mb-2">
              Select a chunk and click run to see execution progress.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Execution
          </h2>
          <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[300px]">
            {chunk.title}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isRunning && (
            <>
              <span className="text-xs text-gray-400">
                {formatTime(elapsed)}
              </span>
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 bg-red-900/20 hover:bg-red-900/30 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              )}
            </>
          )}
          {!isRunning && chunk.status && (
            <StatusBadge status={chunk.status} />
          )}
        </div>
      </div>

      {/* Tool Calls */}
      <div className="flex-shrink-0 mb-4">
        <h3 className="text-xs font-medium text-gray-400 mb-2">Tool Calls</h3>
        {toolCalls.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-500">
              {isRunning ? 'Waiting for tool calls...' : 'No tool calls'}
            </p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800 max-h-[200px] overflow-auto">
            {toolCalls.map((tc) => (
              <div key={tc.id} className="px-3 py-2 flex items-center gap-3">
                <span className={`font-mono text-xs ${statusColors[tc.status]}`}>
                  {tc.status === 'running' ? '◐' : tc.status === 'completed' ? '✓' : '✕'}
                </span>
                <span className="text-sm text-gray-300 font-mono">{tc.tool}</span>
                {tc.input && 'file_path' in tc.input && (
                  <span className="text-xs text-gray-500 truncate flex-1">
                    {String(tc.input.file_path).split('/').pop()}
                  </span>
                )}
                {tc.completedAt && tc.startedAt && (
                  <span className="text-xs text-gray-500">
                    {((tc.completedAt - tc.startedAt) / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Output */}
      <div className="flex-1 min-h-0 flex flex-col">
        <h3 className="text-xs font-medium text-gray-400 mb-2 flex-shrink-0">Output</h3>
        <div className="flex-1 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          {error ? (
            <div className="p-4 text-sm text-red-400 bg-red-900/10">
              <p className="font-medium mb-1">Error</p>
              <p>{error}</p>
            </div>
          ) : output ? (
            <pre className="p-4 text-sm text-gray-300 whitespace-pre-wrap font-mono overflow-auto h-full">
              {output}
            </pre>
          ) : (
            <div className="p-4 flex items-center justify-center h-full">
              <p className="text-xs text-gray-500">
                {isRunning ? 'Executing...' : 'No output yet'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ChunkStatus }) {
  const config: Record<ChunkStatus, { bg: string; text: string; label: string }> = {
    pending: { bg: 'bg-gray-700', text: 'text-gray-300', label: 'Pending' },
    running: { bg: 'bg-blue-900/30', text: 'text-blue-400', label: 'Running' },
    completed: { bg: 'bg-green-900/30', text: 'text-green-400', label: 'Completed' },
    failed: { bg: 'bg-red-900/30', text: 'text-red-400', label: 'Failed' },
    cancelled: { bg: 'bg-yellow-900/20', text: 'text-yellow-400', label: 'Cancelled' },
  };

  const { bg, text, label } = config[status];

  return (
    <span className={`text-xs px-2 py-1 rounded ${bg} ${text}`}>
      {label}
    </span>
  );
}
