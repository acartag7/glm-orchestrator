import type { Project } from '@specwright/shared';
import { getDb, generateId } from './connection';

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
