# Specwright - Spec-Driven Development Platform

## What This Is

A web-based tool for AI-assisted software development where you:
1. Write specs with Opus assistance
2. Break specs into executable chunks
3. Run chunks with executor (opencode/GLM) while watching progress
4. Review and iterate

**Not** an MCP server. **Not** a Cursor/Windsurf competitor. A personal tool for structured AI development.

## Architecture

```
packages/
├── dashboard/     # Next.js web app (main interface)
├── shared/        # Shared TypeScript types
└── mcp/           # Legacy MCP server (paused)
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Database | SQLite (better-sqlite3) |
| AI Planning | Claude CLI (Opus) |
| AI Execution | opencode HTTP API (GLM-4.7) |
| Real-time | Server-Sent Events |

## Core Concepts

### Project
A directory you're working on. Has one active spec.

### Spec
Markdown document describing what to build. Created/refined with Opus.

### Chunk
A discrete task for GLM to execute. Has title, description, status.

### Execution
Running a chunk through GLM. Shows live tool calls via SSE.

## Key Files

- `.handoff/spec-driven-dev-mvp.md` - Current MVP specification
- `packages/dashboard/` - Main web application
- `packages/shared/src/index.ts` - Shared types

## Development

```bash
# Install dependencies
pnpm install

# Run dashboard
pnpm --filter @specwright/dashboard dev

# Build all
pnpm build
```

## Current Status

**Phase: MVP Implementation**

See `.handoff/spec-driven-dev-mvp.md` for full spec.

MVP Features:
- [ ] Project CRUD
- [ ] Spec editor with Opus refinement
- [ ] Chunk management
- [ ] GLM execution with live view
- [ ] Basic status tracking

## Commands

```bash
# Development
pnpm dev              # Run all in dev mode
pnpm build            # Build all packages
pnpm test             # Run tests

# Dashboard only
pnpm --filter @specwright/dashboard dev
pnpm --filter @specwright/dashboard build
```

## Database

SQLite stored at `~/.specwright/orchestrator.db`

Tables: `projects`, `specs`, `chunks`, `tool_calls`

## AI Integration

### Opus (Planning/Review)

```typescript
import { ClaudeClient } from '@specwright/mcp';
const client = new ClaudeClient();
await client.executePrompt(prompt, workingDir);
```

### Executor (opencode/GLM)

```typescript
import { OpencodeClient } from '@specwright/mcp';
const client = new OpencodeClient();
// Uses HTTP API at localhost:4096
```

## Notes

- Always use pnpm (not npm/yarn)
- Dashboard runs on port 4740
- opencode server must be running for GLM execution

## Issue Tracking

**Linear Project:** ORC (Orchestrator)

### Bug Ticket Format

Bugs use inline orchestrator spec prompts:

```markdown
## Problem
Description of the bug.

## Files Involved
- `path/to/file.ts` (lines X-Y)

## Orchestrator Spec Prompt
\`\`\`
Detailed spec prompt that can be pasted directly into the orchestrator.
\`\`\`

## Acceptance Criteria
- [ ] Checkbox items
```

### Feature Ticket Format

Features reference spec files (keeps tickets concise):

```markdown
## Summary
Brief description of the feature.

## Spec File
`.handoff/specs/ORC-XX-feature-name.md` (to be created)

## Why This Matters
- Key points

## Acceptance Criteria
- [ ] Checkbox items
```

### Spec Files Location

Feature implementation specs live in `.handoff/specs/`:

```
.handoff/specs/
├── ORC-21-git-integration.md
├── ORC-22-spec-editing.md
├── ORC-23-chunk-editing.md
├── ORC-24-spec-templates.md
├── ORC-25-auto-chunking.md
├── ORC-26-model-optimization.md
├── ORC-27-cli-interface.md
└── ORC-29-git-worktrees.md
```

These files contain detailed implementation specs that the orchestrator can use directly.

## Workflow Patterns

### Ralph Loop (Git Integration)

When git integration is enabled (ORC-21):
1. Branch created per spec: `spec/{spec-slug}`
2. Commit after each successful chunk
3. Git reset on chunk failure
4. Switch back to original branch when done

### Git Worktrees (Parallel Execution)

When worktrees are enabled (ORC-29):
1. Each spec gets its own worktree: `../project-spec-{shortId}/`
2. Multiple specs can run in parallel
3. Worktree cleaned up after PR is merged

### Model Allocation

When model optimization is enabled (ORC-26):
| Task | Model |
|------|-------|
| Spec refinement | Opus |
| Chunk execution | GLM |
| Review (pass/fail) | Sonnet |
| Fix generation | Sonnet |
