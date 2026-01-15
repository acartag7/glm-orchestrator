'use client';

import { useState, useCallback, useRef } from 'react';
import type { RunAllState, RunAllProgress, RunAllEvent, ReviewStatus, ChunkToolCall } from '@glm/shared';

const initialProgress: RunAllProgress = {
  current: 0,
  total: 0,
  passed: 0,
  failed: 0,
  fixes: 0,
};

const initialState: RunAllState = {
  isRunning: false,
  isPaused: false,
  currentChunkId: null,
  currentStep: null,
  progress: initialProgress,
  events: [],
  error: null,
};

interface RunAllChunkStatus {
  chunkId: string;
  title: string;
  status: 'pending' | 'executing' | 'reviewing' | 'passed' | 'needs_fix' | 'failed';
  output?: string;
  reviewStatus?: ReviewStatus;
  reviewFeedback?: string;
  fixChunkId?: string;
}

interface UseRunAllReturn {
  state: RunAllState;
  chunkStatuses: RunAllChunkStatus[];
  currentToolCalls: ChunkToolCall[];
  startRunAll: () => Promise<void>;
  stopRunAll: () => Promise<void>;
  reset: () => void;
}

export function useRunAll(specId: string): UseRunAllReturn {
  const [state, setState] = useState<RunAllState>(initialState);
  const [chunkStatuses, setChunkStatuses] = useState<RunAllChunkStatus[]>([]);
  const [currentToolCalls, setCurrentToolCalls] = useState<ChunkToolCall[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const handleEvent = useCallback((eventType: string, data: Record<string, unknown>) => {
    const event: RunAllEvent = {
      type: eventType as RunAllEvent['type'],
      chunkId: data.chunkId as string | undefined,
      timestamp: (data.timestamp as number) || Date.now(),
      data,
    };

    setState(prev => ({
      ...prev,
      events: [...prev.events, event],
    }));

    switch (eventType) {
      case 'chunk_start':
        setState(prev => ({
          ...prev,
          currentChunkId: data.chunkId as string,
          currentStep: 'executing',
          progress: {
            ...prev.progress,
            current: data.index as number,
            total: data.total as number,
          },
        }));
        setCurrentToolCalls([]);
        setChunkStatuses(prev => {
          const existing = prev.find(c => c.chunkId === data.chunkId);
          if (existing) {
            return prev.map(c =>
              c.chunkId === data.chunkId
                ? { ...c, status: 'executing' as const }
                : c
            );
          }
          return [
            ...prev,
            {
              chunkId: data.chunkId as string,
              title: data.title as string,
              status: 'executing' as const,
            },
          ];
        });
        break;

      case 'tool_call':
        if (data.toolCall) {
          const toolCall = data.toolCall as ChunkToolCall;
          setCurrentToolCalls(prev => {
            const existing = prev.findIndex(t => t.id === toolCall.id);
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = toolCall;
              return updated;
            }
            return [...prev, toolCall];
          });
        }
        break;

      case 'chunk_complete':
        setChunkStatuses(prev =>
          prev.map(c =>
            c.chunkId === data.chunkId
              ? { ...c, output: data.output as string }
              : c
          )
        );
        break;

      case 'review_start':
        setState(prev => ({
          ...prev,
          currentStep: 'reviewing',
        }));
        setChunkStatuses(prev =>
          prev.map(c =>
            c.chunkId === data.chunkId
              ? { ...c, status: 'reviewing' as const }
              : c
          )
        );
        break;

      case 'review_complete':
        setChunkStatuses(prev =>
          prev.map(c =>
            c.chunkId === data.chunkId
              ? {
                  ...c,
                  status: data.status === 'pass' ? 'passed' as const :
                         data.status === 'needs_fix' ? 'needs_fix' as const :
                         'failed' as const,
                  reviewStatus: data.status as ReviewStatus,
                  reviewFeedback: data.feedback as string,
                  fixChunkId: data.fixChunkId as string | undefined,
                }
              : c
          )
        );
        if (data.status === 'pass') {
          setState(prev => ({
            ...prev,
            progress: {
              ...prev.progress,
              passed: prev.progress.passed + 1,
            },
          }));
        }
        break;

      case 'fix_chunk_start':
        setState(prev => ({
          ...prev,
          currentChunkId: data.chunkId as string,
          currentStep: 'fix',
          progress: {
            ...prev.progress,
            fixes: prev.progress.fixes + 1,
          },
        }));
        setCurrentToolCalls([]);
        setChunkStatuses(prev => {
          const existing = prev.find(c => c.chunkId === data.chunkId);
          if (existing) {
            return prev.map(c =>
              c.chunkId === data.chunkId
                ? { ...c, status: 'executing' as const }
                : c
            );
          }
          return [
            ...prev,
            {
              chunkId: data.chunkId as string,
              title: data.title as string,
              status: 'executing' as const,
            },
          ];
        });
        break;

      case 'fix_chunk_complete':
        // Fix chunk complete - waiting for review
        break;

      case 'error':
        setState(prev => ({
          ...prev,
          error: data.message as string,
        }));
        if (data.chunkId) {
          setChunkStatuses(prev =>
            prev.map(c =>
              c.chunkId === data.chunkId
                ? { ...c, status: 'failed' as const }
                : c
            )
          );
          setState(prev => ({
            ...prev,
            progress: {
              ...prev.progress,
              failed: prev.progress.failed + 1,
            },
          }));
        }
        break;

      case 'stopped':
        setState(prev => ({
          ...prev,
          isRunning: false,
          currentStep: null,
          error: data.reason as string,
        }));
        break;

      case 'all_complete':
        setState(prev => ({
          ...prev,
          isRunning: false,
          currentChunkId: null,
          currentStep: null,
          progress: {
            ...prev.progress,
            passed: data.passed as number,
            failed: data.failed as number,
            fixes: data.fixes as number,
          },
        }));
        break;
    }
  }, []);

  const startRunAll = useCallback(async () => {
    // Reset state
    setState({
      ...initialState,
      isRunning: true,
    });
    setChunkStatuses([]);
    setCurrentToolCalls([]);

    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Create EventSource for SSE
    const eventSource = new EventSource(`/api/specs/${specId}/run-all`, {
      // POST method not supported by EventSource, need to use fetch
    });

    // Actually, EventSource only supports GET. We need to use fetch with POST.
    // Close the EventSource and use fetch instead.
    eventSource.close();

    try {
      const response = await fetch(`/api/specs/${specId}/run-all`, {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        setState(prev => ({
          ...prev,
          isRunning: false,
          error: error.error || 'Failed to start Run All',
        }));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setState(prev => ({
          ...prev,
          isRunning: false,
          error: 'No response body',
        }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);
          } else if (line === '' && currentEvent && currentData) {
            // End of event
            try {
              const data = JSON.parse(currentData);
              handleEvent(currentEvent, data);
            } catch {
              console.error('Failed to parse SSE data:', currentData);
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        isRunning: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, [specId, handleEvent]);

  const stopRunAll = useCallback(async () => {
    try {
      const response = await fetch(`/api/specs/${specId}/run-all/abort`, {
        method: 'POST',
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to abort:', error);
      }

      setState(prev => ({
        ...prev,
        isRunning: false,
        isPaused: false,
      }));

      // Close event source if any
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    } catch (error) {
      console.error('Error stopping Run All:', error);
    }
  }, [specId]);

  const reset = useCallback(() => {
    setState(initialState);
    setChunkStatuses([]);
    setCurrentToolCalls([]);
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  return {
    state,
    chunkStatuses,
    currentToolCalls,
    startRunAll,
    stopRunAll,
    reset,
  };
}
