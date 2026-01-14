/**
 * SQLite schema definitions for GLM Orchestrator
 */

export const SCHEMA_V2 = `
-- Servers table (existing)
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  folder_name TEXT NOT NULL,
  pid INTEGER NOT NULL,
  connected_at INTEGER NOT NULL,
  last_heartbeat INTEGER NOT NULL,
  status TEXT NOT NULL
);

-- Tasks table (extended for v2)
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  workflow_id TEXT,
  session_id TEXT,           -- NEW: opencode session ID
  model_id TEXT,             -- NEW: e.g., "glm-4.7"
  provider_id TEXT,          -- NEW: e.g., "zai-coding-plan"
  status TEXT NOT NULL,
  description TEXT,
  prompt TEXT,
  output TEXT,
  error TEXT,
  tokens_input INTEGER DEFAULT 0,  -- NEW
  tokens_output INTEGER DEFAULT 0, -- NEW
  cost REAL DEFAULT 0,             -- NEW
  started_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY (server_id) REFERENCES servers(id)
);

-- Tool calls table (extended for v2)
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  call_id TEXT,              -- NEW: opencode's callID
  tool_name TEXT NOT NULL,
  state TEXT DEFAULT 'completed',  -- NEW: pending/running/completed/error
  input TEXT,
  output TEXT,
  duration_ms INTEGER,
  called_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Workflows table (existing)
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

-- NEW: Task output chunks for streaming text
CREATE TABLE IF NOT EXISTS task_output_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  chunk TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- NEW: File operations tracking
CREATE TABLE IF NOT EXISTS file_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  operation TEXT NOT NULL,  -- read/write/edit
  file_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_server ON tasks(server_id);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_state ON tool_calls(state);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
CREATE INDEX IF NOT EXISTS idx_output_chunks_task ON task_output_chunks(task_id);
CREATE INDEX IF NOT EXISTS idx_file_ops_task ON file_operations(task_id);
`;

/**
 * Migration queries for upgrading v1 to v2
 */
export const MIGRATIONS_V1_TO_V2 = [
  `ALTER TABLE tasks ADD COLUMN session_id TEXT`,
  `ALTER TABLE tasks ADD COLUMN model_id TEXT`,
  `ALTER TABLE tasks ADD COLUMN provider_id TEXT`,
  `ALTER TABLE tasks ADD COLUMN tokens_input INTEGER DEFAULT 0`,
  `ALTER TABLE tasks ADD COLUMN tokens_output INTEGER DEFAULT 0`,
  `ALTER TABLE tasks ADD COLUMN cost REAL DEFAULT 0`,
  `ALTER TABLE tool_calls ADD COLUMN call_id TEXT`,
  `ALTER TABLE tool_calls ADD COLUMN state TEXT DEFAULT 'completed'`,
  `CREATE TABLE IF NOT EXISTS task_output_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    chunk TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  )`,
  `CREATE TABLE IF NOT EXISTS file_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tool_calls_state ON tool_calls(state)`,
  `CREATE INDEX IF NOT EXISTS idx_output_chunks_task ON task_output_chunks(task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_file_ops_task ON file_operations(task_id)`,
];
