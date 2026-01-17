/**
 * Worktree Cleanup API (ORC-29)
 *
 * POST /api/worktrees/cleanup
 * Triggers background cleanup of merged PR worktrees
 */

import { NextResponse } from 'next/server';
import { cleanupMergedWorktrees } from '@/lib/worktree-cleanup';

export async function POST() {
  try {
    const result = await cleanupMergedWorktrees();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Worktree Cleanup] Error:', error);
    return NextResponse.json(
      { error: 'Cleanup failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
