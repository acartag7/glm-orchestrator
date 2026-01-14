import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';
import { MVP_SCHEMA } from '@glm/shared';
import type { Project, Spec, Chunk, ChunkToolCall } from '@glm/shared';

const DB_DIR = path.join(os.homedir(), '.glm-orchestrator');
const DB_PATH = path.join(DB_DIR, 'orchestrator.db');

let db: DatabaseType | null = null;

function getDb(): DatabaseType {
  if (db) return db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  // Initialize MVP schema
  db.exec(MVP_SCHEMA);

  return db;
}

// ============================================================================
// ID Generation
// ============================================================================

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================================================
// Project Operations
// ============================================================================

interface ProjectRow {
  id: string;
  name: string;
  directory: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    directory: row.directory,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAllProjects(): Project[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM projects
    ORDER BY updated_at DESC
  `);
  return (stmt.all() as ProjectRow[]).map(rowToProject);
}

export function getProject(id: string): Project | null {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM projects WHERE id = ?`);
  const row = stmt.get(id) as ProjectRow | undefined;
  return row ? rowToProject(row) : null;
}

export function createProject(data: { name: string; directory: string; description?: string }): Project {
  const database = getDb();
  const now = Date.now();
  const id = generateId();

  const stmt = database.prepare(`
    INSERT INTO projects (id, name, directory, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, data.name, data.directory, data.description ?? null, now, now);

  // Create initial empty spec for the project
  const specId = generateId();
  const specStmt = database.prepare(`
    INSERT INTO specs (id, project_id, title, content, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  specStmt.run(specId, id, 'Untitled Spec', '', 1, now, now);

  return {
    id,
    name: data.name,
    directory: data.directory,
    description: data.description,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateProject(id: string, data: { name?: string; directory?: string; description?: string }): Project | null {
  const database = getDb();
  const existing = getProject(id);
  if (!existing) return null;

  const now = Date.now();
  const stmt = database.prepare(`
    UPDATE projects
    SET name = ?, directory = ?, description = ?, updated_at = ?
    WHERE id = ?
  `);
  stmt.run(
    data.name ?? existing.name,
    data.directory ?? existing.directory,
    data.description ?? existing.description ?? null,
    now,
    id
  );

  return getProject(id);
}

export function deleteProject(id: string): boolean {
  const database = getDb();
  const stmt = database.prepare(`DELETE FROM projects WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============================================================================
// Spec Operations
// ============================================================================

interface SpecRow {
  id: string;
  project_id: string;
  title: string;
  content: string;
  version: number;
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

export function getSpecByProject(projectId: string): Spec | null {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM specs WHERE project_id = ?
    ORDER BY created_at DESC LIMIT 1
  `);
  const row = stmt.get(projectId) as SpecRow | undefined;
  return row ? rowToSpec(row) : null;
}

export function updateSpec(id: string, data: { title?: string; content?: string }): Spec | null {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM specs WHERE id = ?`);
  const existing = stmt.get(id) as SpecRow | undefined;
  if (!existing) return null;

  const now = Date.now();
  const updateStmt = database.prepare(`
    UPDATE specs
    SET title = ?, content = ?, version = version + 1, updated_at = ?
    WHERE id = ?
  `);
  updateStmt.run(
    data.title ?? existing.title,
    data.content ?? existing.content,
    now,
    id
  );

  // Also update parent project's updated_at
  const projectStmt = database.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`);
  projectStmt.run(now, existing.project_id);

  const result = database.prepare(`SELECT * FROM specs WHERE id = ?`).get(id) as SpecRow;
  return rowToSpec(result);
}

// ============================================================================
// Chunk Operations
// ============================================================================

interface ChunkRow {
  id: string;
  spec_id: string;
  title: string;
  description: string;
  order: number;
  status: string;
  output: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
}

function rowToChunk(row: ChunkRow): Chunk {
  return {
    id: row.id,
    specId: row.spec_id,
    title: row.title,
    description: row.description,
    order: row.order,
    status: row.status as Chunk['status'],
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
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

export function createChunk(specId: string, data: { title: string; description: string; order?: number }): Chunk {
  const database = getDb();
  const id = generateId();

  // Get next order if not specified
  let order = data.order;
  if (order === undefined) {
    const maxOrderStmt = database.prepare(`SELECT MAX("order") as max_order FROM chunks WHERE spec_id = ?`);
    const result = maxOrderStmt.get(specId) as { max_order: number | null };
    order = (result.max_order ?? -1) + 1;
  }

  const stmt = database.prepare(`
    INSERT INTO chunks (id, spec_id, title, description, "order", status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `);
  stmt.run(id, specId, data.title, data.description, order);

  return {
    id,
    specId,
    title: data.title,
    description: data.description,
    order,
    status: 'pending',
  };
}

export function updateChunk(id: string, data: { title?: string; description?: string; order?: number; status?: Chunk['status']; output?: string; error?: string }): Chunk | null {
  const database = getDb();
  const existing = getChunk(id);
  if (!existing) return null;

  const stmt = database.prepare(`
    UPDATE chunks
    SET title = ?, description = ?, "order" = ?, status = ?, output = ?, error = ?,
        started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
        completed_at = CASE WHEN ? IN ('completed', 'failed') THEN ? ELSE completed_at END
    WHERE id = ?
  `);

  const now = Date.now();
  const newStatus = data.status ?? existing.status;

  stmt.run(
    data.title ?? existing.title,
    data.description ?? existing.description,
    data.order ?? existing.order,
    newStatus,
    data.output ?? existing.output ?? null,
    data.error ?? existing.error ?? null,
    newStatus, now,  // For started_at
    newStatus, now,  // For completed_at
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

// ============================================================================
// Tool Call Operations
// ============================================================================

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

export { getDb };
