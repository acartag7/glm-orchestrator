/**
 * Run All Chunks API
 *
 * POST /api/specs/[id]/run-all
 * Returns SSE stream with execution events for all chunks
 *
 * DELETE /api/specs/[id]/run-all
 * Aborts the current run-all execution
 */

import { getSpec } from '@/lib/db';
import {
  specExecutionService,
  type SpecExecutionEvents,
} from '@/lib/services/spec-execution-service';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Helper to send SSE event (safely handles closed controller)
function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  isClosedRef: { value: boolean },
  eventType: string,
  data: Record<string, unknown>
): void {
  if (isClosedRef.value) return;

  try {
    const payload = JSON.stringify({ ...data, timestamp: Date.now() });
    controller.enqueue(encoder.encode(`event: ${eventType}\ndata: ${payload}\n\n`));
  } catch (err) {
    if (err instanceof TypeError && String(err).includes('Controller is already closed')) {
      isClosedRef.value = true;
    } else {
      console.error('[Execution] Error sending SSE event:', err);
    }
  }
}

// POST /api/specs/[id]/run-all
export async function POST(_request: Request, context: RouteContext) {
  const { id: specId } = await context.params;

  // Validate spec exists
  const spec = getSpec(specId);
  if (!spec) {
    return new Response(JSON.stringify({ error: 'Spec not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if already running
  if (specExecutionService.isRunning(specId)) {
    return new Response(JSON.stringify({ error: 'Run All is already in progress for this spec' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const isClosedRef = { value: false };

      // Map SpecExecutionEvents to SSE events
      const events: SpecExecutionEvents = {
        // Spec-level events
        onSpecStart: (id, total) => {
          sendEvent(controller, encoder, isClosedRef, 'spec_start', { specId: id, totalChunks: total });
        },
        onSpecComplete: (id, stats) => {
          sendEvent(controller, encoder, isClosedRef, 'all_complete', {
            specId: id,
            passed: stats.passedChunks,
            failed: stats.failedChunks,
            fixes: stats.fixChunksCreated,
            prUrl: stats.prUrl,
          });
        },
        onSpecAborted: (id, reason) => {
          sendEvent(controller, encoder, isClosedRef, 'stopped', { specId: id, reason });
        },

        // Chunk events
        onChunkStart: (chunkId, title, index, total) => {
          sendEvent(controller, encoder, isClosedRef, 'chunk_start', { chunkId, title, index, total });
        },
        onChunkComplete: (chunkId, result) => {
          sendEvent(controller, encoder, isClosedRef, 'chunk_complete', {
            chunkId,
            output: result.output || '',
            status: result.status,
          });
        },
        onChunkSkipped: (chunkId, reason) => {
          sendEvent(controller, encoder, isClosedRef, 'chunk_skipped', { chunkId, reason });
        },

        // Dependency events
        onDependencyBlocked: (chunkId, chunkTitle, blockedBy, blockedByTitle, reason) => {
          sendEvent(controller, encoder, isClosedRef, 'dependency_blocked', {
            chunkId,
            chunkTitle,
            blockedBy,
            blockedByTitle,
            reason,
          });
        },

        // Tool call events
        onToolCall: (chunkId, toolCall) => {
          sendEvent(controller, encoder, isClosedRef, 'tool_call', {
            chunkId,
            toolCall: {
              id: toolCall.id,
              tool: toolCall.tool,
              status: toolCall.status,
              input: toolCall.input,
            },
          });
        },

        // Validation events
        onValidationStart: (chunkId) => {
          sendEvent(controller, encoder, isClosedRef, 'validation_start', { chunkId });
        },
        onValidationComplete: (chunkId, result) => {
          sendEvent(controller, encoder, isClosedRef, 'validation_complete', {
            chunkId,
            filesChanged: result.filesChanged,
            buildSuccess: result.buildResult.success,
            autoFail: result.autoFail ? true : false,
          });
        },

        // Review events
        onReviewStart: (chunkId) => {
          sendEvent(controller, encoder, isClosedRef, 'review_start', { chunkId });
        },
        onReviewComplete: (chunkId, result) => {
          sendEvent(controller, encoder, isClosedRef, 'review_complete', {
            chunkId,
            status: result.status,
            feedback: result.feedback,
            fixChunkId: result.fixChunkId,
          });
        },

        // Git events
        onGitWorkflowInit: (state) => {
          if (state.isWorktree) {
            sendEvent(controller, encoder, isClosedRef, 'worktree_created', {
              path: state.workingDir,
              branch: state.specBranch,
            });
          } else {
            sendEvent(controller, encoder, isClosedRef, 'git_branch_created', {
              branch: state.specBranch,
              originalBranch: state.originalBranch,
            });
          }
        },
        onGitReset: (chunkId, reason) => {
          sendEvent(controller, encoder, isClosedRef, 'git_reset', { chunkId, reason });
        },
        onGitCommit: (chunkId, commitHash, filesChanged) => {
          sendEvent(controller, encoder, isClosedRef, 'git_commit', { chunkId, commitHash, filesChanged });
        },
        onGitPush: (branch) => {
          sendEvent(controller, encoder, isClosedRef, 'git_push', { branch });
        },
        onPRCreated: (url, number) => {
          sendEvent(controller, encoder, isClosedRef, 'pr_created', { url, number });
        },
        onCommit: (chunkId, hash) => {
          sendEvent(controller, encoder, isClosedRef, 'git_commit', { chunkId, commitHash: hash });
        },

        // Final review events
        onFinalReviewStart: (id) => {
          sendEvent(controller, encoder, isClosedRef, 'final_review_start', { specId: id });
        },
        onFinalReviewComplete: (id, result) => {
          sendEvent(controller, encoder, isClosedRef, 'final_review_complete', {
            specId: id,
            status: result.status,
            feedback: result.feedback,
          });
        },
        onFinalReviewFixChunks: (id, fixChunkIds) => {
          sendEvent(controller, encoder, isClosedRef, 'final_review_fix_chunks', {
            specId: id,
            fixChunkIds,
          });
        },

        // Error events
        onError: (id, message) => {
          sendEvent(controller, encoder, isClosedRef, 'error', { chunkId: id, message });
        },
      };

      try {
        await specExecutionService.runAll(specId, events);
      } catch (error) {
        sendEvent(controller, encoder, isClosedRef, 'error', {
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        if (!isClosedRef.value) {
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// DELETE /api/specs/[id]/run-all - Abort execution
export async function DELETE(_request: Request, context: RouteContext) {
  const { id: specId } = await context.params;

  if (!specExecutionService.isRunning(specId)) {
    return new Response(JSON.stringify({ error: 'No execution running for this spec' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  specExecutionService.abort(specId);

  return new Response(JSON.stringify({ success: true, message: 'Execution aborted' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
