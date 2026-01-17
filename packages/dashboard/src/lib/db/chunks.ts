import type { Chunk, ReviewStatus } from '@specwright/shared';
import { getDb, generateId } from './connection';

interface ChunkRow {
  id: string;
  spec_id: string;
  title: string;
  description: string;
  order: number;
  status: string;
  output: string | null;
  output_summary: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  review_status: string | null;
  review_feedback: string | null;
  dependencies: string | null;
}

function rowToChunk(row: ChunkRow): Chunk {
  let dependencies: string[] = [];
  try {
    dependencies = row.dependencies ? JSON.parse(row.dependencies) : [];
  } catch {
    dependencies = [];
  }

  return {
    id: row.id,
    specId: row.spec_id,
    title: row.title,
    description: row.description,
    order: row.order,
    status: row.status as Chunk['status'],
    output: row.output ?? undefined,
    outputSummary: row.output_summary ?? undefined,
    error: row.error ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    reviewStatus: (row.review_status as ReviewStatus) ?? undefined,
    reviewFeedback: row.review_feedback ?? undefined,
    dependencies,
  };
}

export function getChunksBySpec(specId: string): Chunk[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM chunks WHERE spec_id = ?
    ORDER BY "order" ASC
  `);
  return (stmt.all(specId) as ChunkRow[]).map(rowToChunk);
}

export function getChunk(id: string): Chunk | null {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM chunks WHERE id = ?`);
  const row = stmt.get(id) as ChunkRow | undefined;
  return row ? rowToChunk(row) : null;
}

export function createChunk(specId: string, data: { title: string; description: string; order?: number; dependencies?: string[] }): Chunk {
  const database = getDb();
  const id = generateId();

  // Get next order if not specified
  let order = data.order;
  if (order === undefined) {
    const maxOrderStmt = database.prepare(`SELECT MAX("order") as max_order FROM chunks WHERE spec_id = ?`);
    const result = maxOrderStmt.get(specId) as { max_order: number | null };
    order = (result.max_order ?? -1) + 1;
  }

  const dependencies = data.dependencies ?? [];

  const stmt = database.prepare(`
    INSERT INTO chunks (id, spec_id, title, description, "order", status, dependencies)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `);
  stmt.run(id, specId, data.title, data.description, order, JSON.stringify(dependencies));

  return {
    id,
    specId,
    title: data.title,
    description: data.description,
    order,
    status: 'pending',
    dependencies,
  };
}

export function updateChunk(id: string, data: {
  title?: string;
  description?: string;
  order?: number;
  status?: Chunk['status'];
  output?: string;
  outputSummary?: string;
  error?: string;
  reviewStatus?: ReviewStatus;
  reviewFeedback?: string;
  dependencies?: string[];
}): Chunk | null {
  const database = getDb();
  const existing = getChunk(id);
  if (!existing) return null;

  const stmt = database.prepare(`
    UPDATE chunks
    SET title = ?, description = ?, "order" = ?, status = ?, output = ?, output_summary = ?, error = ?,
        started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
        completed_at = CASE WHEN ? IN ('completed', 'failed') THEN ? ELSE completed_at END,
        review_status = ?, review_feedback = ?, dependencies = ?
    WHERE id = ?
  `);

  const now = Date.now();
  const newStatus = data.status ?? existing.status;
  const newDependencies = data.dependencies ?? existing.dependencies;

  stmt.run(
    data.title ?? existing.title,
    data.description ?? existing.description,
    data.order ?? existing.order,
    newStatus,
    data.output ?? existing.output ?? null,
    data.outputSummary ?? existing.outputSummary ?? null,
    data.error ?? existing.error ?? null,
    newStatus, now,  // For started_at
    newStatus, now,  // For completed_at
    data.reviewStatus ?? existing.reviewStatus ?? null,
    data.reviewFeedback ?? existing.reviewFeedback ?? null,
    JSON.stringify(newDependencies),
    id
  );

  return getChunk(id);
}

export function deleteChunk(id: string): boolean {
  const database = getDb();
  const stmt = database.prepare(`DELETE FROM chunks WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function reorderChunks(specId: string, chunkIds: string[]): void {
  const database = getDb();
  const stmt = database.prepare(`UPDATE chunks SET "order" = ? WHERE id = ? AND spec_id = ?`);

  const transaction = database.transaction(() => {
    chunkIds.forEach((chunkId, index) => {
      stmt.run(index, chunkId, specId);
    });
  });

  transaction();
}

/**
 * Insert a fix chunk after another chunk.
 * Shifts all subsequent chunks down by one position.
 */
export function insertFixChunk(afterChunkId: string, fixData: { title: string; description: string }): Chunk | null {
  const database = getDb();

  // Get the original chunk to know its specId and order
  const originalChunk = getChunk(afterChunkId);
  if (!originalChunk) return null;

  const newOrder = originalChunk.order + 1;

  // Shift all chunks after the original chunk down by one
  const shiftStmt = database.prepare(`
    UPDATE chunks
    SET "order" = "order" + 1
    WHERE spec_id = ? AND "order" >= ?
  `);
  shiftStmt.run(originalChunk.specId, newOrder);

  // Create the fix chunk (depends on the original chunk)
  const id = generateId();
  const dependencies = [afterChunkId];  // Fix chunk depends on the chunk it's fixing
  const stmt = database.prepare(`
    INSERT INTO chunks (id, spec_id, title, description, "order", status, dependencies)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `);
  stmt.run(id, originalChunk.specId, fixData.title, fixData.description, newOrder, JSON.stringify(dependencies));

  return {
    id,
    specId: originalChunk.specId,
    title: fixData.title,
    description: fixData.description,
    order: newOrder,
    status: 'pending',
    dependencies,
  };
}
