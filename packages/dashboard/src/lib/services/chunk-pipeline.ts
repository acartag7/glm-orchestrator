/**
 * Chunk Pipeline - Orchestrates the full chunk execution flow
 *
 * Flow: execute → validate → review → commit
 *
 * This is the core orchestration layer that combines:
 * - ChunkExecutor for OpenCode execution
 * - ValidationService for file change and build validation
 * - ReviewService for Haiku review
 * - GitService for committing changes
 */

import type { ChunkToolCall } from '@specwright/shared';
import { getChunk, updateChunk, getSpec } from '../db';
import { getProject } from '../db/projects';
import { chunkExecutor, type ExecutionResult } from './chunk-executor';
import { validationService, type ValidationResult } from './validation-service';
import { reviewService, createReviewService, type ChunkReviewResult } from './review-service';
import { gitService, type GitWorkflowState } from './git-service';

export interface ChunkPipelineResult {
  status: 'pass' | 'fail' | 'needs_fix' | 'error' | 'cancelled';
  output?: string;
  reviewFeedback?: string;
  commitHash?: string;
  fixChunkId?: string;
  error?: string;
}

export interface ChunkPipelineEvents {
  onExecutionStart?: (chunkId: string) => void;
  onExecutionComplete?: (chunkId: string, output: string) => void;
  onToolCall?: (chunkId: string, toolCall: ChunkToolCall) => void;
  onValidationStart?: (chunkId: string) => void;
  onValidationComplete?: (chunkId: string, result: ValidationResult) => void;
  onReviewStart?: (chunkId: string) => void;
  onReviewComplete?: (chunkId: string, result: ChunkReviewResult) => void;
  onCommit?: (chunkId: string, commitHash: string) => void;
  onError?: (chunkId: string, error: string) => void;
}

export class ChunkPipeline {
  /**
   * Execute full chunk pipeline:
   * 1. Execute chunk via OpenCode
   * 2. Validate (if gitState provided)
   * 3. Review with Haiku
   * 4. Commit (if review passes and gitState provided)
   * 5. Create fix chunk (if review returns needs_fix)
   */
  async execute(
    chunkId: string,
    gitState?: GitWorkflowState,
    events?: ChunkPipelineEvents
  ): Promise<ChunkPipelineResult> {
    const chunk = getChunk(chunkId);
    if (!chunk) {
      const error = 'Chunk not found';
      events?.onError?.(chunkId, error);
      return { status: 'error', error };
    }

    const spec = getSpec(chunk.specId);
    if (!spec) {
      const error = 'Spec not found';
      events?.onError?.(chunkId, error);
      return { status: 'error', error };
    }

    const project = getProject(spec.projectId);

    console.log(`[ChunkPipeline] Starting pipeline for chunk: ${chunk.title}`);

    // Step 1: Execute chunk
    events?.onExecutionStart?.(chunkId);

    const executionResult = await chunkExecutor.execute(chunkId, {
      onToolCall: (toolCall) => events?.onToolCall?.(chunkId, toolCall),
    });

    if (executionResult.status === 'cancelled') {
      return { status: 'cancelled', output: executionResult.output };
    }

    if (executionResult.status === 'failed') {
      events?.onError?.(chunkId, executionResult.error || 'Execution failed');
      return {
        status: 'fail',
        output: executionResult.output,
        error: executionResult.error,
      };
    }

    events?.onExecutionComplete?.(chunkId, executionResult.output || '');

    // Step 2: Validate (if gitState provided for working directory)
    let validationResult: ValidationResult | undefined;
    const workingDir = gitState?.workingDir || project?.directory;

    if (workingDir) {
      events?.onValidationStart?.(chunkId);

      validationResult = await validationService.validate(chunkId, workingDir);

      events?.onValidationComplete?.(chunkId, validationResult);

      // Auto-fail on validation failure
      if (validationResult.autoFail) {
        console.log(`[ChunkPipeline] Validation auto-fail: ${validationResult.autoFail.reason}`);

        // Update chunk with failure info
        updateChunk(chunkId, {
          status: 'failed',
          error: validationResult.autoFail.feedback,
          reviewStatus: 'fail',
          reviewFeedback: validationResult.autoFail.feedback,
        });

        events?.onError?.(chunkId, validationResult.autoFail.feedback);

        return {
          status: 'fail',
          output: executionResult.output,
          reviewFeedback: validationResult.autoFail.feedback,
          error: validationResult.autoFail.feedback,
        };
      }
    }

    // Step 3: Review with Haiku
    events?.onReviewStart?.(chunkId);

    // Use project-specific review service if available
    const reviewSvc = project?.id ? createReviewService(project.id) : reviewService;

    const reviewResult = await reviewSvc.reviewChunk(chunkId, validationResult);

    events?.onReviewComplete?.(chunkId, reviewResult);

    if (reviewResult.status === 'error') {
      events?.onError?.(chunkId, reviewResult.error || 'Review failed');
      return {
        status: 'error',
        output: executionResult.output,
        error: reviewResult.error,
      };
    }

    // Step 4: Commit (if review passes and git is enabled)
    let commitHash: string | undefined;

    if (reviewResult.status === 'pass' && gitState?.enabled) {
      const commitResult = await gitService.commitChunk(
        gitState,
        chunkId,
        chunk.title,
        chunk.order
      );

      if (commitResult.success && commitResult.commitHash) {
        commitHash = commitResult.commitHash;
        events?.onCommit?.(chunkId, commitHash);

        // Update chunk with commit hash
        updateChunk(chunkId, { commitHash });
      } else {
        console.warn(`[ChunkPipeline] Commit failed: ${commitResult.error}`);
        // Don't fail the pipeline for commit failures - changes are still valid
      }
    }

    // Step 5: Handle needs_fix
    if (reviewResult.status === 'needs_fix') {
      console.log(`[ChunkPipeline] Chunk needs fix: ${reviewResult.feedback}`);

      // Git reset if changes were made but failed review
      if (gitState?.enabled) {
        gitService.resetHard(gitState);
        console.log(`[ChunkPipeline] Reset git state after needs_fix`);
      }

      return {
        status: 'needs_fix',
        output: executionResult.output,
        reviewFeedback: reviewResult.feedback,
        fixChunkId: reviewResult.fixChunkId,
      };
    }

    // Step 6: Handle fail
    if (reviewResult.status === 'fail') {
      console.log(`[ChunkPipeline] Chunk failed review: ${reviewResult.feedback}`);

      // Git reset on failure
      if (gitState?.enabled) {
        gitService.resetHard(gitState);
        console.log(`[ChunkPipeline] Reset git state after fail`);
      }

      return {
        status: 'fail',
        output: executionResult.output,
        reviewFeedback: reviewResult.feedback,
      };
    }

    // Success!
    console.log(`[ChunkPipeline] Chunk completed successfully: ${chunk.title}`);

    return {
      status: 'pass',
      output: executionResult.output,
      reviewFeedback: reviewResult.feedback,
      commitHash,
    };
  }

  /**
   * Abort a running pipeline
   */
  async abort(chunkId: string): Promise<{ success: boolean; error?: string }> {
    return chunkExecutor.abort(chunkId);
  }

  /**
   * Check if chunk is currently in pipeline
   */
  isRunning(chunkId: string): boolean {
    return chunkExecutor.isRunning(chunkId);
  }
}

export const chunkPipeline = new ChunkPipeline();
