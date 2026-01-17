import Database, { type Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { MVP_SCHEMA, MIGRATIONS_PHASE2, MIGRATIONS_REVIEW_LOOP, MIGRATIONS_PHASE3_DEPS, MIGRATIONS_OUTPUT_SUMMARY, MIGRATIONS_PHASE4_WORKERS, MIGRATIONS_CONFIG_SYSTEM, MIGRATIONS_CASCADE_DELETE } from '@specwright/shared';

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

// ============================================================================
// ID Generation
// ============================================================================

export function generateId(): string {
  return randomUUID();
}
