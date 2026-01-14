import { NextResponse } from 'next/server';
import { getSpecByProject, updateSpec } from '@/lib/db';
import type { UpdateSpecRequest } from '@glm/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/projects/[id]/spec - Get spec for project
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const spec = getSpecByProject(projectId);

    if (!spec) {
      return NextResponse.json(
        { error: 'Spec not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(spec);
  } catch (error) {
    console.error('Error fetching spec:', error);
    return NextResponse.json(
      { error: 'Failed to fetch spec' },
      { status: 500 }
    );
  }
}

// PUT /api/projects/[id]/spec - Update spec
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json() as UpdateSpecRequest;

    // Get existing spec for this project
    const existingSpec = getSpecByProject(projectId);
    if (!existingSpec) {
      return NextResponse.json(
        { error: 'Spec not found' },
        { status: 404 }
      );
    }

    const spec = updateSpec(existingSpec.id, {
      title: body.title?.trim(),
      content: body.content,
    });

    if (!spec) {
      return NextResponse.json(
        { error: 'Failed to update spec' },
        { status: 500 }
      );
    }

    return NextResponse.json(spec);
  } catch (error) {
    console.error('Error updating spec:', error);
    return NextResponse.json(
      { error: 'Failed to update spec' },
      { status: 500 }
    );
  }
}
