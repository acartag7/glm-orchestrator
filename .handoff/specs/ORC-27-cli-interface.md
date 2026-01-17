# ORC-27: CLI Interface for Orchestrator

## Overview

`orc` CLI tool that mirrors web UI functionality from terminal for CLI-native workflows.

## Context

Currently must use web UI to run specs. CLI-native users prefer terminal, and CLI enables scriptable automation.

## Commands

```bash
orc projects              # List projects
orc specs <projectId>     # List specs
orc chunks <specId>       # List chunks
orc run-all <specId>      # Run with live output
orc status <specId>       # Show current status
orc config                # Manage configuration
```

## Package Structure

```
packages/cli/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── commands/
│   │   ├── projects.ts
│   │   ├── specs.ts
│   │   ├── chunks.ts
│   │   ├── run.ts
│   │   └── config.ts
│   └── lib/
│       ├── api.ts
│       └── output.ts
└── bin/orc
```

## Implementation

### 1. Package Setup

Create `packages/cli/package.json`:

```json
{
  "name": "@specwright/cli",
  "version": "0.1.0",
  "description": "CLI for GLM Orchestrator",
  "bin": {
    "orc": "./bin/orc"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc -w"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "chalk": "^5.3.0",
    "ora": "^8.0.0",
    "cli-table3": "^0.6.5",
    "eventsource": "^2.0.2"
  }
}
```

### 2. API Client

Create `packages/cli/src/lib/api.ts`:

```typescript
const BASE_URL = process.env.ORC_API_URL || 'http://localhost:4740';

export async function fetchProjects() {
  const res = await fetch(`${BASE_URL}/api/projects`);
  return res.json();
}

export async function fetchSpecs(projectId: string) {
  const res = await fetch(`${BASE_URL}/api/projects/${projectId}/specs`);
  return res.json();
}

export async function runAll(specId: string) {
  return fetch(`${BASE_URL}/api/specs/${specId}/run-all`, { method: 'POST' });
}
```

### 3. Main Entry Point

Create `packages/cli/src/index.ts`:

```typescript
import { Command } from 'commander';
import { projectsCommand } from './commands/projects.js';
import { specsCommand } from './commands/specs.js';
import { runCommand } from './commands/run.js';

const program = new Command();

program
  .name('orc')
  .description('CLI for GLM Orchestrator')
  .version('0.1.0');

program.addCommand(projectsCommand);
program.addCommand(specsCommand);
program.addCommand(runCommand);

program.parse();
```

## Files to Create

- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/bin/orc`
- `packages/cli/src/index.ts`
- `packages/cli/src/lib/api.ts`
- `packages/cli/src/lib/output.ts`
- `packages/cli/src/commands/projects.ts`
- `packages/cli/src/commands/specs.ts`
- `packages/cli/src/commands/run.ts`

## Dependencies

- Blocked by: ORC-5, ORC-6, ORC-9 (core execution bugs should be fixed first)

## Acceptance Criteria

- [ ] `orc projects` lists all projects
- [ ] `orc specs <projectId>` lists specs
- [ ] `orc run-all <specId>` runs with live SSE output
- [ ] Colorful, readable terminal output
- [ ] Works while dashboard is running
