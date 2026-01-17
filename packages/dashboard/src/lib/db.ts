import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { MVP_SCHEMA, MIGRATIONS_PHASE2, MIGRATIONS_REVIEW_LOOP, MIGRATIONS_PHASE3_DEPS, MIGRATIONS_OUTPUT_SUMMARY, MIGRATIONS_PHASE4_WORKERS, MIGRATIONS_CONFIG_SYSTEM } from '@specwright/shared';
import type { Project, Spec, Chunk, ChunkToolCall, SpecStudioState, SpecStudioStep, Question, ChunkSuggestion, SpecStatus, ReviewStatus, Worker, WorkerStatus, WorkerQueueItem, WorkerProgress, ProjectConfig } from '@specwright/shared';

const DB_DIR = path.join(os.homedir(), '.specwright');
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, 'orchestrator.db');

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

  // Run Phase 2 migrations (add columns to specs table)
  runPhase2Migrations(db);

  // Run Review Loop migrations (add review columns to chunks table)
  runReviewLoopMigrations(db);

  // Run Phase 3 migrations (add dependencies column to chunks table)
  runPhase3DepsMigrations(db);

  // Run Output Summary migrations (add output_summary column to chunks table)
  runOutputSummaryMigrations(db);

  // Run Phase 4 migrations (workers and queue tables)
  runPhase4WorkersMigrations(db);

  // Run Configuration System migrations (add config_json column to projects table)
  runConfigSystemMigrations(db);

  return db;
}

function runPhase2Migrations(database: DatabaseType): void {
  // Check if migration is needed by checking if 'status' column exists
  const tableInfo = database.prepare(`PRAGMA table_info(specs)`).all() as { name: string }[];
  const hasStatusColumn = tableInfo.some(col => col.name === 'status');

  if (!hasStatusColumn) {
    for (const migration of MIGRATIONS_PHASE2) {
      try {
        database.exec(migration);
      } catch (err) {
        // Column might already exist, ignore
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('duplicate column')) {
          console.warn(`Migration warning: ${message}`);
        }
      }
    }
  }
}

function runReviewLoopMigrations(database: DatabaseType): void {
  // Check if migration is needed by checking if 'review_status' column exists
  const tableInfo = database.prepare(`PRAGMA table_info(chunks)`).all() as { name: string }[];
  const hasReviewStatusColumn = tableInfo.some(col => col.name === 'review_status');

  if (!hasReviewStatusColumn) {
    for (const migration of MIGRATIONS_REVIEW_LOOP) {
      try {
        database.exec(migration);
      } catch (err) {
        // Column might already exist, ignore
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('duplicate column')) {
          console.warn(`Migration warning: ${message}`);
        }
      }
    }
  }
}

function runPhase3DepsMigrations(database: DatabaseType): void {
  // Check if migration is needed by checking if 'dependencies' column exists
  const tableInfo = database.prepare(`PRAGMA table_info(chunks)`).all() as { name: string }[];
  const hasDependenciesColumn = tableInfo.some(col => col.name === 'dependencies');

  if (!hasDependenciesColumn) {
    for (const migration of MIGRATIONS_PHASE3_DEPS) {
      try {
        database.exec(migration);
      } catch (err) {
        // Column might already exist, ignore
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('duplicate column')) {
          console.warn(`Migration warning: ${message}`);
        }
      }
    }
  }
}

function runOutputSummaryMigrations(database: DatabaseType): void {
  // Check if migration is needed by checking if 'output_summary' column exists
  const tableInfo = database.prepare(`PRAGMA table_info(chunks)`).all() as { name: string }[];
  const hasOutputSummaryColumn = tableInfo.some(col => col.name === 'output_summary');

  if (!hasOutputSummaryColumn) {
    for (const migration of MIGRATIONS_OUTPUT_SUMMARY) {
      try {
        database.exec(migration);
      } catch (err) {
        // Column might already exist, ignore
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('duplicate column')) {
          console.warn(`Migration warning: ${message}`);
        }
      }
    }
  }
}

function runPhase4WorkersMigrations(database: DatabaseType): void {
  // Check if workers table exists
  const tables = database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='workers'`).all();

  if (tables.length === 0) {
    for (const migration of MIGRATIONS_PHASE4_WORKERS) {
      try {
        database.exec(migration);
      } catch (err) {
        // Table/index might already exist, ignore
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('already exists')) {
          console.warn(`Migration warning: ${message}`);
        }
      }
    }
  }
}

function runConfigSystemMigrations(database: DatabaseType): void {
  const tableInfo = database.prepare(`PRAGMA table_info(projects)`).all() as { name: string }[];
  const hasConfigJsonColumn = tableInfo.some(col => col.name === 'config_json');

  if (!hasConfigJsonColumn) {
    for (const migration of MIGRATIONS_CONFIG_SYSTEM) {
      try {
        database.exec(migration);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('duplicate column')) {
          console.warn(`Migration warning: ${message}`);
        }
      }
    }
  }
}

// ============================================================================
// ID Generation
// ============================================================================

function generateId(): string {
  return randomUUID();
}

// ============================================================================
// Project Operations
// ============================================================================

interface ProjectRow {
  id: string;
  name: string;
  directory: string;
  description: string | null;
  config_json: string | null;
  created_at: number;
  updated_at: number;
}

function rowToProject(row: ProjectRow): Project {
  let config = undefined;
  if (row.config_json) {
    try {
      config = JSON.parse(row.config_json);
    } catch {
      config = undefined;
    }
  }
  return {
    id: row.id,
    name: row.name,
    directory: row.directory,
    description: row.description ?? undefined,
    config,
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

  // Note: No longer auto-creating a spec. Multi-spec support means specs are created explicitly.

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
  status: string | null;
  branch_name: string | null;
  pr_number: number | null;
  pr_url: string | null;
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
    prNumber: row.pr_number ?? undefined,
    prUrl: row.pr_url ?? undefined,
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
    prNumber?: number;
    prUrl?: string;
  }
): Spec | null {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM specs WHERE id = ?`);
  const existing = stmt.get(id) as SpecRow | undefined;
  if (!existing) return null;

  const now = Date.now();
  const updateStmt = database.prepare(`
    UPDATE specs
    SET title = ?, content = ?, status = ?, branch_name = ?, pr_number = ?, pr_url = ?, version = version + 1, updated_at = ?
    WHERE id = ?
  `);
  updateStmt.run(
    data.title ?? existing.title,
    data.content ?? existing.content,
    data.status ?? existing.status ?? 'draft',
    data.branchName ?? existing.branch_name,
    data.prNumber ?? existing.pr_number,
    data.prUrl ?? existing.pr_url,
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

// ============================================================================
// Spec Studio State Operations
// ============================================================================

interface StudioStateRow {
  id: string;
  project_id: string;
  step: string;
  intent: string;
  questions: string;
  answers: string;
  generated_spec: string;
  suggested_chunks: string;
  created_at: number;
  updated_at: number;
}

function rowToStudioState(row: StudioStateRow): SpecStudioState {
  return {
    id: row.id,
    projectId: row.project_id,
    step: row.step as SpecStudioStep,
    intent: row.intent,
    questions: JSON.parse(row.questions) as Question[],
    answers: JSON.parse(row.answers) as Record<string, string | string[]>,
    generatedSpec: row.generated_spec,
    suggestedChunks: JSON.parse(row.suggested_chunks) as ChunkSuggestion[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getStudioState(projectId: string): SpecStudioState | null {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM spec_studio_state WHERE project_id = ?`);
  const row = stmt.get(projectId) as StudioStateRow | undefined;
  return row ? rowToStudioState(row) : null;
}

export function createStudioState(projectId: string): SpecStudioState {
  const database = getDb();
  const id = generateId();
  const now = Date.now();

  const stmt = database.prepare(`
    INSERT INTO spec_studio_state (id, project_id, step, intent, questions, answers, generated_spec, suggested_chunks, created_at, updated_at)
    VALUES (?, ?, 'intent', '', '[]', '{}', '', '[]', ?, ?)
  `);
  stmt.run(id, projectId, now, now);

  return {
    id,
    projectId,
    step: 'intent',
    intent: '',
    questions: [],
    answers: {},
    generatedSpec: '',
    suggestedChunks: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function updateStudioState(
  projectId: string,
  data: {
    step?: SpecStudioStep;
    intent?: string;
    questions?: Question[];
    answers?: Record<string, string | string[]>;
    generatedSpec?: string;
    suggestedChunks?: ChunkSuggestion[];
  }
): SpecStudioState | null {
  const database = getDb();
  const existing = getStudioState(projectId);
  if (!existing) return null;

  const now = Date.now();
  const stmt = database.prepare(`
    UPDATE spec_studio_state
    SET step = ?, intent = ?, questions = ?, answers = ?, generated_spec = ?, suggested_chunks = ?, updated_at = ?
    WHERE project_id = ?
  `);
  stmt.run(
    data.step ?? existing.step,
    data.intent ?? existing.intent,
    JSON.stringify(data.questions ?? existing.questions),
    JSON.stringify(data.answers ?? existing.answers),
    data.generatedSpec ?? existing.generatedSpec,
    JSON.stringify(data.suggestedChunks ?? existing.suggestedChunks),
    now,
    projectId
  );

  return getStudioState(projectId);
}

export function deleteStudioState(projectId: string): boolean {
  const database = getDb();
  const stmt = database.prepare(`DELETE FROM spec_studio_state WHERE project_id = ?`);
  const result = stmt.run(projectId);
  return result.changes > 0;
}

// ============================================================================
// Worker Operations (Phase 4)
// ============================================================================

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

// ============================================================================
// Worker Queue Operations (Phase 4)
// ============================================================================

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

export { getDb };
