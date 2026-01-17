import type { Spec, SpecStatus } from '@specwright/shared';
import { getDb, generateId } from './connection';

interface SpecRow {
  id: string;
  project_id: string;
  title: string;
  content: string;
  version: number;
  status: string | null;
  branch_name: string | null;
  original_branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  // Worktree fields (ORC-29)
  worktree_path: string | null;
  worktree_created_at: number | null;
  worktree_last_activity: number | null;
  pr_merged: number | null;
  created_at: number;
  updated_at: number;
}

function rowToSpec(row: SpecRow): Spec {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    version: row.version,
    status: (row.status as SpecStatus) || 'draft',
    branchName: row.branch_name ?? undefined,
    originalBranch: row.original_branch ?? undefined,
    prNumber: row.pr_number ?? undefined,
    prUrl: row.pr_url ?? undefined,
    // Worktree fields (ORC-29)
    worktreePath: row.worktree_path ?? undefined,
    worktreeCreatedAt: row.worktree_created_at ?? undefined,
    worktreeLastActivity: row.worktree_last_activity ?? undefined,
    prMerged: row.pr_merged === 1 ? true : row.pr_merged === 0 ? false : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSpec(id: string): Spec | null {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM specs WHERE id = ?`);
  const row = stmt.get(id) as SpecRow | undefined;
  return row ? rowToSpec(row) : null;
}

export function getSpecsByProject(projectId: string): Spec[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM specs WHERE project_id = ?
    ORDER BY created_at ASC
  `);
  return (stmt.all(projectId) as SpecRow[]).map(rowToSpec);
}

export function getSpecByProject(projectId: string): Spec | null {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM specs WHERE project_id = ?
    ORDER BY created_at DESC LIMIT 1
  `);
  const row = stmt.get(projectId) as SpecRow | undefined;
  return row ? rowToSpec(row) : null;
}

export function createSpec(projectId: string, title: string, content?: string): Spec {
  const database = getDb();
  const id = generateId();
  const now = Date.now();

  const stmt = database.prepare(`
    INSERT INTO specs (id, project_id, title, content, version, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 'draft', ?, ?)
  `);
  stmt.run(id, projectId, title, content ?? '', now, now);

  // Update parent project's updated_at
  const projectStmt = database.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`);
  projectStmt.run(now, projectId);

  return {
    id,
    projectId,
    title,
    content: content ?? '',
    version: 1,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}

export function updateSpec(
  id: string,
  data: {
    title?: string;
    content?: string;
    status?: SpecStatus;
    branchName?: string;
    originalBranch?: string;
    prNumber?: number;
    prUrl?: string;
    // Worktree fields (ORC-29)
    worktreePath?: string;
    worktreeCreatedAt?: number;
    worktreeLastActivity?: number;
    prMerged?: boolean;
  }
): Spec | null {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM specs WHERE id = ?`);
  const existing = stmt.get(id) as SpecRow | undefined;
  if (!existing) return null;

  const now = Date.now();
  const updateStmt = database.prepare(`
    UPDATE specs
    SET title = ?, content = ?, status = ?, branch_name = ?, original_branch = ?, pr_number = ?, pr_url = ?,
        worktree_path = ?, worktree_created_at = ?, worktree_last_activity = ?, pr_merged = ?,
        version = version + 1, updated_at = ?
    WHERE id = ?
  `);

  // Handle worktreePath: undefined = keep existing, null = clear it
  const worktreePath = data.worktreePath === undefined
    ? existing.worktree_path
    : data.worktreePath === null ? null : data.worktreePath;

  updateStmt.run(
    data.title ?? existing.title,
    data.content ?? existing.content,
    data.status ?? existing.status ?? 'draft',
    data.branchName ?? existing.branch_name,
    data.originalBranch ?? existing.original_branch,
    data.prNumber ?? existing.pr_number,
    data.prUrl ?? existing.pr_url,
    worktreePath,
    data.worktreeCreatedAt ?? existing.worktree_created_at,
    data.worktreeLastActivity ?? existing.worktree_last_activity,
    data.prMerged !== undefined ? (data.prMerged ? 1 : 0) : existing.pr_merged,
    now,
    id
  );

  // Also update parent project's updated_at
  const projectStmt = database.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`);
  projectStmt.run(now, existing.project_id);

  const result = database.prepare(`SELECT * FROM specs WHERE id = ?`).get(id) as SpecRow;
  return rowToSpec(result);
}

export function deleteSpec(id: string): boolean {
  const database = getDb();

  // Get spec to update project's updated_at
  const spec = getSpec(id);
  if (!spec) return false;

  const stmt = database.prepare(`DELETE FROM specs WHERE id = ?`);
  const result = stmt.run(id);

  if (result.changes > 0) {
    // Update parent project's updated_at
    const projectStmt = database.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`);
    projectStmt.run(Date.now(), spec.projectId);
  }

  return result.changes > 0;
}
