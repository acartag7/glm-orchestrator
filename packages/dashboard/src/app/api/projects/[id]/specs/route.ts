import { NextRequest, NextResponse } from 'next/server';
import { getProject, getSpecsByProject, createSpec, getChunksBySpec } from '@/lib/db';
import type { CreateSpecRequest } from '@specwright/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/projects/[id]/specs - List all specs for a project
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;

    const project = getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const specs = getSpecsByProject(projectId);

    // Include chunk counts for each spec
    const specsWithCounts = specs.map(spec => {
      const chunks = getChunksBySpec(spec.id);
      const completedChunks = chunks.filter(c => c.status === 'completed').length;
      return {
        ...spec,
        chunkCount: chunks.length,
        completedChunkCount: completedChunks,
      };
    });

    return NextResponse.json(specsWithCounts);
  } catch (error) {
    console.error('Error fetching specs:', error);
    return NextResponse.json({ error: 'Failed to fetch specs' }, { status: 500 });
  }
}

// POST /api/projects/[id]/specs - Create a new spec
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;

    const project = getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const body = await request.json() as CreateSpecRequest;

    if (!body.title || typeof body.title !== 'string') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const spec = createSpec(projectId, body.title.trim(), body.content);

    return NextResponse.json(spec, { status: 201 });
  } catch (error) {
    console.error('Error creating spec:', error);
    return NextResponse.json({ error: 'Failed to create spec' }, { status: 500 });
  }
}
