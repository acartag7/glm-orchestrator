/**
 * Stale Worktrees API (ORC-29)
 *
 * GET /api/worktrees/stale
 * Returns list of stale worktrees (7+ days inactive, PR not merged)
 */

import { NextResponse } from 'next/server';
import { getStaleWorktrees } from '@/lib/worktree-cleanup';

export async function GET() {
  try {
    const staleWorktrees = getStaleWorktrees();
    return NextResponse.json({ staleWorktrees });
  } catch (error) {
    console.error('[Stale Worktrees] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get stale worktrees', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
