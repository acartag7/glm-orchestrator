import { NextResponse } from 'next/server';
import { getSpec, getChunksBySpec, createChunk } from '@/lib/db';
import type { CreateChunkRequest } from '@specwright/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/specs/[id]/chunks - List all chunks for a spec
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: specId } = await context.params;

    const spec = getSpec(specId);
    if (!spec) {
      return NextResponse.json({ error: 'Spec not found' }, { status: 404 });
    }

    const chunks = getChunksBySpec(specId);
    return NextResponse.json(chunks);
  } catch (error) {
    console.error('Error fetching chunks:', error);
    return NextResponse.json({ error: 'Failed to fetch chunks' }, { status: 500 });
  }
}

// POST /api/specs/[id]/chunks - Create a new chunk for a spec
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: specId } = await context.params;
    const body = await request.json() as CreateChunkRequest;

    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    if (!body.description || typeof body.description !== 'string') {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }

    const spec = getSpec(specId);
    if (!spec) {
      return NextResponse.json({ error: 'Spec not found' }, { status: 404 });
    }

    const chunk = createChunk(specId, {
      title: body.title.trim(),
      description: body.description.trim(),
      order: body.order,
    });

    return NextResponse.json(chunk, { status: 201 });
  } catch (error) {
    console.error('Error creating chunk:', error);
    return NextResponse.json({ error: 'Failed to create chunk' }, { status: 500 });
  }
}
