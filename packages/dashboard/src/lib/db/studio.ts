import type { SpecStudioState, SpecStudioStep, Question, ChunkSuggestion } from '@specwright/shared';
import { getDb, generateId } from './connection';

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
