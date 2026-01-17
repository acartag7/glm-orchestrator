/**
 * Worker Queue API
 *
 * GET /api/queue - List queued specs
 * POST /api/queue - Add spec to queue
 */

import { NextResponse } from 'next/server';
import { getOrchestrator } from '@/lib/worker-orchestrator';
import { getSpec, addToQueue, getQueueItemBySpec, getWorkerBySpec } from '@/lib/db';
import type { AddToQueueRequest } from '@specwright/shared';

// GET /api/queue
export async function GET() {
  const orchestrator = getOrchestrator();
  const queue = orchestrator.getQueue();

  return NextResponse.json(queue);
}

// POST /api/queue
export async function POST(request: Request) {
  try {
    const body = await request.json() as AddToQueueRequest;

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

    // Check if already queued
    const existingQueueItem = getQueueItemBySpec(body.specId);
    if (existingQueueItem) {
      return NextResponse.json(
        { error: 'Spec is already in queue' },
        { status: 409 }
      );
    }

    // Check if already has active worker
    const existingWorker = getWorkerBySpec(body.specId);
    if (existingWorker && ['idle', 'running', 'paused'].includes(existingWorker.status)) {
      return NextResponse.json(
        { error: 'Spec already has an active worker' },
        { status: 409 }
      );
    }

    // Add to queue
    const queueItem = addToQueue(body.specId, spec.projectId, body.priority ?? 0);

    // Try to process queue (in case there's capacity)
    const orchestrator = getOrchestrator();
    orchestrator.processQueue();

    return NextResponse.json(queueItem, { status: 201 });
  } catch (error) {
    console.error('Error adding to queue:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add to queue' },
      { status: 500 }
    );
  }
}
