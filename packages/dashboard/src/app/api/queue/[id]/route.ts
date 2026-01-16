/**
 * Individual Queue Item API
 *
 * GET /api/queue/[id] - Get queue item
 * DELETE /api/queue/[id] - Remove from queue
 */

import { NextResponse } from 'next/server';
import { getQueueItem, removeFromQueue } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/queue/[id]
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  const queueItem = getQueueItem(id);
  if (!queueItem) {
    return NextResponse.json(
      { error: 'Queue item not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(queueItem);
}

// DELETE /api/queue/[id]
export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  const queueItem = getQueueItem(id);
  if (!queueItem) {
    return NextResponse.json(
      { error: 'Queue item not found' },
      { status: 404 }
    );
  }

  const success = removeFromQueue(id);
  if (!success) {
    return NextResponse.json(
      { error: 'Failed to remove from queue' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
