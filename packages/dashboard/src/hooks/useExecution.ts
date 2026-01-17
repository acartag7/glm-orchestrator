'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Chunk, ChunkToolCall, ChunkStatus, ReviewResult, ReviewStatus } from '@specwright/shared';

interface ExecutionState {
  isRunning: boolean;
  chunkId: string | null;
  status: ChunkStatus | null;
  toolCalls: ChunkToolCall[];
  output: string;
  error: string | null;
  startedAt: number | null;
  // Review state
  isReviewing: boolean;
  reviewResult: ReviewResult | null;
  fixChunkId: string | null;
}

interface UseExecutionReturn {
  state: ExecutionState;
  runChunk: (chunkId: string) => Promise<void>;
  abortChunk: (chunkId: string) => Promise<void>;
  watchChunk: (chunkId: string) => void;
  stopWatching: () => void;
  // Review functions
  reviewChunk: (chunkId: string) => Promise<ReviewResult | null>;
  clearReview: () => void;
}

export function useExecution(): UseExecutionReturn {
  const [state, setState] = useState<ExecutionState>({
    isRunning: false,
    chunkId: null,
    status: null,
    toolCalls: [],
    output: '',
    error: null,
    startedAt: null,
    isReviewing: false,
    reviewResult: null,
    fixChunkId: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const watchingChunkIdRef = useRef<string | null>(null);

  // Cleanup event source
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    watchingChunkIdRef.current = null;
  }, []);

  // Watch a chunk's execution via SSE
  const watchChunk = useCallback((chunkId: string) => {
    // Cleanup previous
    cleanup();

    watchingChunkIdRef.current = chunkId;

    const eventSource = new EventSource(`/api/chunks/${chunkId}/events`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('init', (e) => {
      try {
        const data = JSON.parse(e.data);
        setState({
          isRunning: data.chunk.status === 'running',
          chunkId,
          status: data.chunk.status,
          toolCalls: data.toolCalls || [],
          output: data.chunk.output || '',
          error: data.chunk.error || null,
          startedAt: Date.now(),
          isReviewing: false,
          reviewResult: null,
          fixChunkId: null,
        });
      } catch (err) {
        console.error('Error parsing init event:', err);
      }
    });

    eventSource.addEventListener('status', (e) => {
      try {
        const data = JSON.parse(e.data);
        setState(prev => ({
          ...prev,
          status: data.status,
          isRunning: data.status === 'running',
        }));
      } catch (err) {
        console.error('Error parsing status event:', err);
      }
    });

    eventSource.addEventListener('tool_call', (e) => {
      try {
        const data = JSON.parse(e.data);
        setState(prev => {
          const existingIndex = prev.toolCalls.findIndex(tc => tc.id === data.toolCall.id);
          if (existingIndex >= 0) {
            // Update existing
            const newToolCalls = [...prev.toolCalls];
            newToolCalls[existingIndex] = data.toolCall;
            return { ...prev, toolCalls: newToolCalls };
          } else {
            // Add new
            return { ...prev, toolCalls: [...prev.toolCalls, data.toolCall] };
          }
        });
      } catch (err) {
        console.error('Error parsing tool_call event:', err);
      }
    });

    eventSource.addEventListener('text', (e) => {
      try {
        const data = JSON.parse(e.data);
        setState(prev => ({
          ...prev,
          output: prev.output + data.text,
        }));
      } catch (err) {
        console.error('Error parsing text event:', err);
      }
    });

    eventSource.addEventListener('complete', (e) => {
      try {
        const data = JSON.parse(e.data);
        setState(prev => ({
          ...prev,
          isRunning: false,
          status: 'completed',
          output: data.output || prev.output,
        }));
        cleanup();
      } catch (err) {
        console.error('Error parsing complete event:', err);
      }
    });

    eventSource.addEventListener('error', (e) => {
      if (e instanceof MessageEvent) {
        try {
          const data = JSON.parse(e.data);
          setState(prev => ({
            ...prev,
            isRunning: false,
            status: 'failed',
            error: data.error,
          }));
        } catch {
          // Connection error
        }
      }
      cleanup();
    });

    eventSource.onerror = () => {
      // Connection error - might just be completed
      cleanup();
    };
  }, [cleanup]);

  // Stop watching
  const stopWatching = useCallback(() => {
    cleanup();
    setState({
      isRunning: false,
      chunkId: null,
      status: null,
      toolCalls: [],
      output: '',
      error: null,
      startedAt: null,
      isReviewing: false,
      reviewResult: null,
      fixChunkId: null,
    });
  }, [cleanup]);

  // Run a chunk
  const runChunk = useCallback(async (chunkId: string) => {
    try {
      // Start execution
      const response = await fetch(`/api/chunks/${chunkId}/run`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start execution');
      }

      // Start watching - reset review state as well
      setState({
        isRunning: true,
        chunkId,
        status: 'running',
        toolCalls: [],
        output: '',
        error: null,
        startedAt: Date.now(),
        isReviewing: false,
        reviewResult: null,
        fixChunkId: null,
      });

      // Give it a moment to start, then watch
      setTimeout(() => watchChunk(chunkId), 100);
    } catch (err) {
      setState(prev => ({
        ...prev,
        isRunning: false,
        error: err instanceof Error ? err.message : 'Failed to start execution',
      }));
      throw err;
    }
  }, [watchChunk]);

  // Abort a chunk
  const abortChunk = useCallback(async (chunkId: string) => {
    try {
      const response = await fetch(`/api/chunks/${chunkId}/abort`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to abort execution');
      }

      setState(prev => ({
        ...prev,
        isRunning: false,
        status: 'cancelled',
        error: 'Execution cancelled by user',
      }));

      cleanup();
    } catch (err) {
      throw err;
    }
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  // Review a completed chunk
  const reviewChunk = useCallback(async (chunkId: string): Promise<ReviewResult | null> => {
    try {
      setState(prev => ({
        ...prev,
        isReviewing: true,
        reviewResult: null,
        fixChunkId: null,
      }));

      const response = await fetch(`/api/chunks/${chunkId}/review`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to review chunk');
      }

      const result = await response.json();

      setState(prev => ({
        ...prev,
        isReviewing: false,
        reviewResult: {
          status: result.status,
          feedback: result.feedback,
          fixChunk: result.fixChunk,
        },
        fixChunkId: result.fixChunkId || null,
      }));

      return result;
    } catch (err) {
      setState(prev => ({
        ...prev,
        isReviewing: false,
        error: err instanceof Error ? err.message : 'Failed to review chunk',
      }));
      return null;
    }
  }, []);

  // Clear review state
  const clearReview = useCallback(() => {
    setState(prev => ({
      ...prev,
      reviewResult: null,
      fixChunkId: null,
    }));
  }, []);

  return {
    state,
    runChunk,
    abortChunk,
    watchChunk,
    stopWatching,
    reviewChunk,
    clearReview,
  };
}
