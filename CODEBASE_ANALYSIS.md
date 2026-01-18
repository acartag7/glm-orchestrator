# Specwright Codebase Analysis

**Generated:** 2026-01-18
**Purpose:** Comprehensive context document for LLM understanding

---

## 1. Executive Summary

### What is Specwright?

Specwright is a **web-based AI-assisted software development platform** that implements "spec-driven development" - a workflow where you:

1. Write specifications with AI (Claude Opus) assistance
2. Break specs into executable "chunks" (discrete tasks)
3. Execute chunks with an AI executor (GLM-4.7 via opencode)
4. Watch real-time progress via Server-Sent Events
5. Auto-review results with AI (Haiku/Opus)
6. Auto-commit to git and create PRs

**NOT** a Cursor/Windsurf/IDE competitor. It's a personal/team tool for structured AI-assisted development with full visibility into what the AI is doing.

### Current State

| Aspect | Status |
|--------|--------|
| **Development Phase** | Post-MVP, approaching dogfooding |
| **Maturity** | Alpha - functional but rough edges |
| **Codebase Size** | ~90 TypeScript files, ~15K lines |
| **Primary Use Case** | Building itself (dogfooding goal) |

### Key Technical Choices

| Layer | Technology | Why |
|-------|------------|-----|
| Frontend | Next.js 16, React 19, Tailwind 4 | Modern stack, SSR, good DX |
| Database | SQLite (better-sqlite3) | Simple, file-based, fast |
| AI Planning | Claude CLI (Opus) | Best reasoning for specs |
| AI Execution | opencode HTTP API (GLM-4.7) | Cost-effective for coding tasks |
| AI Review | Claude API (Haiku/Opus) | Tiered review strategy |
| Real-time | Server-Sent Events | Simple, built-in browser support |

---

## 2. Architecture Overview

### Package Structure

```
packages/
├── dashboard/     # Main Next.js web application (87 TS files)
│   ├── src/
│   │   ├── app/           # Next.js routes + API endpoints (49 routes)
│   │   ├── components/    # React components (34 files)
│   │   ├── hooks/         # Custom hooks (execution, projects, run-all, workers)
│   │   ├── lib/
│   │   │   ├── db/        # SQLite database layer (8 modules)
│   │   │   └── services/  # Core business logic (7 services)
│   │   └── contexts/      # React context providers
├── shared/        # Shared TypeScript types (4 files)
│   └── src/
│       ├── types.ts       # ~800 lines of type definitions
│       ├── schema.ts      # SQLite schema + migrations
│       ├── config.ts      # Project configuration types
│       └── index.ts       # Exports
└── mcp/           # Legacy MCP server (PAUSED - 24 files)
    └── src/
        ├── client/        # Claude CLI + opencode clients
        ├── execution/     # Legacy execution logic
        └── prompts/       # Prompt templates
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐│
│  │ Project List │  │ Spec Studio  │  │ Spec Editor  │  │ Execution Panel  ││
│  │   (home)     │  │  (wizard)    │  │ + Chunks     │  │ (live tool calls)││
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API ROUTES                                      │
│  /api/projects   /api/specs   /api/chunks   /api/workers   /api/queue       │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SERVICES                                        │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────────────┐ │
│  │ ChunkPipeline  │  │ ReviewService  │  │ SpecExecutionService           │ │
│  │ (orchestrates) │  │ (Haiku/Opus)   │  │ (run-all, git workflow)        │ │
│  └────────────────┘  └────────────────┘  └────────────────────────────────┘ │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────────────┐ │
│  │ ChunkExecutor  │  │ GitService     │  │ ValidationService              │ │
│  │ (opencode API) │  │ (branch/PR)    │  │ (file changes, build)          │ │
│  └────────────────┘  └────────────────┘  └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL SERVICES                               │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────────────┐ │
│  │ opencode       │  │ Claude CLI     │  │ Git / GitHub                   │ │
│  │ (GLM executor) │  │ (Opus planner) │  │ (version control)              │ │
│  │ localhost:4096 │  │ subprocess     │  │ gh CLI                         │ │
│  └────────────────┘  └────────────────┘  └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATABASE                                        │
│  SQLite: ~/.specwright/orchestrator.db                                       │
│  Tables: projects, specs, chunks, chunk_tool_calls, workers, worker_queue,  │
│          spec_studio_state, review_logs                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Domain Model

### Entity Relationships

```
Project
  │
  ├── has many → Specs (multiple independent specs per project)
  │                │
  │                ├── has many → Chunks (ordered, with dependencies)
  │                │                │
  │                │                └── has many → ChunkToolCalls (execution history)
  │                │
  │                └── has one → SpecStudioState (wizard persistence)
  │
  └── has config → ProjectConfig (executor, planner, reviewer settings)
```

### Key Types

```typescript
// Core entities
interface Project {
  id: string;
  name: string;
  directory: string;         // Working directory path
  description?: string;
  configJson?: string;       // JSON-serialized ProjectConfig
}

interface Spec {
  id: string;
  projectId: string;
  title: string;
  content: string;           // Markdown specification
  status: SpecStatus;        // draft | ready | running | review | completed | merged
  branchName?: string;       // Git branch for this spec
  prNumber?: number;         // GitHub PR number
  prUrl?: string;
}

interface Chunk {
  id: string;
  specId: string;
  title: string;
  description: string;       // Instructions for executor
  order: number;             // Execution order
  status: ChunkStatus;       // pending | running | completed | failed | cancelled
  dependencies?: string[];   // Array of chunk IDs this depends on
  output?: string;           // Executor output
  outputSummary?: string;    // Condensed summary for context passing
  reviewStatus?: ReviewStatus; // pass | needs_fix | fail | error | skipped
  reviewFeedback?: string;
}

// Status types
type SpecStatus = 'draft' | 'ready' | 'running' | 'review' | 'completed' | 'merged';
type ChunkStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
type ReviewStatus = 'pass' | 'needs_fix' | 'fail' | 'error' | 'skipped';
```

---

## 4. Key User Flows

### Flow 1: Spec Studio Wizard

The primary way users create specs:

```
Step 1: Intent
├── User describes what they want to build (plain text)
├── Minimum 20 characters required
└── Continue → triggers question generation

Step 2: Questions
├── Opus generates 3-6 clarifying questions
├── Question types: text, choice (radio), multiselect (checkbox)
├── User answers questions
└── Generate Spec → triggers spec generation

Step 3: Review
├── Opus generates full markdown spec from intent + answers
├── User can edit manually or request AI refinement
├── Refinement input → Opus improves spec
└── Looks Good → triggers chunk generation

Step 4: Config (optional)
├── Select executor (opencode/claude-code)
├── Select reviewer model (haiku/sonnet/opus)
├── Set max retry attempts
└── Continue

Step 5: Chunks
├── Opus suggests 4-8 implementation chunks
├── User can select/deselect, edit, reorder
├── Add custom chunks
├── Chunk detail level: minimal/standard/detailed
└── Create & Start → saves spec + creates chunks
```

### Flow 2: Run All (Spec Execution)

```
Click "Run All"
    │
    ├── Optional: Reset confirmation (clear previous progress)
    │
    ├── Initialize git workflow
    │   ├── Create branch: spec/{spec-slug}
    │   └── OR create worktree: ../project-spec-{shortId}/
    │
    └── For each chunk (respecting dependencies):
        │
        ├── ChunkPipeline.execute()
        │   ├── Build prompt with context from previous chunks
        │   ├── ChunkExecutor → opencode HTTP API
        │   │   └── SSE stream: tool calls, text, completion
        │   ├── ValidationService → check file changes, build
        │   ├── ReviewService → Haiku quick review (3 retries)
        │   └── GitService → commit if pass
        │
        ├── If review = "needs_fix"
        │   └── Create fix chunk, continue
        │
        ├── If review = "fail" or error
        │   └── Stop execution, alert user
        │
        └── Continue to next chunk
    │
    ├── All chunks pass → Final spec review (Opus)
    │
    └── Push branch + Create PR
```

### Flow 3: Single Chunk Execution

```
Click ▶ on chunk
    │
    ├── POST /api/chunks/[id]/run
    │
    ├── ChunkExecutor.execute()
    │   ├── Create opencode session
    │   ├── Send prompt with chunk description
    │   └── Stream tool calls via SSE
    │
    ├── GET /api/chunks/[id]/events (SSE subscription)
    │   └── Receive: tool_call, text, completion events
    │
    ├── Update chunk status: running → completed/failed
    │
    └── Optional: POST /api/chunks/[id]/review
```

---

## 5. Service Responsibilities

### ChunkPipeline (`lib/services/chunk-pipeline.ts`)
- **Purpose:** Orchestrates single chunk execution lifecycle
- **Flow:** Execute → Validate → Review → Commit
- **Key methods:**
  - `execute(chunkId, options)` - Full pipeline
  - `handleReviewResult(result)` - Process review outcome
- **Emits:** onExecutionStart, onToolCall, onReviewComplete, etc.

### SpecExecutionService (`lib/services/spec-execution-service.ts`)
- **Purpose:** Runs entire spec (all chunks) with git workflow
- **Key methods:**
  - `runAll(specId, options)` - Execute all chunks
  - `abort(specId)` - Stop execution
- **Features:**
  - Respects chunk dependencies
  - Creates/manages git branches or worktrees
  - Handles fix chunks for failed reviews
  - Final spec review before PR

### ChunkExecutor (`lib/services/chunk-executor.ts`)
- **Purpose:** Wraps opencode HTTP API calls
- **Key methods:**
  - `execute(chunkId, prompt, workingDir)` - Run chunk
  - `abort(chunkId)` - Cancel execution
- **Features:**
  - AbortController per execution
  - SSE streaming of tool calls
  - Timeout handling (15 min default)

### ReviewService (`lib/services/review-service.ts`)
- **Purpose:** AI-powered review of chunk outputs
- **Models:**
  - Chunk review: Haiku (fast, 3 retries, 3 min timeout)
  - Final review: Opus (thorough, 10 min timeout)
- **Returns:** pass | needs_fix | fail | error
- **Features:**
  - Rate limit detection and backoff
  - Parse error handling
  - Fix chunk generation for needs_fix

### GitService (`lib/services/git-service.ts`)
- **Purpose:** Git operations for spec workflow
- **Key methods:**
  - `initWorkflow(spec)` - Create branch or worktree
  - `commit(message)` - Commit current changes
  - `push()` - Push to remote
  - `createPR(spec)` - Create GitHub PR
  - `resetHard()` - Rollback on failure

### ValidationService (`lib/services/validation-service.ts`)
- **Purpose:** Validate chunk actually did something
- **Checks:**
  - File changes exist (git status)
  - Build succeeds (type check)
  - No breaking changes

### OpencodeManager (`lib/services/opencode-manager.ts`)
- **Purpose:** Manage opencode server lifecycle
- **Features:**
  - Auto-start on dashboard launch
  - Health monitoring (5s interval)
  - Auto-restart on crash (up to 3 attempts)

---

## 6. Database Schema

### Core Tables

```sql
-- Projects
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  directory TEXT NOT NULL,
  description TEXT,
  config_json TEXT,                    -- ProjectConfig as JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Specs (multiple per project)
CREATE TABLE specs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'draft',         -- draft/ready/running/review/completed/merged
  branch_name TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  original_branch TEXT,
  commit_hash TEXT,
  worktree_path TEXT,
  worktree_created_at INTEGER,
  final_review_status TEXT,
  final_review_feedback TEXT,
  final_review_attempts INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Chunks (ordered, with dependencies)
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  spec_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',       -- pending/running/completed/failed/cancelled
  output TEXT,
  output_summary TEXT,                 -- Condensed for context passing
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  review_status TEXT,                  -- pass/needs_fix/fail/error/skipped
  review_feedback TEXT,
  review_error TEXT,
  review_attempts INTEGER DEFAULT 0,
  dependencies TEXT,                   -- JSON array of chunk IDs
  commit_hash TEXT,
  FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE
);

-- Tool call history
CREATE TABLE chunk_tool_calls (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL,
  tool TEXT NOT NULL,                  -- read, write, edit, bash, etc.
  input TEXT NOT NULL,                 -- JSON
  output TEXT,
  status TEXT DEFAULT 'running',       -- running/completed/error
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

-- Spec Studio state (wizard persistence)
CREATE TABLE spec_studio_state (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  spec_id TEXT,
  step TEXT NOT NULL DEFAULT 'intent', -- intent/questions/review/config/chunks/complete
  intent TEXT DEFAULT '',
  questions TEXT DEFAULT '[]',         -- JSON array of Question objects
  answers TEXT DEFAULT '{}',           -- JSON object
  generated_spec TEXT DEFAULT '',
  suggested_chunks TEXT DEFAULT '[]',  -- JSON array
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, spec_id)
);

-- Workers (for parallel execution)
CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  spec_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT DEFAULT 'idle',          -- idle/running/paused/completed/failed
  current_chunk_id TEXT,
  current_step TEXT,
  progress_current INTEGER DEFAULT 0,
  progress_total INTEGER DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  error TEXT,
  FOREIGN KEY (spec_id) REFERENCES specs(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Review history
CREATE TABLE review_logs (
  id TEXT PRIMARY KEY,
  chunk_id TEXT,
  spec_id TEXT,
  review_type TEXT NOT NULL,           -- chunk/final
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  feedback TEXT,
  error_message TEXT,
  error_type TEXT,
  attempt_number INTEGER NOT NULL,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
```

---

## 7. API Endpoint Summary

### Projects (6 endpoints)
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create project
- `GET /api/projects/[id]` - Get project with active spec
- `PUT /api/projects/[id]` - Update project
- `DELETE /api/projects/[id]` - Delete project (cascades)
- `GET/PUT /api/projects/[id]/config` - Project configuration

### Specs (12 endpoints)
- `GET/PUT/DELETE /api/specs/[id]` - Spec CRUD
- `POST /api/specs/[id]/run-all` - Start execution (SSE stream)
- `DELETE /api/specs/[id]/run-all/abort` - Stop execution
- `POST /api/specs/[id]/refine` - Refine spec with Opus
- `GET /api/specs/[id]/review-logs` - Review history
- `POST /api/specs/[id]/git/branch|commit|pr` - Git operations

### Chunks (8 endpoints)
- `GET/PUT/DELETE /api/chunks/[id]` - Chunk CRUD
- `POST /api/chunks/[id]/run` - Execute chunk
- `POST /api/chunks/[id]/abort` - Cancel execution
- `POST /api/chunks/[id]/review` - Trigger review
- `GET /api/chunks/[id]/events` - SSE event stream
- `GET /api/chunks/[id]/dependencies` - Dependency info

### Spec Studio (5 endpoints)
- `GET /api/projects/[id]/studio` - Get/create wizard state
- `POST /api/projects/[id]/studio/questions` - Generate questions
- `POST /api/projects/[id]/studio/spec` - Generate spec
- `POST /api/projects/[id]/studio/chunks` - Generate chunks
- `POST /api/projects/[id]/studio/complete` - Finalize

### Workers (9 endpoints)
- `GET/POST /api/workers` - List/create workers
- `GET/PUT/DELETE /api/workers/[id]` - Worker CRUD
- `POST /api/workers/[id]/pause|resume` - Control
- `GET /api/workers/events` - SSE stream
- `GET/POST/PUT/DELETE /api/queue` - Queue management

---

## 8. What's Working Well

### Strengths

1. **Clean Type System**
   - Comprehensive types in shared package (~800 lines)
   - Well-organized with clear section headers
   - Proper workspace dependencies

2. **Robust Execution Pipeline**
   - Full lifecycle: execute → validate → review → commit
   - Dependency-aware execution order
   - Fix chunk generation for failed reviews
   - Automatic retry with exponential backoff

3. **Real-time Visibility**
   - SSE streaming of tool calls
   - Live progress tracking
   - Execution history persistence

4. **Git Integration**
   - Branch per spec workflow
   - Auto-commit on chunk success
   - Git worktree support for parallel specs
   - PR creation with spec content

5. **Spec Studio Wizard**
   - Guided spec creation (5 steps)
   - AI-generated clarifying questions
   - State persistence across sessions
   - Chunk suggestions with customization

6. **Dual Review Strategy**
   - Fast Haiku for chunk review (seconds)
   - Thorough Opus for final review (minutes)
   - Rate limit handling with backoff

7. **Security Patterns**
   - No string interpolation in shell commands
   - Path validation (home directory only)
   - Branch name sanitization

---

## 9. What Needs Work

### Known Issues (from EXECUTION-PLAN.md)

**Dogfooding Blockers:**
1. Uses alert()/confirm() instead of proper modals → ConfirmModal component exists but not used everywhere
2. Brittle Claude CLI path detection → Needs CLAUDE_PATH env var support
3. No "unsaved changes" warning in wizard → Data can be lost
4. No error boundaries → Crashes with no recovery
5. Race conditions in parallel run-all → Need serial execution
6. Delete errors silently swallowed → No user feedback

**Technical Debt:**
1. MCP package is "paused" but dashboard still depends on it
2. Large monolithic spec page component (~1000 lines)
3. 11+ database migration phases accumulated
4. Some type duplication between packages
5. Missing loading states in worker UI
6. EventSource reconnection not robust

### Code Quality Issues

```
Severity Distribution (35 issues found):
- Critical: 0
- High: 8
- Medium: 18
- Low: 9

Categories:
- Bugs: 10
- UX: 5
- Architecture: 5
- Integration: 3
- Database: 2
- Config: 2
```

---

## 10. Roadmap & Vision

### Near-term (Dogfooding)

**Phase A: Fix Blockers**
- Replace alert/confirm with ConfirmModal
- Add error boundaries
- Fix race conditions in run-all
- Add unsaved changes warnings

**Phase B: Stability**
- Max size for event buffers
- Remove dead code
- Add database indexes
- Environment variable configuration

### Medium-term (Self-improvement)

**Phase C: Configuration System**
- `.handoff/config.yaml` per project
- Executor/reviewer selection UI
- Per-spec configuration overrides

**Phase D: Analytics**
- Usage tracking per execution
- Cost tracking per model
- Performance metrics

### Long-term (Ralph Loop)

**Phase 5: Ralph Loop Integration**
The ultimate goal is iterative execution until genuinely complete:

```
while (iteration < maxIterations && status !== 'SHIP'):
    1. Build context (fresh, declarative)
    2. Execute chunk (GLM/Claude Code)
    3. Commit to branch (atomic unit)
    4. Review (Sonnet quick / Opus thorough)
    5. If SHIP: break, next chunk
    6. If REVISE:
       - git reset --hard (discard work)
       - Improve prompt with feedback
       - iteration++
```

**Key differences from current:**
- Loop until SHIP vs one fix attempt
- Discard and retry vs patch failures
- Fresh context each iteration vs accumulated conversation
- Structured review with specific checks vs generic prompts

### Planned Features

**ORC-61: Contract Generation**
- Generate explicit typed contracts from specs before chunking
- Define what each chunk creates vs consumes
- Explicit dependencies between chunks
- Feasibility checking with grep-based validation

**ORC-62: Assertion Enforcement**
- Pre-execution gate (block if dependencies not met)
- Context injection (pass available exports to executor)
- Post-execution validation (verify assertions)
- Context accumulation (record what was created)
- DSPy-inspired Assert/Suggest pattern

---

## 11. File Reference

### Key Files to Understand

| Purpose | File |
|---------|------|
| Type definitions | `packages/shared/src/types.ts` |
| Database schema | `packages/shared/src/schema.ts` |
| Chunk pipeline | `packages/dashboard/src/lib/services/chunk-pipeline.ts` |
| Spec execution | `packages/dashboard/src/lib/services/spec-execution-service.ts` |
| Chunk executor | `packages/dashboard/src/lib/services/chunk-executor.ts` |
| Review service | `packages/dashboard/src/lib/services/review-service.ts` |
| Git operations | `packages/dashboard/src/lib/services/git-service.ts` |
| Main spec page | `packages/dashboard/src/app/project/[id]/spec/[specId]/page.tsx` |
| Run-all hook | `packages/dashboard/src/hooks/useRunAll.ts` |
| MVP specification | `.handoff/spec-driven-dev-mvp.md` |
| Execution plan | `.handoff/EXECUTION-PLAN.md` |
| Ralph Loop spec | `.handoff/phase-5-ralph-loop-spec.md` |

### Spec Files (Roadmap)

```
.handoff/specs/
├── ORC-22-spec-editing.md         # Spec editing improvements
├── ORC-23-chunk-editing.md        # Chunk editing improvements
├── ORC-24-spec-templates.md       # Reusable spec templates
├── ORC-25-auto-chunking.md        # Automatic chunk generation
├── ORC-26-model-optimization.md   # Model selection per task
├── ORC-27-cli-interface.md        # CLI alternative to web UI
├── ORC-43-opencode-lifecycle.md   # Server auto-management
├── ORC-45-setup-wizard.md         # First-run setup
├── ORC-51-haiku-review-strategy.md # Dual-model review
├── ORC-56-dogfood-blockers.md     # Critical fixes
├── ORC-61-contract-generation.md  # Contract system
└── ORC-62-assertion-enforcement.md # Enforcement system
```

---

## 12. Commands & Development

```bash
# Development
pnpm install                              # Install dependencies
pnpm --filter @specwright/dashboard dev   # Run dashboard on :4740
pnpm build                                # Build all packages
pnpm test                                 # Run tests

# Dashboard requires opencode running
opencode                                  # Start on :4096

# Database location
~/.specwright/orchestrator.db
```

---

## 13. Summary for LLM Context

**When working on Specwright, understand that:**

1. **It's a spec-driven development tool** - not an IDE, not a chat interface, but a structured workflow for AI-assisted coding

2. **The core loop is:** Write Spec → Generate Chunks → Execute with GLM → Review with Haiku/Opus → Commit → PR

3. **Three AI models are used:**
   - Opus: Planning (spec generation, final review)
   - GLM-4.7: Execution (coding tasks via opencode)
   - Haiku: Quick review (fast chunk validation)

4. **Key services:**
   - ChunkPipeline orchestrates single chunk lifecycle
   - SpecExecutionService runs entire specs with git workflow
   - ReviewService handles AI-powered review with retry logic

5. **Current priority:** Get to dogfooding state by fixing blockers, then use the tool to build itself

6. **Future direction:** Ralph Loop pattern with contract generation and assertion enforcement

7. **Code conventions:**
   - Use pnpm, not npm/yarn
   - TypeScript strict mode
   - ConfirmModal for confirmations (never browser confirm())
   - spawnSync with arrays for shell commands (no string interpolation)
   - All database access through lib/db modules

8. **The MCP package is paused** - focus on dashboard package for active development
