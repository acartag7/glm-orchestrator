import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';

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

  return db;
}

export interface Server {
  id: string;
  folder_name: string;
  pid: number;
  connected_at: number;
  last_heartbeat: number;
  status: string;
}

export interface Task {
  id: string;
  server_id: string;
  workflow_id: string | null;
  status: string;
  description: string | null;
  prompt: string | null;
  output: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
}

export interface ToolCall {
  id: string;
  task_id: string;
  tool_name: string;
  input: string | null;
  output: string | null;
  duration_ms: number | null;
  called_at: number;
}

export interface Workflow {
  id: string;
  server_id: string;
  name: string;
  status: string;
  current_stage: string | null;
  stages: string | null;
  created_at: number;
  updated_at: number;
}

export interface TaskHistoryOptions {
  limit?: number;
  offset?: number;
  status?: string;
  server_id?: string;
  workflow_id?: string;
  search?: string;
}

export function getActiveServers(): Server[] {
  const database = getDb();
  const now = Date.now();
  const stmt = database.prepare(`
    SELECT * FROM servers
    WHERE last_heartbeat > ? - 30000
    ORDER BY last_heartbeat DESC
  `);
  return stmt.all(now) as Server[];
}

export function getActiveTasks(): Task[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM tasks
    WHERE status IN ('running', 'pending')
    ORDER BY started_at DESC
  `);
  return stmt.all() as Task[];
}

export function getTaskHistory(options: TaskHistoryOptions = {}): Task[] {
  const database = getDb();
  const { limit = 100, offset = 0, status, server_id, workflow_id, search } = options;

  let query = `SELECT * FROM tasks WHERE 1=1`;
  const params: (string | number)[] = [];

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  if (server_id) {
    query += ` AND server_id = ?`;
    params.push(server_id);
  }

  if (workflow_id) {
    query += ` AND workflow_id = ?`;
    params.push(workflow_id);
  }

  if (search) {
    query += ` AND (description LIKE ? OR prompt LIKE ? OR output LIKE ?)`;
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  query += ` ORDER BY started_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = database.prepare(query);
  return stmt.all(...params) as Task[];
}

export function getWorkflows(): Workflow[] {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT * FROM workflows
    ORDER BY updated_at DESC
  `);
  return stmt.all() as Workflow[];
}

export function getTaskDetails(taskId: string): { task: Task | null; toolCalls: ToolCall[] } {
  const database = getDb();
  const taskStmt = database.prepare(`SELECT * FROM tasks WHERE id = ?`);
  const task = taskStmt.get(taskId) as Task | null;

  const toolCallsStmt = database.prepare(`SELECT * FROM tool_calls WHERE task_id = ? ORDER BY called_at ASC`);
  const toolCalls = toolCallsStmt.all(taskId) as ToolCall[];

  return { task, toolCalls };
}

export function cancelTask(taskId: string): boolean {
  const database = getDb();
  const stmt = database.prepare(`UPDATE tasks SET status = 'cancelled', completed_at = ? WHERE id = ? AND status IN ('running', 'pending')`);
  const result = stmt.run(Date.now(), taskId);
  return result.changes > 0;
}

export { getDb };
