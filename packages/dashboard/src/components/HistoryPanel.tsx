'use client';

import { useEffect, useState } from 'react';
import type { Task, ToolCall, TaskDetailsResponse } from '@/lib/types';

const TASKS_PER_PAGE = 20;

export default function HistoryPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [expandedTaskToolCalls, setExpandedTaskToolCalls] = useState<ToolCall[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchTasks();
  }, [searchQuery, statusFilter, currentPage]);

  async function fetchTasks() {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', TASKS_PER_PAGE.toString());
      params.set('offset', (currentPage * TASKS_PER_PAGE).toString());
      if (searchQuery) params.set('search', searchQuery);
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/history?${params.toString()}`);
      const data = await res.json();
      setTasks(data.tasks || []);
      setTotalCount(data.tasks?.length || 0);
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchTaskDetails(taskId: string) {
    try {
      const res = await fetch(`/api/task/${taskId}`);
      const json = await res.json();
      const data: TaskDetailsResponse = json.data || json;
      setExpandedTaskToolCalls(data.toolCalls || []);
    } catch (error) {
      console.error('Error fetching task details:', error);
    }
  }

  async function toggleExpand(taskId: string) {
    if (expandedTaskId === taskId) {
      setExpandedTaskId(null);
      setExpandedTaskToolCalls([]);
    } else {
      setExpandedTaskId(taskId);
      await fetchTaskDetails(taskId);
    }
  }

  function formatDuration(startedAt: number | null, completedAt: number | null): string {
    if (!startedAt) return '-';
    const end = completedAt || Date.now();
    const seconds = Math.floor((end - startedAt) / 1000);
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

  function formatServerId(serverId: string): string {
    return serverId.replace('_', ':');
  }

  const totalPages = Math.ceil(totalCount / TASKS_PER_PAGE);
  const statusOptions = ['', 'pending', 'running', 'completed', 'failed', 'cancelled'];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide">
          History
        </h2>
        <span className="bg-purple-600 text-white text-xs font-medium px-2 py-0.5 rounded-full">
          {totalCount}
        </span>
      </div>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="Search tasks..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setCurrentPage(0);
          }}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-600"
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setCurrentPage(0);
          }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-600"
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status === '' ? 'All Statuses' : status.charAt(0).toUpperCase() + status.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-gray-500 italic">Loading...</p>
      ) : tasks.length === 0 ? (
        <p className="text-gray-500 italic">No tasks found</p>
      ) : (
        <>
          <div className="space-y-2">
            {tasks.map((task) => {
              const badge = getStatusBadge(task.status);
              const isExpanded = expandedTaskId === task.id;

              return (
                <div key={task.id} className="bg-gray-800 rounded-lg overflow-hidden">
                  <div
                    className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-750"
                    onClick={() => toggleExpand(task.id)}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate">
                          {task.description || task.id}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {formatServerId(task.server_id)}
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
                        {formatDuration(task.started_at, task.completed_at)}
                      </span>
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
                      {expandedTaskToolCalls.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Tool Calls:</p>
                          <div className="space-y-2">
                            {expandedTaskToolCalls.map((toolCall) => (
                              <div
                                key={toolCall.id}
                                className="bg-gray-900 rounded p-2 space-y-1"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium text-gray-300">
                                    {toolCall.tool_name}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    {toolCall.duration_ms ? `${toolCall.duration_ms}ms` : '-'}
                                  </span>
                                </div>
                                {toolCall.input && (
                                  <div className="text-xs text-gray-400 max-h-20 overflow-y-auto">
                                    <span className="text-gray-500">Input:</span>{' '}
                                    {toolCall.input}
                                  </div>
                                )}
                                {toolCall.output && (
                                  <div className="text-xs text-gray-400 max-h-20 overflow-y-auto">
                                    <span className="text-gray-500">Output:</span>{' '}
                                    {toolCall.output}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-700">
              <button
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 disabled:text-gray-600 disabled:border-gray-800 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-xs text-gray-500">
                Page {currentPage + 1} of {totalPages} ({totalCount} tasks)
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 disabled:text-gray-600 disabled:border-gray-800 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
