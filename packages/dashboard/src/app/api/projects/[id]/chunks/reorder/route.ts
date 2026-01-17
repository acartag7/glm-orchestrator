import { NextResponse } from 'next/server';
import { getSpecByProject, getChunksBySpec, reorderChunks } from '@/lib/db';
import type { ReorderChunksRequest } from '@specwright/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/projects/[id]/chunks/reorder - Reorder chunks
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json() as ReorderChunksRequest;

    if (!Array.isArray(body.chunkIds) || body.chunkIds.length === 0) {
      return NextResponse.json(
        { error: 'chunkIds array is required' },
        { status: 400 }
      );
    }

    // Get spec for project
    const spec = getSpecByProject(projectId);
    if (!spec) {
      return NextResponse.json(
        { error: 'Spec not found for project' },
        { status: 404 }
      );
    }

    // Reorder chunks
    reorderChunks(spec.id, body.chunkIds);

    // Return updated chunks
    const chunks = getChunksBySpec(spec.id);
    return NextResponse.json(chunks);
  } catch (error) {
    console.error('Error reordering chunks:', error);
    return NextResponse.json(
      { error: 'Failed to reorder chunks' },
      { status: 500 }
    );
  }
}
