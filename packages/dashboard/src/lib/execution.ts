/**
 * Chunk Execution Service
 *
 * Manages running chunks through OpencodeClient (GLM)
 */

import { OpencodeClient } from '@specwright/mcp/client';
import type { Project, Spec, Chunk, ChunkToolCall, ToolCallEvent, EventHandler, ProjectConfig } from '@specwright/shared';
import { DEFAULT_PROJECT_CONFIG } from '@specwright/shared';
import { getChunk, updateChunk, createToolCall, updateToolCall, getProject, getSpec, getChunksBySpec } from './db';
import { buildPromptForChunk } from './prompt-builder';
import { generateChunkSummary, generateQuickSummary } from './summary-generator';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_BUFFER_SIZE = 1000; // Maximum events to buffer for late subscribers

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

// Track which opencode tool call IDs belong to which chunk (for cleanup)
const chunkToolCallIds = new Map<string, Set<string>>();

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
 * Build prompt for chunk execution with dependency context
 */
async function buildChunkPromptWithContext(spec: Spec, chunk: Chunk): Promise<string> {
  // Wrap getChunk to convert null to undefined
  const getChunkOrUndefined = (id: string): Chunk | undefined => getChunk(id) ?? undefined;
  return buildPromptForChunk(chunk, spec, getChunkOrUndefined);
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

  // Get project config or use defaults
  const config: ProjectConfig = project.config ?? DEFAULT_PROJECT_CONFIG;

  // Log config at execution start
  console.log(`[Execution] Starting chunk: ${chunk.title}`);
  console.log(`[Execution] Config: Executor=${config.executor.type}@${config.executor.endpoint || 'default'}, Model=${config.executor.model || 'default'}, MaxIterations=${config.maxIterations}`);

  // Build prompt with dependency context
  const prompt = await buildChunkPromptWithContext(spec, chunk);

  // Create client with config
  const client = new OpencodeClient({ baseUrl: config.executor.endpoint });
  const listeners = new Set<(event: ExecutionEvent) => void>();

  try {
    // Check executor health based on config
    if (config.executor.type === 'opencode') {
      const health = await client.checkHealth();
      if (!health.healthy) {
        return { success: false, error: `OpenCode server is not available at ${config.executor.endpoint || 'http://localhost:4096'}. Make sure opencode is running.` };
      }
    } else if (config.executor.type === 'claude-code') {
      // TODO: Implement Claude Code executor
      return { success: false, error: 'Claude Code executor is not yet implemented.' };
    }

    // Create session
    const session = await client.createSession(project.directory, `Chunk: ${chunk.title}`);

    // Update chunk status
    updateChunk(chunkId, { status: 'running' });

    // Set up timeout from config
    const timeoutId = setTimeout(() => {
      handleTimeout(chunkId);
    }, config.executor.timeout || DEFAULT_TIMEOUT_MS);

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

    // Send prompt with config
    await client.sendPrompt(session.id, project.directory, {
      parts: [{ type: 'text', text: prompt }],
      model: {
        providerID: 'zai-coding-plan',
        modelID: config.executor.model || 'glm-4.7',
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

    // Enforce buffer size limit by removing oldest events
    if (execution.eventBuffer.length > MAX_BUFFER_SIZE) {
      execution.eventBuffer.splice(0, execution.eventBuffer.length - MAX_BUFFER_SIZE);
    }

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

    // Track this tool call ID for cleanup
    let chunkIds = chunkToolCallIds.get(chunkId);
    if (!chunkIds) {
      chunkIds = new Set();
      chunkToolCallIds.set(chunkId, chunkIds);
    }
    chunkIds.add(toolCall.callId);
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
  cleanup(chunkId, 'failed', 'Execution timed out');
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

  // Clean up tool call ID mappings for this chunk
  const toolCallIds = chunkToolCallIds.get(chunkId);
  if (toolCallIds) {
    for (const opcodeId of toolCallIds) {
      toolCallIdMap.delete(opcodeId);
    }
    chunkToolCallIds.delete(chunkId);
  }

  const finalOutput = output || execution.textOutput || undefined;

  // Update chunk
  updateChunk(chunkId, {
    status,
    error: error || undefined,
    output: finalOutput,
  });

  // Emit final events
  emitEvent(chunkId, { type: 'status', status });
  if (status === 'completed') {
    emitEvent(chunkId, { type: 'complete', output: finalOutput || 'Task completed' });

    // Generate summary asynchronously (fire and forget)
    // This ensures the summary is available for dependent chunks
    generateSummaryAsync(chunkId, execution.directory);
  } else if (error) {
    emitEvent(chunkId, { type: 'error', error });
  }

  // Remove from active
  activeExecutions.delete(chunkId);
}

/**
 * Generate summary asynchronously after chunk completion
 * This runs in the background and updates the chunk when done
 *
 * TODO: Phase 5 (Ralph Loop) Integration:
 * - Enforce maxIterations limit from config in iteration loop
 * - Integrate reviewer based on config.reviewer.type
 * - Pass reviewer config (type, cliPath, autoApprove) to review step
 */
async function generateSummaryAsync(chunkId: string, workingDirectory: string): Promise<void> {
  try {
    const chunk = getChunk(chunkId);
    if (!chunk) {
      console.error(`[Summary] Chunk not found: ${chunkId}`);
      return;
    }

    console.error(`[Summary] Generating summary for chunk: ${chunk.title}`);

    // Try to generate a detailed summary with Claude
    const result = await generateChunkSummary(chunk, workingDirectory);

    if (result.success && result.summary) {
      updateChunk(chunkId, { outputSummary: result.summary });
      console.error(`[Summary] Summary generated for chunk: ${chunk.title}`);
    } else {
      // Fall back to quick summary if Claude fails
      const quickSummary = generateQuickSummary(chunk);
      updateChunk(chunkId, { outputSummary: quickSummary });
      console.error(`[Summary] Quick summary generated for chunk: ${chunk.title} (Claude failed: ${result.error})`);
    }
  } catch (error) {
    console.error(`[Summary] Error generating summary for chunk ${chunkId}:`, error);
    // Generate quick summary as fallback
    const chunk = getChunk(chunkId);
    if (chunk) {
      const quickSummary = generateQuickSummary(chunk);
      updateChunk(chunkId, { outputSummary: quickSummary });
    }
  }
}
