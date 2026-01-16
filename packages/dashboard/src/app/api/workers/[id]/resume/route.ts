/**
 * Resume Worker API
 *
 * POST /api/workers/[id]/resume - Resume a paused worker
 */

import { NextResponse } from 'next/server';
import { getOrchestrator } from '@/lib/worker-orchestrator';
import { getWorker } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/workers/[id]/resume
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  const worker = getWorker(id);
  if (!worker) {
    return NextResponse.json(
      { error: 'Worker not found' },
      { status: 404 }
    );
  }

  if (worker.status !== 'paused') {
    return NextResponse.json(
      { error: 'Worker is not paused' },
      { status: 400 }
    );
  }

  const orchestrator = getOrchestrator();

  try {
    await orchestrator.resumeWorker(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error resuming worker:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resume worker' },
      { status: 500 }
    );
  }
}
