'use client';

import { useState } from 'react';
import type { Task } from '@/lib/types';

interface ActiveTasksPanelProps {
  tasks: Task[];
}

export default function ActiveTasksPanel({ tasks }: ActiveTasksPanelProps) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  function formatDuration(startedAt: number | null): string {
    if (!startedAt) return '0s';
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  function getStatusBadge(status: string): { text: string; classes: string } {
    switch (status) {
      case 'running':
        return { text: 'Running', classes: 'bg-blue-600 text-white' };
      case 'pending':
        return { text: 'Pending', classes: 'bg-yellow-600 text-white' };
      case 'completed':
        return { text: 'Completed', classes: 'bg-green-600 text-white' };
      case 'failed':
        return { text: 'Failed', classes: 'bg-red-600 text-white' };
      case 'cancelled':
        return { text: 'Cancelled', classes: 'bg-gray-600 text-white' };
      default:
        return { text: status, classes: 'bg-gray-600 text-white' };
    }
  }

  async function handleCancel(taskId: string) {
    setCancellingId(taskId);
    try {
      const res = await fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
    } catch (error) {
      console.error('Error cancelling task:', error);
    } finally {
      setCancellingId(null);
    }
  }

  function toggleExpand(taskId: string) {
    setExpandedTaskId(expandedTaskId === taskId ? null : taskId);
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">
          Active Tasks
        </h2>
        <span className="bg-blue-600 text-white text-xs font-medium px-2 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>
      {tasks.length === 0 ? (
        <p className="text-gray-500 italic">No active tasks</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const badge = getStatusBadge(task.status);
            const isExpanded = expandedTaskId === task.id;
            const isRunning = task.status === 'running';

            return (
              <div
                key={task.id}
                className="bg-gray-800 rounded-lg overflow-hidden"
              >
                <div
                  className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-750"
                  onClick={() => toggleExpand(task.id)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {isRunning && (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200 truncate">
                        {task.description || task.id}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.classes}`}
                    >
                      {badge.text}
                    </span>
                    <span className="text-xs text-gray-500 w-16 text-right">
                      {formatDuration(task.started_at)}
                    </span>
                    {(task.status === 'running' || task.status === 'pending') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancel(task.id);
                        }}
                        disabled={cancellingId === task.id}
                        className="text-red-500 hover:text-red-400 disabled:text-gray-600 text-xs font-medium px-2 py-1 rounded border border-red-900 hover:border-red-700 disabled:border-gray-700"
                      >
                        {cancellingId === task.id ? 'Cancelling...' : 'Cancel'}
                      </button>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-gray-700 px-3 py-3 space-y-2">
                    {task.prompt && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Prompt:</p>
                        <div className="bg-gray-900 rounded p-2 text-xs text-gray-300 max-h-40 overflow-y-auto whitespace-pre-wrap">
                          {task.prompt}
                        </div>
                      </div>
                    )}
                    {task.output && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Output:</p>
                        <div className="bg-gray-900 rounded p-2 text-xs text-gray-300 max-h-40 overflow-y-auto whitespace-pre-wrap">
                          {task.output}
                        </div>
                      </div>
                    )}
                    {task.error && (
                      <div>
                        <p className="text-xs text-red-500 mb-1">Error:</p>
                        <div className="bg-red-900/20 rounded p-2 text-xs text-red-400 max-h-40 overflow-y-auto whitespace-pre-wrap">
                          {task.error}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
