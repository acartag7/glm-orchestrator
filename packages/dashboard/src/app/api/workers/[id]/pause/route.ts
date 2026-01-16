/**
 * Pause Worker API
 *
 * POST /api/workers/[id]/pause - Pause a running worker
 */

import { NextResponse } from 'next/server';
import { getOrchestrator } from '@/lib/worker-orchestrator';
import { getWorker } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/workers/[id]/pause
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  const worker = getWorker(id);
  if (!worker) {
    return NextResponse.json(
      { error: 'Worker not found' },
      { status: 404 }
    );
  }

  if (worker.status !== 'running') {
    return NextResponse.json(
      { error: 'Worker is not running' },
      { status: 400 }
    );
  }

  const orchestrator = getOrchestrator();

  try {
    await orchestrator.pauseWorker(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error pausing worker:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to pause worker' },
      { status: 500 }
    );
  }
}
