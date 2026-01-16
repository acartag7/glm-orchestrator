/**
 * Individual Worker API
 *
 * GET /api/workers/[id] - Get worker status
 * DELETE /api/workers/[id] - Stop and remove worker
 */

import { NextResponse } from 'next/server';
import { getOrchestrator } from '@/lib/worker-orchestrator';
import { getWorker } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/workers/[id]
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  const worker = getWorker(id);
  if (!worker) {
    return NextResponse.json(
      { error: 'Worker not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(worker);
}

// DELETE /api/workers/[id]
export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  const worker = getWorker(id);
  if (!worker) {
    return NextResponse.json(
      { error: 'Worker not found' },
      { status: 404 }
    );
  }

  const orchestrator = getOrchestrator();

  try {
    await orchestrator.stopWorker(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error stopping worker:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop worker' },
      { status: 500 }
    );
  }
}
