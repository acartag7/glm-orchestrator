# Specwright - Spec-Driven Development Platform

A web-based tool for structured AI-assisted software development. "Specwright" = one who crafts specs.

## What It Does

1. **Write Specs** - Create feature specifications with AI assistance (Claude Opus)
2. **Break Into Chunks** - Split specs into discrete, executable tasks
3. **Execute with GLM** - Run chunks through GLM-4.7 with real-time progress
4. **Review & Iterate** - See results, retry failures, refine approach

## Why?

| Tool | Approach |
|------|----------|
| Cursor/Windsurf | Black box - you prompt, it codes |
| **This** | Transparent - you see the plan, control each step |

## Screenshot

```
┌─────────────────────────────────────────────────────────────────┐
│  Project: My API                                                │
├─────────────────────────────┬───────────────────────────────────┤
│  SPEC                       │  EXECUTION                        │
│  ┌───────────────────────┐  │  ┌─────────────────────────────┐  │
│  │ # Auth Feature        │  │  │ Running chunk 2/4...        │  │
│  │                       │  │  │                             │  │
│  │ JWT authentication    │  │  │ read  src/auth/jwt.ts   ✓  │  │
│  │ with login/register   │  │  │ write src/routes/...    ◐  │  │
│  │                       │  │  │ edit  package.json      ○  │  │
│  │ [Ask Opus to Refine]  │  │  │                             │  │
│  └───────────────────────┘  │  └─────────────────────────────┘  │
│                             │                                   │
│  CHUNKS                     │                                   │
│  ☑ 1. Setup deps       [●]  │                                   │
│  ◐ 2. Auth routes      [■]  │                                   │
│  ○ 3. Middleware       [▶]  │                                   │
│  ○ 4. Tests            [▶]  │                                   │
└─────────────────────────────┴───────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- [opencode](https://github.com/sst/opencode) (for GLM execution)
- Claude CLI (for Opus integration)

### Install & Run

```bash
git clone https://github.com/acartag7/specwright.git
cd specwright
pnpm install
pnpm build

# Start the dashboard
pnpm --filter @specwright/dashboard dev
# Opens at http://localhost:4740
```

### Start opencode Server

```bash
opencode
# Runs at http://localhost:4096
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Web UI       │────▶│    Backend      │────▶│   Executors     │
│   (Next.js)     │     │  (API Routes)   │     │                 │
└─────────────────┘     └─────────────────┘     │  ┌───────────┐  │
                               │                │  │   Opus    │  │
                               │                │  │ (planning)│  │
                        ┌──────▼──────┐         │  └───────────┘  │
                        │   SQLite    │         │  ┌───────────┐  │
                        │  Database   │         │  │    GLM    │  │
                        └─────────────┘         │  │(execution)│  │
                                                │  └───────────┘  │
                                                └─────────────────┘
```

## Project Structure

```
packages/
├── dashboard/          # Next.js web app
│   ├── src/app/        # Pages and API routes
│   ├── src/components/ # React components
│   └── src/lib/        # Database, utilities
├── shared/             # Shared TypeScript types
└── mcp/                # AI client libraries
    ├── client/
    │   ├── opencode.ts # GLM HTTP client
    │   └── claude.ts   # Opus CLI client
    └── ...
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Backend | Next.js API Routes |
| Database | SQLite (better-sqlite3) |
| AI - Planning | Claude CLI (Opus 4.5) |
| AI - Execution | opencode HTTP API (GLM-4.7) |
| Real-time | Server-Sent Events |

## Roadmap

### MVP (Current)
- [x] Project structure
- [x] Dashboard foundation
- [x] AI client libraries
- [ ] Project CRUD
- [ ] Spec editor
- [ ] Chunk management
- [ ] Execution view

### Phase 2
- [ ] Review loop (Opus checks GLM output)
- [ ] Parallel chunk execution
- [ ] n8n-style graph visualization

### Phase 3
- [ ] Git integration (PR per feature)
- [ ] CI/CD integration
- [ ] Team collaboration

## Development

```bash
# Install
pnpm install

# Run dashboard in dev mode
pnpm --filter @specwright/dashboard dev

# Build all packages
pnpm build

# Run tests
pnpm test
```

## License

MIT
