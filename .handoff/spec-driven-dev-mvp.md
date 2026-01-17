# Spec-Driven Development Platform - MVP

## Vision

A web-based tool where you write specs with AI assistance, break them into chunks, and execute them with GLM while watching progress in real-time.

**Not** a Cursor/Windsurf competitor. **A personal/team tool** for structured AI-assisted development.

---

## Current Progress

**Status:** Post-MVP - Spec Studio
**Last Updated:** 2025-01-15
**Next Task:** Implement Spec Studio (Guided Wizard Flow)

### Completed
- [x] Project structure (monorepo with pnpm + turborepo)
- [x] Dashboard foundation (Next.js + Tailwind CSS 4)
- [x] AI clients (OpencodeClient for GLM, ClaudeClient for Opus)
- [x] SSE infrastructure for real-time updates
- [x] MVP spec written
- [x] **Day 1: Foundation**
  - [x] New MVP database schema (projects, specs, chunks, chunk_tool_calls)
  - [x] Shared MVP types in @specwright/shared
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
- [x] **Day 3: Execution**
  - [x] Added 'cancelled' status to ChunkStatus type
  - [x] Run chunk API endpoint (/api/chunks/[id]/run)
  - [x] Abort chunk API endpoint (/api/chunks/[id]/abort)
  - [x] SSE events stream (/api/chunks/[id]/events)
  - [x] Execution service with OpencodeClient integration
  - [x] useExecution hook for state management
  - [x] ExecutionPanel component with live tool calls
  - [x] Sequential execution (one chunk at a time)
  - [x] Timeout handling (5 min default)
- [x] **Day 4-5: Test & Fix**
  - [x] Fixed Opus model name (claude-opus-4-5-20251101)
  - [x] Fixed ClaudeClient text extraction (handle non-streaming messages)
  - [x] Fixed tool calls not showing (session ID vs directory matching)
  - [x] Fixed SSE race condition (event buffering for late subscribers)
  - [x] Added execution history persistence (view completed chunk tool calls)
  - [x] Added chunk selection UI for history viewing
  - [x] Added OpenCode connection error handling with helpful message
  - [x] End-to-end flow tested: Create project → Write spec → Refine with Opus → Create chunks → Execute → Complete

### In Progress
**Spec Studio** - Guided wizard flow for spec creation (see detailed spec below)

### Next Priorities
1. **Spec Studio** - THE priority. Guided wizard replaces raw textarea approach
2. **UI Improvements** - Fix chunk truncation, responsive layout, output panel
3. **Review Loop** - Opus reviews GLM output, auto-creates fix chunks if needed

### Known Issues
- Chunk descriptions show full content (should truncate)
- Output panel shows entire prompt instead of just results
- Layout not responsive on smaller screens
- ~~Spec editor area too small~~ (Spec Studio will replace this)

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
- [x] Create shared types in `@specwright/shared`
- [x] Set up API routes structure
- [x] Project CRUD (API + basic UI)

### Day 2: Spec & Chunks ✅
- [x] Spec editor component (simple textarea initially)
- [x] Spec API routes
- [x] Chunk list component
- [x] Chunk CRUD (API + UI)
- [x] Chunk reordering (drag & drop or arrows)

### Day 3: Execution ✅
- [x] "Run chunk" endpoint (integrates OpencodeClient)
- [x] Execution panel component
- [x] Tool call streaming via SSE
- [x] Status updates (pending → running → completed/failed/cancelled)

### Day 4: Opus Integration & Polish ✅
- [x] "Ask Opus to refine" endpoint (integrates ClaudeClient)
- [x] Loading states, error handling
- [x] Basic styling polish
- [x] Test end-to-end flow

### Day 5: Bug Fixes & Improvements ✅
- [x] Bug fixes from testing (Opus model, text extraction, tool calls)
- [x] UX improvements (chunk selection, history viewing)
- [x] Chunk retry functionality (re-run failed chunks)
- [x] Execution history persistence

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

## Spec Studio Wizard Implementation (CURRENT PRIORITY)

Build a 4-step guided wizard for AI-assisted spec creation that replaces the raw textarea approach. The wizard guides users through structured spec development with Opus assistance at each stage.

### Flow Diagram

```
┌──────────┐    ┌───────────┐    ┌────────┐    ┌────────┐
│  Intent  │ → │ Questions │ → │ Review │ → │ Chunks │ → [Complete]
│  Step 1  │    │  Step 2   │    │ Step 3 │    │ Step 4 │
└──────────┘    └───────────┘    └────────┘    └────────┘
     ↑               ↑               ↑
     └───────────────┴───────────────┘
           Can navigate back anytime
```

### UI Mockups

#### Step 1: Intent
```
┌─────────────────────────────────────────────────────────────┐
│  SPEC STUDIO                              Step 1 of 4  ●○○○ │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  What do you want to build?                                 │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  I want to add user authentication to my Express   │   │
│  │  API. Users should be able to register and login.  │   │
│  │  Use JWT tokens.                                   │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│                                          [Continue →]       │
└─────────────────────────────────────────────────────────────┘
```

#### Step 2: Questions
```
┌─────────────────────────────────────────────────────────────┐
│  SPEC STUDIO                              Step 2 of 4  ●●○○ │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Let me understand your requirements better:                │
│                                                             │
│  How should passwords be stored?                            │
│  ○ Bcrypt hashing (recommended)                             │
│  ○ Argon2                                                   │
│  ○ Let me decide                                            │
│                                                             │
│  What user info is required for registration?               │
│  ☑ Email  ☑ Password  ☐ Username  ☐ Full name              │
│                                                             │
│  How long should JWT tokens be valid?                       │
│  [_1 hour_________________________]                         │
│                                                             │
│  Any additional requirements?                               │
│  [_________________________________]                        │
│                                                             │
│                                  [← Back]  [Generate Spec →]│
└─────────────────────────────────────────────────────────────┘
```

#### Step 3: Review
```
┌─────────────────────────────────────────────────────────────┐
│  SPEC STUDIO                              Step 3 of 4  ●●●○ │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Here's your spec:                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ # User Authentication System                        │   │
│  │                                                     │   │
│  │ ## Overview                                         │   │
│  │ JWT-based authentication for Express API...        │   │
│  │                                                     │   │
│  │ ## Requirements                                     │   │
│  │ - POST /auth/register                              │   │
│  │ - POST /auth/login                                 │   │
│  │ ...                                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Want to refine?                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Add refresh token support                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                            [Refine]         │
│                                                             │
│                             [← Back]  [Looks Good →]        │
└─────────────────────────────────────────────────────────────┘
```

#### Step 4: Chunks
```
┌─────────────────────────────────────────────────────────────┐
│  SPEC STUDIO                              Step 4 of 4  ●●●● │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Suggested implementation chunks:                           │
│                                                             │
│  ☑ 1. Setup dependencies                                    │
│       Install bcrypt, jsonwebtoken, add TypeScript types    │
│                                                             │
│  ☑ 2. Create user database schema                           │
│       Add users table with email, password_hash             │
│                                                             │
│  ☑ 3. Implement registration endpoint                       │
│       POST /auth/register with validation                   │
│                                                             │
│  ☑ 4. Implement login endpoint                              │
│       POST /auth/login, verify password, return JWT         │
│                                                             │
│  ☑ 5. Add authentication middleware                         │
│       Verify JWT, attach user to request                    │
│                                                             │
│  [+ Add custom chunk]                                       │
│                                                             │
│                          [← Back]  [Create & Start →]       │
└─────────────────────────────────────────────────────────────┘
```

---

### Data Model

#### New Types (`@specwright/shared`)

```typescript
// Spec Studio state (persisted across sessions)
interface SpecStudioState {
  id: string;
  projectId: string;
  step: SpecStudioStep;
  intent: string;
  questions: Question[];
  answers: Record<string, string | string[]>; // questionId → answer(s)
  generatedSpec: string;
  suggestedChunks: ChunkSuggestion[];
  createdAt: number;
  updatedAt: number;
}

type SpecStudioStep = 'intent' | 'questions' | 'review' | 'chunks' | 'complete';

interface Question {
  id: string;
  question: string;
  type: QuestionType;
  options?: string[];  // Required for 'choice' and 'multiselect'
  required: boolean;
}

type QuestionType = 'text' | 'choice' | 'multiselect';

interface ChunkSuggestion {
  id: string;
  title: string;
  description: string;
  selected: boolean;
  order: number;
}
```

#### Database Schema Addition

```sql
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

CREATE INDEX IF NOT EXISTS idx_studio_project ON spec_studio_state(project_id);
```

---

### API Routes

#### Base Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/projects/[id]/studio` | Get studio state (creates if not exists) |
| `PUT` | `/api/projects/[id]/studio` | Update studio state (step, intent, answers, etc.) |

#### Opus Integration Routes

| Method | Endpoint | Description | Request Body | Response |
|--------|----------|-------------|--------------|----------|
| `POST` | `/api/projects/[id]/studio/questions` | Generate clarifying questions from intent | `{ intent: string }` | `{ questions: Question[] }` |
| `POST` | `/api/projects/[id]/studio/spec` | Generate spec from intent + answers | `{ intent: string, answers: Record<string, string \| string[]> }` | `{ spec: string }` |
| `POST` | `/api/projects/[id]/studio/refine` | Refine spec based on feedback | `{ spec: string, feedback: string }` | `{ spec: string }` |
| `POST` | `/api/projects/[id]/studio/chunks` | Generate chunk suggestions from spec | `{ spec: string }` | `{ chunks: ChunkSuggestion[] }` |
| `POST` | `/api/projects/[id]/studio/complete` | Finalize: save spec + create chunks | `{ spec: string, chunks: ChunkSuggestion[] }` | `{ success: boolean }` |

---

### UI Components

#### File Structure

```
packages/dashboard/src/components/spec-studio/
├── SpecStudioWizard.tsx       # Main container + state management
├── StepIndicator.tsx          # Progress dots: ●●○○
├── IntentStep.tsx             # Step 1: Large textarea
├── QuestionsStep.tsx          # Step 2: Dynamic question form
├── QuestionField.tsx          # Individual question renderer
├── ReviewStep.tsx             # Step 3: Spec display + refinement
├── ChunksStep.tsx             # Step 4: Selectable chunk list
└── ChunkSuggestionItem.tsx    # Editable chunk row
```

#### Component Specifications

##### `SpecStudioWizard.tsx`

**Props:**
```typescript
interface SpecStudioWizardProps {
  projectId: string;
  projectDirectory: string;
  existingSpec?: Spec;  // Pre-fill intent from existing spec
}
```

**Responsibilities:**
- Fetch/create studio state on mount
- Manage step navigation (next/back)
- Coordinate data between steps
- Auto-save state changes to API
- Handle completion flow

**State:**
```typescript
const [studioState, setStudioState] = useState<SpecStudioState | null>(null);
const [isLoading, setIsLoading] = useState(true);
const [isSaving, setIsSaving] = useState(false);
```

##### `StepIndicator.tsx`

**Props:**
```typescript
interface StepIndicatorProps {
  currentStep: SpecStudioStep;
  onStepClick?: (step: SpecStudioStep) => void;  // Optional: allow clicking completed steps
}
```

**Visual:** `Step 1 of 4  ●●○○`

**States:**
- `●` filled (emerald-400) = completed or current
- `○` outline (neutral-600) = pending

##### `IntentStep.tsx`

**Props:**
```typescript
interface IntentStepProps {
  intent: string;
  onChange: (intent: string) => void;
  onNext: () => void;
  isGenerating: boolean;  // Show loading while generating questions
}
```

**Features:**
- Large textarea (min-height: 200px)
- Placeholder text with example
- Character count (optional)
- "Continue →" button (disabled if intent empty or < 20 chars)

##### `QuestionsStep.tsx`

**Props:**
```typescript
interface QuestionsStepProps {
  questions: Question[];
  answers: Record<string, string | string[]>;
  onAnswerChange: (questionId: string, value: string | string[]) => void;
  onBack: () => void;
  onNext: () => void;
  isGenerating: boolean;  // Show loading while generating spec
}
```

**Features:**
- Render questions dynamically using `QuestionField`
- Show validation state (required fields)
- "Generate Spec →" button

##### `QuestionField.tsx`

**Props:**
```typescript
interface QuestionFieldProps {
  question: Question;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}
```

**Renders based on `question.type`:**
- `text`: `<textarea>` or `<input type="text">`
- `choice`: Radio button group
- `multiselect`: Checkbox group

##### `ReviewStep.tsx`

**Props:**
```typescript
interface ReviewStepProps {
  spec: string;
  onSpecChange: (spec: string) => void;  // For manual edits
  onBack: () => void;
  onNext: () => void;
  onRefine: (feedback: string) => Promise<void>;
  isRefining: boolean;
}
```

**Features:**
- Markdown preview of generated spec (read-only by default)
- "Edit manually" toggle to enable textarea editing
- Refinement input field + "Refine" button
- Loading state during refinement
- "Looks Good →" button to proceed

##### `ChunksStep.tsx`

**Props:**
```typescript
interface ChunksStepProps {
  chunks: ChunkSuggestion[];
  onChunksChange: (chunks: ChunkSuggestion[]) => void;
  onBack: () => void;
  onComplete: () => void;
  isCompleting: boolean;
}
```

**Features:**
- List of `ChunkSuggestionItem` components
- Checkbox to select/deselect each chunk
- Drag-to-reorder or up/down arrows
- "Add custom chunk" button
- "Create & Start →" button (creates spec + selected chunks)

##### `ChunkSuggestionItem.tsx`

**Props:**
```typescript
interface ChunkSuggestionItemProps {
  chunk: ChunkSuggestion;
  onToggle: () => void;
  onEdit: (title: string, description: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}
```

---

### Navigation Logic

Update `project/[id]/page.tsx`:

```typescript
// Determine what to show
if (!spec?.content || (studioState && studioState.step !== 'complete')) {
  return (
    <SpecStudioWizard
      projectId={id}
      projectDirectory={project.directory}
      existingSpec={spec}
    />
  );
}

// Spec exists and complete → show workspace
return <ProjectWorkspace project={project} spec={spec} />;
```

#### Entry Points

| Scenario | Behavior |
|----------|----------|
| New project | Auto-enter Studio at Step 1 |
| Existing project, empty spec | Enter Studio at Step 1 |
| Existing project, in-progress Studio | Resume at saved step |
| Existing project, complete spec | Show workspace with "Edit in Studio" button |

---

### Opus Prompt Templates

#### Generate Questions

```
You are helping a developer write a software specification. Based on their intent below, generate 3-6 clarifying questions to better understand their requirements.

Project directory: {directory}

Intent:
{intent}

Generate questions that will help create a complete, actionable specification. Return JSON array:

[
  {
    "id": "q1",
    "question": "How should passwords be stored?",
    "type": "choice",
    "options": ["Bcrypt (recommended)", "Argon2", "Let me decide"],
    "required": true
  },
  {
    "id": "q2",
    "question": "What user information is required for registration?",
    "type": "multiselect",
    "options": ["Email", "Password", "Username", "Full name"],
    "required": true
  },
  {
    "id": "q3",
    "question": "Any additional requirements or constraints?",
    "type": "text",
    "required": false
  }
]

Rules:
- Use "choice" for mutually exclusive options (radio buttons)
- Use "multiselect" for non-exclusive options (checkboxes)
- Use "text" for open-ended questions
- Include a recommended option in parentheses where appropriate
- Keep questions focused and actionable
- Return ONLY valid JSON, no markdown
```

#### Generate Spec

```
Create a detailed software specification based on the developer's intent and their answers to clarifying questions.

Project directory: {directory}

Intent:
{intent}

Answers to clarifying questions:
{formattedAnswers}

Write a clear, actionable specification in Markdown format. Include:
- Overview (1-2 paragraphs)
- Requirements (specific, numbered list)
- Acceptance criteria (testable conditions)
- Technical constraints (if any were mentioned)

Be specific enough that another developer (or AI) could implement this without ambiguity.
```

#### Refine Spec

```
Refine this specification based on the feedback provided.

Current specification:
{spec}

Feedback:
{feedback}

Update the specification to address the feedback while maintaining the existing structure and level of detail. Return the complete updated specification in Markdown format.
```

#### Generate Chunks

```
Break down this specification into implementation chunks. Each chunk should be a discrete task that can be executed independently by an AI coding assistant.

Specification:
{spec}

Return a JSON array of chunks ordered by dependency (foundational tasks first):

[
  {
    "id": "chunk_1",
    "title": "Setup dependencies",
    "description": "Install required packages: bcrypt, jsonwebtoken. Add TypeScript type definitions. Update package.json.",
    "selected": true,
    "order": 1
  },
  {
    "id": "chunk_2",
    "title": "Create user database schema",
    "description": "Create users table with columns: id (UUID), email (unique), password_hash, created_at, updated_at. Add appropriate indexes.",
    "selected": true,
    "order": 2
  }
]

Rules:
- Each chunk should take 5-15 minutes to implement
- Descriptions should be detailed enough for autonomous execution
- Order by dependencies (setup → core → features → tests)
- Include 4-8 chunks typically
- Return ONLY valid JSON, no markdown
```

---

### Implementation Plan

#### Day 1: Foundation

| Task | Description | Files |
|------|-------------|-------|
| Add `spec_studio_state` table | Add to schema | `packages/dashboard/src/lib/db.ts` |
| Add TypeScript types | SpecStudioState, Question, ChunkSuggestion | `packages/shared/src/index.ts` |
| Create `GET /api/projects/[id]/studio` | Returns studio state, creates if not exists | `packages/dashboard/src/app/api/projects/[id]/studio/route.ts` |
| Create `PUT /api/projects/[id]/studio` | Updates studio state | Same file |
| Add DB operations | getStudioState, createStudioState, updateStudioState | `packages/dashboard/src/lib/db.ts` |
| Create `SpecStudioWizard.tsx` | Main container with step state | `packages/dashboard/src/components/spec-studio/` |
| Create `StepIndicator.tsx` | Progress dots component | Same directory |
| Apply terminal theme | Use existing color palette | All components |

#### Day 2: Steps 1-2

| Task | Description | Files |
|------|-------------|-------|
| Create `IntentStep.tsx` | Large textarea with validation | `spec-studio/IntentStep.tsx` |
| Create `POST .../studio/questions` | Opus generates questions from intent | `api/projects/[id]/studio/questions/route.ts` |
| Create `QuestionsStep.tsx` | Dynamic form renderer | `spec-studio/QuestionsStep.tsx` |
| Create `QuestionField.tsx` | Handles choice/multiselect/text | `spec-studio/QuestionField.tsx` |
| Wire up Intent → Questions flow | Generate questions on "Continue" | `SpecStudioWizard.tsx` |

#### Day 3: Steps 3-4

| Task | Description | Files |
|------|-------------|-------|
| Create `POST .../studio/spec` | Opus generates spec from intent + answers | `api/projects/[id]/studio/spec/route.ts` |
| Create `ReviewStep.tsx` | Spec preview with edit mode | `spec-studio/ReviewStep.tsx` |
| Create `POST .../studio/refine` | Opus refines spec based on feedback | `api/projects/[id]/studio/refine/route.ts` |
| Create `POST .../studio/chunks` | Opus generates chunk suggestions | `api/projects/[id]/studio/chunks/route.ts` |
| Create `ChunksStep.tsx` | Selectable/editable chunk list | `spec-studio/ChunksStep.tsx` |
| Create `ChunkSuggestionItem.tsx` | Individual chunk row | `spec-studio/ChunkSuggestionItem.tsx` |

#### Day 4: Integration

| Task | Description | Files |
|------|-------------|-------|
| Create `POST .../studio/complete` | Save spec + create chunks in DB | `api/projects/[id]/studio/complete/route.ts` |
| Update project page routing | Auto-enter Studio for new/empty projects | `app/project/[id]/page.tsx` |
| Add "Edit in Studio" button | For projects with existing specs | `ProjectWorkspace` or header |
| End-to-end testing | Test complete flow from new project | Manual testing |

---

### Acceptance Criteria

#### Step 1: Intent
- [ ] Large textarea renders with placeholder text
- [ ] "Continue →" button disabled if intent < 20 characters
- [ ] State persists on navigation/refresh
- [ ] Existing spec content pre-fills textarea when editing

#### Step 2: Questions
- [ ] Questions load after clicking "Continue" from Step 1
- [ ] Loading state shown while Opus generates questions
- [ ] All three question types render correctly (text, choice, multiselect)
- [ ] Required field validation works
- [ ] "← Back" returns to Intent step with data preserved

#### Step 3: Review
- [ ] Generated spec displays in markdown format
- [ ] Manual edit mode toggle works
- [ ] Refinement input triggers Opus and updates spec
- [ ] Loading state shown during refinement
- [ ] Multiple refinements can be chained

#### Step 4: Chunks
- [ ] Suggested chunks display with checkboxes
- [ ] Chunks can be selected/deselected
- [ ] Chunks can be reordered
- [ ] Chunks can be edited inline
- [ ] Custom chunks can be added
- [ ] "Create & Start →" saves spec and creates selected chunks

#### Completion
- [ ] Spec saved to database with correct content
- [ ] Selected chunks created in correct order
- [ ] Studio state marked as 'complete'
- [ ] User redirected to project workspace
- [ ] Chunks visible in workspace chunk list

#### Navigation & State
- [ ] Can navigate back to any previous step
- [ ] State persists across page refreshes
- [ ] New projects auto-enter Studio
- [ ] "Edit in Studio" button appears for completed projects
- [ ] Resuming in-progress Studio works correctly

---

## Visual Design: Terminal Theme

A developer-focused, terminal-inspired aesthetic that feels like a powerful dev tool.

### Design Principles
- **Dark-first**: Terminal aesthetic with neutral-950 background
- **Monospace typography**: `font-mono` for UI elements, data, code
- **Terminal green accent**: Emerald-400/500 for primary actions and highlights
- **Code-like UI elements**: Git branches, file paths, command palette hints
- **Subtle details**: Grid pattern background, glass effects, minimal borders

### Color Palette (Dark Mode)

```css
/* Backgrounds */
bg-neutral-950      /* Main background */
bg-neutral-900      /* Cards, panels */
bg-neutral-800      /* Borders, dividers */

/* Text */
text-neutral-100    /* Primary text */
text-neutral-400    /* Secondary text */
text-neutral-500    /* Muted text */

/* Accents */
emerald-400         /* Primary highlight */
emerald-500         /* Primary actions */
amber-400           /* Warnings */
violet-400          /* Special states */
```

### Typography

```css
/* Font families */
font-mono           /* Primary: Geist Mono, JetBrains Mono, or similar */
                    /* All labels, data, code, navigation */

/* Sizes */
text-[10px]         /* Tiny labels, shortcuts, metadata */
text-xs             /* Secondary labels, descriptions */
text-sm             /* Body text, regular content */
text-base           /* Headings */
```

### UI Components

**Button styles:**
```tsx
// Primary action (emerald)
className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20"

// Ghost button
className="text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800"
```

**Card styles:**
```tsx
className="bg-neutral-900/50 border-neutral-800"
```

**Input/Textarea:**
```tsx
className="bg-neutral-900 border-neutral-800 text-neutral-300 placeholder:text-neutral-700"
```

**Badge/Status:**
```tsx
// Success
className="bg-emerald-500/10 text-emerald-400"

// Warning
className="bg-amber-500/10 text-amber-400"

// Info
className="bg-violet-500/10 text-violet-400"
```

### Icon Elements

- **Terminal icon** for logo/brand
- **Git branches** for version context
- **Command palette hint** (`⌘K` style)
- **macOS window controls** (red/yellow/green dots) for editor-like panels

### Background Pattern

```tsx
// Subtle grid overlay
className="bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]"
```

### Navigation Style

**Breadcrumbs:**
```
/ dashboard
/ project / mkekdo5g-4gboyig
```

**Sidebar items:**
```
[icon] dashboard    ⌘1
[icon] cvs          ⌘2
[icon] tracker      ⌘3
```

**Active state:**
```
bg-emerald-500/10 text-emerald-400 border border-emerald-500/20
```

### Example Code Snippets

**Header:**
```tsx
<header className="border-b border-neutral-800/80 px-4 py-3">
  <div className="flex items-center gap-2">
    <div className="h-7 w-7 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
      <Terminal className="h-3.5 w-3.5 text-emerald-400" />
    </div>
    <span className="font-mono text-sm font-medium text-neutral-300">specwright</span>
  </div>
  <div className="flex items-center gap-2 text-sm">
    <span className="text-neutral-500">/</span>
    <span className="text-neutral-400">project</span>
  </div>
</header>
```

**Terminal-style editor:**
```tsx
<Card className="bg-neutral-900/50 border-neutral-800">
  {/* macOS window controls */}
  <div className="flex gap-1.5">
    <div className="h-3 w-3 rounded-full bg-red-500/80" />
    <div className="h-3 w-3 rounded-full bg-amber-500/80" />
    <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
  </div>
  <span className="font-mono text-xs text-neutral-600">spec.md</span>
</Card>
```

### Status Indicators

**Chunk status:**
```
☑ completed  → emerald-400
○ pending    → neutral-500
◐ running    → amber-400
■ failed     → red-400
```

**System status:**
```tsx
<div className="flex items-center gap-2">
  <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" />
  <span className="text-[10px] font-mono text-emerald-400">services online</span>
</div>
```

---

## Phase 2: Multi-Spec Workflow (NEXT PRIORITY)

The core workflow for real usage: multiple specs per project, automated review, and git integration.

### Overview

```
Project
  └── Specs (multiple, independent)
        ├── Spec 1: "Add authentication"
        │     └── Chunks → Execute → Review → PR #1
        ├── Spec 2: "Add API endpoints"
        │     └── Chunks → Execute → Review → PR #2
        └── Spec 3: "Add tests"
              └── Chunks → In Progress...
```

**Key insight:** Each spec is a self-contained unit of work that becomes one PR.

---

### 1. Multiple Specs per Project

#### Current vs New Model

```
Current:  Project → Spec (one active)
New:      Project → Specs[] (many, each independent)
```

#### UI Changes

**Project Page Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back    Project: My API Backend              [+ New Spec]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SPECS                                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ● Add user authentication                    [PR #12]   │   │
│  │   5/5 chunks completed                       ✓ Done     │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ ◐ Add REST API endpoints                     [branch]   │   │
│  │   2/4 chunks completed                       Running    │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ ○ Add unit tests                                        │   │
│  │   0/0 chunks                                 Draft      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [+ New Spec]                                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Spec States:**
- `draft` - Created but not started (in Studio or no chunks)
- `ready` - Chunks generated, ready to execute
- `running` - Chunks being executed
- `review` - All chunks done, awaiting review
- `completed` - All chunks passed review
- `merged` - PR merged

#### Data Model Changes

```typescript
interface Spec {
  id: string;
  projectId: string;
  title: string;
  content: string;
  version: number;
  status: SpecStatus;           // NEW
  branchName?: string;          // NEW - git branch for this spec
  prNumber?: number;            // NEW - PR number if created
  prUrl?: string;               // NEW - PR URL
  createdAt: number;
  updatedAt: number;
}

type SpecStatus = 'draft' | 'ready' | 'running' | 'review' | 'completed' | 'merged';
```

#### Database Schema Changes

```sql
-- Add columns to specs table
ALTER TABLE specs ADD COLUMN status TEXT DEFAULT 'draft';
ALTER TABLE specs ADD COLUMN branch_name TEXT;
ALTER TABLE specs ADD COLUMN pr_number INTEGER;
ALTER TABLE specs ADD COLUMN pr_url TEXT;
```

#### API Changes

```
GET    /api/projects/[id]/specs         # List all specs for project
POST   /api/projects/[id]/specs         # Create new spec
GET    /api/specs/[id]                  # Get single spec with chunks
PUT    /api/specs/[id]                  # Update spec
DELETE /api/specs/[id]                  # Delete spec
```

---

### 2. Review Loop

After each chunk executes, Opus reviews the work automatically.

#### Flow

```
Chunk executes → GLM output captured →
    ↓
Opus reviews (output + file changes) →
    ↓
┌─────────────────────────────────────────┐
│  PASS        → Mark done, next chunk    │
│  NEEDS_FIX   → Create fix chunk, run it │
│  FAIL        → Stop, alert user         │
└─────────────────────────────────────────┘
```

#### Review Result Types

```typescript
interface ReviewResult {
  status: 'pass' | 'needs_fix' | 'fail';
  feedback: string;
  fixChunk?: {
    title: string;
    description: string;
  };
}
```

#### API Route

```
POST /api/chunks/[id]/review
```

**Request:** (none - uses chunk's output)

**Response:**
```json
{
  "status": "needs_fix",
  "feedback": "The login endpoint was created but password hashing is missing.",
  "fixChunk": {
    "title": "Add password hashing to login",
    "description": "Update the login endpoint to hash passwords using bcrypt before comparing..."
  }
}
```

#### Opus Review Prompt

```
You are reviewing the output of an AI coding assistant that just completed a task.

## Task
Title: {chunk.title}
Description: {chunk.description}

## Output from AI Assistant
{chunk.output}

## Your Job
Determine if the task was completed correctly.

Return JSON:
{
  "status": "pass" | "needs_fix" | "fail",
  "feedback": "Brief explanation of your assessment",
  "fixChunk": {  // Only include if status is "needs_fix"
    "title": "Short title for the fix",
    "description": "Detailed instructions to fix the issue"
  }
}

Rules:
- "pass" = Task completed correctly, no issues found
- "needs_fix" = Task partially done or has fixable issues
- "fail" = Task cannot be completed, fundamental problem
- Be specific in feedback
- Fix descriptions should be actionable
- Return ONLY valid JSON
```

#### UI Changes

**Execution Panel - Review Status:**
```
┌─────────────────────────────────────────────────────────────────┐
│  EXECUTION                                                      │
├─────────────────────────────────────────────────────────────────┤
│  Chunk: Add login endpoint                                      │
│  Status: Reviewing...                                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ✓ Execution complete                                    │   │
│  │ ◐ Opus reviewing...                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Review Result:                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ⚠ NEEDS_FIX                                             │   │
│  │                                                         │   │
│  │ Password hashing is missing. The login endpoint stores  │   │
│  │ passwords in plain text.                                │   │
│  │                                                         │   │
│  │ Fix chunk created: "Add password hashing"               │   │
│  │ [Run Fix] [Skip] [Mark as Done Anyway]                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### 3. Run All Chunks

Execute all chunks in a spec sequentially with automatic review.

#### Flow

```
"Run All" clicked →
    ↓
For each chunk (in order):
    Execute with GLM →
    Review with Opus →
    If pass: continue
    If needs_fix: run fix chunk, then continue
    If fail: stop
    ↓
All done → Update spec status → Offer PR creation
```

#### UI

**Spec Workspace:**
```
┌─────────────────────────────────────────────────────────────────┐
│  Spec: Add user authentication                    [Run All ▶]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CHUNKS                                        Progress: 2/5    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ✓ 1. Setup dependencies                     Passed      │   │
│  │ ✓ 2. Create user model                      Passed      │   │
│  │ ◐ 3. Add login endpoint                     Running     │   │
│  │ ○ 4. Add register endpoint                  Pending     │   │
│  │ ○ 5. Add auth middleware                    Pending     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Stop] [Skip Current] [Pause]                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### API Route

```
POST /api/specs/[id]/run-all
```

**Response:** SSE stream of execution events

```
event: chunk_start
data: {"chunkId": "...", "title": "Setup dependencies"}

event: chunk_complete
data: {"chunkId": "...", "output": "..."}

event: review_start
data: {"chunkId": "..."}

event: review_complete
data: {"chunkId": "...", "status": "pass", "feedback": "..."}

event: all_complete
data: {"specId": "...", "passed": 5, "failed": 0}
```

---

### 4. Git Integration (Per Spec)

Each spec gets its own branch and PR.

#### Flow

```
Spec created → Branch created (optional) →
    ↓
Chunks execute (all on branch) →
    ↓
All pass → "Create PR" button →
    ↓
PR created with spec title + description
```

#### Branch Naming

```
spec/{spec-id}-{slugified-title}
```

Example: `spec/abc123-add-user-authentication`

#### API Routes

```
POST /api/specs/[id]/git/branch    # Create branch for spec
POST /api/specs/[id]/git/commit    # Commit current changes
POST /api/specs/[id]/git/pr        # Create PR from spec
```

#### PR Template

```markdown
## {spec.title}

{spec.content}

---

### Chunks Completed
- [x] {chunk1.title}
- [x] {chunk2.title}
- [x] {chunk3.title}

### Generated by Spec-Driven Dev
```

#### UI

**After all chunks pass:**
```
┌─────────────────────────────────────────────────────────────────┐
│  ✓ All chunks completed successfully!                           │
│                                                                 │
│  Ready to create PR?                                            │
│                                                                 │
│  Branch: spec/abc123-add-user-authentication                    │
│  Commits: 5                                                     │
│  Files changed: 12                                              │
│                                                                 │
│  [Create PR] [Create Commit Only] [Skip]                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

### Implementation Plan

#### Day 1: Multi-Spec Foundation

| Task | Description | Files |
|------|-------------|-------|
| Add spec status columns | status, branch_name, pr_number, pr_url | `db.ts` schema |
| Update Spec type | Add new fields | `@specwright/shared` |
| Create specs list API | GET /api/projects/[id]/specs | `api/projects/[id]/specs/route.ts` |
| Create spec detail API | GET/PUT/DELETE /api/specs/[id] | `api/specs/[id]/route.ts` |
| Update project page | Show specs list, "New Spec" button | `app/project/[id]/page.tsx` |
| Create SpecCard component | Spec list item with status | `components/SpecCard.tsx` |

#### Day 2: Review Loop

| Task | Description | Files |
|------|-------------|-------|
| Create review API | POST /api/chunks/[id]/review | `api/chunks/[id]/review/route.ts` |
| Add Opus review prompt | Review template | Same file |
| Update ExecutionPanel | Show review status, fix options | `components/ExecutionPanel.tsx` |
| Handle fix chunks | Insert and run fix chunks | `hooks/useExecution.ts` |
| Add review state | Track review status per chunk | Update chunk status flow |

#### Day 3: Run All

| Task | Description | Files |
|------|-------------|-------|
| Create run-all API | POST /api/specs/[id]/run-all | `api/specs/[id]/run-all/route.ts` |
| Orchestration logic | Sequential execution with review | Same file |
| SSE events | Stream execution progress | Same file |
| Update spec workspace | "Run All" button, progress | `app/project/[id]/spec/[id]/page.tsx` |
| Add controls | Stop, skip, pause | Same file |

#### Day 4: Git Integration

| Task | Description | Files |
|------|-------------|-------|
| Create branch API | POST /api/specs/[id]/git/branch | `api/specs/[id]/git/branch/route.ts` |
| Create commit API | POST /api/specs/[id]/git/commit | `api/specs/[id]/git/commit/route.ts` |
| Create PR API | POST /api/specs/[id]/git/pr | `api/specs/[id]/git/pr/route.ts` |
| Completion UI | PR creation flow after all pass | `components/SpecComplete.tsx` |
| Update spec status | Track git state | `db.ts` |

---

### Acceptance Criteria

#### Multiple Specs
- [ ] Project page shows list of all specs
- [ ] "New Spec" opens Spec Studio for new spec
- [ ] Each spec shows status (draft/ready/running/completed)
- [ ] Click spec to view its workspace and chunks
- [ ] Specs are independent (own chunks, own branch)

#### Review Loop
- [ ] After chunk executes, review triggers automatically
- [ ] Review result shown in UI (pass/needs_fix/fail)
- [ ] Fix chunks auto-created and can be run
- [ ] User can skip review or mark done manually
- [ ] Review feedback stored with chunk

#### Run All
- [ ] "Run All" button executes chunks sequentially
- [ ] Progress shown (2/5 chunks)
- [ ] Stops on failure, shows which chunk failed
- [ ] Can stop/pause mid-execution
- [ ] Continues from where it stopped

#### Git Integration
- [ ] Each spec can have its own branch
- [ ] "Create PR" generates PR with spec content
- [ ] PR includes list of completed chunks
- [ ] Spec status updates to "merged" after PR merge
- [ ] Branch auto-created on first chunk execution (optional)

---

## Future Phases (Deferred)

### Phase 3: Visualization
- Graph view of chunks with dependencies
- Parallel execution support
- Click node to see details

### Phase 4: MCP Integration
- Project-level MCP server configuration
- Custom tools beyond file operations

### Phase 5: Advanced Features
- Project templates
- Team collaboration
- Usage analytics
