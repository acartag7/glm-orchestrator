import { NextResponse } from 'next/server';
import { getSpecByProject, getChunksBySpec, createChunk } from '@/lib/db';
import type { CreateChunkRequest } from '@specwright/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/projects/[id]/chunks - List all chunks for project
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;

    // Get spec for project
    const spec = getSpecByProject(projectId);
    if (!spec) {
      return NextResponse.json(
        { error: 'Spec not found for project' },
        { status: 404 }
      );
    }

    const chunks = getChunksBySpec(spec.id);
    return NextResponse.json(chunks);
  } catch (error) {
    console.error('Error fetching chunks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch chunks' },
      { status: 500 }
    );
  }
}

// POST /api/projects/[id]/chunks - Create a new chunk
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json() as CreateChunkRequest;

    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }

    if (!body.description || typeof body.description !== 'string') {
      return NextResponse.json(
        { error: 'Description is required' },
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

    const chunk = createChunk(spec.id, {
      title: body.title.trim(),
      description: body.description.trim(),
      order: body.order,
    });

    return NextResponse.json(chunk, { status: 201 });
  } catch (error) {
    console.error('Error creating chunk:', error);
    return NextResponse.json(
      { error: 'Failed to create chunk' },
      { status: 500 }
    );
  }
}
