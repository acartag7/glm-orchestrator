import type { Worker, WorkerStatus, WorkerProgress } from '@specwright/shared';
import { getDb, generateId } from './connection';

interface WorkerRow {
  id: string;
  spec_id: string;
  project_id: string;
  status: string;
  current_chunk_id: string | null;
  current_step: string | null;
  progress_current: number;
  progress_total: number;
  progress_passed: number;
  progress_failed: number;
  started_at: number | null;
  completed_at: number | null;
  error: string | null;
  // Joined fields
  project_name?: string;
  spec_title?: string;
  chunk_title?: string;
}

function rowToWorker(row: WorkerRow): Worker {
  return {
    id: row.id,
    specId: row.spec_id,
    projectId: row.project_id,
    status: row.status as WorkerStatus,
    currentChunkId: row.current_chunk_id ?? undefined,
    currentStep: (row.current_step as 'executing' | 'reviewing') ?? undefined,
    progress: {
      current: row.progress_current,
      total: row.progress_total,
      passed: row.progress_passed,
      failed: row.progress_failed,
    },
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    error: row.error ?? undefined,
    projectName: row.project_name,
    specTitle: row.spec_title,
    currentChunkTitle: row.chunk_title,
  };
}

export function getAllWorkers(): Worker[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT w.*,
           p.name as project_name,
           s.title as spec_title,
           c.title as chunk_title
    FROM workers w
    LEFT JOIN projects p ON w.project_id = p.id
    LEFT JOIN specs s ON w.spec_id = s.id
    LEFT JOIN chunks c ON w.current_chunk_id = c.id
    ORDER BY w.started_at DESC
  `);
  return (stmt.all() as WorkerRow[]).map(rowToWorker);
}

export function getActiveWorkers(): Worker[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT w.*,
           p.name as project_name,
           s.title as spec_title,
           c.title as chunk_title
    FROM workers w
    LEFT JOIN projects p ON w.project_id = p.id
    LEFT JOIN specs s ON w.spec_id = s.id
    LEFT JOIN chunks c ON w.current_chunk_id = c.id
    WHERE w.status IN ('idle', 'running', 'paused')
    ORDER BY w.started_at DESC
  `);
  return (stmt.all() as WorkerRow[]).map(rowToWorker);
}

export function getWorker(id: string): Worker | null {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT w.*,
           p.name as project_name,
           s.title as spec_title,
           c.title as chunk_title
    FROM workers w
    LEFT JOIN projects p ON w.project_id = p.id
    LEFT JOIN specs s ON w.spec_id = s.id
    LEFT JOIN chunks c ON w.current_chunk_id = c.id
    WHERE w.id = ?
  `);
  const row = stmt.get(id) as WorkerRow | undefined;
  return row ? rowToWorker(row) : null;
}

export function getWorkerBySpec(specId: string): Worker | null {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT w.*,
           p.name as project_name,
           s.title as spec_title,
           c.title as chunk_title
    FROM workers w
    LEFT JOIN projects p ON w.project_id = p.id
    LEFT JOIN specs s ON w.spec_id = s.id
    LEFT JOIN chunks c ON w.current_chunk_id = c.id
    WHERE w.spec_id = ? AND w.status IN ('idle', 'running', 'paused')
  `);
  const row = stmt.get(specId) as WorkerRow | undefined;
  return row ? rowToWorker(row) : null;
}

export function createWorker(specId: string, projectId: string): Worker {
  const database = getDb();
  const id = generateId();
  const now = Date.now();

  // Get total chunks for progress
  const chunksStmt = database.prepare(`SELECT COUNT(*) as count FROM chunks WHERE spec_id = ?`);
  const chunksResult = chunksStmt.get(specId) as { count: number };
  const totalChunks = chunksResult.count;

  const stmt = database.prepare(`
    INSERT INTO workers (id, spec_id, project_id, status, progress_current, progress_total, progress_passed, progress_failed, started_at)
    VALUES (?, ?, ?, 'idle', 0, ?, 0, 0, ?)
  `);
  stmt.run(id, specId, projectId, totalChunks, now);

  return getWorker(id)!;
}

export function updateWorker(id: string, data: {
  status?: WorkerStatus;
  currentChunkId?: string | null;
  currentStep?: 'executing' | 'reviewing' | null;
  progress?: Partial<WorkerProgress>;
  error?: string | null;
}): Worker | null {
  const database = getDb();
  const existing = getWorker(id);
  if (!existing) return null;

  const now = Date.now();
  const stmt = database.prepare(`
    UPDATE workers
    SET status = ?,
        current_chunk_id = ?,
        current_step = ?,
        progress_current = ?,
        progress_total = ?,
        progress_passed = ?,
        progress_failed = ?,
        completed_at = CASE WHEN ? IN ('completed', 'failed') THEN ? ELSE completed_at END,
        error = ?
    WHERE id = ?
  `);

  const newStatus = data.status ?? existing.status;
  const newProgress = {
    current: data.progress?.current ?? existing.progress.current,
    total: data.progress?.total ?? existing.progress.total,
    passed: data.progress?.passed ?? existing.progress.passed,
    failed: data.progress?.failed ?? existing.progress.failed,
  };

  stmt.run(
    newStatus,
    data.currentChunkId === null ? null : (data.currentChunkId ?? existing.currentChunkId ?? null),
    data.currentStep === null ? null : (data.currentStep ?? existing.currentStep ?? null),
    newProgress.current,
    newProgress.total,
    newProgress.passed,
    newProgress.failed,
    newStatus,
    now,
    data.error === null ? null : (data.error ?? existing.error ?? null),
    id
  );

  return getWorker(id);
}

export function deleteWorker(id: string): boolean {
  const database = getDb();
  const stmt = database.prepare(`DELETE FROM workers WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function cleanupCompletedWorkers(): number {
  const database = getDb();
  // Delete workers that have been completed/failed for more than 1 hour
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  const stmt = database.prepare(`
    DELETE FROM workers
    WHERE status IN ('completed', 'failed')
    AND completed_at < ?
  `);
  const result = stmt.run(oneHourAgo);
  return result.changes;
}
