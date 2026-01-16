/**
 * Queue Reorder API
 *
 * POST /api/queue/reorder - Change queue priority
 */

import { NextResponse } from 'next/server';
import { reorderQueue, getWorkerQueue } from '@/lib/db';
import type { ReorderQueueRequest } from '@glm/shared';

// POST /api/queue/reorder
export async function POST(request: Request) {
  try {
    const body = await request.json() as ReorderQueueRequest;

    if (!body.queueIds || !Array.isArray(body.queueIds)) {
      return NextResponse.json(
        { error: 'queueIds array is required' },
        { status: 400 }
      );
    }

    // Reorder the queue
    reorderQueue(body.queueIds);

    // Return updated queue
    const queue = getWorkerQueue();

    return NextResponse.json({ success: true, queue });
  } catch (error) {
    console.error('Error reordering queue:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reorder queue' },
      { status: 500 }
    );
  }
}
