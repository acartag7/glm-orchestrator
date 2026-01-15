/**
 * Abort Run All API
 *
 * POST /api/specs/[id]/run-all/abort
 * Aborts the current run-all session for a spec
 */

import { NextResponse } from 'next/server';
import { getSpec } from '@/lib/db';
import {
  abortRunAllSession,
  hasActiveRunAllSession,
  abortChunkExecution,
  getRunningChunkId,
} from '@/lib/execution';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/specs/[id]/run-all/abort
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id: specId } = await context.params;

    // Check if spec exists
    const spec = getSpec(specId);
    if (!spec) {
      return NextResponse.json(
        { error: 'Spec not found' },
        { status: 404 }
      );
    }

    // Check if run-all is in progress
    if (!hasActiveRunAllSession(specId)) {
      return NextResponse.json(
        { error: 'No Run All session in progress for this spec' },
        { status: 400 }
      );
    }

    // Abort the run-all session
    abortRunAllSession(specId);

    // Also abort any currently running chunk
    const runningChunkId = getRunningChunkId();
    if (runningChunkId) {
      await abortChunkExecution(runningChunkId);
    }

    return NextResponse.json({
      success: true,
      message: 'Run All aborted',
    });
  } catch (error) {
    console.error('Error aborting Run All:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to abort Run All' },
      { status: 500 }
    );
  }
}
