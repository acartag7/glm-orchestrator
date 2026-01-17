import type { WorkerQueueItem } from '@specwright/shared';
import { getDb, generateId } from './connection';

interface QueueRow {
  id: string;
  spec_id: string;
  project_id: string;
  priority: number;
  added_at: number;
  // Joined fields
  project_name?: string;
  spec_title?: string;
}

function rowToQueueItem(row: QueueRow): WorkerQueueItem {
  return {
    id: row.id,
    specId: row.spec_id,
    projectId: row.project_id,
    priority: row.priority,
    addedAt: row.added_at,
    projectName: row.project_name,
    specTitle: row.spec_title,
  };
}

export function getWorkerQueue(): WorkerQueueItem[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT q.*,
           p.name as project_name,
           s.title as spec_title
    FROM worker_queue q
    LEFT JOIN projects p ON q.project_id = p.id
    LEFT JOIN specs s ON q.spec_id = s.id
    ORDER BY q.priority DESC, q.added_at ASC
  `);
  return (stmt.all() as QueueRow[]).map(rowToQueueItem);
}

export function getQueueItem(id: string): WorkerQueueItem | null {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT q.*,
           p.name as project_name,
           s.title as spec_title
    FROM worker_queue q
    LEFT JOIN projects p ON q.project_id = p.id
    LEFT JOIN specs s ON q.spec_id = s.id
    WHERE q.id = ?
  `);
  const row = stmt.get(id) as QueueRow | undefined;
  return row ? rowToQueueItem(row) : null;
}

export function getQueueItemBySpec(specId: string): WorkerQueueItem | null {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT q.*,
           p.name as project_name,
           s.title as spec_title
    FROM worker_queue q
    LEFT JOIN projects p ON q.project_id = p.id
    LEFT JOIN specs s ON q.spec_id = s.id
    WHERE q.spec_id = ?
  `);
  const row = stmt.get(specId) as QueueRow | undefined;
  return row ? rowToQueueItem(row) : null;
}

export function addToQueue(specId: string, projectId: string, priority: number = 0): WorkerQueueItem {
  const database = getDb();
  const id = generateId();
  const now = Date.now();

  const stmt = database.prepare(`
    INSERT INTO worker_queue (id, spec_id, project_id, priority, added_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, specId, projectId, priority, now);

  return getQueueItem(id)!;
}

export function removeFromQueue(id: string): boolean {
  const database = getDb();
  const stmt = database.prepare(`DELETE FROM worker_queue WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function removeFromQueueBySpec(specId: string): boolean {
  const database = getDb();
  const stmt = database.prepare(`DELETE FROM worker_queue WHERE spec_id = ?`);
  const result = stmt.run(specId);
  return result.changes > 0;
}

export function getNextQueueItem(): WorkerQueueItem | null {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT q.*,
           p.name as project_name,
           s.title as spec_title
    FROM worker_queue q
    LEFT JOIN projects p ON q.project_id = p.id
    LEFT JOIN specs s ON q.spec_id = s.id
    ORDER BY q.priority DESC, q.added_at ASC
    LIMIT 1
  `);
  const row = stmt.get() as QueueRow | undefined;
  return row ? rowToQueueItem(row) : null;
}

export function reorderQueue(queueIds: string[]): void {
  const database = getDb();
  const stmt = database.prepare(`UPDATE worker_queue SET priority = ? WHERE id = ?`);

  const transaction = database.transaction(() => {
    // Higher priority = earlier in queue, so reverse the index
    queueIds.forEach((queueId, index) => {
      const priority = queueIds.length - index;
      stmt.run(priority, queueId);
    });
  });

  transaction();
}
