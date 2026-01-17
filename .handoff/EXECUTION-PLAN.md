# GLM Orchestrator - Master Execution Plan

**Created:** 2026-01-16
**Goal:** Get to dogfooding state, then use the orchestrator to build itself

---

## Current State Summary

### What's Built (Working)
- ✅ Project/Spec/Chunk CRUD
- ✅ Spec Studio wizard (intent → questions → spec → chunks)
- ✅ GLM execution with live tool calls
- ✅ Opus spec refinement and review
- ✅ Multi-spec per project
- ✅ Run All chunks with review loop
- ✅ Git integration (branch, commit, PR)
- ✅ Dependency graph visualization
- ✅ Codebase analysis for context
- ✅ Output summaries for context passing
- ✅ Worker types and orchestrator (backend)

### What's Blocking Dogfooding (Must Fix)
1. **#5** - Uses alert()/confirm() instead of proper UI modals
2. **#10** - Brittle Claude CLI path detection
3. **#17** - No "unsaved changes" warning in wizard
4. **#18** - No error boundaries (crashes with no recovery)
5. **#21** - Race conditions in parallel run-all
6. **#24** - Delete errors silently swallowed

### What's Planned (Phase 5+)
- Configuration system (.handoff/config.yaml)
- Analytics/usage tracking (codexbar integration)
- Ralph Loop (iterative execution until SHIP)
- Structured reviews with specific checks
- Verification steps (type check, lint, tests)

---

## Execution Order

### Phase A: Dogfooding Blockers [MANUAL - 2-3 days]

These must be fixed manually before we can use the orchestrator:

```
Sprint 1: Critical Fixes
├── 1.1 Create Toast notification system
├── 1.2 Create ConfirmModal component
├── 1.3 Replace alert()/confirm() with new components (#5)
├── 1.4 Fix CLAUDE_PATH env var support (#10)
├── 1.5 Add ErrorBoundary component (#18)
├── 1.6 Add unsaved changes warning (#17)
├── 1.7 Fix delete error handling (#24)
└── 1.8 Make run-all serial (fix race condition #21)
```

**How to execute:**
```bash
# Work directly in the codebase
cd /Users/acartagena/project/orchestrator

# For each fix:
# 1. Read the relevant file
# 2. Make the fix
# 3. Test manually in browser (http://localhost:4740)
# 4. Commit when working

pnpm --filter @specwright/dashboard dev  # Run the dashboard
```

---

### Phase B: Quick Stability Wins [MANUAL - 1 day]

```
Sprint 2: Quick Fixes
├── 2.1 Clear toolCallIdMap on cleanup (#1)
├── 2.2 Add max size to eventBuffer (#2)
├── 2.3 Remove dead EventSource code (#3)
├── 2.4 Extract shared review prompt (#8)
├── 2.5 Use crypto.randomUUID() for IDs (#20)
├── 2.6 Add OPENCODE_URL env var (#22)
├── 2.7 Add DB_PATH env var (#23)
├── 2.8 Add database indexes (#25)
└── 2.9 Add Workers page loading state (#31)
```

**How to execute:** Same as Phase A - direct code changes.

---

### Phase C: Configuration System [CAN START DOGFOODING]

This is the first feature we can build USING the orchestrator:

```
Sprint 3: Configuration
├── 3.1 Create config types in @specwright/shared
├── 3.2 Create config loader (lib/config-loader.ts)
├── 3.3 Create config API routes
├── 3.4 Add config UI to Spec Studio
└── 3.5 Wire up executor/reviewer selection
```

**How to execute with orchestrator:**
```
1. Open http://localhost:4740
2. Create/select the "orchestrator" project (directory: /Users/acartagena/project/orchestrator)
3. Create new spec: "Configuration System"
4. Go through Spec Studio wizard
5. Let Opus generate chunks
6. Run All → Watch it build itself
7. Review, fix if needed
8. Create PR
```

---

### Phase D: Analytics & Usage [DOGFOOD]

```
Sprint 4: Analytics
├── 4.1 Create usage tracking service (call codexbar)
├── 4.2 Create usage API endpoint
├── 4.3 Create usage dashboard component
├── 4.4 Add per-execution cost tracking
└── 4.5 Add usage graphs/charts
```

**How to execute:** Create spec in orchestrator, run chunks.

---

### Phase E: Worker UI Completion [DOGFOOD]

```
Sprint 5: Worker UI
├── 5.1 Polish Workers page with loading/error states
├── 5.2 Integrate WorkerDashboard fully
├── 5.3 Add queue management UI
└── 5.4 Add worker detail view
```

**How to execute:** Create spec in orchestrator, run chunks.

---

### Phase F: UX Polish [DOGFOOD]

```
Sprint 6: UX Improvements
├── 6.1 Fix SSE reconnection timeout (#4)
├── 6.2 Add reconnect failure notification (#11)
├── 6.3 Fix runChunk setTimeout race (#19)
├── 6.4 Fix focus timing (#29)
└── 6.5 Add debug logger utility (#16)
```

**How to execute:** Create spec in orchestrator, run chunks.

---

### Phase G: Ralph Loop [DOGFOOD]

```
Sprint 7: Ralph Loop Implementation
├── 7.1 Create iteration tracking schema
├── 7.2 Implement execution loop with retry
├── 7.3 Add rollback logic (git reset)
├── 7.4 Integrate structured reviews
├── 7.5 Add verification steps
└── 7.6 Update run-all to use Ralph Loop
```

**How to execute:** Create spec in orchestrator, run chunks.

---

### Phase H: Architecture Cleanup [DOGFOOD - OPTIONAL]

```
Sprint 8: Refactoring (when needed)
├── 8.1 Split db.ts by domain
├── 8.2 Organize types.ts
├── 8.3 Split spec page component
└── 8.4 Split CreateProjectModal
```

**How to execute:** Create spec in orchestrator, run chunks.

---

## File Locations Reference

### Key Files for Phase A Fixes

| Fix | File |
|-----|------|
| Toast system | `components/Toast.tsx` (new) |
| ConfirmModal | `components/ConfirmModal.tsx` (new) |
| alert/confirm replacement | `components/ChunkList.tsx` |
| CLAUDE_PATH | `packages/mcp/src/client/claude.ts` |
| ErrorBoundary | `components/ErrorBoundary.tsx` (new) |
| Unsaved warning | `components/spec-studio/SpecStudioWizard.tsx` |
| Delete error | `hooks/useProjects.ts` |
| Run-all race | `app/api/specs/[id]/run-all/route.ts` |

### Key Files for Phase B Fixes

| Fix | File |
|-----|------|
| toolCallIdMap cleanup | `lib/execution.ts` |
| eventBuffer max size | `lib/execution.ts` |
| Dead EventSource | `hooks/useRunAll.ts` |
| Shared review prompt | `lib/prompts.ts` (new) |
| UUID generation | `lib/db.ts` |
| OPENCODE_URL env | `packages/mcp/src/client/opencode.ts` |
| DB_PATH env | `lib/db.ts` |
| Database indexes | `packages/shared/src/schema.ts` |
| Workers loading | `app/workers/page.tsx` |

---

## Configuration Defaults (For Phase C)

```yaml
# .handoff/config.yaml

tools:
  executors:
    - id: opencode
      name: "OpenCode (GLM 4.7)"
      type: opencode
      endpoint: "${OPENCODE_URL:-http://localhost:4096}"
    - id: claude-code
      name: "Claude Code"
      type: claude-code
      path: "${CLAUDE_PATH:-claude}"

  planners:
    - id: opus
      model: "claude-opus-4-5-20251101"
    - id: sonnet
      model: "claude-sonnet-4-5-20250929"

  reviewers:
    - id: sonnet-quick
      model: "claude-sonnet-4-5-20250929"
    - id: opus-thorough
      model: "claude-opus-4-5-20251101"

defaults:
  executor: opencode
  planner: opus
  reviewer: sonnet-quick
  maxIterations: 5  # User preference: 10 for personal use

rules:
  - "Use pnpm, never npm or yarn"
  - "TypeScript strict mode"
  - "Follow existing patterns"
```

---

## Codebase Review Summary (35 Issues Found)

### By Severity
- Critical: 0
- High: 8
- Medium: 18
- Low: 9

### By Category
- Bugs: 10
- UX: 5
- Architecture: 5
- Integration: 3
- Database: 2
- Config: 2
- Other: 8

### Dogfooding Blockers (6 issues)
#5, #10, #17, #18, #21, #24

### Quick Wins (15 issues)
#1, #3, #8, #10, #14, #15, #16, #20, #22, #23, #25, #26, #29, #31, #34

---

## Commands Reference

```bash
# Development
pnpm --filter @specwright/dashboard dev    # Run dashboard on :4740
pnpm build                           # Build all packages
pnpm test                            # Run tests (when added)

# Git workflow
git checkout -b fix/sprint-1-blockers
git add -A && git commit -m "fix: sprint 1 - dogfooding blockers"
git push -u origin fix/sprint-1-blockers

# Check usage (once codexbar integrated)
codexbar usage --json | jq .
```

---

## Success Criteria

### Dogfooding Ready (After Phase A+B)
- [ ] Can create a spec without crashes
- [ ] Can run all chunks without race conditions
- [ ] Errors are shown to user clearly
- [ ] Can navigate without losing work

### Full Dogfooding (After Phase C-F)
- [ ] Can configure which model/executor to use
- [ ] Can see usage/cost tracking
- [ ] Workers run in background reliably
- [ ] UX is smooth and polished

### Ralph Loop Complete (After Phase G)
- [ ] Chunks retry until SHIP or max iterations
- [ ] Failed work is rolled back cleanly
- [ ] Verification runs after each chunk
- [ ] Reviews are structured and actionable

---

## Next Session Instructions

1. **Read this file first** - It's the master plan
2. **Start with Phase A** - Fix dogfooding blockers manually
3. **Test after each fix** - Run `pnpm --filter @specwright/dashboard dev`
4. **Commit frequently** - Small, focused commits
5. **After Phase A+B** - Start using orchestrator to build Phase C+

The goal: **Get to dogfooding ASAP**, then let the tool help build itself.
