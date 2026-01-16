/**
 * SQLite schema definitions for GLM Orchestrator
 */

// ============================================================================
// MVP Schema (Spec-Driven Development Platform)
// ============================================================================

export const MVP_SCHEMA = `
-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  directory TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Specs
CREATE TABLE IF NOT EXISTS specs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'draft',
  branch_name TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Chunks
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  spec_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  output TEXT,
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  review_status TEXT,
  review_feedback TEXT,
  FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE
);

-- Tool Calls (for execution history)
CREATE TABLE IF NOT EXISTS chunk_tool_calls (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT,
  status TEXT DEFAULT 'running',
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

-- Spec Studio State (for wizard persistence)
CREATE TABLE IF NOT EXISTS spec_studio_state (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  step TEXT NOT NULL DEFAULT 'intent',
  intent TEXT DEFAULT '',
  questions TEXT DEFAULT '[]',
  answers TEXT DEFAULT '{}',
  generated_spec TEXT DEFAULT '',
  suggested_chunks TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_specs_project ON specs(project_id);
CREATE INDEX IF NOT EXISTS idx_chunks_spec ON chunks(spec_id);
CREATE INDEX IF NOT EXISTS idx_chunks_status ON chunks(status);
CREATE INDEX IF NOT EXISTS idx_chunk_tool_calls_chunk ON chunk_tool_calls(chunk_id);
CREATE INDEX IF NOT EXISTS idx_studio_project ON spec_studio_state(project_id);
`;

// ============================================================================
// Legacy Schema (v2 - kept for reference)
// ============================================================================

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

/**
 * Migration queries for Phase 2 (Multi-Spec support)
 * These add new columns to the specs table
 */
export const MIGRATIONS_PHASE2 = [
  `ALTER TABLE specs ADD COLUMN status TEXT DEFAULT 'draft'`,
  `ALTER TABLE specs ADD COLUMN branch_name TEXT`,
  `ALTER TABLE specs ADD COLUMN pr_number INTEGER`,
  `ALTER TABLE specs ADD COLUMN pr_url TEXT`,
];

/**
 * Migration queries for Phase 2 Review Loop
 * These add review columns to the chunks table
 */
export const MIGRATIONS_REVIEW_LOOP = [
  `ALTER TABLE chunks ADD COLUMN review_status TEXT`,
  `ALTER TABLE chunks ADD COLUMN review_feedback TEXT`,
];

/**
 * Migration queries for Phase 3 (Dependencies/Graph View)
 * Adds dependencies column to chunks table
 */
export const MIGRATIONS_PHASE3_DEPS = [
  `ALTER TABLE chunks ADD COLUMN dependencies TEXT DEFAULT '[]'`,
];

/**
 * Migration queries for Output Summary feature
 * Adds output_summary column to chunks table for context passing
 */
export const MIGRATIONS_OUTPUT_SUMMARY = [
  `ALTER TABLE chunks ADD COLUMN output_summary TEXT`,
];

/**
 * Migration queries for Phase 4 (Multiple GLM Workers)
 * Adds workers and worker_queue tables
 */
export const MIGRATIONS_PHASE4_WORKERS = [
  // Workers table
  `CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    spec_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    status TEXT DEFAULT 'idle',
    current_chunk_id TEXT,
    current_step TEXT,
    progress_current INTEGER DEFAULT 0,
    progress_total INTEGER DEFAULT 0,
    progress_passed INTEGER DEFAULT 0,
    progress_failed INTEGER DEFAULT 0,
    started_at INTEGER,
    completed_at INTEGER,
    error TEXT,
    FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  // Worker queue
  `CREATE TABLE IF NOT EXISTS worker_queue (
    id TEXT PRIMARY KEY,
    spec_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    added_at INTEGER NOT NULL,
    FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status)`,
  `CREATE INDEX IF NOT EXISTS idx_workers_spec ON workers(spec_id)`,
  `CREATE INDEX IF NOT EXISTS idx_queue_priority ON worker_queue(priority DESC, added_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_queue_spec ON worker_queue(spec_id)`,
];
