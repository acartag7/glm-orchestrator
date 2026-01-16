/**
 * Worker Instance
 *
 * Handles execution of a single spec's chunks.
 * Similar to run-all but designed for background operation.
 */

import type { Chunk, ReviewResult, ReviewStatus, ChunkToolCall, WorkerProgress } from '@glm/shared';
import {
  getChunksBySpec,
  updateChunk,
  insertFixChunk,
  getChunk,
  updateSpec,
} from './db';
import {
  startChunkExecution,
  waitForChunkCompletion,
  abortChunkExecution,
} from './execution';
import { ClaudeClient } from '@glm/mcp/client';

type WorkerEventCallback = (event: {
  type: string;
  data: Record<string, unknown>;
}) => void;

// Review prompt template
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

/**
 * Find chunks that can run (all dependencies completed)
 */
function findRunnableChunks(
  allChunks: Chunk[],
  completedIds: Set<string>,
  runningIds: Set<string>,
  failedIds: Set<string>
): Chunk[] {
  return allChunks.filter(chunk => {
    if (completedIds.has(chunk.id) || runningIds.has(chunk.id) || failedIds.has(chunk.id)) {
      return false;
    }
    if (chunk.status !== 'pending' && chunk.status !== 'failed' && chunk.status !== 'cancelled') {
      return false;
    }
    for (const depId of chunk.dependencies) {
      if (!completedIds.has(depId)) {
        return false;
      }
    }
    return true;
  });
}

export class WorkerInstance {
  private workerId: string;
  private specId: string;
  private projectId: string;
  private directory: string;
  private onEvent: WorkerEventCallback;

  private aborted = false;
  private paused = false;
  private pausePromise: Promise<void> | null = null;
  private pauseResolve: (() => void) | null = null;

  private progress: WorkerProgress = {
    current: 0,
    total: 0,
    passed: 0,
    failed: 0,
  };

  private currentChunkId: string | null = null;

  constructor(
    workerId: string,
    specId: string,
    projectId: string,
    directory: string,
    onEvent: WorkerEventCallback
  ) {
    this.workerId = workerId;
    this.specId = specId;
    this.projectId = projectId;
    this.directory = directory;
    this.onEvent = onEvent;
  }

  /**
   * Start executing the worker
   */
  async start(): Promise<void> {
    try {
      // Update spec status to running
      updateSpec(this.specId, { status: 'running' });

      // Get all chunks
      const allChunks = getChunksBySpec(this.specId);
      const pendingChunks = allChunks.filter(c =>
        c.status === 'pending' || c.status === 'failed' || c.status === 'cancelled'
      );

      this.progress.total = pendingChunks.length;
      this.emitProgress();

      // Track state
      const completedIds = new Set<string>();
      const runningIds = new Set<string>();
      const failedIds = new Set<string>();

      // Initialize completed set with already completed chunks
      for (const chunk of allChunks) {
        if (chunk.status === 'completed') {
          completedIds.add(chunk.id);
        }
      }

      let hasFailure = false;
      let stopReason: string | null = null;

      // Main execution loop
      while (!hasFailure && !stopReason) {
        // Check for abort
        if (this.aborted) {
          stopReason = 'Aborted by user';
          break;
        }

        // Check for pause
        await this.waitIfPaused();

        // Refresh chunks from DB
        const currentChunks = getChunksBySpec(this.specId);

        // Find runnable chunks
        const runnableChunks = findRunnableChunks(currentChunks, completedIds, runningIds, failedIds);

        // Check if done
        if (runnableChunks.length === 0 && runningIds.size === 0) {
          break;
        }

        // Wait if nothing can run
        if (runnableChunks.length === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        // Run chunks (one at a time for workers to avoid resource contention)
        // Unlike run-all which runs in parallel, workers run chunks sequentially
        for (const chunk of runnableChunks) {
          if (this.aborted) {
            stopReason = 'Aborted by user';
            break;
          }

          await this.waitIfPaused();

          runningIds.add(chunk.id);
          this.progress.current++;
          this.currentChunkId = chunk.id;
          this.emitProgress('executing');

          const result = await this.runChunk(chunk.id, chunk.title, false);
          runningIds.delete(chunk.id);

          if (!result.success) {
            if (this.aborted) {
              stopReason = 'Aborted by user';
            } else {
              failedIds.add(chunk.id);
              this.progress.failed++;
              hasFailure = true;
              stopReason = `Chunk "${chunk.title}" failed`;
            }
            break;
          }

          // Handle review result
          if (result.reviewResult) {
            if (result.reviewResult.status === 'pass') {
              completedIds.add(chunk.id);
              this.progress.passed++;
            } else if (result.reviewResult.status === 'needs_fix' && result.fixChunkId) {
              // Run fix chunk
              const fixChunk = getChunk(result.fixChunkId);
              if (fixChunk) {
                this.currentChunkId = result.fixChunkId;
                this.emitProgress('executing');

                const fixResult = await this.runChunk(result.fixChunkId, fixChunk.title, true);

                if (!fixResult.success) {
                  if (this.aborted) {
                    stopReason = 'Aborted by user';
                  } else {
                    failedIds.add(chunk.id);
                    this.progress.failed++;
                    hasFailure = true;
                    stopReason = `Fix chunk "${fixChunk.title}" failed`;
                  }
                  break;
                }

                if (fixResult.reviewResult?.status === 'pass') {
                  completedIds.add(chunk.id);
                  completedIds.add(result.fixChunkId);
                  this.progress.passed++;
                } else if (fixResult.reviewResult?.status === 'fail') {
                  failedIds.add(chunk.id);
                  this.progress.failed++;
                  hasFailure = true;
                  stopReason = `Fix chunk "${fixChunk.title}" review failed`;
                  break;
                } else {
                  // needs_fix again - mark as completed to avoid infinite loop
                  completedIds.add(chunk.id);
                  completedIds.add(result.fixChunkId);
                }
              }
            } else if (result.reviewResult.status === 'fail') {
              failedIds.add(chunk.id);
              this.progress.failed++;
              hasFailure = true;
              stopReason = `Chunk "${chunk.title}" review failed`;
              break;
            }
          }

          this.emitProgress();
        }
      }

      // Update spec status
      if (!this.aborted && this.progress.failed === 0) {
        updateSpec(this.specId, { status: 'completed' });
      } else {
        updateSpec(this.specId, { status: 'review' });
      }

      // Emit completion
      this.currentChunkId = null;
      this.onEvent({
        type: 'completed',
        data: {
          progress: this.progress,
          stopReason,
        },
      });
    } catch (error) {
      this.onEvent({
        type: 'failed',
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
          progress: this.progress,
        },
      });
    }
  }

  /**
   * Run a single chunk
   */
  private async runChunk(
    chunkId: string,
    title: string,
    isFix: boolean
  ): Promise<{ success: boolean; reviewResult?: ReviewResult; fixChunkId?: string }> {
    // Check for abort
    if (this.aborted) {
      return { success: false };
    }

    // Emit start event
    this.onEvent({
      type: 'chunk_start',
      data: {
        chunkId,
        title,
        isFix,
        progress: this.progress,
      },
    });

    // Start execution
    const startResult = await startChunkExecution(chunkId);
    if (!startResult.success) {
      return { success: false };
    }

    // Wait for completion
    const completionResult = await waitForChunkCompletion(
      chunkId,
      (toolCall: ChunkToolCall) => {
        // Forward tool calls for visibility
        this.onEvent({
          type: 'tool_call',
          data: {
            chunkId,
            toolCall: {
              id: toolCall.id,
              tool: toolCall.tool,
              status: toolCall.status,
            },
          },
        });
      }
    );

    if (this.aborted) {
      return { success: false };
    }

    if (completionResult.status !== 'completed') {
      return { success: false };
    }

    // Emit complete event
    this.onEvent({
      type: 'chunk_complete',
      data: {
        chunkId,
        output: completionResult.output || '',
      },
    });

    // Review the chunk
    this.emitProgress('reviewing');
    this.onEvent({
      type: 'review_start',
      data: { chunkId },
    });

    const updatedChunk = getChunk(chunkId);
    if (!updatedChunk) {
      return { success: false };
    }

    // Build review prompt and call Opus
    const reviewPrompt = buildReviewPrompt(updatedChunk);
    const claudeClient = new ClaudeClient();

    try {
      const reviewResult = await claudeClient.execute(reviewPrompt, { timeout: 120000 });

      if (!reviewResult.success) {
        return { success: false };
      }

      const parsedReview = parseReviewResult(reviewResult.output);
      if (!parsedReview) {
        // Assume pass if parsing fails
        this.onEvent({
          type: 'review_complete',
          data: {
            chunkId,
            status: 'pass',
            feedback: 'Review parsing failed, assuming pass',
          },
        });
        return { success: true, reviewResult: { status: 'pass', feedback: 'Review parsing failed' } };
      }

      // Update chunk with review result
      updateChunk(chunkId, {
        reviewStatus: parsedReview.status,
        reviewFeedback: parsedReview.feedback,
      });

      let fixChunkId: string | undefined;

      // Create fix chunk if needed
      if (parsedReview.status === 'needs_fix' && parsedReview.fixChunk) {
        const fixChunk = insertFixChunk(chunkId, {
          title: parsedReview.fixChunk.title,
          description: parsedReview.fixChunk.description,
        });
        if (fixChunk) {
          fixChunkId = fixChunk.id;
          this.progress.total++; // Add fix chunk to total
        }
      }

      this.onEvent({
        type: 'review_complete',
        data: {
          chunkId,
          status: parsedReview.status,
          feedback: parsedReview.feedback,
          fixChunkId,
        },
      });

      return { success: true, reviewResult: parsedReview, fixChunkId };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Emit progress event
   */
  private emitProgress(step?: 'executing' | 'reviewing'): void {
    const chunk = this.currentChunkId ? getChunk(this.currentChunkId) : null;
    this.onEvent({
      type: 'progress',
      data: {
        progress: this.progress,
        currentChunkId: this.currentChunkId,
        currentChunkTitle: chunk?.title,
        currentStep: step,
      },
    });
  }

  /**
   * Wait if paused
   */
  private async waitIfPaused(): Promise<void> {
    if (this.paused && !this.pausePromise) {
      this.pausePromise = new Promise(resolve => {
        this.pauseResolve = resolve;
      });
    }
    if (this.pausePromise) {
      await this.pausePromise;
    }
  }

  /**
   * Pause the worker
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume the worker
   */
  resume(): void {
    this.paused = false;
    if (this.pauseResolve) {
      this.pauseResolve();
      this.pauseResolve = null;
      this.pausePromise = null;
    }
  }

  /**
   * Abort the worker
   */
  async abort(): Promise<void> {
    this.aborted = true;
    this.resume(); // Unblock if paused

    // Abort current chunk if running
    if (this.currentChunkId) {
      try {
        await abortChunkExecution(this.currentChunkId);
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Check if paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Check if aborted
   */
  isAborted(): boolean {
    return this.aborted;
  }

  /**
   * Get current progress
   */
  getProgress(): WorkerProgress {
    return { ...this.progress };
  }
}
