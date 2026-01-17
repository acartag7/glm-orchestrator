'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Chunk, ChunkToolCall, ChunkStatus, ReviewResult, ReviewStatus } from '@specwright/shared';

/** Polling interval in milliseconds for chunk status updates */
const POLL_INTERVAL_MS = 3000;

/**
 * Compares chunk arrays to detect status changes, ignoring metadata fields.
 * Returns true if any chunk's status or error field has changed.
 */
function hasStatusChanged(oldChunks: Chunk[], newChunks: Chunk[]): boolean {
  if (!oldChunks || !newChunks) return true;
  if (oldChunks.length !== newChunks.length) return true;

  return oldChunks.some((oldChunk, idx) => {
    const newChunk = newChunks[idx];
    return oldChunk.status !== newChunk.status ||
           oldChunk.error !== newChunk.error;
  });
}

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
  // Polling state
  isPolling: boolean;
  lastUpdate: Date | null;
}

interface UseExecutionProps {
  specId?: string;
  chunks?: Chunk[];
  spec?: { status: string };
  onChunksUpdate?: (chunks: Chunk[]) => void;
  onSpecUpdate?: (spec: any) => void;
}

/**
 * Hook for managing chunk execution with live SSE monitoring and automatic status polling.
 * Provides chunk execution controls, real-time tool call updates via Server-Sent Events,
 * and background polling for spec/chunk status changes.
 * 
 * @param props - Configuration options
 * @param props.specId - ID of the spec being executed
 * @param props.chunks - Array of chunks in the spec
 * @param props.spec - Spec object with status field
 * @param props.onChunksUpdate - Callback when chunk data is updated via polling
 * @param props.onSpecUpdate - Callback when spec data is updated via polling
 * @returns Hook state and functions
 * @returns {ExecutionState} state - Current execution state
 * @returns {(chunkId: string) => Promise<void>} runChunk - Start executing a chunk
 * @returns {(chunkId: string) => Promise<void>} abortChunk - Abort chunk execution
 * @returns {(chunkId: string) => void} watchChunk - Subscribe to chunk SSE events
 * @returns {() => void} stopWatching - Unsubscribe from SSE events
 * @returns {(chunkId: string) => Promise<ReviewResult | null>} reviewChunk - Review a completed chunk
 * @returns {() => void} clearReview - Clear review state
 * @returns {boolean} isPolling - Indicates if active polling is running for status updates
 * @returns {Date | null} lastUpdate - Timestamp of last successful status fetch
 */
export function useExecution(props: UseExecutionProps = {}): UseExecutionReturn {
  const { specId, chunks, spec, onChunksUpdate, onSpecUpdate } = props;
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

  const [isPolling, setIsPolling] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const watchingChunkIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Determines if polling should be active based on execution status.
   * Polling runs when spec is running OR any chunk is running.
   */
  const shouldPoll = useMemo(() => {
    if (!chunks || !spec) return false;
    return spec.status === 'running' || chunks.some(chunk => chunk.status === 'running');
  }, [chunks, spec]);

  // Cleanup event source
  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    watchingChunkIdRef.current = null;
  }, []);

  // Polling useEffect for chunk status updates
  useEffect(() => {
    if (!shouldPoll || !specId) return;

    let isMounted = true;
    let intervalId: NodeJS.Timeout;

    const poll = async () => {
      if (!isMounted) return;

      if (document.visibilityState === 'hidden') return;

      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch(`/api/specs/${specId}`, {
          signal: abortControllerRef.current.signal
        });

        if (!response.ok) {
          if (response.status === 404 || response.status === 401 || response.status === 403) {
            console.error('Polling stopped: spec not found or auth error');
            setIsPolling(false);
            return;
          }
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (isMounted) {
          if (!data.chunks) return;

          const newChunks = data.chunks;
          const newSpec = data.spec || { status: spec?.status };

          let hasChanges = false;

          if (hasStatusChanged(chunks || [], newChunks)) {
            onChunksUpdate?.(newChunks);
            hasChanges = true;
          }

          if (spec && newSpec && spec.status !== newSpec.status) {
            onSpecUpdate?.(newSpec);
            hasChanges = true;
          }

          if (hasChanges) {
            setLastUpdate(new Date());
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.error('Polling error:', error);
      }
    };

    poll();
    setIsPolling(true);
    intervalId = setInterval(poll, POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        poll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted = false;
      abortControllerRef.current?.abort();
      clearInterval(intervalId);
      setIsPolling(false);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [specId, shouldPoll, chunks, spec, onChunksUpdate, onSpecUpdate]);

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
    isPolling,
    lastUpdate,
  };
}
