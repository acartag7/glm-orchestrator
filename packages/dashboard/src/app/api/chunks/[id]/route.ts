import { NextResponse } from 'next/server';
import { getChunk, getToolCallsByChunk, updateChunk, deleteChunk } from '@/lib/db';
import type { UpdateChunkRequest } from '@specwright/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/chunks/[id] - Get chunk with tool calls
export async function GET(_request: Request, context: RouteContext) {
  const { id: chunkId } = await context.params;

  const chunk = getChunk(chunkId);
  if (!chunk) {
    return NextResponse.json(
      { error: 'Chunk not found' },
      { status: 404 }
    );
  }

  const toolCalls = getToolCallsByChunk(chunkId);

  return NextResponse.json({
    chunk,
    toolCalls,
  });
}

// PUT /api/chunks/[id] - Update a chunk
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id: chunkId } = await context.params;
    const body = await request.json() as UpdateChunkRequest;

    const chunk = updateChunk(chunkId, {
      title: body.title?.trim(),
      description: body.description?.trim(),
      order: body.order,
    });

    if (!chunk) {
      return NextResponse.json({ error: 'Chunk not found' }, { status: 404 });
    }

    return NextResponse.json(chunk);
  } catch (error) {
    console.error('Error updating chunk:', error);
    return NextResponse.json({ error: 'Failed to update chunk' }, { status: 500 });
  }
}

// DELETE /api/chunks/[id] - Delete a chunk
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id: chunkId } = await context.params;
    const deleted = deleteChunk(chunkId);

    if (!deleted) {
      return NextResponse.json({ error: 'Chunk not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting chunk:', error);
    return NextResponse.json({ error: 'Failed to delete chunk' }, { status: 500 });
  }
}
