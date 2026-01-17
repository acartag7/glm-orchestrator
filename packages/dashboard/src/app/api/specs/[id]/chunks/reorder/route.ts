import { NextResponse } from 'next/server';
import { getSpec, reorderChunks, getChunksBySpec } from '@/lib/db';
import type { ReorderChunksRequest } from '@specwright/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/specs/[id]/chunks/reorder - Reorder chunks
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: specId } = await context.params;
    const body = await request.json() as ReorderChunksRequest;

    if (!body.chunkIds || !Array.isArray(body.chunkIds)) {
      return NextResponse.json({ error: 'chunkIds array is required' }, { status: 400 });
    }

    const spec = getSpec(specId);
    if (!spec) {
      return NextResponse.json({ error: 'Spec not found' }, { status: 404 });
    }

    reorderChunks(specId, body.chunkIds);
    const updatedChunks = getChunksBySpec(specId);

    return NextResponse.json(updatedChunks);
  } catch (error) {
    console.error('Error reordering chunks:', error);
    return NextResponse.json({ error: 'Failed to reorder chunks' }, { status: 500 });
  }
}
