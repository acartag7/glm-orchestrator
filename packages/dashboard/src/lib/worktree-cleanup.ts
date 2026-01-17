/**
 * Worktree Cleanup Module (ORC-29)
 *
 * Background job to cleanup merged PR worktrees and detect stale/orphaned worktrees.
 */

import { getDb } from './db/connection';
import { getProject } from './db/projects';
import { updateSpec } from './db/specs';
import { checkPRMerged, removeWorktree, listWorktrees } from './git';

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SpecRow {
  id: string;
  project_id: string;
  title: string;
  worktree_path: string | null;
  worktree_created_at: number | null;
  worktree_last_activity: number | null;
  pr_url: string | null;
  pr_merged: number | null;
}

interface ProjectRow {
  id: string;
  directory: string;
}

export interface StaleWorktree {
  specId: string;
  specTitle: string;
  worktreePath: string;
  daysInactive: number;
  prUrl?: string;
}

export interface CleanupResult {
  cleaned: number;
  stale: number;
  errors: string[];
}

/**
 * Background job to cleanup merged PR worktrees
 * Run this periodically (e.g., every 5 minutes)
 */
export async function cleanupMergedWorktrees(): Promise<CleanupResult> {
  const db = getDb();
  const errors: string[] = [];
  let cleaned = 0;
  let stale = 0;

  // Find all specs with worktrees and PRs that aren't marked as merged
  const specs = db.prepare(`
    SELECT * FROM specs
    WHERE worktree_path IS NOT NULL
    AND pr_url IS NOT NULL
    AND pr_merged = 0
  `).all() as SpecRow[];

  for (const specRow of specs) {
    try {
      const project = getProject(specRow.project_id);
      if (!project) continue;

      // Check if PR is merged
      const prCheck = checkPRMerged(project.directory, specRow.pr_url!);

      if (prCheck.merged) {
        // PR is merged, cleanup worktree
        const removeResult = removeWorktree(project.directory, specRow.worktree_path!);

        if (removeResult.success) {
          // Mark as merged and clear worktree path
          updateSpec(specRow.id, {
            prMerged: true,
            worktreePath: null as unknown as string, // Setting to null to clear
          });
          cleaned++;
          console.log(`[Cleanup] Removed merged worktree: ${specRow.worktree_path}`);
        } else {
          errors.push(`Failed to remove ${specRow.worktree_path}: ${removeResult.error}`);
        }
      } else if (prCheck.error) {
        // Error checking PR (might be deleted or network issue)
        const now = Date.now();
        const lastActivity = specRow.worktree_last_activity || specRow.worktree_created_at || now;

        if (now - lastActivity > STALE_THRESHOLD_MS) {
          // Mark as stale (7+ days inactive, PR check failed)
          stale++;
        }
      }
    } catch (error) {
      errors.push(`Error processing spec ${specRow.id}: ${error}`);
    }
  }

  // Also check for orphaned worktrees (in git but not in DB)
  const allProjects = db.prepare(`SELECT id, directory FROM projects`).all() as ProjectRow[];

  for (const projectRow of allProjects) {
    try {
      const gitWorktrees = listWorktrees(projectRow.directory);
      const dbWorktreePaths = new Set(
        (db.prepare(`
          SELECT worktree_path FROM specs
          WHERE project_id = ? AND worktree_path IS NOT NULL
        `).all(projectRow.id) as { worktree_path: string }[])
          .map(row => row.worktree_path)
      );

      for (const worktree of gitWorktrees) {
        // Skip main worktree (the project directory itself)
        if (worktree.path === projectRow.directory) continue;

        // Check if this looks like a spec worktree (matches our naming pattern)
        if (!worktree.path.includes('-spec-')) continue;

        // If worktree exists in git but not in DB, it's orphaned
        if (!dbWorktreePaths.has(worktree.path)) {
          console.log(`[Cleanup] Found orphaned worktree: ${worktree.path}`);
          const removeResult = removeWorktree(projectRow.directory, worktree.path);

          if (removeResult.success) {
            cleaned++;
            console.log(`[Cleanup] Removed orphaned worktree: ${worktree.path}`);
          } else {
            errors.push(`Failed to remove orphaned ${worktree.path}: ${removeResult.error}`);
          }
        }
      }
    } catch (error) {
      errors.push(`Error cleaning project ${projectRow.id}: ${error}`);
    }
  }

  return { cleaned, stale, errors };
}

/**
 * Get stale worktrees (7+ days inactive, PR not merged)
 */
export function getStaleWorktrees(): StaleWorktree[] {
  const db = getDb();
  const now = Date.now();

  const specs = db.prepare(`
    SELECT * FROM specs
    WHERE worktree_path IS NOT NULL
    AND pr_merged = 0
  `).all() as SpecRow[];

  const staleWorktrees: StaleWorktree[] = [];

  for (const spec of specs) {
    const lastActivity = spec.worktree_last_activity || spec.worktree_created_at || now;
    const daysInactive = Math.floor((now - lastActivity) / (24 * 60 * 60 * 1000));

    if (daysInactive >= 7 && spec.worktree_path) {
      staleWorktrees.push({
        specId: spec.id,
        specTitle: spec.title,
        worktreePath: spec.worktree_path,
        daysInactive,
        prUrl: spec.pr_url ?? undefined,
      });
    }
  }

  return staleWorktrees;
}

/**
 * Get orphaned worktrees (in git but not in DB) for a specific project
 */
export function getOrphanedWorktrees(projectId: string): string[] {
  const db = getDb();
  const project = getProject(projectId);
  if (!project) return [];

  const gitWorktrees = listWorktrees(project.directory);
  const dbWorktreePaths = new Set(
    (db.prepare(`
      SELECT worktree_path FROM specs
      WHERE project_id = ? AND worktree_path IS NOT NULL
    `).all(projectId) as { worktree_path: string }[])
      .map(row => row.worktree_path)
  );

  const orphaned: string[] = [];

  for (const worktree of gitWorktrees) {
    // Skip main worktree
    if (worktree.path === project.directory) continue;

    // Check if this looks like a spec worktree
    if (!worktree.path.includes('-spec-')) continue;

    // If worktree exists in git but not in DB, it's orphaned
    if (!dbWorktreePaths.has(worktree.path)) {
      orphaned.push(worktree.path);
    }
  }

  return orphaned;
}

/**
 * Get active worktree count for a project
 */
export function getActiveWorktreeCount(projectId: string): number {
  const db = getDb();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM specs
    WHERE project_id = ? AND worktree_path IS NOT NULL AND pr_merged = 0
  `).get(projectId) as { count: number };

  return result?.count || 0;
}

/**
 * Remove a specific worktree by spec ID
 */
export function removeWorktreeBySpecId(specId: string): { success: boolean; error?: string } {
  const db = getDb();
  const spec = db.prepare(`SELECT * FROM specs WHERE id = ?`).get(specId) as SpecRow | undefined;

  if (!spec || !spec.worktree_path) {
    return { success: false, error: 'Spec not found or has no worktree' };
  }

  const project = getProject(spec.project_id);
  if (!project) {
    return { success: false, error: 'Project not found' };
  }

  const result = removeWorktree(project.directory, spec.worktree_path);

  if (result.success) {
    // Clear worktree path in database
    updateSpec(specId, {
      worktreePath: null as unknown as string,
    });
  }

  return result;
}
