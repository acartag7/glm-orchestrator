import { NextResponse } from 'next/server';
import { getSpec, updateSpec, createChunk, updateStudioState } from '@/lib/db';
import type { CompleteStudioRequest } from '@specwright/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/specs/[id]/studio/complete - Save spec and create chunks
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: specId } = await context.params;
    const body = await request.json() as CompleteStudioRequest;

    const spec = getSpec(specId);
    if (!spec) {
      return NextResponse.json({ error: 'Spec not found' }, { status: 404 });
    }

    if (!body.spec?.trim()) {
      return NextResponse.json({ error: 'Spec content is required' }, { status: 400 });
    }

    // Update spec with generated content and set status to 'ready'
    const updatedSpec = updateSpec(specId, {
      title: extractTitle(body.spec) || spec.title || 'Untitled Spec',
      content: body.spec,
      status: 'ready',
    });

    if (!updatedSpec) {
      return NextResponse.json({ error: 'Failed to update spec' }, { status: 500 });
    }

    // Create chunks from selected suggestions
    const selectedChunks = (body.chunks || []).filter(c => c.selected);
    for (const chunk of selectedChunks) {
      createChunk(specId, {
        title: chunk.title,
        description: chunk.description,
        order: chunk.order,
      });
    }

    // Mark studio as complete for the parent project
    updateStudioState(spec.projectId, { step: 'complete' });

    return NextResponse.json({ success: true, spec: updatedSpec });
  } catch (error) {
    console.error('Error completing studio:', error);
    return NextResponse.json(
      { error: `Failed to complete: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

// Extract title from markdown (first # heading)
function extractTitle(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}
