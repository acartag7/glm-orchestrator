/**
 * Database module for Specwright
 *
 * Extended schema with:
 * - session_id, model_id, provider_id on tasks
 * - call_id, state on tool_calls
 * - task_output_chunks for streaming text
 * - file_operations tracking
 */

import Database from "better-sqlite3";
import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";
import { basename } from "path";

const DB_DIR = join(homedir(), ".specwright");
const DB_PATH = join(DB_DIR, "orchestrator.db");

// Ensure directory exists
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// v2 Schema with extended fields
db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    folder_name TEXT NOT NULL,
    pid INTEGER NOT NULL,
    connected_at INTEGER NOT NULL,
    last_heartbeat INTEGER NOT NULL,
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    workflow_id TEXT,
    session_id TEXT,
    model_id TEXT,
    provider_id TEXT,
    status TEXT NOT NULL,
    description TEXT,
    prompt TEXT,
    output TEXT,
    error TEXT,
    tokens_input INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    started_at INTEGER,
    completed_at INTEGER,
    FOREIGN KEY (server_id) REFERENCES servers(id)
  );

  CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    call_id TEXT,
    tool_name TEXT NOT NULL,
    state TEXT DEFAULT 'completed',
    input TEXT,
    output TEXT,
    duration_ms INTEGER,
    called_at INTEGER NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    current_stage TEXT,
    stages TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (server_id) REFERENCES servers(id)
  );

  CREATE TABLE IF NOT EXISTS task_output_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    chunk TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS file_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_server ON tasks(server_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
  CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_id);
  CREATE INDEX IF NOT EXISTS idx_tool_calls_state ON tool_calls(state);
  CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
  CREATE INDEX IF NOT EXISTS idx_output_chunks_task ON task_output_chunks(task_id);
  CREATE INDEX IF NOT EXISTS idx_file_ops_task ON file_operations(task_id);
`);

// Run migrations for existing databases
try {
  // Add new columns if they don't exist
  db.exec(`ALTER TABLE tasks ADD COLUMN session_id TEXT`);
} catch { /* Column already exists */ }

try {
  db.exec(`ALTER TABLE tasks ADD COLUMN model_id TEXT`);
} catch { /* Column already exists */ }

try {
  db.exec(`ALTER TABLE tasks ADD COLUMN provider_id TEXT`);
} catch { /* Column already exists */ }

try {
  db.exec(`ALTER TABLE tasks ADD COLUMN tokens_input INTEGER DEFAULT 0`);
} catch { /* Column already exists */ }

try {
  db.exec(`ALTER TABLE tasks ADD COLUMN tokens_output INTEGER DEFAULT 0`);
} catch { /* Column already exists */ }

try {
  db.exec(`ALTER TABLE tasks ADD COLUMN cost REAL DEFAULT 0`);
} catch { /* Column already exists */ }

try {
  db.exec(`ALTER TABLE tool_calls ADD COLUMN call_id TEXT`);
} catch { /* Column already exists */ }

try {
  db.exec(`ALTER TABLE tool_calls ADD COLUMN state TEXT DEFAULT 'completed'`);
} catch { /* Column already exists */ }

// Server ID for this instance
let serverId: string | null = null;

/**
 * Register this MCP server instance
 */
export function registerServer(workingDirectory: string): string {
  const folderName = basename(workingDirectory);
  const pid = process.pid;
  const now = Date.now();

  serverId = `${folderName}:${pid}`;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO servers (id, folder_name, pid, connected_at, last_heartbeat, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(serverId, folderName, pid, now, now, "connected");

  console.error(`[DB] Server registered: ${serverId}`);
  return serverId;
}

/**
 * Update server heartbeat
 */
export function heartbeat(): void {
  if (!serverId) return;

  const stmt = db.prepare(`
    UPDATE servers SET last_heartbeat = ? WHERE id = ?
  `);
  stmt.run(Date.now(), serverId);
}

/**
 * Mark server as disconnected
 */
export function disconnectServer(): void {
  if (!serverId) return;

  const stmt = db.prepare(`
    UPDATE servers SET status = 'disconnected' WHERE id = ?
  `);
  stmt.run(serverId);
  console.error(`[DB] Server disconnected: ${serverId}`);
}

/**
 * Create a new task record
 */
export function createTask(
  taskId: string,
  description: string,
  prompt: string,
  workflowId?: string
): void {
  if (!serverId) {
    console.error("[DB] Warning: No server registered, skipping task creation");
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO tasks (id, server_id, workflow_id, status, description, prompt, started_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `);
  stmt.run(taskId, serverId, workflowId || null, description, prompt, Date.now());
}

/**
 * Update task with session info (v2)
 */
export function updateTaskSession(
  taskId: string,
  sessionId: string | null,
  providerId: string,
  modelId: string
): void {
  const stmt = db.prepare(`
    UPDATE tasks SET session_id = ?, provider_id = ?, model_id = ? WHERE id = ?
  `);
  stmt.run(sessionId, providerId, modelId, taskId);
}

/**
 * Update task status to completed
 */
export function completeTask(taskId: string, output: string): void {
  const stmt = db.prepare(`
    UPDATE tasks SET status = 'completed', output = ?, completed_at = ? WHERE id = ?
  `);
  stmt.run(output, Date.now(), taskId);
}

/**
 * Update task status to failed
 */
export function failTask(taskId: string, error: string): void {
  const stmt = db.prepare(`
    UPDATE tasks SET status = 'failed', error = ?, completed_at = ? WHERE id = ?
  `);
  stmt.run(error, Date.now(), taskId);
}

/**
 * Update task tokens and cost (v2)
 */
export function updateTaskTokens(
  taskId: string,
  tokensInput: number,
  tokensOutput: number,
  cost: number
): void {
  const stmt = db.prepare(`
    UPDATE tasks SET tokens_input = ?, tokens_output = ?, cost = ? WHERE id = ?
  `);
  stmt.run(tokensInput, tokensOutput, cost, taskId);
}

/**
 * Record a tool call within a task (legacy)
 */
export function recordToolCall(
  taskId: string,
  toolName: string,
  input: string | null,
  output: string | null,
  durationMs: number
): void {
  const callId = `${taskId}-tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const stmt = db.prepare(`
    INSERT INTO tool_calls (id, task_id, tool_name, state, input, output, duration_ms, called_at)
    VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)
  `);
  stmt.run(callId, taskId, toolName, input, output, durationMs, Date.now());
}

/**
 * Record a tool call with state tracking (v2)
 */
export function recordToolCallWithState(
  taskId: string,
  callId: string,
  toolName: string,
  state: "pending" | "running" | "completed" | "error",
  input: string | null,
  output: string | null
): void {
  const dbId = `${taskId}-${callId}`;

  // Upsert: update if exists, insert if not
  const existing = db.prepare(`SELECT id FROM tool_calls WHERE id = ?`).get(dbId);

  if (existing) {
    const stmt = db.prepare(`
      UPDATE tool_calls SET state = ?, input = COALESCE(?, input), output = COALESCE(?, output)
      WHERE id = ?
    `);
    stmt.run(state, input, output, dbId);
  } else {
    const stmt = db.prepare(`
      INSERT INTO tool_calls (id, task_id, call_id, tool_name, state, input, output, called_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(dbId, taskId, callId, toolName, state, input, output, Date.now());
  }
}

/**
 * Record a streaming text chunk (v2)
 */
export function recordOutputChunk(taskId: string, chunk: string, chunkIndex: number): void {
  const stmt = db.prepare(`
    INSERT INTO task_output_chunks (task_id, chunk, chunk_index, created_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(taskId, chunk, chunkIndex, Date.now());
}

/**
 * Record a file operation (v2)
 */
export function recordFileOperation(
  taskId: string,
  operation: "read" | "write" | "edit",
  filePath: string
): void {
  const stmt = db.prepare(`
    INSERT INTO file_operations (task_id, operation, file_path, created_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(taskId, operation, filePath, Date.now());
}

/**
 * Create a new workflow record
 */
export function createWorkflow(
  workflowId: string,
  name: string,
  stages: string
): void {
  if (!serverId) return;

  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO workflows (id, server_id, name, status, stages, created_at, updated_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `);
  stmt.run(workflowId, serverId, name, stages, now, now);
}

/**
 * Update workflow status
 */
export function updateWorkflow(
  workflowId: string,
  status: string,
  currentStage?: string
): void {
  const stmt = db.prepare(`
    UPDATE workflows SET status = ?, current_stage = ?, updated_at = ? WHERE id = ?
  `);
  stmt.run(status, currentStage || null, Date.now(), workflowId);
}

/**
 * Get current server ID
 */
export function getServerId(): string | null {
  return serverId;
}

// Start heartbeat interval
let heartbeatInterval: NodeJS.Timeout | null = null;

export function startHeartbeat(): void {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(heartbeat, 10000); // Every 10 seconds
}

export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Cleanup on process exit
process.on("exit", () => {
  stopHeartbeat();
  disconnectServer();
});

process.on("SIGINT", () => {
  stopHeartbeat();
  disconnectServer();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopHeartbeat();
  disconnectServer();
  process.exit(0);
});
