# Specwright

Stop prompting. Start specifying.

Specwright turns vague feature requests into executable plans. Write a spec, let AI break it into chunks, execute each with oversight, and ship with confidence.

## The Problem

AI coding assistants are powerful but opaque. You prompt, they code, you hope it works. When it doesn't, you're back to guessing what went wrong.

**Specwright gives you control:**

1. **Specify** - Describe what you want in plain language
2. **Plan** - AI generates a step-by-step implementation plan
3. **Execute** - Watch each step run with live visibility
4. **Review** - AI reviews its own work, fixes issues automatically
5. **Ship** - One-click PR when everything passes

## What You Get

### Guided Spec Creation
A wizard that asks the right questions to turn your idea into a detailed specification. No blank page problem.

### Transparent Execution
See every file read, every edit made, every command run. No black box.

### Automatic Review Loop
After each chunk executes, AI reviews the output. Problems get fixed before you even see them.

### Git-Native Workflow
Each spec becomes a branch. Completed work becomes a PR. Clean commit history included.

### Dependency-Aware
Chunks know what came before. Later chunks build on earlier work automatically.

## Quick Start

```bash
git clone https://github.com/acartag7/specwright.git
cd specwright
pnpm install && pnpm build
pnpm dev:dashboard
```

Opens at http://localhost:4740

Requires [opencode](https://github.com/sst/opencode) running at localhost:4096 for execution.

## How It Works

```
You: "Add user authentication with JWT"
           ↓
Specwright: "Let me ask a few questions..."
    - Password storage method?
    - Required user fields?
    - Token expiration?
           ↓
Specwright generates spec + chunks:
    1. Setup dependencies
    2. Create user model
    3. Implement login endpoint
    4. Implement register endpoint
    5. Add auth middleware
           ↓
Execute → Review → Fix (if needed) → Repeat
           ↓
All chunks pass → Create PR
```

## Roadmap

**Now**
- Spec Studio wizard
- Live execution with tool call visibility
- Auto-review with fix generation
- Multi-spec projects
- Git integration (branch, commit, PR)
- Dependency graphs

**Next**
- Configuration per project
- Ralph Loop (retry until done)
- Verification steps (typecheck, lint, test)
- Parallel specs with git worktrees

**Later**
- Spec templates
- Usage analytics
- Team collaboration

## License

MIT
