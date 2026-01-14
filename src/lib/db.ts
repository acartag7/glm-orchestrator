import Database from "better-sqlite3";
import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";
import { basename } from "path";

const DB_DIR = join(homedir(), ".glm-orchestrator");
const DB_PATH = join(DB_DIR, "orchestrator.db");

// Ensure directory exists
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Create tables if not exists (same schema as dashboard)
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
    status TEXT NOT NULL,
    description TEXT,
    prompt TEXT,
    output TEXT,
    error TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    FOREIGN KEY (server_id) REFERENCES servers(id)
  );

  CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
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

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_server ON tasks(server_id);
  CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
`);

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
 * Record a tool call within a task
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
    INSERT INTO tool_calls (id, task_id, tool_name, input, output, duration_ms, called_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(callId, taskId, toolName, input, output, durationMs, Date.now());
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

// Note: db is not exported to avoid type issues
// Use the exported functions instead
