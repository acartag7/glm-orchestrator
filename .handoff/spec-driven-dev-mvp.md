# Spec-Driven Development Platform - MVP

## Vision

A web-based tool where you write specs with AI assistance, break them into chunks, and execute them with GLM while watching progress in real-time.

**Not** a Cursor/Windsurf competitor. **A personal/team tool** for structured AI-assisted development.

---

## Current Progress

**Status:** Day 2 - Complete
**Last Updated:** 2025-01-14
**Next Task:** Day 3 - Execution

### Completed
- [x] Project structure (monorepo with pnpm + turborepo)
- [x] Dashboard foundation (Next.js + Tailwind CSS 4)
- [x] AI clients (OpencodeClient for GLM, ClaudeClient for Opus)
- [x] SSE infrastructure for real-time updates
- [x] MVP spec written
- [x] **Day 1: Foundation**
  - [x] New MVP database schema (projects, specs, chunks, chunk_tool_calls)
  - [x] Shared MVP types in @glm/shared
  - [x] Project CRUD API routes
  - [x] Project list UI (home page)
  - [x] Create Project modal
  - [x] Project workspace page placeholder
- [x] **Day 2: Spec & Chunks**
  - [x] Spec API routes (GET, PUT)
  - [x] Spec refine endpoint with Opus integration
  - [x] Spec editor component with auto-save
  - [x] Chunks API routes (CRUD + reorder)
  - [x] Chunk list component with move controls
  - [x] Chunk editor modal
  - [x] Full project workspace UI

### In Progress
- [ ] **Day 3: Execution** ← START HERE

### Blockers / Notes
_None_

---

## MVP Scope

### In Scope
- [ ] Project management (CRUD)
- [ ] Spec editor with Opus refinement
- [ ] Chunk/feature breakdown (manual)
- [ ] One-click GLM execution per chunk
- [ ] Real-time execution view
- [ ] Basic status tracking

### Out of Scope (Future Phases)
- Review loop (Opus checks GLM output)
- n8n-style graph visualization
- Git/PR integration
- Parallel chunk execution
- CI/CD integration

---

## Data Model

### Project
```typescript
interface Project {
  id: string;
  name: string;
  directory: string;      // Working directory path
  description?: string;
  createdAt: number;
  updatedAt: number;
}
```

### Spec
```typescript
interface Spec {
  id: string;
  projectId: string;
  title: string;
  content: string;        // Markdown content
  version: number;        // Increment on each save
  createdAt: number;
  updatedAt: number;
}
```

### Chunk
```typescript
interface Chunk {
  id: string;
  specId: string;
  title: string;
  description: string;    // What GLM should do
  order: number;          // Execution order
  status: ChunkStatus;
  output?: string;        // GLM's final output
  error?: string;
  startedAt?: number;
  completedAt?: number;
  toolCalls: ToolCall[];  // Recorded tool calls
}

type ChunkStatus = 'pending' | 'running' | 'completed' | 'failed';

interface ToolCall {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
  completedAt?: number;
}
```

### Database Schema (SQLite)

```sql
-- Projects
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  directory TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Specs
CREATE TABLE specs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Chunks
CREATE TABLE chunks (
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
  FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE
);

-- Tool Calls (for execution history)
CREATE TABLE tool_calls (
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

-- Indexes
CREATE INDEX idx_specs_project ON specs(project_id);
CREATE INDEX idx_chunks_spec ON chunks(spec_id);
CREATE INDEX idx_chunks_status ON chunks(status);
CREATE INDEX idx_tool_calls_chunk ON tool_calls(chunk_id);
```

---

## UI Structure

### Page Routes

```
/                       → Project list (home)
/project/[id]           → Project workspace
/project/[id]/spec/[id] → Spec editor (optional, could be inline)
```

### Main Layout: Project Workspace

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← Back    Project: My API Backend                          [Settings] [⋮]  │
├───────────────────────────────────┬─────────────────────────────────────────┤
│                                   │                                         │
│  SPEC                             │  EXECUTION                              │
│  ┌─────────────────────────────┐  │  ┌─────────────────────────────────────┐│
│  │ # Authentication Feature    │  │  │                                     ││
│  │                             │  │  │  Status: Running chunk 2/4          ││
│  │ Implement JWT-based auth    │  │  │                                     ││
│  │ with the following:         │  │  │  ┌─────────────────────────────────┐││
│  │                             │  │  │  │ ◐ Creating auth routes...       │││
│  │ - Login endpoint            │  │  │  │                                 │││
│  │ - Register endpoint         │  │  │  │ read  src/index.ts         ✓   │││
│  │ - JWT token generation      │  │  │  │ write src/auth/jwt.ts      ✓   │││
│  │ - Protected route middleware│  │  │  │ edit  src/routes/index.ts  ◐   │││
│  │                             │  │  │  │                                 │││
│  │ [Edit] [Ask Opus to Refine] │  │  │  └─────────────────────────────────┘││
│  └─────────────────────────────┘  │  │                                     ││
│                                   │  │  Output:                            ││
│  CHUNKS                           │  │  ┌─────────────────────────────────┐││
│  ┌─────────────────────────────┐  │  │  │ Created JWT utility with sign   │││
│  │ ☑ 1. Setup dependencies     │  │  │  │ and verify functions...         │││
│  │      Completed 45s     [↺]  │  │  │  └─────────────────────────────────┘││
│  │                             │  │  │                                     ││
│  │ ◐ 2. Create auth routes     │  │  └─────────────────────────────────────┘│
│  │      Running...        [■]  │  │                                         │
│  │                             │  │                                         │
│  │ ○ 3. Add middleware         │  │                                         │
│  │      Pending           [▶]  │  │                                         │
│  │                             │  │                                         │
│  │ ○ 4. Write tests            │  │                                         │
│  │      Pending           [▶]  │  │                                         │
│  │                             │  │                                         │
│  │ [+ Add Chunk]               │  │                                         │
│  └─────────────────────────────┘  │                                         │
│                                   │                                         │
└───────────────────────────────────┴─────────────────────────────────────────┘
```

### Component Breakdown

```
app/
├── page.tsx                    # Project list
├── project/
│   └── [id]/
│       └── page.tsx            # Project workspace
├── components/
│   ├── ProjectList.tsx         # Grid of project cards
│   ├── ProjectCard.tsx         # Single project card
│   ├── CreateProjectModal.tsx  # New project form
│   ├── SpecEditor.tsx          # Markdown editor for spec
│   ├── ChunkList.tsx           # List of chunks
│   ├── ChunkItem.tsx           # Single chunk with controls
│   ├── ChunkEditor.tsx         # Modal/inline chunk editor
│   ├── ExecutionPanel.tsx      # Right side - live execution
│   ├── ToolCallList.tsx        # Tool calls during execution
│   └── ToolCallItem.tsx        # Single tool call
├── hooks/
│   ├── useProjects.ts          # Project CRUD
│   ├── useSpec.ts              # Spec CRUD
│   ├── useChunks.ts            # Chunk CRUD
│   └── useExecution.ts         # Execution state + SSE
└── lib/
    ├── db.ts                   # Database queries
    ├── api.ts                  # API client
    └── types.ts                # Shared types
```

---

## API Routes

### Projects
```
GET    /api/projects              # List all projects
POST   /api/projects              # Create project
GET    /api/projects/[id]         # Get project
PUT    /api/projects/[id]         # Update project
DELETE /api/projects/[id]         # Delete project
```

### Specs
```
GET    /api/projects/[id]/spec    # Get spec for project
PUT    /api/projects/[id]/spec    # Update spec
POST   /api/projects/[id]/spec/refine  # Ask Opus to refine spec
```

### Chunks
```
GET    /api/projects/[id]/chunks        # List chunks
POST   /api/projects/[id]/chunks        # Create chunk
PUT    /api/projects/[id]/chunks/[cid]  # Update chunk
DELETE /api/projects/[id]/chunks/[cid]  # Delete chunk
POST   /api/projects/[id]/chunks/reorder # Reorder chunks
```

### Execution
```
POST   /api/chunks/[id]/run       # Start executing a chunk
POST   /api/chunks/[id]/abort     # Abort running chunk
GET    /api/chunks/[id]/status    # Get chunk status + tool calls
```

### SSE
```
GET    /api/events                # SSE stream for all events
GET    /api/events/[chunkId]      # SSE stream for specific chunk
```

---

## Implementation Plan

### Day 1: Foundation ✅
- [x] Create new database schema (drop old tables)
- [x] Create shared types in `@glm/shared`
- [x] Set up API routes structure
- [x] Project CRUD (API + basic UI)

### Day 2: Spec & Chunks ✅
- [x] Spec editor component (simple textarea initially)
- [x] Spec API routes
- [x] Chunk list component
- [x] Chunk CRUD (API + UI)
- [x] Chunk reordering (drag & drop or arrows)

### Day 3: Execution
- [ ] "Run chunk" endpoint (integrates OpencodeClient)
- [ ] Execution panel component
- [ ] Tool call streaming via SSE
- [ ] Status updates (pending → running → completed/failed)

### Day 4: Opus Integration & Polish
- [ ] "Ask Opus to refine" endpoint (integrates ClaudeClient)
- [ ] Loading states, error handling
- [ ] Basic styling polish
- [ ] Test end-to-end flow

### Day 5: Buffer & Improvements
- [ ] Bug fixes from testing
- [ ] UX improvements
- [ ] Chunk retry functionality
- [ ] Basic persistence/recovery

---

## Key User Flows

### Flow 1: Create New Project
```
1. User clicks "+ New Project" on home
2. Modal: Enter name, directory path
3. Click "Create"
4. Redirect to project workspace
5. Empty spec editor + empty chunk list
```

### Flow 2: Write Spec
```
1. User types spec in markdown editor
2. Auto-saves on blur (or manual save)
3. Optional: Click "Ask Opus to Refine"
   - Shows loading state
   - Opus returns improved spec
   - User can accept/reject changes
```

### Flow 3: Create Chunks
```
1. User clicks "+ Add Chunk"
2. Enter title + description (what GLM should do)
3. Chunk appears in list
4. User can reorder, edit, delete chunks
```

### Flow 4: Execute Chunk
```
1. User clicks [▶] on a pending chunk
2. Status changes to "running"
3. Execution panel shows live tool calls
4. Tool calls stream in via SSE
5. When complete:
   - Status → "completed" or "failed"
   - Output shown in execution panel
   - User can retry if failed
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Backend | Next.js API routes |
| Database | SQLite (better-sqlite3) |
| AI - Planning | Claude CLI (Opus) |
| AI - Execution | opencode HTTP API (GLM) |
| Real-time | Server-Sent Events |

---

## File Structure (Final)

```
packages/
├── dashboard/                  # Main web app (rename to 'app'?)
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx       # Home - project list
│   │   │   ├── project/
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx  # Project workspace
│   │   │   └── api/
│   │   │       ├── projects/
│   │   │       ├── chunks/
│   │   │       └── events/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── lib/
│   └── package.json
├── shared/                     # Shared types
│   └── src/
│       └── index.ts
└── mcp/                        # Keep for later (optional CLI interface)
    └── ...
```

---

## Success Criteria

MVP is complete when:
1. ✅ Can create a project with a directory
2. ✅ Can write/edit a spec
3. ✅ Can ask Opus to refine the spec
4. ✅ Can create/edit/delete/reorder chunks
5. ✅ Can run a chunk and see live tool calls
6. ✅ Can see chunk completion status
7. ✅ Can retry a failed chunk

---

## What's Next (Post-MVP)

**Phase 2: Review Loop**
- After chunk completes, Opus reviews the code
- Checks: tests pass, no security issues, code quality
- If issues found → creates fix chunk automatically

**Phase 3: Visualization**
- n8n-style graph view of chunks
- Visual status indicators
- Parallel execution support

**Phase 4: Git Integration**
- Each chunk creates a commit
- Option to create PR per feature
- Branch management

**Phase 5: Advanced**
- Project templates
- Chunk templates
- Team collaboration
- Usage analytics
