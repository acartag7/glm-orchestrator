import { NextResponse } from 'next/server';
import { getChunk, getToolCallsByChunk } from '@/lib/db';

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
