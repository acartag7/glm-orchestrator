import type { ChunkToolCall } from '@specwright/shared';
import { getDb, generateId } from './connection';

interface ToolCallRow {
  id: string;
  chunk_id: string;
  tool: string;
  input: string;
  output: string | null;
  status: string;
  started_at: number;
  completed_at: number | null;
}

function rowToToolCall(row: ToolCallRow): ChunkToolCall {
  return {
    id: row.id,
    chunkId: row.chunk_id,
    tool: row.tool,
    input: JSON.parse(row.input),
    output: row.output ?? undefined,
    status: row.status as ChunkToolCall['status'],
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  };
}

export function getToolCallsByChunk(chunkId: string): ChunkToolCall[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM chunk_tool_calls WHERE chunk_id = ?
    ORDER BY started_at ASC
  `);
  return (stmt.all(chunkId) as ToolCallRow[]).map(rowToToolCall);
}

export function createToolCall(chunkId: string, data: { tool: string; input: Record<string, unknown> }): ChunkToolCall {
  const database = getDb();
  const id = generateId();
  const now = Date.now();

  const stmt = database.prepare(`
    INSERT INTO chunk_tool_calls (id, chunk_id, tool, input, status, started_at)
    VALUES (?, ?, ?, ?, 'running', ?)
  `);
  stmt.run(id, chunkId, data.tool, JSON.stringify(data.input), now);

  return {
    id,
    chunkId,
    tool: data.tool,
    input: data.input,
    status: 'running',
    startedAt: now,
  };
}

export function updateToolCall(id: string, data: { status?: ChunkToolCall['status']; output?: string }): ChunkToolCall | null {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM chunk_tool_calls WHERE id = ?`);
  const existing = stmt.get(id) as ToolCallRow | undefined;
  if (!existing) return null;

  const now = Date.now();
  const updateStmt = database.prepare(`
    UPDATE chunk_tool_calls
    SET status = ?, output = ?, completed_at = CASE WHEN ? IN ('completed', 'error') THEN ? ELSE completed_at END
    WHERE id = ?
  `);

  const newStatus = data.status ?? existing.status;
  updateStmt.run(newStatus, data.output ?? existing.output, newStatus, now, id);

  const result = database.prepare(`SELECT * FROM chunk_tool_calls WHERE id = ?`).get(id) as ToolCallRow;
  return rowToToolCall(result);
}
