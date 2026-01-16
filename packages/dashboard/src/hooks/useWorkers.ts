'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Worker, WorkerQueueItem, WorkerEvent } from '@glm/shared';

interface WorkersState {
  workers: Worker[];
  queue: WorkerQueueItem[];
  activeCount: number;
  maxWorkers: number;
  hasCapacity: boolean;
  isConnected: boolean;
  error: string | null;
}

const initialState: WorkersState = {
  workers: [],
  queue: [],
  activeCount: 0,
  maxWorkers: 5,
  hasCapacity: true,
  isConnected: false,
  error: null,
};

interface UseWorkersReturn {
  state: WorkersState;
  startWorker: (specId: string) => Promise<Worker | null>;
  stopWorker: (workerId: string) => Promise<boolean>;
  pauseWorker: (workerId: string) => Promise<boolean>;
  resumeWorker: (workerId: string) => Promise<boolean>;
  addToQueue: (specId: string, priority?: number) => Promise<WorkerQueueItem | null>;
  removeFromQueue: (queueId: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

export function useWorkers(): UseWorkersReturn {
  const [state, setState] = useState<WorkersState>(initialState);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Connect to SSE stream
  const connect = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const eventSource = new EventSource('/api/workers/events');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setState(prev => ({ ...prev, isConnected: true, error: null }));
    };

    eventSource.onerror = () => {
      setState(prev => ({ ...prev, isConnected: false }));
      eventSource.close();

      // Reconnect after 5 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    };

    // Handle init event
    eventSource.addEventListener('init', (event) => {
      try {
        const data = JSON.parse(event.data);
        setState(prev => ({
          ...prev,
          workers: data.data.workers || [],
          queue: data.data.queue || [],
          activeCount: data.data.activeCount || 0,
          maxWorkers: data.data.maxWorkers || 5,
          hasCapacity: (data.data.activeCount || 0) < (data.data.maxWorkers || 5),
        }));
      } catch (e) {
        console.error('Failed to parse init event:', e);
      }
    });

    // Handle worker events
    const handleWorkerEvent = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as WorkerEvent;
        handleEvent(data);
      } catch (e) {
        console.error('Failed to parse worker event:', e);
      }
    };

    eventSource.addEventListener('worker_started', handleWorkerEvent);
    eventSource.addEventListener('worker_progress', handleWorkerEvent);
    eventSource.addEventListener('worker_chunk_start', handleWorkerEvent);
    eventSource.addEventListener('worker_chunk_complete', handleWorkerEvent);
    eventSource.addEventListener('worker_review_start', handleWorkerEvent);
    eventSource.addEventListener('worker_review_complete', handleWorkerEvent);
    eventSource.addEventListener('worker_paused', handleWorkerEvent);
    eventSource.addEventListener('worker_resumed', handleWorkerEvent);
    eventSource.addEventListener('worker_completed', handleWorkerEvent);
    eventSource.addEventListener('worker_failed', handleWorkerEvent);
    eventSource.addEventListener('worker_stopped', handleWorkerEvent);
    eventSource.addEventListener('queue_updated', handleWorkerEvent);
  }, []);

  // Handle events
  const handleEvent = useCallback((event: WorkerEvent) => {
    switch (event.type) {
      case 'worker_started':
        setState(prev => {
          const worker = event.data.worker as Worker;
          const workers = [...prev.workers.filter(w => w.id !== worker.id), worker];
          const activeCount = workers.filter(w =>
            ['idle', 'running', 'paused'].includes(w.status)
          ).length;
          return {
            ...prev,
            workers,
            activeCount,
            hasCapacity: activeCount < prev.maxWorkers,
          };
        });
        break;

      case 'worker_progress':
        setState(prev => ({
          ...prev,
          workers: prev.workers.map(w =>
            w.id === event.workerId
              ? {
                  ...w,
                  status: 'running' as const,
                  progress: (event.data.progress as Worker['progress']) || w.progress,
                  currentChunkId: event.data.currentChunkId as string | undefined,
                  currentChunkTitle: event.data.currentChunkTitle as string | undefined,
                  currentStep: event.data.currentStep as 'executing' | 'reviewing' | undefined,
                }
              : w
          ),
        }));
        break;

      case 'worker_paused':
        setState(prev => ({
          ...prev,
          workers: prev.workers.map(w =>
            w.id === event.workerId
              ? { ...w, status: 'paused' as const }
              : w
          ),
        }));
        break;

      case 'worker_resumed':
        setState(prev => ({
          ...prev,
          workers: prev.workers.map(w =>
            w.id === event.workerId
              ? { ...w, status: 'running' as const }
              : w
          ),
        }));
        break;

      case 'worker_completed':
        setState(prev => {
          const workers = prev.workers.map(w =>
            w.id === event.workerId
              ? {
                  ...w,
                  status: 'completed' as const,
                  currentChunkId: undefined,
                  currentChunkTitle: undefined,
                  currentStep: undefined,
                  progress: (event.data.progress as Worker['progress']) || w.progress,
                }
              : w
          );
          const activeCount = workers.filter(w =>
            ['idle', 'running', 'paused'].includes(w.status)
          ).length;
          return {
            ...prev,
            workers,
            activeCount,
            hasCapacity: activeCount < prev.maxWorkers,
          };
        });
        break;

      case 'worker_failed':
      case 'worker_stopped':
        setState(prev => {
          const workers = prev.workers.map(w =>
            w.id === event.workerId
              ? {
                  ...w,
                  status: 'failed' as const,
                  error: event.data.error as string | undefined,
                  currentChunkId: undefined,
                  currentChunkTitle: undefined,
                  currentStep: undefined,
                }
              : w
          );
          const activeCount = workers.filter(w =>
            ['idle', 'running', 'paused'].includes(w.status)
          ).length;
          return {
            ...prev,
            workers,
            activeCount,
            hasCapacity: activeCount < prev.maxWorkers,
          };
        });
        break;

      case 'queue_updated':
        setState(prev => ({
          ...prev,
          queue: (event.data.queue as WorkerQueueItem[]) || [],
        }));
        break;
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  // Manual refresh
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/workers');
      if (response.ok) {
        const data = await response.json();
        setState(prev => ({
          ...prev,
          workers: data.workers || [],
          queue: data.queue || [],
          activeCount: data.activeCount || 0,
          maxWorkers: data.maxWorkers || 5,
          hasCapacity: data.hasCapacity ?? true,
        }));
      }
    } catch (e) {
      console.error('Failed to refresh workers:', e);
    }
  }, []);

  // Start a worker
  const startWorker = useCallback(async (specId: string): Promise<Worker | null> => {
    try {
      const response = await fetch('/api/workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specId }),
      });

      if (!response.ok) {
        const error = await response.json();
        setState(prev => ({ ...prev, error: error.error }));
        return null;
      }

      const worker = await response.json();
      return worker;
    } catch (e) {
      setState(prev => ({
        ...prev,
        error: e instanceof Error ? e.message : 'Failed to start worker',
      }));
      return null;
    }
  }, []);

  // Stop a worker
  const stopWorker = useCallback(async (workerId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/workers/${workerId}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  // Pause a worker
  const pauseWorker = useCallback(async (workerId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/workers/${workerId}/pause`, {
        method: 'POST',
      });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  // Resume a worker
  const resumeWorker = useCallback(async (workerId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/workers/${workerId}/resume`, {
        method: 'POST',
      });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  // Add to queue
  const addToQueue = useCallback(async (specId: string, priority?: number): Promise<WorkerQueueItem | null> => {
    try {
      const response = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specId, priority }),
      });

      if (!response.ok) {
        const error = await response.json();
        setState(prev => ({ ...prev, error: error.error }));
        return null;
      }

      const queueItem = await response.json();
      return queueItem;
    } catch (e) {
      setState(prev => ({
        ...prev,
        error: e instanceof Error ? e.message : 'Failed to add to queue',
      }));
      return null;
    }
  }, []);

  // Remove from queue
  const removeFromQueue = useCallback(async (queueId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/queue/${queueId}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  return {
    state,
    startWorker,
    stopWorker,
    pauseWorker,
    resumeWorker,
    addToQueue,
    removeFromQueue,
    refresh,
  };
}
