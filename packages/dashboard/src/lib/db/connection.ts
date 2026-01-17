import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { MVP_SCHEMA, MIGRATIONS_PHASE2, MIGRATIONS_REVIEW_LOOP, MIGRATIONS_PHASE3_DEPS, MIGRATIONS_OUTPUT_SUMMARY, MIGRATIONS_PHASE4_WORKERS, MIGRATIONS_CONFIG_SYSTEM, MIGRATIONS_CASCADE_DELETE, MIGRATIONS_GIT_INTEGRATION, MIGRATIONS_WORKTREES } from '@specwright/shared';

const DB_DIR = path.join(os.homedir(), '.specwright');
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, 'orchestrator.db');

let db: DatabaseType | null = null;

export function getDb(): DatabaseType {
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

  // Run Cascade Delete migrations (ORC-31)
  runCascadeDeleteMigrations(db);

  // Run Spec Studio State migrations (ORC-46)
  runSpecStudioStateMigrations(db);

  // Run Git Integration migrations (ORC-21)
  runGitIntegrationMigrations(db);

  // Run Worktree migrations (ORC-29)
  runWorktreeMigrations(db);

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

interface ForeignKeyInfo {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

function runCascadeDeleteMigrations(database: DatabaseType): void {
  // Check if migration is needed by examining foreign key constraints on ALL affected tables
  // A partial migration could leave some tables without CASCADE, so check all of them
  const tablesToCheck = ['specs', 'chunks', 'chunk_tool_calls', 'spec_studio_state', 'workers', 'worker_queue'];

  const allHaveCascade = tablesToCheck.every(table => {
    try {
      const fkInfo = database.prepare(`PRAGMA foreign_key_list(${table})`).all() as ForeignKeyInfo[];
      // A table needs CASCADE if it has any foreign keys
      // Skip tables with no FKs (shouldn't happen but be safe)
      if (fkInfo.length === 0) return true;
      // All foreign keys in this table must have CASCADE
      return fkInfo.every(fk => fk.on_delete === 'CASCADE');
    } catch {
      // Table doesn't exist yet (fresh database) - doesn't need migration
      return true;
    }
  });

  if (allHaveCascade) {
    // Migration already applied or fresh database with new schema
    return;
  }

  console.log('Running cascade delete migration (ORC-31)...');

  // Disable FK enforcement during migration - required for DROP TABLE with references
  database.exec('PRAGMA foreign_keys = OFF');

  // Run migrations within a transaction for safety
  const transaction = database.transaction(() => {
    for (const migration of MIGRATIONS_CASCADE_DELETE) {
      try {
        database.exec(migration);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Ignore errors for tables that don't exist yet (fresh database)
        if (!message.includes('no such table')) {
          throw err;
        }
      }
    }
  });

  try {
    transaction();
    // Re-enable FK enforcement and verify integrity
    database.exec('PRAGMA foreign_keys = ON');
    // PRAGMA foreign_key_check returns rows for violations, not an error
    const fkViolations = database.prepare('PRAGMA foreign_key_check').all();
    if (fkViolations.length > 0) {
      console.error('Foreign key violations detected after migration:', fkViolations);
      // Violations indicate data integrity issues - log but don't throw
      // since we can't easily rollback at this point
    }
    console.log('Cascade delete migration completed successfully');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Cascade delete migration failed: ${message}`);
    // Ensure FK enforcement is re-enabled even on error
    database.exec('PRAGMA foreign_keys = ON');
    // Don't throw - allow the app to continue with existing schema
  }
}

function runSpecStudioStateMigrations(database: DatabaseType): void {
  // Check if we need to recreate the table to fix the UNIQUE constraint
  // Old schema had UNIQUE(project_id), new schema needs UNIQUE(project_id, spec_id)
  const indexInfo = database.prepare(`PRAGMA index_list(spec_studio_state)`).all() as { name: string; unique: number }[];
  const tableInfo = database.prepare(`PRAGMA table_info(spec_studio_state)`).all() as { name: string }[];
  const hasSpecIdColumn = tableInfo.some(col => col.name === 'spec_id');

  // Check if there's a unique index on just project_id (the old constraint)
  let needsRecreate = false;
  for (const idx of indexInfo) {
    if (idx.unique) {
      const cols = database.prepare(`PRAGMA index_info("${idx.name}")`).all() as { name: string }[];
      // If there's a unique index with only project_id, we need to recreate
      if (cols.length === 1 && cols[0].name === 'project_id') {
        needsRecreate = true;
        break;
      }
    }
  }

  if (needsRecreate) {
    console.log('Recreating spec_studio_state table to fix unique constraint (ORC-46)...');
    database.exec('PRAGMA foreign_keys = OFF');
    try {
      database.exec(`
        CREATE TABLE IF NOT EXISTS spec_studio_state_new (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          spec_id TEXT,
          step TEXT NOT NULL DEFAULT 'intent',
          intent TEXT DEFAULT '',
          questions TEXT DEFAULT '[]',
          answers TEXT DEFAULT '{}',
          generated_spec TEXT DEFAULT '',
          suggested_chunks TEXT DEFAULT '[]',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE,
          UNIQUE(project_id, spec_id)
        )
      `);
      // Copy data, setting spec_id to NULL for existing rows
      database.exec(`
        INSERT INTO spec_studio_state_new (id, project_id, spec_id, step, intent, questions, answers, generated_spec, suggested_chunks, created_at, updated_at)
        SELECT id, project_id, ${hasSpecIdColumn ? 'spec_id' : 'NULL'}, step, intent, questions, answers, generated_spec, suggested_chunks, created_at, updated_at
        FROM spec_studio_state WHERE project_id IN (SELECT id FROM projects)
      `);
      database.exec(`DROP TABLE spec_studio_state`);
      database.exec(`ALTER TABLE spec_studio_state_new RENAME TO spec_studio_state`);
      console.log('spec_studio_state table recreated successfully');
    } finally {
      database.exec('PRAGMA foreign_keys = ON');
    }
  } else if (!hasSpecIdColumn) {
    // Just add the spec_id column if table already has correct constraint structure
    try {
      database.exec(`ALTER TABLE spec_studio_state ADD COLUMN spec_id TEXT REFERENCES specs(id) ON DELETE CASCADE`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('duplicate column')) {
        console.warn(`Migration warning: ${message}`);
      }
    }
  }

  // Always try to create indexes (IF NOT EXISTS makes it safe for all cases)
  try {
    database.exec(`CREATE INDEX IF NOT EXISTS idx_studio_project ON spec_studio_state(project_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_studio_spec ON spec_studio_state(spec_id)`);
  } catch (err) {
    console.warn(`Index creation warning: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function runGitIntegrationMigrations(database: DatabaseType): void {
  // Check if migration is needed by checking both columns
  const specsTableInfo = database.prepare(`PRAGMA table_info(specs)`).all() as { name: string }[];
  const chunksTableInfo = database.prepare(`PRAGMA table_info(chunks)`).all() as { name: string }[];

  const hasOriginalBranchColumn = specsTableInfo.some(col => col.name === 'original_branch');
  const hasCommitHashColumn = chunksTableInfo.some(col => col.name === 'commit_hash');

  // Only skip if BOTH columns exist
  if (hasOriginalBranchColumn && hasCommitHashColumn) {
    return;
  }

  for (const migration of MIGRATIONS_GIT_INTEGRATION) {
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

function runWorktreeMigrations(database: DatabaseType): void {
  // Check if migration is needed by checking if 'worktree_path' column exists
  const tableInfo = database.prepare(`PRAGMA table_info(specs)`).all() as { name: string }[];
  const hasWorktreePathColumn = tableInfo.some(col => col.name === 'worktree_path');

  if (!hasWorktreePathColumn) {
    console.log('Running worktree migrations (ORC-29)...');

    for (const migration of MIGRATIONS_WORKTREES) {
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

    console.log('Worktree migrations completed');
  }
}

// ============================================================================
// ID Generation
// ============================================================================

export function generateId(): string {
  return randomUUID();
}
