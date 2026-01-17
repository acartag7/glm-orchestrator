/**
 * Project Worktrees API (ORC-29)
 *
 * GET /api/projects/[id]/worktrees
 * Returns worktree information for a project including active count and orphaned worktrees
 */

import { NextResponse } from 'next/server';
import { getActiveWorktreeCount, getOrphanedWorktrees } from '@/lib/worktree-cleanup';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id: projectId } = await context.params;

  try {
    const activeCount = getActiveWorktreeCount(projectId);
    const orphaned = getOrphanedWorktrees(projectId);

    return NextResponse.json({
      activeCount,
      orphaned,
      warning: activeCount >= 5 ? `${activeCount} specs running in parallel. Performance may be impacted.` : null,
    });
  } catch (error) {
    console.error('[Project Worktrees] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get worktree info', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
