import { NextResponse } from 'next/server';
import { getChunk, updateChunk, insertFixChunk, getSpec } from '@/lib/db';
import { buildReviewPrompt, parseReviewResult } from '@/lib/prompts';
import { ClaudeClient } from '@specwright/mcp/client';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/chunks/[id]/review - Review a completed chunk with Opus
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id: chunkId } = await context.params;

    // Get chunk
    const chunk = getChunk(chunkId);
    if (!chunk) {
      return NextResponse.json(
        { error: 'Chunk not found' },
        { status: 404 }
      );
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
      return NextResponse.json(
        { error: 'Spec not found' },
        { status: 404 }
      );
    }

    // Build review prompt
    const prompt = buildReviewPrompt(chunk);

    // Call Opus for review
    const claudeClient = new ClaudeClient();
    const result = await claudeClient.execute(prompt, {
      timeout: 120000, // 2 minutes for review
    });

    if (!result.success) {
      return NextResponse.json(
        { error: `Review failed: ${result.output}` },
        { status: 500 }
      );
    }

    // Parse the review result
    const reviewResult = parseReviewResult(result.output);
    if (!reviewResult) {
      return NextResponse.json(
        { error: 'Failed to parse review result', rawOutput: result.output },
        { status: 500 }
      );
    }

    // Update chunk with review result
    updateChunk(chunkId, {
      reviewStatus: reviewResult.status,
      reviewFeedback: reviewResult.feedback,
    });

    // If needs_fix, create the fix chunk
    let fixChunk = null;
    if (reviewResult.status === 'needs_fix' && reviewResult.fixChunk) {
      fixChunk = insertFixChunk(chunkId, {
        title: reviewResult.fixChunk.title,
        description: reviewResult.fixChunk.description,
      });
    }

    return NextResponse.json({
      ...reviewResult,
      fixChunk: fixChunk || reviewResult.fixChunk,
      fixChunkId: fixChunk?.id,
    });
  } catch (error) {
    console.error('Error reviewing chunk:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to review chunk' },
      { status: 500 }
    );
  }
}
