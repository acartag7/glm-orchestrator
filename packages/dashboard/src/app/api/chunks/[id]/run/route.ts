import { NextResponse } from 'next/server';
import { startChunkExecution, hasRunningExecution, getRunningChunkId } from '@/lib/execution';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/chunks/[id]/run - Start executing a chunk
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id: chunkId } = await context.params;

    // Check if already running
    if (hasRunningExecution()) {
      const runningId = getRunningChunkId();
      return NextResponse.json(
        { error: `Another chunk is already running (${runningId})` },
        { status: 409 }
      );
    }

    const result = await startChunkExecution(chunkId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Chunk execution started',
      chunkId,
    });
  } catch (error) {
    console.error('Error starting chunk execution:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start execution' },
      { status: 500 }
    );
  }
}
