import { NextResponse } from 'next/server';
import { abortChunkExecution } from '@/lib/execution';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/chunks/[id]/abort - Abort a running chunk execution
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id: chunkId } = await context.params;

    const result = await abortChunkExecution(chunkId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Chunk execution aborted',
      chunkId,
    });
  } catch (error) {
    console.error('Error aborting chunk execution:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to abort execution' },
      { status: 500 }
    );
  }
}
