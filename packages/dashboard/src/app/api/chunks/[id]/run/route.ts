/**
 * Single Chunk Run API
 *
 * POST /api/chunks/[id]/run
 * Runs a single chunk through the full pipeline (execute → validate → review → commit)
 */

import { NextResponse } from 'next/server';
import { getChunk, getSpec } from '@/lib/db';
import { getProject } from '@/lib/db/projects';
import { chunkPipeline } from '@/lib/services/chunk-pipeline';
import { gitService } from '@/lib/services/git-service';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/chunks/[id]/run - Run a single chunk through the full pipeline
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id: chunkId } = await context.params;

    // Get chunk and validate
    const chunk = getChunk(chunkId);
    if (!chunk) {
      return NextResponse.json({ error: 'Chunk not found' }, { status: 404 });
    }

    // Check if already running
    if (chunkPipeline.isRunning(chunkId)) {
      return NextResponse.json({ error: 'Chunk is already running' }, { status: 409 });
    }

    // Get spec and project for git workflow
    const spec = getSpec(chunk.specId);
    if (!spec) {
      return NextResponse.json({ error: 'Spec not found' }, { status: 404 });
    }

    const project = getProject(spec.projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Initialize git workflow
    let gitState;
    try {
      gitState = await gitService.initWorkflow(spec.id, project.directory);
      console.log(`[Execution] Git workflow initialized: ${gitState.enabled ? gitState.specBranch : 'disabled'}`);
    } catch (error) {
      console.warn('[Execution] Git workflow init failed:', error);
      // Continue without git
    }

    // Run chunk through pipeline
    const result = await chunkPipeline.execute(chunkId, gitState, {
      onToolCall: (id, toolCall) => {
        console.log(`[Execution] Tool call: ${toolCall.tool}`);
      },
      onValidationComplete: (id, validation) => {
        console.log(`[Execution] Validation: ${validation.filesChanged} files changed`);
      },
      onReviewComplete: (id, review) => {
        console.log(`[Execution] Review: ${review.status}`);
      },
      onCommit: (id, hash) => {
        console.log(`[Execution] Committed: ${hash}`);
      },
    });

    // Cleanup git state
    if (gitState) {
      await gitService.cleanup(gitState);
    }

    return NextResponse.json({
      success: result.status === 'pass',
      status: result.status,
      output: result.output,
      reviewFeedback: result.reviewFeedback,
      commitHash: result.commitHash,
      fixChunkId: result.fixChunkId,
      error: result.error,
    });
  } catch (error) {
    console.error('[Execution] Error running chunk:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run chunk' },
      { status: 500 }
    );
  }
}
