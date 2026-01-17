import { NextRequest, NextResponse } from 'next/server';
import { getSpec, updateSpec, deleteSpec, getChunksBySpec } from '@/lib/db';
import type { UpdateSpecRequest } from '@specwright/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/specs/[id] - Get a single spec with its chunks
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: specId } = await context.params;

    const spec = getSpec(specId);
    if (!spec) {
      return NextResponse.json({ error: 'Spec not found' }, { status: 404 });
    }

    const chunks = getChunksBySpec(specId);

    return NextResponse.json({
      spec,
      chunks,
    });
  } catch (error) {
    console.error('Error fetching spec:', error);
    return NextResponse.json({ error: 'Failed to fetch spec' }, { status: 500 });
  }
}

// PUT /api/specs/[id] - Update a spec
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id: specId } = await context.params;

    const existingSpec = getSpec(specId);
    if (!existingSpec) {
      return NextResponse.json({ error: 'Spec not found' }, { status: 404 });
    }

    const body = await request.json() as UpdateSpecRequest;

    const updatedSpec = updateSpec(specId, {
      title: body.title,
      content: body.content,
      status: body.status,
      branchName: body.branchName,
      prNumber: body.prNumber,
      prUrl: body.prUrl,
    });

    if (!updatedSpec) {
      return NextResponse.json({ error: 'Failed to update spec' }, { status: 500 });
    }

    return NextResponse.json(updatedSpec);
  } catch (error) {
    console.error('Error updating spec:', error);
    return NextResponse.json({ error: 'Failed to update spec' }, { status: 500 });
  }
}

// DELETE /api/specs/[id] - Delete a spec and its chunks
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id: specId } = await context.params;

    const spec = getSpec(specId);
    if (!spec) {
      return NextResponse.json({ error: 'Spec not found' }, { status: 404 });
    }

    const deleted = deleteSpec(specId);
    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete spec' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting spec:', error);
    return NextResponse.json({ error: 'Failed to delete spec' }, { status: 500 });
  }
}
