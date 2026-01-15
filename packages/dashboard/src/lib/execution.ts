/**
 * Chunk Execution Service
 *
 * Manages running chunks through OpencodeClient (GLM)
 */

import { OpencodeClient } from '@glm/mcp/client';
import type { Project, Spec, Chunk, ChunkToolCall, ToolCallEvent, EventHandler } from '@glm/shared';
import { getChunk, updateChunk, createToolCall, updateToolCall, getProject, getSpec, getChunksBySpec } from './db';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface ActiveExecution {
  chunkId: string;
  sessionId: string;
  directory: string;
  startedAt: number;
  timeoutId: NodeJS.Timeout;
  client: OpencodeClient;
  unsubscribe: () => void;
  listeners: Set<(event: ExecutionEvent) => void>;
  textOutput: string;
  eventBuffer: ExecutionEvent[]; // Buffer events for late subscribers
}

export type ExecutionEvent =
  | { type: 'status'; status: 'running' | 'completed' | 'failed' | 'cancelled' }
  | { type: 'tool_call'; toolCall: ChunkToolCall }
  | { type: 'text'; text: string }
  | { type: 'complete'; output: string }
  | { type: 'error'; error: string };

// Store active executions
const activeExecutions = new Map<string, ActiveExecution>();

// Map tool call IDs from opencode to our IDs
const toolCallIdMap = new Map<string, string>();

// Store active run-all sessions
const activeRunAllSessions = new Map<string, { aborted: boolean }>();

/**
 * Start a run-all session for a spec
 */
export function startRunAllSession(specId: string): void {
  activeRunAllSessions.set(specId, { aborted: false });
}

/**
 * Check if run-all should be aborted
 */
export function isRunAllAborted(specId: string): boolean {
  const session = activeRunAllSessions.get(specId);
  return session?.aborted ?? false;
}

/**
 * Abort a run-all session
 */
export function abortRunAllSession(specId: string): void {
  const session = activeRunAllSessions.get(specId);
  if (session) {
    session.aborted = true;
  }
}

/**
 * End a run-all session
 */
export function endRunAllSession(specId: string): void {
  activeRunAllSessions.delete(specId);
}

/**
 * Check if a run-all session is active
 */
export function hasActiveRunAllSession(specId: string): boolean {
  return activeRunAllSessions.has(specId);
}

/**
 * Wait for a chunk execution to complete
 * Returns the final status and output/error
 */
export function waitForChunkCompletion(
  chunkId: string,
  onToolCall?: (toolCall: ChunkToolCall) => void,
  onText?: (text: string) => void
): Promise<{ status: 'completed' | 'failed' | 'cancelled'; output?: string; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    let output = '';
    let error = '';

    const unsubscribe = subscribeToExecution(chunkId, (event) => {
      if (resolved) return;

      switch (event.type) {
        case 'tool_call':
          if (onToolCall) onToolCall(event.toolCall);
          break;
        case 'text':
          if (onText) onText(event.text);
          break;
        case 'complete':
          output = event.output;
          break;
        case 'error':
          error = event.error;
          break;
        case 'status':
          if (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled') {
            resolved = true;
            unsubscribe();
            resolve({
              status: event.status,
              output: output || undefined,
              error: error || undefined,
            });
          }
          break;
      }
    });

    // Also check if execution is not active (already completed)
    const execution = activeExecutions.get(chunkId);
    if (!execution) {
      resolved = true;
      unsubscribe();
      // Chunk not running - get status from DB
      const chunk = getChunk(chunkId);
      if (chunk) {
        resolve({
          status: chunk.status === 'completed' ? 'completed' :
                  chunk.status === 'cancelled' ? 'cancelled' : 'failed',
          output: chunk.output,
          error: chunk.error,
        });
      } else {
        resolve({ status: 'failed', error: 'Chunk not found' });
      }
    }
  });
}

/**
 * Build prompt for chunk execution
 */
function buildChunkPrompt(project: Project, spec: Spec, chunk: Chunk, totalChunks: number): string {
  return `# Task: ${chunk.title}

You are implementing a feature for the project "${project.name}".

## Instructions
${chunk.description}

## Context
- This is chunk ${chunk.order + 1} of ${totalChunks}
- Working directory: ${project.directory}
- Focus ONLY on this specific task
- Do not modify unrelated files

## Spec Reference
${spec.title}

Begin implementation.`;
}

/**
 * Check if any chunk is currently running
 */
export function hasRunningExecution(): boolean {
  return activeExecutions.size > 0;
}

/**
 * Get currently running chunk ID if any
 */
export function getRunningChunkId(): string | null {
  const [chunkId] = activeExecutions.keys();
  return chunkId ?? null;
}

/**
 * Start executing a chunk
 */
export async function startChunkExecution(chunkId: string): Promise<{ success: boolean; error?: string }> {
  // Check if already running
  if (activeExecutions.has(chunkId)) {
    return { success: false, error: 'Chunk is already running' };
  }

  // Check if another chunk is running
  if (hasRunningExecution()) {
    return { success: false, error: 'Another chunk is already running' };
  }

  // Get chunk
  const chunk = getChunk(chunkId);
  if (!chunk) {
    return { success: false, error: 'Chunk not found' };
  }

  if (chunk.status === 'running') {
    return { success: false, error: 'Chunk is already running' };
  }

  // Get spec
  const spec = getSpec(chunk.specId);
  if (!spec) {
    return { success: false, error: 'Spec not found' };
  }

  // Get project
  const project = getProject(spec.projectId);
  if (!project) {
    return { success: false, error: 'Project not found' };
  }

  // Get total chunks for context
  const allChunks = getChunksBySpec(chunk.specId);
  const totalChunks = allChunks.length;

  // Build prompt
  const prompt = buildChunkPrompt(project, spec, chunk, totalChunks);

  // Create client
  const client = new OpencodeClient();
  const listeners = new Set<(event: ExecutionEvent) => void>();

  try {
    // Check opencode health
    const health = await client.checkHealth();
    if (!health.healthy) {
      return { success: false, error: 'OpenCode server is not available at http://localhost:4096. Make sure opencode is running.' };
    }

    // Create session
    const session = await client.createSession(project.directory, `Chunk: ${chunk.title}`);

    // Update chunk status
    updateChunk(chunkId, { status: 'running' });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      handleTimeout(chunkId);
    }, DEFAULT_TIMEOUT_MS);

    // Create event handler
    const eventHandler: EventHandler = {
      onSessionStatus: (eventSessionId, status) => {
        console.error(`[Execution] SessionStatus: ${eventSessionId} vs ${session.id}, status: ${status}`);
        // Match by session ID or directory
        if (eventSessionId === session.id || eventSessionId === project.directory) {
          if (status === 'busy') {
            emitEvent(chunkId, { type: 'status', status: 'running' });
          }
        }
      },
      onToolCall: (eventSessionId, toolCall) => {
        console.error(`[Execution] ToolCall: ${eventSessionId} vs ${session.id}, tool: ${toolCall.tool}`);
        // Match by session ID or directory
        if (eventSessionId === session.id || eventSessionId === project.directory) {
          handleToolCall(chunkId, toolCall);
        }
      },
      onTextChunk: (eventSessionId, text) => {
        // Match by session ID or directory
        if (eventSessionId === session.id || eventSessionId === project.directory) {
          // Accumulate text output
          const execution = activeExecutions.get(chunkId);
          if (execution) {
            execution.textOutput += text;
          }
          emitEvent(chunkId, { type: 'text', text });
        }
      },
      onFileEdit: () => {},
      onError: (eventSessionId, error) => {
        // Match by session ID or directory
        if (eventSessionId === session.id || eventSessionId === project.directory) {
          handleError(chunkId, error.message);
        }
      },
      onComplete: (eventSessionId) => {
        console.error(`[Execution] Complete: ${eventSessionId} vs ${session.id}`);
        // Match by session ID or directory
        if (eventSessionId === session.id || eventSessionId === project.directory) {
          handleComplete(chunkId);
        }
      },
    };

    // Subscribe to events
    const unsubscribe = client.subscribeToEvents(eventHandler);

    // Store execution state
    activeExecutions.set(chunkId, {
      chunkId,
      sessionId: session.id,
      directory: project.directory,
      startedAt: Date.now(),
      timeoutId,
      client,
      unsubscribe,
      listeners,
      textOutput: '',
      eventBuffer: [], // Buffer for late subscribers
    });

    // Send prompt
    await client.sendPrompt(session.id, project.directory, {
      parts: [{ type: 'text', text: prompt }],
      model: {
        providerID: 'zai-coding-plan',
        modelID: 'glm-4.7',
      },
    });

    return { success: true };
  } catch (error) {
    // Cleanup on error
    updateChunk(chunkId, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Abort a running chunk execution
 */
export async function abortChunkExecution(chunkId: string): Promise<{ success: boolean; error?: string }> {
  const execution = activeExecutions.get(chunkId);
  if (!execution) {
    return { success: false, error: 'Chunk is not running' };
  }

  try {
    // Abort the session
    await execution.client.abortSession(execution.sessionId, execution.directory);

    // Cleanup
    cleanup(chunkId, 'cancelled', 'Execution cancelled by user');

    return { success: true };
  } catch (error) {
    cleanup(chunkId, 'failed', error instanceof Error ? error.message : 'Failed to abort');
    return { success: false, error: error instanceof Error ? error.message : 'Failed to abort' };
  }
}

/**
 * Subscribe to execution events for a chunk
 */
export function subscribeToExecution(chunkId: string, listener: (event: ExecutionEvent) => void): () => void {
  const execution = activeExecutions.get(chunkId);
  if (execution) {
    // Replay buffered events to new subscriber
    for (const event of execution.eventBuffer) {
      try {
        listener(event);
      } catch (e) {
        console.error('Error replaying event to listener:', e);
      }
    }

    // Add listener for future events
    execution.listeners.add(listener);
    return () => execution.listeners.delete(listener);
  }
  return () => {};
}

/**
 * Get execution for a chunk
 */
export function getExecution(chunkId: string): ActiveExecution | undefined {
  return activeExecutions.get(chunkId);
}

// Helper: Emit event to all listeners
function emitEvent(chunkId: string, event: ExecutionEvent): void {
  const execution = activeExecutions.get(chunkId);
  if (execution) {
    // Buffer event for late subscribers
    execution.eventBuffer.push(event);

    // Send to current listeners
    for (const listener of execution.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('Error in execution listener:', e);
      }
    }
  }
}

// Helper: Handle tool call events
function handleToolCall(chunkId: string, toolCall: ToolCallEvent): void {
  // Check if we've seen this tool call before
  let dbToolCallId = toolCallIdMap.get(toolCall.callId);

  if (!dbToolCallId) {
    // New tool call - create in DB
    const dbToolCall = createToolCall(chunkId, {
      tool: toolCall.tool,
      input: toolCall.input || {},
    });
    dbToolCallId = dbToolCall.id;
    toolCallIdMap.set(toolCall.callId, dbToolCallId);
  }

  // Update status
  if (toolCall.state === 'completed' || toolCall.state === 'error') {
    updateToolCall(dbToolCallId, {
      status: toolCall.state,
      output: toolCall.output,
    });
  }

  // Emit event
  emitEvent(chunkId, {
    type: 'tool_call',
    toolCall: {
      id: dbToolCallId,
      chunkId,
      tool: toolCall.tool,
      input: toolCall.input || {},
      output: toolCall.output,
      status: toolCall.state === 'error' ? 'error' : toolCall.state === 'completed' ? 'completed' : 'running',
      startedAt: Date.now(),
      completedAt: toolCall.state === 'completed' || toolCall.state === 'error' ? Date.now() : undefined,
    },
  });
}

// Helper: Handle timeout
function handleTimeout(chunkId: string): void {
  cleanup(chunkId, 'failed', 'Execution timed out after 5 minutes');
}

// Helper: Handle error
function handleError(chunkId: string, message: string): void {
  cleanup(chunkId, 'failed', message);
}

// Helper: Handle completion
function handleComplete(chunkId: string): void {
  const execution = activeExecutions.get(chunkId);
  const output = execution?.textOutput || 'Task completed';
  cleanup(chunkId, 'completed', undefined, output);
}

// Helper: Cleanup execution
function cleanup(chunkId: string, status: 'completed' | 'failed' | 'cancelled', error?: string, output?: string): void {
  const execution = activeExecutions.get(chunkId);
  if (!execution) return;

  // Clear timeout
  clearTimeout(execution.timeoutId);

  // Unsubscribe from events
  execution.unsubscribe();

  // Delete session (don't wait)
  execution.client.deleteSession(execution.sessionId, execution.directory).catch(() => {});

  // Update chunk
  updateChunk(chunkId, {
    status,
    error: error || undefined,
    output: output || execution.textOutput || undefined,
  });

  // Emit final events
  emitEvent(chunkId, { type: 'status', status });
  if (status === 'completed') {
    emitEvent(chunkId, { type: 'complete', output: output || execution.textOutput || 'Task completed' });
  } else if (error) {
    emitEvent(chunkId, { type: 'error', error });
  }

  // Remove from active
  activeExecutions.delete(chunkId);
}
