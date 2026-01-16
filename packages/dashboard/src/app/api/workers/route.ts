/**
 * Workers API
 *
 * GET /api/workers - List all workers
 * POST /api/workers - Create a new worker for a spec
 */

import { NextResponse } from 'next/server';
import { getOrchestrator } from '@/lib/worker-orchestrator';
import { getSpec } from '@/lib/db';
import type { CreateWorkerRequest } from '@glm/shared';

// GET /api/workers
export async function GET() {
  const orchestrator = getOrchestrator();
  const workers = orchestrator.getWorkers();
  const activeCount = orchestrator.getActiveCount();
  const maxWorkers = orchestrator.getMaxWorkers();
  const queue = orchestrator.getQueue();

  return NextResponse.json({
    workers,
    activeCount,
    maxWorkers,
    queue,
    hasCapacity: activeCount < maxWorkers,
  });
}

// POST /api/workers
export async function POST(request: Request) {
  try {
    const body = await request.json() as CreateWorkerRequest;

    if (!body.specId) {
      return NextResponse.json(
        { error: 'specId is required' },
        { status: 400 }
      );
    }

    // Verify spec exists
    const spec = getSpec(body.specId);
    if (!spec) {
      return NextResponse.json(
        { error: 'Spec not found' },
        { status: 404 }
      );
    }

    const orchestrator = getOrchestrator();

    try {
      const worker = await orchestrator.startWorker(body.specId);
      return NextResponse.json(worker, { status: 201 });
    } catch (error) {
      // Check if it's a capacity error
      if (error instanceof Error && error.message.includes('capacity')) {
        return NextResponse.json(
          { error: error.message, shouldQueue: true },
          { status: 503 }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error('Error creating worker:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create worker' },
      { status: 500 }
    );
  }
}
