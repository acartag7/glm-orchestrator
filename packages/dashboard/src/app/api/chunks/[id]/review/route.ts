/**
 * Chunk Review API
 *
 * POST /api/chunks/[id]/review
 * Reviews a completed chunk using the review service
 */

import { NextResponse } from 'next/server';
import { getChunk, getSpec } from '@/lib/db';
import { getProject } from '@/lib/db/projects';
import { createReviewService } from '@/lib/services/review-service';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/chunks/[id]/review - Review a completed chunk
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id: chunkId } = await context.params;

    // Get chunk
    const chunk = getChunk(chunkId);
    if (!chunk) {
      return NextResponse.json({ error: 'Chunk not found' }, { status: 404 });
    }

    // Only review completed chunks
    if (chunk.status !== 'completed') {
      return NextResponse.json(
        { error: 'Can only review completed chunks' },
        { status: 400 }
      );
    }

    // Get spec for context
    const spec = getSpec(chunk.specId);
    if (!spec) {
      return NextResponse.json({ error: 'Spec not found' }, { status: 404 });
    }

    // Get project-specific review service
    const project = getProject(spec.projectId);
    const reviewSvc = createReviewService(project?.id);

    console.log(`[Review] Starting review for chunk: ${chunk.title}`);

    // Run review
    const result = await reviewSvc.reviewChunk(chunkId);

    if (result.status === 'error') {
      return NextResponse.json(
        { error: result.error || 'Review failed' },
        { status: 500 }
      );
    }

    console.log(`[Review] Chunk ${chunkId} review complete: ${result.status}`);

    return NextResponse.json({
      status: result.status,
      feedback: result.feedback,
      fixChunk: result.fixChunk,
      fixChunkId: result.fixChunkId,
    });
  } catch (error) {
    console.error('[Review] Error reviewing chunk:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to review chunk' },
      { status: 500 }
    );
  }
}
