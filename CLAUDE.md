# Spec-Driven Development Platform

## What This Is

A web-based tool for AI-assisted software development where you:
1. Write specs with Opus assistance
2. Break specs into executable chunks
3. Run chunks with GLM while watching progress
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
pnpm --filter @glm/dashboard dev

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
pnpm --filter @glm/dashboard dev
pnpm --filter @glm/dashboard build
```

## Database

SQLite stored at `~/.glm-orchestrator/orchestrator.db`

Tables: `projects`, `specs`, `chunks`, `tool_calls`

## AI Integration

### Opus (Planning/Review)
```typescript
import { ClaudeClient } from '@glm/mcp';
const client = new ClaudeClient();
await client.executePrompt(prompt, workingDir);
```

### GLM (Execution)
```typescript
import { OpencodeClient } from '@glm/mcp';
const client = new OpencodeClient();
// Uses HTTP API at localhost:4096
```

## Notes

- Always use pnpm (not npm/yarn)
- Dashboard runs on port 4740
- opencode server must be running for GLM execution
