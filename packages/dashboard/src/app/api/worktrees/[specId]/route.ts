/**
 * Worktree Management API (ORC-29)
 *
 * DELETE /api/worktrees/[specId]
 * Removes the worktree for a specific spec
 */

import { NextResponse } from 'next/server';
import { removeWorktreeBySpecId } from '@/lib/worktree-cleanup';

interface RouteContext {
  params: Promise<{ specId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { specId } = await context.params;

  try {
    const result = removeWorktreeBySpecId(specId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to remove worktree' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Worktree Remove] Error:', error);
    return NextResponse.json(
      { error: 'Failed to remove worktree', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
