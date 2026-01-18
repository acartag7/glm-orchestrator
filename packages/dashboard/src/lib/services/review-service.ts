/**
 * Review Service - Orchestrates chunk and spec reviews with Claude
 *
 * Handles:
 * - Chunk reviews with Haiku (fast, per-chunk)
 * - Final spec reviews with Opus (comprehensive)
 * - Retry logic with exponential backoff
 * - Review logging to database
 */

import type { Chunk, Spec, ReviewStatus, ReviewResult } from '@specwright/shared';
import { CLAUDE_MODELS, type ReviewerConfig } from '@specwright/shared';
import { ClaudeClient } from '@specwright/mcp/client';
import { getChunk, updateChunk, insertFixChunk, getSpec, getChunksBySpec } from '../db';
import { getProject } from '../db/projects';
import { buildReviewPrompt, buildEnhancedReviewPrompt, parseReviewResult, type ValidationResultForPrompt } from '../prompts';
import { getDb, generateId } from '../db/connection';

export type ErrorType = 'rate_limit' | 'timeout' | 'parse_error' | 'unknown';

export interface ChunkReviewResult {
  status: 'pass' | 'fail' | 'needs_fix' | 'error';
  feedback?: string;
  fixChunk?: { title: string; description: string };
  fixChunkId?: string;
  error?: string;
  errorType?: ErrorType;
}

export interface FinalReviewResult {
  status: 'pass' | 'fail' | 'needs_fix' | 'error';
  feedback: string;
  integrationIssues?: string[];
  missingRequirements?: string[];
  fixChunks?: Array<{ title: string; description: string }>;
  error?: string;
  errorType?: ErrorType;
}

interface ReviewLogEntry {
  chunkId?: string;
  specId?: string;
  reviewType: 'chunk' | 'final';
  model: string;
  status: 'pass' | 'fail' | 'needs_fix' | 'error';
  feedback?: string;
  errorMessage?: string;
  errorType?: ErrorType;
  attemptNumber: number;
  durationMs: number;
}

const DEFAULT_CHUNK_TIMEOUT = 180000;  // 3 minutes
const DEFAULT_FINAL_TIMEOUT = 600000;  // 10 minutes
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BACKOFF_MS = 2000;

export class ReviewService {
  private config: ReviewerConfig;

  constructor(config?: Partial<ReviewerConfig>) {
    this.config = {
      type: 'sonnet-quick',
      cliPath: 'claude',
      autoApprove: false,
      chunkModel: 'haiku',
      finalModel: 'opus',
      chunkTimeout: DEFAULT_CHUNK_TIMEOUT,
      finalTimeout: DEFAULT_FINAL_TIMEOUT,
      maxRetries: DEFAULT_MAX_RETRIES,
      retryBackoffMs: DEFAULT_RETRY_BACKOFF_MS,
      finalReviewMaxFixAttempts: 2,
      ...config,
    };
  }

  /**
   * Review a single chunk with Haiku
   * - Updates chunk.review_status to 'reviewing' immediately
   * - Executes review with retry logic
   * - Updates chunk with results
   * - Logs to review_logs table
   */
  async reviewChunk(
    chunkId: string,
    validationResult?: ValidationResultForPrompt
  ): Promise<ChunkReviewResult> {
    const chunk = getChunk(chunkId);
    if (!chunk) {
      return { status: 'error', error: 'Chunk not found', errorType: 'unknown' };
    }

    const spec = getSpec(chunk.specId);
    if (!spec) {
      return { status: 'error', error: 'Spec not found', errorType: 'unknown' };
    }

    // Update status to reviewing
    updateChunk(chunkId, { reviewStatus: 'pass' }); // Temporary - will be overwritten
    console.log(`[Review] Starting chunk review for ${chunk.title} with ${this.config.chunkModel}`);

    const modelKey = this.config.chunkModel || 'haiku';
    const modelId = CLAUDE_MODELS[modelKey];
    const timeout = this.config.chunkTimeout || DEFAULT_CHUNK_TIMEOUT;
    const maxRetries = this.config.maxRetries || DEFAULT_MAX_RETRIES;
    const backoffMs = this.config.retryBackoffMs || DEFAULT_RETRY_BACKOFF_MS;

    // Build prompt
    const prompt = validationResult
      ? buildEnhancedReviewPrompt(chunk, validationResult)
      : buildReviewPrompt(chunk);

    let lastError: Error | null = null;
    let attemptNumber = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      attemptNumber = attempt + 1;
      const startTime = Date.now();

      try {
        const client = new ClaudeClient({ model: modelId });
        const result = await client.execute(prompt, { timeout });
        const durationMs = Date.now() - startTime;

        if (!result.success) {
          const errorType = this.classifyError(result.output);
          if (errorType === 'rate_limit' && attempt < maxRetries) {
            console.warn(`[Review] Rate limit detected for chunk ${chunkId}, retrying...`);
            await this.sleep(backoffMs * Math.pow(2, attempt));
            continue;
          }

          this.logReview({
            chunkId,
            reviewType: 'chunk',
            model: modelKey,
            status: 'error',
            errorMessage: result.output,
            errorType,
            attemptNumber,
            durationMs,
          });

          return {
            status: 'error',
            error: result.output,
            errorType,
          };
        }

        // Parse result
        const reviewResult = parseReviewResult(result.output);
        if (!reviewResult) {
          this.logReview({
            chunkId,
            reviewType: 'chunk',
            model: modelKey,
            status: 'error',
            errorMessage: 'Failed to parse review result',
            errorType: 'parse_error',
            attemptNumber,
            durationMs,
          });

          return {
            status: 'error',
            error: 'Failed to parse review result',
            errorType: 'parse_error',
          };
        }

        // Update chunk with result
        updateChunk(chunkId, {
          reviewStatus: reviewResult.status,
          reviewFeedback: reviewResult.feedback,
        });

        // Log successful review
        this.logReview({
          chunkId,
          reviewType: 'chunk',
          model: modelKey,
          status: reviewResult.status,
          feedback: reviewResult.feedback,
          attemptNumber,
          durationMs,
        });

        console.log(`[Review] Chunk ${chunkId} review ${reviewResult.status}`);

        // Create fix chunk if needed
        let fixChunkId: string | undefined;
        if (reviewResult.status === 'needs_fix' && reviewResult.fixChunk) {
          const fixChunk = insertFixChunk(chunkId, {
            title: reviewResult.fixChunk.title,
            description: reviewResult.fixChunk.description,
          });
          fixChunkId = fixChunk?.id;
        }

        return {
          status: reviewResult.status,
          feedback: reviewResult.feedback,
          fixChunk: reviewResult.fixChunk,
          fixChunkId,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const durationMs = Date.now() - startTime;
        const errorType = this.classifyError(lastError);

        if (errorType === 'rate_limit' && attempt < maxRetries) {
          console.warn(`[Review] Rate limit for chunk ${chunkId}, retry ${attempt + 1}/${maxRetries}`);
          await this.sleep(backoffMs * Math.pow(2, attempt));
          continue;
        }

        this.logReview({
          chunkId,
          reviewType: 'chunk',
          model: modelKey,
          status: 'error',
          errorMessage: lastError.message,
          errorType,
          attemptNumber,
          durationMs,
        });
      }
    }

    // All retries exhausted
    console.error(`[Review] All retries exhausted for chunk ${chunkId}`);
    return {
      status: 'error',
      error: lastError?.message || 'Review failed after all retries',
      errorType: 'unknown',
    };
  }

  /**
   * Final review of entire spec with Opus
   * - Reviews integration, completeness, quality
   * - Can return fix chunks if issues found
   * - Updates spec.final_review_status
   * - Logs to review_logs table
   */
  async reviewSpecFinal(specId: string): Promise<FinalReviewResult> {
    const spec = getSpec(specId);
    if (!spec) {
      return { status: 'error', feedback: '', error: 'Spec not found', errorType: 'unknown' };
    }

    const chunks = getChunksBySpec(specId);
    if (chunks.length === 0) {
      return { status: 'error', feedback: '', error: 'No chunks found', errorType: 'unknown' };
    }

    console.log(`[Review] Starting final spec review for ${spec.title} with ${this.config.finalModel}`);

    const modelKey = this.config.finalModel || 'opus';
    const modelId = CLAUDE_MODELS[modelKey];
    const timeout = this.config.finalTimeout || DEFAULT_FINAL_TIMEOUT;
    const maxRetries = this.config.maxRetries || DEFAULT_MAX_RETRIES;
    const backoffMs = this.config.retryBackoffMs || DEFAULT_RETRY_BACKOFF_MS;

    const prompt = this.buildFinalReviewPrompt(spec, chunks);

    let lastError: Error | null = null;
    let attemptNumber = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      attemptNumber = attempt + 1;
      const startTime = Date.now();

      try {
        const client = new ClaudeClient({ model: modelId });
        const result = await client.execute(prompt, { timeout });
        const durationMs = Date.now() - startTime;

        if (!result.success) {
          const errorType = this.classifyError(result.output);
          if (errorType === 'rate_limit' && attempt < maxRetries) {
            console.warn(`[Review] Rate limit for final review, retrying...`);
            await this.sleep(backoffMs * Math.pow(2, attempt));
            continue;
          }

          this.logReview({
            specId,
            reviewType: 'final',
            model: modelKey,
            status: 'error',
            errorMessage: result.output,
            errorType,
            attemptNumber,
            durationMs,
          });

          return {
            status: 'error',
            feedback: '',
            error: result.output,
            errorType,
          };
        }

        // Parse final review result
        const finalResult = this.parseFinalReviewResult(result.output);
        if (!finalResult) {
          this.logReview({
            specId,
            reviewType: 'final',
            model: modelKey,
            status: 'error',
            errorMessage: 'Failed to parse final review result',
            errorType: 'parse_error',
            attemptNumber,
            durationMs,
          });

          return {
            status: 'error',
            feedback: '',
            error: 'Failed to parse final review result',
            errorType: 'parse_error',
          };
        }

        // Log successful review
        this.logReview({
          specId,
          reviewType: 'final',
          model: modelKey,
          status: finalResult.status,
          feedback: finalResult.feedback,
          attemptNumber,
          durationMs,
        });

        console.log(`[Review] Final spec review ${finalResult.status}`);
        return finalResult;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const durationMs = Date.now() - startTime;
        const errorType = this.classifyError(lastError);

        if (errorType === 'rate_limit' && attempt < maxRetries) {
          console.warn(`[Review] Rate limit for final review, retry ${attempt + 1}/${maxRetries}`);
          await this.sleep(backoffMs * Math.pow(2, attempt));
          continue;
        }

        this.logReview({
          specId,
          reviewType: 'final',
          model: modelKey,
          status: 'error',
          errorMessage: lastError.message,
          errorType,
          attemptNumber,
          durationMs,
        });
      }
    }

    console.error(`[Review] All retries exhausted for final review`);
    return {
      status: 'error',
      feedback: '',
      error: lastError?.message || 'Final review failed after all retries',
      errorType: 'unknown',
    };
  }

  /**
   * Create fix chunks based on final review feedback
   * Returns array of created chunk IDs
   */
  async createFixChunks(
    specId: string,
    fixes: Array<{ title: string; description: string }>
  ): Promise<string[]> {
    const chunks = getChunksBySpec(specId);
    if (chunks.length === 0) {
      return [];
    }

    const lastChunk = chunks[chunks.length - 1];
    const createdIds: string[] = [];

    for (const fix of fixes) {
      const fixChunk = insertFixChunk(lastChunk.id, {
        title: fix.title,
        description: fix.description,
      });
      if (fixChunk) {
        createdIds.push(fixChunk.id);
        console.log(`[Review] Created fix chunk: ${fix.title}`);
      }
    }

    return createdIds;
  }

  private buildFinalReviewPrompt(spec: Spec, chunks: Chunk[]): string {
    const chunkSummaries = chunks.map((c, i) => {
      const status = c.reviewStatus || 'pending';
      return `${i + 1}. ${c.title} [${c.status}/${status}]\n   ${c.outputSummary || c.description}`;
    }).join('\n\n');

    return `You are performing a final review of a spec implementation.

## Spec
Title: ${spec.title}

Content:
${spec.content}

## Completed Chunks
${chunkSummaries}

## Your Job
Review the entire implementation for:
1. Integration - Do all chunks work together correctly?
2. Completeness - Are all requirements from the spec addressed?
3. Quality - Is the code well-structured and maintainable?

Return JSON:
{
  "status": "pass" | "needs_fix" | "fail",
  "feedback": "Overall assessment",
  "integrationIssues": ["Issue 1", "Issue 2"],
  "missingRequirements": ["Requirement 1"],
  "fixChunks": [
    {"title": "Fix title", "description": "What needs to be done"}
  ]
}

Rules:
- "pass" = Implementation is complete and correct
- "needs_fix" = Issues found but fixable
- "fail" = Fundamental problems requiring redesign
- Only include fixChunks if status is "needs_fix"
- Return ONLY valid JSON, no markdown code blocks`;
  }

  private parseFinalReviewResult(text: string): FinalReviewResult | null {
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

      return {
        status: parsed.status,
        feedback: parsed.feedback || '',
        integrationIssues: parsed.integrationIssues,
        missingRequirements: parsed.missingRequirements,
        fixChunks: parsed.fixChunks,
      };
    } catch {
      return null;
    }
  }

  private classifyError(error: unknown): ErrorType {
    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('rate limit') || lowerMessage.includes('429')) {
      return 'rate_limit';
    }
    if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
      return 'timeout';
    }
    if (lowerMessage.includes('parse') || lowerMessage.includes('json')) {
      return 'parse_error';
    }
    return 'unknown';
  }

  private logReview(entry: ReviewLogEntry): void {
    try {
      const db = getDb();
      const stmt = db.prepare(`
        INSERT INTO review_logs (id, chunk_id, spec_id, review_type, model, status, feedback, error_message, error_type, attempt_number, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        generateId(),
        entry.chunkId || null,
        entry.specId || null,
        entry.reviewType,
        entry.model,
        entry.status,
        entry.feedback || null,
        entry.errorMessage || null,
        entry.errorType || null,
        entry.attemptNumber,
        entry.durationMs,
        new Date().toISOString()
      );
    } catch (error) {
      console.error('[Review] Failed to log review:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Factory function to create service with project config
export function createReviewService(projectId?: string): ReviewService {
  if (projectId) {
    const project = getProject(projectId);
    if (project?.config?.reviewer) {
      return new ReviewService(project.config.reviewer);
    }
  }
  return new ReviewService();
}

export const reviewService = new ReviewService();
