# Haiku Review Strategy Implementation (ORC-51)

## Overview

This specification implements a dual-review strategy with automatic reviews for all chunk executions (both run-all and single chunk). Per-chunk reviews use lightweight Haiku for fast feedback, while a comprehensive Opus final review runs after all chunks complete. The final review blocks PR creation and can generate fix chunks if issues are found.

**Key behaviors:**
- Haiku review runs immediately after each chunk execution (blocking)
- Commit happens after each chunk passes review
- Final Opus review runs after all chunks complete
- Final review blocks PR creation until it passes
- Final review can create fix chunks if integration issues found
- Single chunk execution also triggers automatic review (same as run-all)

**Architecture refactor:** This spec also decouples the monolithic `run-all/route.ts` (967 lines) into focused services.

## Current State Analysis

### Problems with Current Architecture

1. **run-all/route.ts is a 967-line monolith** doing 6 jobs:
   - HTTP/SSE handling
   - Git workflow (worktree, branch, commit, push, PR)
   - Chunk orchestration (dependency resolution)
   - Validation (file changes, build)
   - Review (Claude call, parse result)
   - Fix chunk creation and retry

2. **Two different flows for running a chunk:**
   - Run All: automatic validation → review → commit
   - Single Chunk: execution only, manual review later

3. **Review logic duplicated:**
   - `run-all/route.ts` lines 490-555 (automatic)
   - `app/api/chunks/[id]/review/route.ts` (manual)

4. **No final spec review** - only per-chunk reviews exist

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    FRONTEND                                              │
│  page.tsx ──→ useRunAll.ts ──→ POST /api/specs/[id]/run-all                             │
│  page.tsx ──→ useExecution.ts ──→ POST /api/chunks/[id]/run                             │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        API Routes (THIN - HTTP handling only)                            │
│                                                                                          │
│  run-all/route.ts (~100 lines)          chunks/[id]/run/route.ts (~50 lines)            │
│  - Create SSE stream                     - Call chunkPipeline.execute()                  │
│  - Call specExecutionService.runAll()    - Return result                                 │
│  - Forward events to SSE                                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                    │                                    │
                    ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                     spec-execution-service.ts (ORCHESTRATOR)                             │
│                                                                                          │
│  runAll(specId, eventEmitter):                                                          │
│    1. gitService.initWorkflow() - setup branch/worktree                                 │
│    2. For each chunk (respecting dependencies):                                          │
│       └── chunkPipeline.execute(chunkId, gitDir)                                        │
│    3. reviewService.reviewSpecFinal(specId) - comprehensive review                      │
│    4. If final review passes: gitService.pushAndCreatePR()                              │
│    5. If final review needs fixes: create fix chunks, re-run                            │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                         chunk-pipeline.ts (SINGLE CHUNK FLOW)                            │
│                                                                                          │
│  execute(chunkId, gitDir?):                                                             │
│    1. chunkExecutor.run(chunkId) ──→ OpenCode/GLM execution                             │
│    2. validationService.validate(chunkId, gitDir)                                       │
│    3. reviewService.reviewChunk(chunkId) ──→ Haiku review                               │
│    4. If review passes && gitDir: gitService.commit(chunkId)                            │
│    5. If review needs_fix: create fix chunk, return for retry                           │
│    6. Return result                                                                      │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
           │                    │                    │                    │
           ▼                    ▼                    ▼                    ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ chunk-executor.ts│ │ review-service.ts│ │  git-service.ts  │ │validation-svc.ts │
│                  │ │                  │ │                  │ │                  │
│ (existing        │ │ reviewChunk()    │ │ initWorkflow()   │ │ validate()       │
│  execution.ts    │ │ reviewSpecFinal()│ │ commit()         │ │ - checkFiles()   │
│  refactored)     │ │ createFixChunks()│ │ resetHard()      │ │ - runBuild()     │
│                  │ │                  │ │ pushAndCreatePR()│ │                  │
│ - OpenCode API   │ │ Uses config for: │ │                  │ │                  │
│ - Tool calls     │ │ - chunkModel     │ │ Uses git.ts      │ │ Uses existing    │
│ - Timeout        │ │ - finalModel     │ │ utility functions│ │ review-validation│
│                  │ │ - timeouts       │ │                  │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │   review.ts      │
                     │ (pure functions) │
                     │                  │
                     │ buildChunkPrompt │
                     │ buildFinalPrompt │
                     │ parseResult()    │
                     │ detectRateLimit()│
                     │ retryWithBackoff │
                     └──────────────────┘
```

## File Structure

```
packages/dashboard/src/lib/
├── services/
│   ├── spec-execution-service.ts    # Orchestrates run-all flow
│   ├── chunk-pipeline.ts            # Single chunk: execute → validate → review → commit
│   ├── chunk-executor.ts            # Refactored from execution.ts (raw OpenCode execution)
│   ├── review-service.ts            # Haiku chunk review, Opus final review
│   ├── git-service.ts               # Git workflow (branch, commit, push, PR)
│   └── validation-service.ts        # File changes, build validation
├── review.ts                        # Pure review functions (prompts, parsing, retry)
├── git.ts                           # Keep existing utility functions
├── review-validation.ts             # Keep existing (used by validation-service)
└── execution.ts                     # DEPRECATED - migrate to chunk-executor.ts
```

## Requirements

### 1. Configuration (`packages/shared/src/config.ts`)

1.1. Extend `ReviewerConfig` interface:

```typescript
export interface ReviewerConfig {
  // Legacy fields (kept for backwards compat)
  type: 'sonnet-quick' | 'opus-thorough';
  cliPath?: string;
  autoApprove?: boolean;

  // New fields for dual-review strategy
  chunkModel?: 'haiku' | 'sonnet';         // Default: 'haiku'
  finalModel?: 'opus' | 'sonnet';          // Default: 'opus'
  chunkTimeout?: number;                    // Default: 180000 (3 min)
  finalTimeout?: number;                    // Default: 600000 (10 min)
  maxRetries?: number;                      // Default: 3
  retryBackoffMs?: number;                  // Default: 2000
  finalReviewMaxFixAttempts?: number;       // Default: 2 (how many fix rounds for final review)
}
```

1.2. Update `DEFAULT_PROJECT_CONFIG.reviewer`:

```typescript
reviewer: {
  type: 'sonnet-quick',
  cliPath: 'claude',
  autoApprove: false,
  chunkModel: 'haiku',
  finalModel: 'opus',
  chunkTimeout: 180000,      // 3 minutes
  finalTimeout: 600000,      // 10 minutes
  maxRetries: 3,
  retryBackoffMs: 2000,
  finalReviewMaxFixAttempts: 2
}
```

1.3. Add model ID constants:

```typescript
export const CLAUDE_MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
  opus: 'claude-opus-4-5-20251101'
} as const;
```

### 2. Database Schema Changes

2.1. Add/verify columns on `chunks` table:
   - `review_status TEXT DEFAULT 'pending'` - Values: pending, reviewing, pass, fail, needs_fix, error, skipped
   - `review_feedback TEXT` - Review feedback
   - `review_error TEXT` - Error message if review failed
   - `review_attempts INTEGER DEFAULT 0` - Retry count

2.2. Add columns to `specs` table:
   - `final_review_status TEXT DEFAULT 'pending'` - Values: pending, reviewing, pass, fail, needs_fix, error
   - `final_review_feedback TEXT` - Opus final review feedback
   - `final_review_attempts INTEGER DEFAULT 0` - How many fix rounds attempted

2.3. Ensure `review_logs` table exists:

```sql
CREATE TABLE IF NOT EXISTS review_logs (
  id TEXT PRIMARY KEY,
  chunk_id TEXT,
  spec_id TEXT,
  review_type TEXT NOT NULL,        -- 'chunk' | 'final'
  model TEXT NOT NULL,              -- 'haiku' | 'sonnet' | 'opus'
  status TEXT NOT NULL,             -- 'pass' | 'fail' | 'needs_fix' | 'error'
  feedback TEXT,
  error_message TEXT,
  error_type TEXT,                  -- 'rate_limit' | 'timeout' | 'parse_error' | 'unknown'
  attempt_number INTEGER NOT NULL,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
  FOREIGN KEY (spec_id) REFERENCES specs(id) ON DELETE CASCADE
);
```

### 3. Review Library (`packages/dashboard/src/lib/review.ts`)

Pure functions for review logic (no side effects, testable):

3.1. Types:

```typescript
export type ReviewStatus = 'pending' | 'reviewing' | 'pass' | 'fail' | 'needs_fix' | 'error' | 'skipped';
export type ErrorType = 'rate_limit' | 'timeout' | 'parse_error' | 'unknown';

export interface ChunkReviewResult {
  status: 'pass' | 'fail' | 'needs_fix' | 'error';
  feedback?: string;
  fixChunk?: { title: string; description: string };
  error?: string;
  errorType?: ErrorType;
}

export interface FinalReviewResult {
  status: 'pass' | 'fail' | 'needs_fix' | 'error';
  feedback: string;
  integrationIssues?: string[];
  missingRequirements?: string[];
  fixChunks?: Array<{ title: string; description: string }>;
  error?: string;
  errorType?: ErrorType;
}

export interface ReviewConfig {
  model: string;
  timeout: number;
  maxRetries: number;
  retryBackoffMs: number;
  cliPath: string;
}
```

3.2. Functions:

```typescript
// Prompts
export function buildChunkReviewPrompt(chunk: Chunk, spec: Spec): string;
export function buildFinalReviewPrompt(spec: Spec, chunks: Chunk[]): string;

// Parsing
export function parseChunkReviewResult(output: string): ChunkReviewResult | null;
export function parseFinalReviewResult(output: string): FinalReviewResult | null;

// Error detection
export function detectRateLimit(error: unknown): boolean;
export function classifyError(error: unknown): ErrorType;

// Retry logic
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: { maxRetries: number; backoffMs: number; onRetry?: (attempt: number, error: unknown) => void }
): Promise<T>;

// Claude execution wrapper
export async function executeReview(
  prompt: string,
  config: ReviewConfig
): Promise<{ success: boolean; output: string; error?: string }>;
```

### 4. Review Service (`packages/dashboard/src/lib/services/review-service.ts`)

Orchestrates review execution with DB updates and logging:

```typescript
export class ReviewService {
  constructor(private config: ReviewerConfig) {}

  /**
   * Review a single chunk with Haiku
   * - Updates chunk.review_status to 'reviewing' immediately
   * - Executes review with retry logic
   * - Updates chunk with results
   * - Logs to review_logs table
   */
  async reviewChunk(chunkId: string): Promise<ChunkReviewResult>;

  /**
   * Final review of entire spec with Opus
   * - Reviews integration, completeness, quality
   * - Can return fix chunks if issues found
   * - Updates spec.final_review_status
   * - Logs to review_logs table
   */
  async reviewSpecFinal(specId: string): Promise<FinalReviewResult>;

  /**
   * Create fix chunks based on final review feedback
   * Returns array of created chunk IDs
   */
  async createFixChunks(
    specId: string,
    fixes: Array<{ title: string; description: string }>
  ): Promise<string[]>;
}

export const reviewService = new ReviewService(/* config from project */);
```

### 5. Git Service (`packages/dashboard/src/lib/services/git-service.ts`)

Encapsulates all git operations:

```typescript
export interface GitWorkflowState {
  enabled: boolean;
  projectDir: string;
  workingDir: string;           // worktree path or project dir
  isWorktree: boolean;
  originalBranch: string | null;
  specBranch: string | null;
}

export class GitService {
  /**
   * Initialize git workflow for a spec
   * - Check if git repo
   * - Create worktree or branch
   * - Return workflow state
   */
  async initWorkflow(specId: string, projectDir: string): Promise<GitWorkflowState>;

  /**
   * Commit changes for a chunk
   */
  async commitChunk(
    state: GitWorkflowState,
    chunkId: string,
    chunkTitle: string,
    chunkIndex: number
  ): Promise<{ success: boolean; commitHash?: string; error?: string }>;

  /**
   * Reset working directory (discard changes)
   */
  resetHard(state: GitWorkflowState): void;

  /**
   * Push branch and create PR
   * Only called after final review passes
   */
  async pushAndCreatePR(
    state: GitWorkflowState,
    spec: Spec,
    passedChunks: number
  ): Promise<{ success: boolean; prUrl?: string; prNumber?: number; error?: string }>;

  /**
   * Cleanup - switch back to original branch if not using worktree
   */
  async cleanup(state: GitWorkflowState): Promise<void>;
}

export const gitService = new GitService();
```

### 6. Validation Service (`packages/dashboard/src/lib/services/validation-service.ts`)

Wraps existing validation logic:

```typescript
export class ValidationService {
  /**
   * Validate chunk completion
   * - Check files changed
   * - Run build
   * - Return auto-fail if no changes or build failed
   */
  async validate(
    chunkId: string,
    workingDir: string
  ): Promise<{
    valid: boolean;
    filesChanged: number;
    buildSuccess: boolean;
    autoFail?: { reason: 'no_changes' | 'build_failed'; feedback: string };
  }>;
}

export const validationService = new ValidationService();
```

### 7. Chunk Executor (`packages/dashboard/src/lib/services/chunk-executor.ts`)

Refactored from `execution.ts` - handles raw OpenCode execution only:

```typescript
export interface ExecutionResult {
  status: 'completed' | 'failed' | 'cancelled';
  output?: string;
  error?: string;
}

export class ChunkExecutor {
  /**
   * Execute a chunk via OpenCode
   * - Create session
   * - Send prompt
   * - Handle tool calls
   * - Return when complete
   */
  async execute(
    chunkId: string,
    onToolCall?: (toolCall: ChunkToolCall) => void,
    onText?: (text: string) => void
  ): Promise<ExecutionResult>;

  /**
   * Abort running execution
   */
  async abort(chunkId: string): Promise<void>;

  /**
   * Check if chunk is currently executing
   */
  isRunning(chunkId: string): boolean;
}

export const chunkExecutor = new ChunkExecutor();
```

### 8. Chunk Pipeline (`packages/dashboard/src/lib/services/chunk-pipeline.ts`)

Orchestrates the full chunk flow (execute → validate → review → commit):

```typescript
export interface ChunkPipelineResult {
  status: 'pass' | 'fail' | 'needs_fix' | 'error' | 'cancelled';
  output?: string;
  reviewFeedback?: string;
  commitHash?: string;
  fixChunkId?: string;
  error?: string;
}

export interface ChunkPipelineEvents {
  onExecutionStart?: (chunkId: string) => void;
  onExecutionComplete?: (chunkId: string, output: string) => void;
  onToolCall?: (chunkId: string, toolCall: ChunkToolCall) => void;
  onValidationStart?: (chunkId: string) => void;
  onValidationComplete?: (chunkId: string, result: ValidationResult) => void;
  onReviewStart?: (chunkId: string) => void;
  onReviewComplete?: (chunkId: string, result: ChunkReviewResult) => void;
  onCommit?: (chunkId: string, commitHash: string) => void;
  onError?: (chunkId: string, error: string) => void;
}

export class ChunkPipeline {
  /**
   * Execute full chunk pipeline:
   * 1. Execute chunk via OpenCode
   * 2. Validate (if gitState provided)
   * 3. Review with Haiku
   * 4. Commit (if review passes and gitState provided)
   * 5. Create fix chunk (if review returns needs_fix)
   */
  async execute(
    chunkId: string,
    gitState?: GitWorkflowState,
    events?: ChunkPipelineEvents
  ): Promise<ChunkPipelineResult>;
}

export const chunkPipeline = new ChunkPipeline();
```

### 9. Spec Execution Service (`packages/dashboard/src/lib/services/spec-execution-service.ts`)

Top-level orchestrator for run-all:

```typescript
export interface SpecExecutionEvents extends ChunkPipelineEvents {
  onSpecStart?: (specId: string, totalChunks: number) => void;
  onChunkStart?: (chunkId: string, index: number, total: number) => void;
  onChunkComplete?: (chunkId: string, result: ChunkPipelineResult) => void;
  onFixChunkStart?: (chunkId: string, originalChunkId: string) => void;
  onDependencyBlocked?: (chunkId: string, blockedBy: string, reason: string) => void;
  onWorktreeCreated?: (path: string, branch: string) => void;
  onGitReset?: (chunkId: string, reason: string) => void;
  onFinalReviewStart?: (specId: string) => void;
  onFinalReviewComplete?: (specId: string, result: FinalReviewResult) => void;
  onPRCreated?: (url: string, number: number) => void;
  onSpecComplete?: (specId: string, passed: number, failed: number, prUrl?: string) => void;
  onSpecStopped?: (specId: string, reason: string) => void;
}

export class SpecExecutionService {
  /**
   * Run all chunks in a spec
   *
   * Flow:
   * 1. Initialize git workflow (worktree or branch)
   * 2. For each chunk (respecting dependencies):
   *    - Execute chunk pipeline
   *    - If fails: reset git, cancel dependents, stop
   *    - If needs_fix: run fix chunk, then continue
   * 3. After all chunks: run final Opus review
   * 4. If final review needs fixes:
   *    - Create fix chunks
   *    - Run them
   *    - Re-run final review (up to maxFixAttempts)
   * 5. If final review passes: push and create PR
   * 6. Cleanup git state
   */
  async runAll(specId: string, events: SpecExecutionEvents): Promise<void>;

  /**
   * Abort running execution
   */
  abort(specId: string): void;

  /**
   * Check if spec is currently running
   */
  isRunning(specId: string): boolean;
}

export const specExecutionService = new SpecExecutionService();
```

### 10. API Route Updates

#### 10.1. `run-all/route.ts` (Slim down to ~100 lines)

```typescript
export async function POST(request: Request, context: RouteContext) {
  const { id: specId } = await context.params;

  // Validate spec exists
  const spec = getSpec(specId);
  if (!spec) {
    return new Response(JSON.stringify({ error: 'Spec not found' }), { status: 404 });
  }

  // Check not already running
  if (specExecutionService.isRunning(specId)) {
    return new Response(JSON.stringify({ error: 'Already running' }), { status: 409 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (type: string, data: object) => {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Map service events to SSE
      const events: SpecExecutionEvents = {
        onSpecStart: (id, total) => sendEvent('spec_start', { specId: id, total }),
        onChunkStart: (id, index, total) => sendEvent('chunk_start', { chunkId: id, index, total }),
        onToolCall: (id, tc) => sendEvent('tool_call', { chunkId: id, toolCall: tc }),
        onChunkComplete: (id, result) => sendEvent('chunk_complete', { chunkId: id, ...result }),
        // ... map all events
        onSpecComplete: (id, passed, failed, prUrl) => {
          sendEvent('all_complete', { specId: id, passed, failed, prUrl });
          controller.close();
        },
      };

      await specExecutionService.runAll(specId, events);
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
```

#### 10.2. `chunks/[id]/run/route.ts` (Add automatic review)

```typescript
export async function POST(request: Request, context: RouteContext) {
  const { id: chunkId } = await context.params;

  // Get chunk and related data
  const chunk = getChunk(chunkId);
  if (!chunk) {
    return new Response(JSON.stringify({ error: 'Chunk not found' }), { status: 404 });
  }

  const spec = getSpec(chunk.specId);
  const project = getProject(spec.projectId);

  // Initialize git state if git repo
  let gitState: GitWorkflowState | undefined;
  if (project && checkGitRepo(project.directory)) {
    gitState = await gitService.initWorkflow(spec.id, project.directory);
  }

  // Run full pipeline (execute → validate → review → commit)
  const result = await chunkPipeline.execute(chunkId, gitState);

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### 11. Final Review Flow

The final review is critical - it blocks PR creation and can create fix chunks:

```typescript
// In spec-execution-service.ts, after all chunks complete:

async function runFinalReview(specId: string, events: SpecExecutionEvents): Promise<boolean> {
  const config = getProjectConfig(specId);
  let attempts = 0;
  const maxAttempts = config.reviewer.finalReviewMaxFixAttempts ?? 2;

  while (attempts <= maxAttempts) {
    events.onFinalReviewStart?.(specId);

    const result = await reviewService.reviewSpecFinal(specId);

    events.onFinalReviewComplete?.(specId, result);

    if (result.status === 'pass') {
      return true; // Success - can create PR
    }

    if (result.status === 'error') {
      // Review failed technically - log and allow PR with warning
      console.error(`[FinalReview] Error: ${result.error}`);
      updateSpec(specId, { finalReviewStatus: 'error', finalReviewFeedback: result.error });
      return true; // Allow PR but with warning
    }

    if (result.status === 'needs_fix' && result.fixChunks && attempts < maxAttempts) {
      // Create and run fix chunks
      const fixChunkIds = await reviewService.createFixChunks(specId, result.fixChunks);

      for (const fixChunkId of fixChunkIds) {
        const fixResult = await chunkPipeline.execute(fixChunkId, gitState, events);
        if (fixResult.status !== 'pass') {
          // Fix chunk failed - stop
          return false;
        }
      }

      attempts++;
      continue; // Re-run final review
    }

    // fail or needs_fix with no more attempts
    updateSpec(specId, { finalReviewStatus: 'fail', finalReviewFeedback: result.feedback });
    return false;
  }

  return false;
}
```

### 12. Logging

All services use consistent logging:

```typescript
// Review events
console.log(`[Review] Starting ${type} review for ${target} with ${model}`);
console.log(`[Review] ${target} review ${status}`);
console.log(`[Review] Retry ${attempt}/${max} for ${target}: ${reason}`);
console.error(`[Review] ${target} review failed: ${error}`);
console.warn(`[Review] Rate limit detected for ${target}`);

// Execution events
console.log(`[Execution] Starting chunk: ${chunkTitle}`);
console.log(`[Execution] Chunk ${chunkId} ${status}`);

// Git events
console.log(`[Git] Created worktree at ${path}`);
console.log(`[Git] Committed chunk ${chunkId}: ${commitHash}`);
console.log(`[Git] Reset to HEAD`);
console.log(`[Git] Created PR: ${prUrl}`);
```

## Unit Tests

### Test Files to Create

```
packages/dashboard/src/lib/__tests__/
├── review.test.ts                    # Pure function tests
├── services/
│   ├── review-service.test.ts        # Review service tests
│   ├── git-service.test.ts           # Git service tests
│   ├── validation-service.test.ts    # Validation service tests
│   ├── chunk-pipeline.test.ts        # Pipeline integration tests
│   └── spec-execution-service.test.ts # Full flow tests
```

### Test Coverage Requirements

#### 1. review.ts (Pure Functions)

```typescript
describe('buildChunkReviewPrompt', () => {
  it('includes chunk title and description');
  it('includes relevant spec context');
  it('requests pass/fail/needs_fix assessment');
});

describe('buildFinalReviewPrompt', () => {
  it('includes full spec content');
  it('includes all chunk summaries');
  it('requests integration assessment');
});

describe('parseChunkReviewResult', () => {
  it('parses valid JSON response');
  it('extracts status from markdown code block');
  it('handles malformed responses gracefully');
  it('returns null for unparseable output');
});

describe('parseFinalReviewResult', () => {
  it('parses fix chunks array');
  it('extracts integration issues');
  it('handles missing optional fields');
});

describe('detectRateLimit', () => {
  it('detects 429 status code');
  it('detects "rate limit" in error message (case insensitive)');
  it('returns false for other errors');
});

describe('retryWithBackoff', () => {
  it('succeeds on first try');
  it('retries on failure up to maxRetries');
  it('applies exponential backoff');
  it('calls onRetry callback');
  it('throws after max retries exhausted');
});
```

#### 2. review-service.test.ts

```typescript
describe('ReviewService', () => {
  describe('reviewChunk', () => {
    it('updates chunk status to reviewing');
    it('calls Claude with correct model');
    it('updates chunk with review result');
    it('logs to review_logs table');
    it('retries on failure');
    it('handles rate limits gracefully');
  });

  describe('reviewSpecFinal', () => {
    it('updates spec status to reviewing');
    it('calls Claude with Opus model');
    it('includes all chunk summaries in prompt');
    it('returns fix chunks when needed');
    it('handles timeout gracefully');
  });

  describe('createFixChunks', () => {
    it('creates chunks with correct order');
    it('links to spec correctly');
    it('returns chunk IDs');
  });
});
```

#### 3. git-service.test.ts

```typescript
describe('GitService', () => {
  describe('initWorkflow', () => {
    it('creates worktree when available');
    it('falls back to branch when worktree fails');
    it('returns disabled state for non-git repos');
  });

  describe('commitChunk', () => {
    it('stages and commits changes');
    it('returns commit hash');
    it('handles no changes gracefully');
    it('uses safe command execution');
  });

  describe('resetHard', () => {
    it('resets to HEAD');
    it('logs reset action');
  });

  describe('pushAndCreatePR', () => {
    it('pushes branch to remote');
    it('creates PR with correct body');
    it('returns PR URL and number');
    it('handles gh CLI not available');
  });
});
```

#### 4. chunk-pipeline.test.ts

```typescript
describe('ChunkPipeline', () => {
  describe('execute', () => {
    it('runs full pipeline: execute → validate → review → commit');
    it('emits events at each stage');
    it('stops on execution failure');
    it('stops on validation failure');
    it('creates fix chunk on needs_fix');
    it('commits only on review pass');
    it('works without git state');
  });
});
```

#### 5. spec-execution-service.test.ts

```typescript
describe('SpecExecutionService', () => {
  describe('runAll', () => {
    it('runs chunks in dependency order');
    it('cancels dependents on failure');
    it('runs final review after all chunks');
    it('creates fix chunks from final review');
    it('retries final review up to maxAttempts');
    it('creates PR only after final review passes');
    it('handles abort correctly');
  });
});
```

### Mocking Strategy

```typescript
// Mock ClaudeClient
jest.mock('@specwright/mcp/client', () => ({
  ClaudeClient: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({
      success: true,
      output: '{"status": "pass", "feedback": "Good work"}',
    }),
  })),
}));

// Mock database operations
jest.mock('../db', () => ({
  getChunk: jest.fn(),
  updateChunk: jest.fn(),
  getSpec: jest.fn(),
  updateSpec: jest.fn(),
  insertReviewLog: jest.fn(),
}));

// Mock git operations
jest.mock('../git', () => ({
  gitSync: jest.fn().mockReturnValue({ status: 0, stdout: '' }),
  createCommit: jest.fn().mockResolvedValue({ success: true, commitHash: 'abc123' }),
}));
```

---

## Impact Analysis

### Tickets to CLOSE (fixed by ORC-51 refactor)

| Ticket | Title | Why Closed |
|--------|-------|------------|
| ORC-6 | Run-all doesn't auto-continue | Already works, but `spec-execution-service` ensures this |
| ORC-7 | Git commit after chunk | Already done in ORC-21, but `git-service` consolidates |
| ORC-8 | Git reset on chunk failure | Already done in ORC-21, but `git-service` consolidates |
| ORC-9 | Spec status stuck as in_progress | Fixed by `spec-execution-service` status management |
| ORC-26 | Model optimization | **MERGE into ORC-51** - config handles Haiku/Sonnet/Opus selection |

### Tickets BLOCKED BY ORC-51 (add dependency)

| Ticket | Title | Why Blocked |
|--------|-------|-------------|
| ORC-19 | Can't see review outputs in UI | Needs new review status fields from ORC-51 |
| ORC-20 | needs_fix status unclear | Needs review service fix chunk creation from ORC-51 |
| ORC-39 | No visual indication when review fails | Needs review_error field from ORC-51 |
| ORC-52 | Show review warnings in UI | Already marked dependent |

### Tickets NOT AFFECTED

| Ticket | Title | Why |
|--------|-------|-----|
| ORC-11 | No completion notification | UI concern, can be done independently |
| ORC-35 | SSE cleanup race condition | Different layer (frontend hook) |
| ORC-38 | No unit tests for useRunAll | Frontend tests, not affected |

### Clarifications

1. **ORC-7 (Git commit)**: Status is "Backlog" but functionality was implemented in ORC-21. Should be closed as duplicate.

2. **validation-service.ts vs review-validation.ts**:
   - `review-validation.ts` = existing pure functions (file changes, build check)
   - `validation-service.ts` = new service wrapper that uses review-validation.ts and handles DB updates

3. **Final review creates fix chunks**: Yes, up to `finalReviewMaxFixAttempts` (default 2) rounds.

4. **Single chunk execution**: Now uses same `chunk-pipeline` as run-all, so gets automatic review.

---

## Chunked Implementation (Separate Sessions)

Each chunk is a self-contained session that can be reviewed independently.

### Chunk 1: Configuration & Types
**Files:** `packages/shared/src/config.ts`, `packages/shared/src/index.ts`
**Tests:** Type checks only
**Prompt:**
```
Add reviewer config fields to config.ts:
- chunkModel: 'haiku' | 'sonnet' (default haiku)
- finalModel: 'opus' | 'sonnet' (default opus)
- chunkTimeout: number (default 180000)
- finalTimeout: number (default 600000)
- maxRetries: number (default 3)
- retryBackoffMs: number (default 2000)
- finalReviewMaxFixAttempts: number (default 2)

Add CLAUDE_MODELS constant with model IDs.
Update DEFAULT_PROJECT_CONFIG with new fields.
```

### Chunk 2: Database Schema
**Files:** `packages/dashboard/src/lib/db/connection.ts`, `packages/shared/src/schema.ts`
**Tests:** Migration tests
**Prompt:**
```
Add database columns:
- chunks: review_error TEXT, review_attempts INTEGER DEFAULT 0
- specs: final_review_status TEXT DEFAULT 'pending', final_review_feedback TEXT, final_review_attempts INTEGER DEFAULT 0

Ensure review_logs table exists with all columns.
Follow existing migration patterns.
```

### Chunk 3: Review Pure Functions
**Files:** `packages/dashboard/src/lib/review.ts`
**Tests:** `packages/dashboard/src/lib/__tests__/review.test.ts`
**Prompt:**
```
Create review.ts with pure functions:
- buildChunkReviewPrompt(chunk, spec)
- buildFinalReviewPrompt(spec, chunks)
- parseChunkReviewResult(output)
- parseFinalReviewResult(output)
- detectRateLimit(error)
- classifyError(error)
- retryWithBackoff(fn, config)
- executeReview(prompt, config)

Write comprehensive unit tests for each function.
```

### Chunk 4: Git Service
**Files:** `packages/dashboard/src/lib/services/git-service.ts`
**Tests:** `packages/dashboard/src/lib/__tests__/services/git-service.test.ts`
**Prompt:**
```
Create git-service.ts wrapping existing git.ts:
- initWorkflow(specId, projectDir) → GitWorkflowState
- commitChunk(state, chunkId, title, index) → CommitResult
- resetHard(state)
- pushAndCreatePR(state, spec, passedChunks) → PRResult
- cleanup(state)

Write unit tests with mocked git.ts functions.
```

### Chunk 5: Validation Service
**Files:** `packages/dashboard/src/lib/services/validation-service.ts`
**Tests:** `packages/dashboard/src/lib/__tests__/services/validation-service.test.ts`
**Prompt:**
```
Create validation-service.ts wrapping review-validation.ts:
- validate(chunkId, workingDir) → ValidationResult

Write unit tests with mocked review-validation.ts.
```

### Chunk 6: Review Service
**Files:** `packages/dashboard/src/lib/services/review-service.ts`
**Tests:** `packages/dashboard/src/lib/__tests__/services/review-service.test.ts`
**Prompt:**
```
Create review-service.ts:
- reviewChunk(chunkId) → ChunkReviewResult
- reviewSpecFinal(specId) → FinalReviewResult
- createFixChunks(specId, fixes) → string[]

Uses review.ts pure functions.
Updates DB with review status.
Logs to review_logs table.
Write unit tests with mocked ClaudeClient and DB.
```

### Chunk 7: Chunk Executor
**Files:** `packages/dashboard/src/lib/services/chunk-executor.ts`
**Tests:** `packages/dashboard/src/lib/__tests__/services/chunk-executor.test.ts`
**Prompt:**
```
Extract from execution.ts into chunk-executor.ts:
- execute(chunkId, callbacks) → ExecutionResult
- abort(chunkId)
- isRunning(chunkId)

Keep same OpenCode integration, just cleaner interface.
Write unit tests with mocked OpenCode client.
```

### Chunk 8: Chunk Pipeline
**Files:** `packages/dashboard/src/lib/services/chunk-pipeline.ts`
**Tests:** `packages/dashboard/src/lib/__tests__/services/chunk-pipeline.test.ts`
**Prompt:**
```
Create chunk-pipeline.ts orchestrating:
1. chunkExecutor.execute()
2. validationService.validate()
3. reviewService.reviewChunk()
4. gitService.commitChunk()

Emit events at each stage.
Write integration tests with mocked services.
```

### Chunk 9: Spec Execution Service
**Files:** `packages/dashboard/src/lib/services/spec-execution-service.ts`
**Tests:** `packages/dashboard/src/lib/__tests__/services/spec-execution-service.test.ts`
**Prompt:**
```
Create spec-execution-service.ts:
- runAll(specId, events) → handles full flow
- abort(specId)
- isRunning(specId)

Includes dependency resolution, final review, PR creation.
Write integration tests with mocked services.
```

### Chunk 10: Migrate run-all Route
**Files:** `packages/dashboard/src/app/api/specs/[id]/run-all/route.ts`
**Tests:** Manual testing
**Prompt:**
```
Slim down run-all/route.ts to ~100 lines:
- HTTP validation
- Create SSE stream
- Map spec-execution-service events to SSE
- Handle abort endpoint

Remove all business logic (now in services).
```

### Chunk 11: Migrate Single Chunk Route
**Files:** `packages/dashboard/src/app/api/chunks/[id]/run/route.ts`
**Tests:** Manual testing
**Prompt:**
```
Update chunks/[id]/run/route.ts to use chunk-pipeline.execute().
Now has automatic review like run-all.
```

### Chunk 12: Cleanup & Final Review
**Files:** Various
**Tests:** Full integration test
**Prompt:**
```
- Remove deprecated code from execution.ts
- Update any remaining references
- Run full test suite
- Manual end-to-end testing
```

---

## Migration Plan

### Phase 1: Create New Services (Non-Breaking)
1. Create `services/` directory
2. Implement `review.ts` (pure functions) + tests
3. Implement `review-service.ts` + tests
4. Implement `git-service.ts` (wrapping existing `git.ts`) + tests
5. Implement `validation-service.ts` (wrapping existing `review-validation.ts`) + tests
6. Add new config fields with defaults

### Phase 2: Create Pipeline Services
1. Implement `chunk-executor.ts` (extract from `execution.ts`) + tests
2. Implement `chunk-pipeline.ts` + tests
3. Implement `spec-execution-service.ts` + tests

### Phase 3: Migrate API Routes
1. Update `chunks/[id]/run/route.ts` to use `chunk-pipeline`
2. Update `run-all/route.ts` to use `spec-execution-service`
3. Update `chunks/[id]/review/route.ts` to use `review-service`

### Phase 4: Cleanup
1. Deprecate old code paths in `execution.ts`
2. Remove duplicated logic from `run-all/route.ts`
3. Run full test suite

## Acceptance Criteria

### Functional
- [ ] Haiku review runs automatically after every chunk execution (both run-all and single chunk)
- [ ] Review blocks next chunk until complete
- [ ] Commit happens after chunk passes review
- [ ] Final Opus review runs after all chunks complete
- [ ] Final review blocks PR creation
- [ ] Final review can create fix chunks if issues found
- [ ] Fix chunks from final review are executed and re-reviewed
- [ ] PR only created after final review passes

### Configuration
- [ ] `reviewer.chunkModel` configurable ('haiku' | 'sonnet')
- [ ] `reviewer.finalModel` configurable ('opus' | 'sonnet')
- [ ] `reviewer.chunkTimeout` configurable (default 3 min)
- [ ] `reviewer.finalTimeout` configurable (default 10 min)
- [ ] `reviewer.maxRetries` configurable (default 3)
- [ ] `reviewer.finalReviewMaxFixAttempts` configurable (default 2)

### Architecture
- [ ] `run-all/route.ts` reduced to ~100 lines (HTTP handling only)
- [ ] Single chunk execution uses same pipeline as run-all
- [ ] All review logic in `review-service.ts`
- [ ] All git logic in `git-service.ts`
- [ ] Services are testable (no HTTP dependencies)

### Data
- [ ] `chunks` table has `review_status`, `review_feedback`, `review_error`, `review_attempts`
- [ ] `specs` table has `final_review_status`, `final_review_feedback`, `final_review_attempts`
- [ ] `review_logs` table captures all review attempts

### Error Handling
- [ ] Review retry with exponential backoff (3 attempts, 2s/4s/8s)
- [ ] Rate limit detection (429 or 'rate limit' keywords)
- [ ] Review failures never block execution indefinitely
- [ ] All errors logged with context

## Technical Constraints

- Haiku timeout: 3 minutes (configurable)
- Opus final timeout: 10 minutes (configurable)
- Max fix attempts for final review: 2 (configurable)
- Review retries: 3 with exponential backoff
- Services use existing `ClaudeClient` from `packages/mcp`
- Services use existing database patterns

## Dependencies

- ORC-52 depends on this for UI display of review status
- Uses existing `git.ts` utility functions
- Uses existing `review-validation.ts`
- Uses existing `ClaudeClient`

## UI Deferred to ORC-52

All UI changes deferred:
- Review status badges on chunks
- Final review status on spec
- Toast notifications for review events
- "Manual review needed" banner
- Re-review buttons
