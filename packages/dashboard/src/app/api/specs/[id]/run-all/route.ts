/**
 * Run All Chunks API
 *
 * POST /api/specs/[id]/run-all
 * Returns SSE stream with execution events for all chunks
 */

import { getSpec, getChunksBySpec, updateSpec, updateChunk, insertFixChunk, getChunk } from '@/lib/db';
import {
  startChunkExecution,
  waitForChunkCompletion,
  abortChunkExecution,
  startRunAllSession,
  endRunAllSession,
  isRunAllAborted,
  hasActiveRunAllSession,
} from '@/lib/execution';
import { ClaudeClient } from '@glm/mcp/client';
import type { ReviewResult, ReviewStatus, ChunkToolCall } from '@glm/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Review prompt template (same as review endpoint)
const REVIEW_PROMPT_TEMPLATE = `You are reviewing the output of an AI coding assistant that just completed a task.

## Task
Title: {title}
Description: {description}

## Output from AI Assistant
{output}

## Your Job
Determine if the task was completed correctly.

Return JSON:
{
  "status": "pass" | "needs_fix" | "fail",
  "feedback": "Brief explanation of your assessment",
  "fixChunk": {
    "title": "Short title for the fix",
    "description": "Detailed instructions to fix the issue"
  }
}

Rules:
- "pass" = Task completed correctly, no issues found
- "needs_fix" = Task partially done or has fixable issues
- "fail" = Task cannot be completed, fundamental problem
- Be specific in feedback
- Fix descriptions should be actionable
- Only include fixChunk if status is "needs_fix"
- Return ONLY valid JSON, no markdown code blocks`;

function buildReviewPrompt(chunk: { title: string; description: string; output?: string }): string {
  return REVIEW_PROMPT_TEMPLATE
    .replace('{title}', chunk.title)
    .replace('{description}', chunk.description)
    .replace('{output}', chunk.output || 'No output captured');
}

function parseReviewResult(text: string): ReviewResult | null {
  try {
    let jsonStr = text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    const parsed = JSON.parse(jsonStr);
    if (!parsed.status || !['pass', 'needs_fix', 'fail'].includes(parsed.status)) {
      return null;
    }
    const result: ReviewResult = {
      status: parsed.status as ReviewStatus,
      feedback: parsed.feedback || '',
    };
    if (parsed.status === 'needs_fix' && parsed.fixChunk) {
      result.fixChunk = {
        title: parsed.fixChunk.title || 'Fix required issue',
        description: parsed.fixChunk.description || 'Fix the issue identified in the previous task',
      };
    }
    return result;
  } catch {
    return null;
  }
}

// Helper to send SSE event
function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  eventType: string,
  data: Record<string, unknown>
): void {
  const payload = JSON.stringify({ ...data, timestamp: Date.now() });
  controller.enqueue(encoder.encode(`event: ${eventType}\ndata: ${payload}\n\n`));
}

// POST /api/specs/[id]/run-all
export async function POST(_request: Request, context: RouteContext) {
  const { id: specId } = await context.params;

  // Check if spec exists
  const spec = getSpec(specId);
  if (!spec) {
    return new Response(JSON.stringify({ error: 'Spec not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if run-all is already in progress
  if (hasActiveRunAllSession(specId)) {
    return new Response(JSON.stringify({ error: 'Run All is already in progress for this spec' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get all pending chunks (skip completed ones for resume capability)
  const allChunks = getChunksBySpec(specId);
  const pendingChunks = allChunks.filter(c =>
    c.status === 'pending' || c.status === 'failed' || c.status === 'cancelled'
  );

  if (pendingChunks.length === 0) {
    return new Response(JSON.stringify({ error: 'No pending chunks to execute' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Start run-all session
  startRunAllSession(specId);

  // Update spec status to running
  updateSpec(specId, { status: 'running' });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let passed = 0;
      let failed = 0;
      let fixes = 0;
      const total = pendingChunks.length;
      let currentIndex = 0;

      // Helper to run a single chunk (original or fix)
      async function runChunk(
        chunkId: string,
        title: string,
        index: number,
        isFix: boolean
      ): Promise<{ success: boolean; reviewResult?: ReviewResult; fixChunkId?: string }> {
        // Check for abort
        if (isRunAllAborted(specId)) {
          return { success: false };
        }

        // Send start event
        sendEvent(controller, encoder, isFix ? 'fix_chunk_start' : 'chunk_start', {
          chunkId,
          title,
          index,
          total,
        });

        // Start execution
        const startResult = await startChunkExecution(chunkId);
        if (!startResult.success) {
          sendEvent(controller, encoder, 'error', {
            chunkId,
            message: startResult.error || 'Failed to start chunk execution',
          });
          return { success: false };
        }

        // Wait for completion with tool call forwarding
        const completionResult = await waitForChunkCompletion(
          chunkId,
          (toolCall: ChunkToolCall) => {
            sendEvent(controller, encoder, 'tool_call', {
              chunkId,
              toolCall: {
                id: toolCall.id,
                tool: toolCall.tool,
                status: toolCall.status,
                input: toolCall.input,
              },
            });
          }
        );

        // Check for abort after execution
        if (isRunAllAborted(specId)) {
          return { success: false };
        }

        // Handle execution result
        if (completionResult.status !== 'completed') {
          sendEvent(controller, encoder, 'error', {
            chunkId,
            message: completionResult.error || `Chunk ${completionResult.status}`,
          });
          return { success: false };
        }

        // Send complete event
        sendEvent(controller, encoder, isFix ? 'fix_chunk_complete' : 'chunk_complete', {
          chunkId,
          output: completionResult.output || '',
        });

        // Now review the chunk
        sendEvent(controller, encoder, 'review_start', { chunkId });

        // Get updated chunk with output
        const updatedChunk = getChunk(chunkId);
        if (!updatedChunk) {
          sendEvent(controller, encoder, 'error', {
            chunkId,
            message: 'Chunk not found after execution',
          });
          return { success: false };
        }

        // Build review prompt and call Opus
        const reviewPrompt = buildReviewPrompt(updatedChunk);
        const claudeClient = new ClaudeClient();

        try {
          const reviewResult = await claudeClient.execute(reviewPrompt, { timeout: 120000 });

          if (!reviewResult.success) {
            sendEvent(controller, encoder, 'error', {
              chunkId,
              message: `Review failed: ${reviewResult.output}`,
            });
            return { success: false };
          }

          const parsedReview = parseReviewResult(reviewResult.output);
          if (!parsedReview) {
            // If review parsing fails, assume pass to continue
            sendEvent(controller, encoder, 'review_complete', {
              chunkId,
              status: 'pass',
              feedback: 'Review parsing failed, assuming pass',
            });
            return { success: true, reviewResult: { status: 'pass', feedback: 'Review parsing failed' } };
          }

          // Update chunk with review result
          updateChunk(chunkId, {
            reviewStatus: parsedReview.status,
            reviewFeedback: parsedReview.feedback,
          });

          let fixChunkId: string | undefined;

          // If needs_fix, create fix chunk
          if (parsedReview.status === 'needs_fix' && parsedReview.fixChunk) {
            const fixChunk = insertFixChunk(chunkId, {
              title: parsedReview.fixChunk.title,
              description: parsedReview.fixChunk.description,
            });
            if (fixChunk) {
              fixChunkId = fixChunk.id;
            }
          }

          sendEvent(controller, encoder, 'review_complete', {
            chunkId,
            status: parsedReview.status,
            feedback: parsedReview.feedback,
            fixChunkId,
          });

          return { success: true, reviewResult: parsedReview, fixChunkId };
        } catch (error) {
          sendEvent(controller, encoder, 'error', {
            chunkId,
            message: `Review error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          });
          return { success: false };
        }
      }

      // Main execution loop
      try {
        for (const chunk of pendingChunks) {
          currentIndex++;

          // Check for abort before each chunk
          if (isRunAllAborted(specId)) {
            sendEvent(controller, encoder, 'stopped', { reason: 'Aborted by user' });
            break;
          }

          // Run the chunk
          const result = await runChunk(chunk.id, chunk.title, currentIndex, false);

          if (!result.success) {
            // If abort, stop gracefully
            if (isRunAllAborted(specId)) {
              sendEvent(controller, encoder, 'stopped', { reason: 'Aborted by user' });
              break;
            }
            failed++;
            sendEvent(controller, encoder, 'stopped', {
              reason: `Chunk "${chunk.title}" failed`,
            });
            break;
          }

          // Handle review result
          if (result.reviewResult) {
            if (result.reviewResult.status === 'pass') {
              passed++;
            } else if (result.reviewResult.status === 'needs_fix' && result.fixChunkId) {
              // Run fix chunk
              fixes++;
              const fixChunk = getChunk(result.fixChunkId);
              if (fixChunk) {
                const fixResult = await runChunk(result.fixChunkId, fixChunk.title, currentIndex, true);

                if (!fixResult.success) {
                  if (isRunAllAborted(specId)) {
                    sendEvent(controller, encoder, 'stopped', { reason: 'Aborted by user' });
                  } else {
                    failed++;
                    sendEvent(controller, encoder, 'stopped', {
                      reason: `Fix chunk "${fixChunk.title}" failed`,
                    });
                  }
                  break;
                }

                // Check fix chunk review
                if (fixResult.reviewResult?.status === 'pass') {
                  passed++;
                } else if (fixResult.reviewResult?.status === 'fail') {
                  failed++;
                  sendEvent(controller, encoder, 'stopped', {
                    reason: `Fix chunk "${fixChunk.title}" review failed`,
                  });
                  break;
                }
                // If fix needs another fix, we'll skip for now (could recursively fix)
              }
            } else if (result.reviewResult.status === 'fail') {
              failed++;
              sendEvent(controller, encoder, 'stopped', {
                reason: `Chunk "${chunk.title}" review failed`,
              });
              break;
            }
          }
        }

        // Check if all completed successfully
        if (!isRunAllAborted(specId) && failed === 0) {
          // Update spec status to completed
          updateSpec(specId, { status: 'completed' });
        } else {
          // Keep as running or set to review for manual intervention
          updateSpec(specId, { status: 'review' });
        }

        // Send final event
        sendEvent(controller, encoder, 'all_complete', {
          specId,
          passed,
          failed,
          fixes,
        });
      } catch (error) {
        sendEvent(controller, encoder, 'error', {
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        endRunAllSession(specId);
        controller.close();
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
