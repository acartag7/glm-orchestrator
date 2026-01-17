# Phase 5: Ralph Loop Integration & Configuration System

## Executive Summary

This spec consolidates all improvements discussed and introduces the **Ralph Loop** pattern - an iterative execution model where work continues until genuinely complete, with atomic rollback capability and configurable tooling.

---

## Current State Recap

### What's Built (Phases 1-4)

| Phase | Feature | Status |
|-------|---------|--------|
| **MVP** | Project/Spec/Chunk CRUD | ✅ Complete |
| **MVP** | GLM execution with live tool calls | ✅ Complete |
| **MVP** | Opus spec refinement | ✅ Complete |
| **Spec Studio** | 4-step wizard (intent→questions→review→chunks) | ✅ Complete |
| **Phase 2** | Multi-spec per project | ✅ Complete |
| **Phase 2** | Review loop (Opus reviews GLM output) | ✅ Complete |
| **Phase 2** | Run All chunks sequentially | ✅ Complete |
| **Phase 2** | Git integration (branch, commit, PR) | ✅ Complete |
| **Phase 3** | Dependency graph visualization | ✅ Complete |
| **Phase 3** | Dependency editor | ✅ Complete |
| **Phase 3** | Execution plan preview | ✅ Complete |
| **Phase 3** | View mode toggle (list/graph/plan) | ✅ Complete |
| **Phase 3.5** | Codebase analysis | ✅ Complete |
| **Phase 3.5** | Output summaries for context passing | ✅ Complete |
| **Phase 3.5** | Improved chunk generation prompts | ✅ Complete |
| **Phase 4** | Worker types & orchestrator | ✅ Complete |
| **Phase 4** | Worker queue management | ✅ Complete |
| **Phase 4** | Worker SSE events | ✅ Complete |
| **Phase 4** | Worker UI components | ⚠️ Partial |

### What's Incomplete

1. **Worker Dashboard UI** - Components exist but not fully integrated
2. **True Ralph Loop** - We do one fix attempt, not loop until complete
3. **Atomic Rollback** - No git reset on failure
4. **Configuration System** - Hardcoded model/tool choices
5. **Structured Reviews** - Generic prompts, not specific checks
6. **Verification Steps** - No test/type/lint checking

---

## The Ralph Loop Philosophy

### Core Insight

> "As conversation histories accumulate failed attempts, models must process increasing noise before focusing on actual work."

### Our Adaptation

```
┌─────────────────────────────────────────────────────────────────────┐
│                         RALPH LOOP                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   while (iteration < maxIterations && status !== 'SHIP'):          │
│       1. Build context (fresh, declarative)                        │
│       2. Execute chunk (GLM/Claude Code)                           │
│       3. Commit to branch (atomic unit)                            │
│       4. Review (Sonnet quick / Opus thorough)                     │
│       5. If SHIP: break, next chunk                                │
│       6. If REVISE:                                                │
│          - git reset --hard (discard work)                         │
│          - Improve prompt with feedback                            │
│          - iteration++                                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Differences from Current System

| Current | Ralph Loop |
|---------|------------|
| One fix attempt, then move on | Loop until SHIP or max iterations |
| Patch failures | Discard and retry with better prompt |
| Accumulated conversation | Fresh context each iteration |
| Generic review | Structured review with specific checks |
| Hardcoded tools | Configurable pipeline |

---

## 1. Configuration System

### Config File Structure

```yaml
# .handoff/config.yaml (project-level, overrides global)

# Available tools
tools:
  executors:
    - id: opencode
      name: "OpenCode (GLM 4.7)"
      type: opencode
      endpoint: "http://localhost:4096"
    - id: claude-code
      name: "Claude Code"
      type: claude-code
      command: "claude"

  planners:
    - id: opus
      name: "Claude Opus"
      model: "claude-opus-4-5-20251101"
    - id: sonnet
      name: "Claude Sonnet"
      model: "claude-sonnet-4-5-20250929"

  reviewers:
    - id: sonnet-quick
      name: "Sonnet (Quick)"
      model: "claude-sonnet-4-5-20250929"
      checks: ["syntax", "types", "obvious_bugs"]
    - id: opus-thorough
      name: "Opus (Thorough)"
      model: "claude-opus-4-5-20251101"
      checks: ["security", "race_conditions", "memory_leaks", "error_handling", "accessibility"]

# Defaults for this project
defaults:
  executor: opencode
  planner: opus
  quickReviewer: sonnet-quick
  finalReviewer: opus-thorough
  maxIterations: 5

# Global rules (apply to ALL chunks in this project)
rules:
  - "Use pnpm, never npm or yarn"
  - "TypeScript strict mode"
  - "Follow existing patterns in codebase"
  - "No new dependencies without justification"
  - "All exports must have JSDoc comments"

# Verification steps (run after each chunk)
verification:
  enabled: true
  steps:
    - name: "Type Check"
      command: "pnpm tsc --noEmit"
      required: true
    - name: "Lint"
      command: "pnpm lint"
      required: false
    - name: "Tests"
      command: "pnpm test --passWithNoTests"
      required: false
```

### Config Hierarchy

```
Global (~/.handoff/config.yaml)
    ↓ overrides
Project (.handoff/config.yaml)
    ↓ overrides
Spec (stored in database, set via UI)
```

### UI Integration

**Spec Studio - Step 4 (Chunks):**
```
┌─────────────────────────────────────────────────────────────────┐
│  SPEC STUDIO                              Step 4 of 4  ●●●●     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Execution Settings                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Executor:     [OpenCode (GLM 4.7)           ▼]         │   │
│  │  Reviewer:     [Sonnet (Quick)               ▼]         │   │
│  │  Max Retries:  [5                              ]         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Suggested chunks:                                              │
│  ...                                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Data Model

```typescript
interface ProjectConfig {
  executor?: string;        // Tool ID from config
  planner?: string;         // Model ID from config
  quickReviewer?: string;   // Model ID from config
  finalReviewer?: string;   // Model ID from config
  maxIterations?: number;
  rules?: string[];
  verification?: VerificationConfig;
}

interface SpecConfig {
  executor?: string;        // Override project default
  reviewer?: string;        // Override project default
  maxIterations?: number;   // Override project default
}

interface VerificationConfig {
  enabled: boolean;
  steps: VerificationStep[];
}

interface VerificationStep {
  name: string;
  command: string;
  required: boolean;
}
```

### API

```
GET  /api/config                    # Get merged global config
GET  /api/projects/[id]/config      # Get project config (merged with global)
PUT  /api/projects/[id]/config      # Update project config
```

---

## 2. Context Management

### Per-Chunk Context

Each chunk execution receives **declarative context**:

```typescript
interface ChunkContext {
  // The chunk itself
  chunk: {
    title: string;
    description: string;  // Detailed step-by-step instructions
  };

  // Files this chunk should check/modify
  relevantFiles: string[];

  // What previous chunks accomplished
  dependencyContext: DependencyContext[];

  // Project-wide rules
  globalRules: string[];

  // Codebase structure (for ongoing projects)
  codebaseContext?: CodebaseContext;
}

interface DependencyContext {
  chunkId: string;
  title: string;
  outputSummary: string;  // Concise summary, not raw output
  filesCreated: string[];
  filesModified: string[];
  exportsAdded: string[];
}
```

### Prompt Structure

```markdown
# Task: {chunk.title}

## Context from Previous Work
{for each dependency}
### {dep.title}
{dep.outputSummary}

Files created: {dep.filesCreated}
Exports available: {dep.exportsAdded}
{end for}

## Files to Check
Before starting, review these files:
{for each relevantFile}
- {relevantFile}
{end for}

## Global Rules
{for each rule}
- {rule}
{end for}

## Codebase Context
Framework: {codebase.framework}
Package Manager: {codebase.packageManager}
Key Types: {codebase.types}
Existing Components: {codebase.components}

## Your Task
{chunk.description}

## Expected Output
When complete, provide:
1. Summary of what you accomplished
2. Files created/modified
3. New exports/functions available
4. How to verify it works
```

### Output Summary Generation

After each chunk completes, generate a structured summary:

```typescript
interface ChunkOutputSummary {
  summary: string;           // 2-3 sentence description
  filesCreated: string[];
  filesModified: string[];
  exportsAdded: string[];
  testsAdded: string[];
  verificationSteps: string[];
}
```

**Prompt for Summary Generation:**
```markdown
Analyze the output of this completed task and create a concise summary.

Task: {chunk.title}
Description: {chunk.description}

Output:
{chunk.output}

Return JSON:
{
  "summary": "Created user authentication endpoints with JWT...",
  "filesCreated": ["src/auth/login.ts", "src/auth/register.ts"],
  "filesModified": ["src/routes/index.ts"],
  "exportsAdded": ["loginHandler", "registerHandler", "authMiddleware"],
  "testsAdded": [],
  "verificationSteps": ["POST /auth/login returns JWT token", "Protected routes reject invalid tokens"]
}
```

---

## 3. Structured Review System

### Review Tiers

| Tier | When | Model | Checks | Time |
|------|------|-------|--------|------|
| **Quick** | After each chunk iteration | Sonnet | Syntax, types, obvious bugs | ~30s |
| **Deep** | Before marking chunk complete | Opus | Security, race conditions, memory leaks | ~2min |
| **Final** | Before PR creation | Opus | Full review, accessibility, architecture | ~5min |

### Review Prompt Template

```markdown
# Code Review Request

## Task Completed
Title: {chunk.title}
Description: {chunk.description}

## Files Changed
{for each file in diff}
### {file.path}
```diff
{file.diff}
```
{end for}

## Check For (Priority Order)
1. **Security**: SQL injection, XSS, auth bypass, secrets exposure
2. **Race Conditions**: Async state, concurrent access, stale checks
3. **Memory Leaks**: Uncleaned intervals, unsubscribed listeners, unclosed streams
4. **Error Handling**: Silent failures, unhandled promises, lost errors
5. **Logic Bugs**: Off-by-one, wrong counts, edge cases
{if finalReview}
6. **Accessibility**: ARIA attributes, keyboard navigation, screen readers
7. **Architecture**: Follows existing patterns, no unnecessary abstractions
{end if}

## Output Format (JSON)
{
  "decision": "SHIP" | "REVISE",
  "issues": [
    {
      "file": "path/to/file.ts",
      "lines": [245, 264],
      "type": "race_condition",
      "severity": "high" | "medium" | "low",
      "description": "Clear explanation of the issue",
      "suggestion": "Code diff or fix approach",
      "agentPrompt": "Actionable instruction for AI to fix this"
    }
  ],
  "summary": {
    "total": 5,
    "high": 1,
    "medium": 3,
    "low": 1
  }
}

## Rules
- SHIP = Ready to merge, no blocking issues
- REVISE = Has issues that must be fixed
- Only report real issues, not style preferences
- Include line numbers
- Provide actionable fixes
- The agentPrompt should be copy-paste ready
```

### Review Result Type

```typescript
interface ReviewResult {
  decision: 'SHIP' | 'REVISE';
  issues: ReviewIssue[];
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
}

interface ReviewIssue {
  file: string;
  lines: [number, number];
  type: 'security' | 'race_condition' | 'memory_leak' | 'error_handling' | 'logic_bug' | 'accessibility';
  severity: 'high' | 'medium' | 'low';
  description: string;
  suggestion: string;
  agentPrompt: string;  // Ready to use for fix iteration
}
```

---

## 4. Execution Loop (Ralph Loop)

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CHUNK EXECUTION LOOP                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐                                                  │
│  │ Build Context │ ← Fresh each iteration                          │
│  └──────┬───────┘                                                  │
│         ↓                                                          │
│  ┌──────────────┐                                                  │
│  │   Execute    │ ← GLM / Claude Code (configurable)               │
│  └──────┬───────┘                                                  │
│         ↓                                                          │
│  ┌──────────────┐                                                  │
│  │    Commit    │ ← Atomic unit, can rollback                      │
│  └──────┬───────┘                                                  │
│         ↓                                                          │
│  ┌──────────────┐                                                  │
│  │   Verify     │ ← Type check, lint, tests (optional)             │
│  └──────┬───────┘                                                  │
│         ↓                                                          │
│  ┌──────────────┐                                                  │
│  │   Review     │ ← Sonnet quick / Opus thorough                   │
│  └──────┬───────┘                                                  │
│         ↓                                                          │
│     ┌───┴───┐                                                      │
│     │ SHIP? │                                                      │
│     └───┬───┘                                                      │
│    YES  │  NO                                                      │
│    ↓    ↓                                                          │
│  ┌────┐ ┌─────────────────────┐                                   │
│  │Done│ │ iteration < max?    │                                   │
│  └────┘ └──────────┬──────────┘                                   │
│              YES   │   NO                                          │
│              ↓     ↓                                               │
│         ┌───────┐ ┌──────┐                                        │
│         │Reset  │ │ Fail │                                        │
│         │+ Retry│ └──────┘                                        │
│         └───┬───┘                                                  │
│             │                                                      │
│             └──────→ [Back to Build Context with feedback]         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Iteration State

```typescript
interface ChunkIteration {
  id: string;
  chunkId: string;
  iteration: number;
  status: 'executing' | 'verifying' | 'reviewing' | 'completed' | 'failed';

  // Execution
  executionOutput?: string;
  executionDuration?: number;
  commitHash?: string;

  // Verification
  verificationResults?: VerificationResult[];

  // Review
  reviewResult?: ReviewResult;

  // If retrying
  feedbackForNextIteration?: string;

  createdAt: number;
  completedAt?: number;
}

interface VerificationResult {
  step: string;
  command: string;
  passed: boolean;
  output: string;
  duration: number;
}
```

### Database Schema

```sql
-- Iteration history per chunk
CREATE TABLE IF NOT EXISTS chunk_iterations (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'executing',

  -- Execution
  execution_output TEXT,
  execution_duration INTEGER,
  commit_hash TEXT,

  -- Verification
  verification_results TEXT,  -- JSON array

  -- Review
  review_result TEXT,  -- JSON

  -- Feedback for retry
  feedback TEXT,

  created_at INTEGER NOT NULL,
  completed_at INTEGER,

  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE INDEX idx_iterations_chunk ON chunk_iterations(chunk_id);
```

### Rollback Logic

```typescript
async function rollbackChunk(chunkId: string, commitHash: string): Promise<void> {
  const chunk = getChunk(chunkId);
  const spec = getSpec(chunk.specId);
  const project = getProject(spec.projectId);

  // Reset to commit before this chunk started
  await execGit(project.directory, ['reset', '--hard', `${commitHash}^`]);

  // Update chunk status
  updateChunk(chunkId, {
    status: 'pending',
    output: null,
    outputSummary: null,
    error: null
  });
}
```

---

## 5. Verification Steps

### Flow

```
Chunk executes → Commit → Verify → Review
                           ↓
                    ┌──────────────┐
                    │ Type Check   │ → Pass/Fail
                    │ Lint         │ → Pass/Fail (optional)
                    │ Tests        │ → Pass/Fail (optional)
                    └──────────────┘
                           ↓
                    If required step fails:
                    → Rollback + Retry
```

### Verification Runner

```typescript
async function runVerification(
  projectDir: string,
  config: VerificationConfig
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (const step of config.steps) {
    const startTime = Date.now();
    try {
      const output = await execCommand(step.command, { cwd: projectDir });
      results.push({
        step: step.name,
        command: step.command,
        passed: true,
        output,
        duration: Date.now() - startTime,
      });
    } catch (error) {
      results.push({
        step: step.name,
        command: step.command,
        passed: false,
        output: error.message,
        duration: Date.now() - startTime,
      });

      if (step.required) {
        break; // Stop on required failure
      }
    }
  }

  return results;
}
```

---

## 6. State Directory Structure

For debugging and transparency, maintain iteration state in files:

```
.handoff/
├── config.yaml                    # Project config
└── specs/
    └── {spec-id}/
        ├── spec.md                # Spec content
        ├── chunks.json            # Chunk definitions
        ├── codebase-analysis.json # Cached analysis
        └── iterations/
            ├── chunk-1/
            │   ├── iteration-1/
            │   │   ├── context.md     # Prompt sent
            │   │   ├── output.md      # Raw output
            │   │   ├── summary.json   # Generated summary
            │   │   ├── verification.json
            │   │   └── review.json
            │   └── iteration-2/
            │       └── ...
            └── chunk-2/
                └── ...
```

This enables:
- Debugging failed iterations
- Auditing AI decisions
- Training data collection
- Manual recovery

---

## Implementation Plan

### Phase 5.1: Configuration System (Day 1-2)

| Task | Description | Files |
|------|-------------|-------|
| Create config types | ProjectConfig, SpecConfig, VerificationConfig | `@specwright/shared/types.ts` |
| Config loader | Read/merge YAML configs | `lib/config-loader.ts` |
| Config API | GET/PUT project config | `api/projects/[id]/config/route.ts` |
| Config UI | Dropdowns in Spec Studio step 4 | `spec-studio/ChunksStep.tsx` |
| Add config to spec | Store spec-level overrides | `db.ts`, `types.ts` |

### Phase 5.2: Context Management (Day 3-4)

| Task | Description | Files |
|------|-------------|-------|
| Update prompt builder | Add relevantFiles, globalRules | `lib/prompt-builder.ts` |
| Summary generator | Generate structured ChunkOutputSummary | `lib/summary-generator.ts` |
| Dependency context | Pass outputSummary to dependents | `lib/prompt-builder.ts` |
| Codebase context | Include in chunk prompt | `lib/codebase-analyzer.ts` |

### Phase 5.3: Structured Reviews (Day 5-6)

| Task | Description | Files |
|------|-------------|-------|
| Review types | ReviewResult, ReviewIssue | `@specwright/shared/types.ts` |
| Review prompt | Structured template with checks | `lib/review-prompt.ts` |
| Tiered reviews | Quick (Sonnet) vs Deep (Opus) | `lib/reviewer.ts` |
| Review UI | Show issues with file/line | `components/ReviewPanel.tsx` |
| Parse agent prompts | Extract agentPrompt for retry | `lib/reviewer.ts` |

### Phase 5.4: Ralph Loop Execution (Day 7-9)

| Task | Description | Files |
|------|-------------|-------|
| Iteration schema | chunk_iterations table | `@specwright/shared/schema.ts`, `db.ts` |
| Iteration tracking | Create/update iterations | `db.ts` |
| Execution loop | while (iteration < max) | `lib/ralph-executor.ts` |
| Rollback logic | git reset on failure | `lib/ralph-executor.ts` |
| Retry with feedback | Improve prompt from review | `lib/ralph-executor.ts` |
| Update Run All | Use Ralph loop | `api/specs/[id]/run-all/route.ts` |

### Phase 5.5: Verification (Day 10)

| Task | Description | Files |
|------|-------------|-------|
| Verification runner | Execute configured commands | `lib/verification-runner.ts` |
| Integrate with loop | Run after commit, before review | `lib/ralph-executor.ts` |
| Verification UI | Show step results | `components/VerificationPanel.tsx` |

### Phase 5.6: State Directory (Day 11)

| Task | Description | Files |
|------|-------------|-------|
| State writer | Write iteration files to .handoff/ | `lib/state-writer.ts` |
| State reader | Read for debugging/recovery | `lib/state-reader.ts` |
| Cleanup | Remove old iteration files | `lib/state-cleanup.ts` |

---

## Acceptance Criteria

### Configuration
- [ ] Config file loads from .handoff/config.yaml
- [ ] Project config overrides global
- [ ] Spec config overrides project
- [ ] UI shows available options from config
- [ ] Changing executor in UI uses that tool

### Context Management
- [ ] Chunks receive relevantFiles list
- [ ] Chunks receive globalRules
- [ ] Dependency summaries (not raw output) passed to dependents
- [ ] Codebase analysis included for ongoing projects

### Structured Reviews
- [ ] Reviews return JSON with decision/issues
- [ ] Issues include file, lines, type, severity
- [ ] agentPrompt extracted for retries
- [ ] Quick review uses Sonnet
- [ ] Deep review uses Opus

### Ralph Loop
- [ ] Chunk retries up to maxIterations
- [ ] Failed work rolled back (git reset)
- [ ] Retry prompt includes review feedback
- [ ] SHIP decision moves to next chunk
- [ ] max iterations reached → fail chunk

### Verification
- [ ] Type check runs after commit
- [ ] Lint runs after commit (if configured)
- [ ] Tests run after commit (if configured)
- [ ] Required step failure triggers retry
- [ ] Results shown in UI

### State Directory
- [ ] Iteration files written to .handoff/
- [ ] Context, output, review captured
- [ ] Old iterations can be inspected
- [ ] State survives server restart

---

## Success Metrics

1. **Reduced Manual Intervention**: Chunks complete without user fixing issues
2. **Higher First-PR Success Rate**: PRs pass code review more often
3. **Faster Iteration**: System self-corrects instead of waiting for human
4. **Audit Trail**: Every iteration documented for debugging
5. **Flexibility**: Easy to swap models/tools via config

---

## Open Questions

1. **Max Iterations Default**: 5? 10? Configurable per chunk?
2. **Rollback Granularity**: Reset entire chunk or individual files?
3. **Review Caching**: Cache review for unchanged files?
4. **Parallel Verification**: Run type check + lint + tests in parallel?
5. **Cost Tracking**: Track API costs per iteration?

---

## Future Considerations

- **Learning from Failures**: Track which prompts fail, improve templates
- **Shared Rules Library**: Project templates with pre-configured rules
- **Team Collaboration**: Multiple users watching same execution
- **CI/CD Integration**: Trigger Ralph loops from CI pipelines
- **Custom Reviewers**: Allow external review tools (CodeRabbit, etc.)
