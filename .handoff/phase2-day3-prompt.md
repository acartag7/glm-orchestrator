# Phase 2 Day 3: Run All Chunks

## Context

You're implementing Phase 2 of the Spec-Driven Development Platform. Day 1 (Multi-Spec) and Day 2 (Review Loop) are complete. Now we're adding "Run All" - sequential execution of all chunks with automatic review.

**Read the full spec:** `.handoff/spec-driven-dev-mvp.md` (specifically "Phase 2: Multi-Spec Workflow" → "3. Run All Chunks" section)

## What Exists (Days 1-2 Complete)

- Multiple specs per project with status badges
- Individual chunk execution with GLM
- Review loop: Opus reviews after each chunk (pass/needs_fix/fail)
- Fix chunks auto-created when review returns needs_fix
- ExecutionPanel with review UI

## Day 3 Goal

Add "Run All" button that executes all pending chunks sequentially, with automatic review after each.

## Flow

```
"Run All" clicked →
    ↓
For each chunk (in order):
    Execute with GLM →
    Review with Opus →
    If pass: continue to next chunk
    If needs_fix: run fix chunk, then continue
    If fail: stop execution
    ↓
All done → Update spec status to 'completed'
```

## Tasks

### 1. Create Run All API

Create `packages/dashboard/src/app/api/specs/[id]/run-all/route.ts`:

```typescript
// POST /api/specs/[id]/run-all
// Returns SSE stream with execution events:
// - chunk_start: { chunkId, title, index, total }
// - chunk_complete: { chunkId, output }
// - review_start: { chunkId }
// - review_complete: { chunkId, status, feedback, fixChunkId? }
// - fix_chunk_start: { chunkId, title }
// - fix_chunk_complete: { chunkId }
// - error: { chunkId, message }
// - all_complete: { specId, passed, failed, fixes }
// - stopped: { reason }
```

### 2. Run All Orchestration Logic

The API should:
1. Get all pending chunks for the spec (ordered)
2. For each chunk:
   - Send `chunk_start` event
   - Execute with GLM (use existing execution logic)
   - Send `chunk_complete` event
   - Send `review_start` event
   - Review with Opus
   - Send `review_complete` event
   - If needs_fix: create fix chunk, execute it, review it
   - If fail: stop and send `stopped` event
3. When all done: update spec status to 'completed', send `all_complete`

### 3. Add Stop/Pause State

Add to database or in-memory state to track:
- Is a run-all in progress for this spec?
- Should it be stopped/paused?

Create abort endpoint:
```
POST /api/specs/[id]/run-all/abort
```

### 4. useRunAll Hook

Create `packages/dashboard/src/hooks/useRunAll.ts`:

```typescript
interface RunAllState {
  isRunning: boolean;
  isPaused: boolean;
  currentChunkId: string | null;
  currentStep: 'executing' | 'reviewing' | 'fix' | null;
  progress: {
    current: number;
    total: number;
    passed: number;
    failed: number;
    fixes: number;
  };
  events: RunAllEvent[];
  error: string | null;
}

interface RunAllEvent {
  type: string;
  chunkId?: string;
  timestamp: number;
  data: Record<string, unknown>;
}

function useRunAll(specId: string) {
  // Returns state and control functions
  return {
    state: RunAllState,
    startRunAll: () => Promise<void>,
    stopRunAll: () => Promise<void>,
    pauseRunAll: () => void,
    resumeRunAll: () => void,
  };
}
```

### 5. Update Spec Workspace UI

Modify `packages/dashboard/src/app/project/[id]/spec/[specId]/page.tsx`:

Add "Run All" button in header:

```tsx
<button
  onClick={handleRunAll}
  disabled={isRunAllRunning || chunks.length === 0}
  className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 rounded-md font-mono text-xs"
>
  {isRunAllRunning ? (
    <>
      <Spinner /> Running {progress.current}/{progress.total}...
    </>
  ) : (
    <>Run All ▶</>
  )}
</button>
```

### 6. Run All Progress Panel

Create component or update ExecutionPanel to show run-all progress:

```
┌─────────────────────────────────────────────────────────────────┐
│  RUN ALL                                      Progress: 2/5      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ✓ 1. Setup dependencies                     Passed      │   │
│  │ ✓ 2. Create user model                      Passed      │   │
│  │ ◐ 3. Add login endpoint                     Executing   │   │
│  │ ○ 4. Add register endpoint                  Pending     │   │
│  │ ○ 5. Add auth middleware                    Pending     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Current: Executing "Add login endpoint"                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ read  src/routes/index.ts      ✓                        │   │
│  │ write src/routes/auth.ts       ◐                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Stop] [Pause]                                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7. Update Spec Status

When run-all completes successfully:
- Update spec status to 'completed'
- Show completion UI with stats

When run-all fails:
- Keep spec status as 'running' or set to 'review'
- Show which chunk failed and why

### 8. Integration with Existing Execution

The run-all should reuse:
- Existing chunk execution logic (OpencodeClient)
- Existing review logic (review API)
- Existing tool call streaming

Don't duplicate - call the existing endpoints or extract shared functions.

## SSE Event Format

```typescript
// Event types
type RunAllEventType =
  | 'chunk_start'
  | 'tool_call'        // Reuse existing tool call events
  | 'chunk_complete'
  | 'review_start'
  | 'review_complete'
  | 'fix_chunk_start'
  | 'fix_chunk_complete'
  | 'error'
  | 'all_complete'
  | 'stopped';

// Example events
event: chunk_start
data: {"chunkId":"abc","title":"Setup dependencies","index":1,"total":5}

event: tool_call
data: {"chunkId":"abc","tool":"write","status":"running","input":{...}}

event: chunk_complete
data: {"chunkId":"abc","output":"Dependencies installed successfully"}

event: review_start
data: {"chunkId":"abc"}

event: review_complete
data: {"chunkId":"abc","status":"pass","feedback":"Task completed correctly"}

event: all_complete
data: {"specId":"xyz","passed":5,"failed":0,"fixes":1}
```

## Acceptance Criteria

- [ ] "Run All" button in spec workspace header
- [ ] Executes all pending chunks in order
- [ ] Shows progress (2/5 chunks)
- [ ] Reviews each chunk after execution
- [ ] If needs_fix: runs fix chunk automatically
- [ ] If fail: stops and shows error
- [ ] Stop button cancels execution
- [ ] Spec status updated to 'completed' when all pass
- [ ] Can resume from where stopped (skip completed chunks)
- [ ] Live tool call display during execution

## Notes

- Terminal theme: emerald-400 accents
- pnpm always
- Reuse existing execution/review logic
- SSE for real-time updates
- Handle edge cases: empty spec, all chunks done, mid-execution failures
