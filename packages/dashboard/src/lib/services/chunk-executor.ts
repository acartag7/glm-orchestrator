/**
 * Chunk Executor Service - Handles raw OpenCode execution
 *
 * Wraps the existing execution.ts functions into a cleaner service interface.
 * This is a thin wrapper around the existing execution module.
 */

import type { ChunkToolCall } from '@specwright/shared';
import {
  startChunkExecution,
  abortChunkExecution,
  waitForChunkCompletion,
  subscribeToExecution,
  hasRunningExecution,
  getRunningChunkId,
  type ExecutionEvent,
} from '../execution';

export interface ExecutionResult {
  status: 'completed' | 'failed' | 'cancelled';
  output?: string;
  error?: string;
}

export interface ExecutionCallbacks {
  onToolCall?: (toolCall: ChunkToolCall) => void;
  onText?: (text: string) => void;
  onStatusChange?: (status: 'running' | 'completed' | 'failed' | 'cancelled') => void;
}

export class ChunkExecutor {
  /**
   * Execute a chunk via OpenCode
   * - Create session
   * - Send prompt
   * - Handle tool calls
   * - Return when complete
   */
  async execute(
    chunkId: string,
    callbacks?: ExecutionCallbacks
  ): Promise<ExecutionResult> {
    console.log(`[ChunkExecutor] Starting execution for chunk ${chunkId}`);

    // Start the execution
    const startResult = await startChunkExecution(chunkId);

    if (!startResult.success) {
      console.error(`[ChunkExecutor] Failed to start chunk ${chunkId}: ${startResult.error}`);
      return {
        status: 'failed',
        error: startResult.error,
      };
    }

    // Wait for completion
    const result = await waitForChunkCompletion(
      chunkId,
      callbacks?.onToolCall,
      callbacks?.onText
    );

    console.log(`[ChunkExecutor] Chunk ${chunkId} ${result.status}`);

    return {
      status: result.status,
      output: result.output,
      error: result.error,
    };
  }

  /**
   * Abort running execution
   */
  async abort(chunkId: string): Promise<{ success: boolean; error?: string }> {
    console.log(`[ChunkExecutor] Aborting chunk ${chunkId}`);
    return abortChunkExecution(chunkId);
  }

  /**
   * Check if chunk is currently executing
   */
  isRunning(chunkId: string): boolean {
    const runningId = getRunningChunkId();
    return runningId === chunkId;
  }

  /**
   * Check if any execution is running
   */
  hasRunningExecution(): boolean {
    return hasRunningExecution();
  }

  /**
   * Subscribe to execution events
   */
  subscribe(chunkId: string, listener: (event: ExecutionEvent) => void): () => void {
    return subscribeToExecution(chunkId, listener);
  }
}

export const chunkExecutor = new ChunkExecutor();
