# GLM Orchestrator v2 - Architecture & Implementation Plan

## Executive Summary

Refactor the GLM Orchestrator from a process-spawning wrapper to a proper client of opencode's HTTP API with real-time SSE event streaming. This enables full visibility into task execution, proper tool call tracking, and seamless dashboard integration.

---

## Repository Structure: Monorepo

Consolidate `glm-orchestrator` and `glm-orchestrator-dashboard` into a single monorepo:

```
glm-orchestrator/
├── packages/
│   ├── mcp/                    # MCP server (npm: glm-orchestrator)
│   │   ├── src/
│   │   │   ├── client/         # Opencode HTTP client
│   │   │   ├── execution/      # Task execution
│   │   │   ├── prompts/        # System prompts
│   │   │   ├── tools/          # MCP tool definitions
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── dashboard/              # Next.js web app
│   │   ├── src/
│   │   │   ├── app/            # Next.js app router
│   │   │   ├── components/     # React components
│   │   │   ├── hooks/          # useOpencodeEvents, etc.
│   │   │   └── lib/            # Utilities
│   │   ├── package.json
│   │   └── next.config.js
│   │
│   └── shared/                 # Shared types & utilities
│       ├── src/
│       │   ├── types.ts        # Event types, DB schema types
│       │   ├── schema.ts       # SQLite schema definitions
│       │   └── index.ts
│       └── package.json
│
├── .handoff/                   # Specs & documentation
├── poc/                        # Proof of concept scripts
├── package.json                # Root workspace config
├── pnpm-workspace.yaml
├── turbo.json                  # Turborepo config
└── tsconfig.base.json          # Shared TS config
```

### Workspace Configuration

**pnpm-workspace.yaml:**
```yaml
packages:
  - 'packages/*'
```

**Root package.json:**
```json
{
  "name": "glm-orchestrator-monorepo",
  "private": true,
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "dev:mcp": "pnpm --filter @glm/mcp dev",
    "dev:dashboard": "pnpm --filter @glm/dashboard dev",
    "lint": "turbo lint",
    "test": "turbo test"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.7.0"
  }
}
```

**turbo.json:**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

### Package Names
- `@glm/mcp` → publishes as `glm-orchestrator` on npm
- `@glm/dashboard` → not published (web app)
- `@glm/shared` → internal package, not published

### Migration Steps
1. Create new monorepo structure
2. Move orchestrator code to `packages/mcp/`
3. Move dashboard code to `packages/dashboard/`
4. Extract shared types to `packages/shared/`
5. Update imports to use workspace packages
6. Update CI/CD for monorepo (turbo)
7. Update npm publish config for `@glm/mcp`

---

## Current Problems (v1)

### 1. Black Box Execution
```typescript
// Current: spawn and hope
const proc = spawn("opencode", ["run", "-m", "zai-coding-plan/glm-4.7", task]);
// Wait for completion, parse stdout blob
```
- No visibility into what's happening during execution
- Tool calls only visible after completion (via stdout parsing)
- No way to see file operations in real-time

### 2. Fragile Output Parsing
```typescript
// Regex matching keywords from stdout
if (line.includes("Tool:") || line.includes("Created") || ...)
```
- Brittle, breaks with output format changes
- Misses structured information (tool inputs/outputs, timing)

### 3. No Streaming Progress
- Dashboard only sees tasks after completion
- Users wait with no feedback during long operations
- `split_spec_into_chunks` returned useless generic chunks

### 4. Limited Control
- Cancellation via SIGTERM (unreliable)
- No pause/resume capability
- No ability to inject guidance mid-task

---

## New Architecture (v2)

### Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GLM Orchestrator MCP                         │
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │   Session   │    │   Event     │    │    Task Execution       │ │
│  │   Manager   │    │   Handler   │    │    (Prompts/Abort)      │ │
│  └──────┬──────┘    └──────┬──────┘    └───────────┬─────────────┘ │
│         │                  │                       │               │
└─────────┼──────────────────┼───────────────────────┼───────────────┘
          │                  │                       │
          │ HTTP             │ SSE                   │ HTTP
          │                  │                       │
┌─────────▼──────────────────▼───────────────────────▼───────────────┐
│                     Opencode Server (port 4096)                     │
│                                                                     │
│   POST /session              GET /global/event                      │
│   POST /session/:id/prompt   (streams ALL events)                   │
│   POST /session/:id/abort                                           │
│   GET  /session/:id/message                                         │
└─────────────────────────────────────────────────────────────────────┘
          │
          │ LLM API
          ▼
┌─────────────────────┐
│  zai-coding-plan    │
│     glm-4.7         │
└─────────────────────┘


Event Flow (Real-time):
═══════════════════════

1. session.created        → Task starts
2. session.status: busy   → Executing
3. message.part.updated   → Tool call (pending)
4. message.part.updated   → Tool call (running) + input
5. message.part.updated   → Tool call (completed) + output
6. message.part.updated   → Text streaming (token by token)
7. session.status: idle   → Complete

All events written to SQLite → Dashboard polls/reads
```

### Key Components

#### 1. Opencode Client (`src/client/opencode.ts`) - For GLM

Typed client for opencode's HTTP API:

```typescript
interface OpencodeClient {
  // Session management
  createSession(opts: { directory: string; title?: string }): Promise<Session>;
  getSession(id: string): Promise<Session>;
  deleteSession(id: string): Promise<void>;

  // Prompt execution
  sendPrompt(sessionId: string, opts: PromptOptions): Promise<void>;
  sendPromptSync(sessionId: string, opts: PromptOptions): Promise<Message>;
  abortSession(sessionId: string): Promise<void>;

  // Messages
  getMessages(sessionId: string): Promise<Message[]>;
  getMessage(sessionId: string, messageId: string): Promise<Message>;

  // Event streaming
  subscribeToEvents(handler: EventHandler): () => void;
}

interface PromptOptions {
  parts: Array<{ type: "text"; text: string }>;
  model: {
    providerID: string;  // "zai-coding-plan" or "github-copilot"
    modelID: string;     // "glm-4.7" or "claude-opus-4.5"
  };
  systemPrompt?: string;  // Custom system prompt for task specificity
}
```

#### 2. Claude Client (`src/client/claude.ts`) - For Opus

Typed client for Claude CLI stream-json:

```typescript
interface ClaudeClient {
  execute(prompt: string, opts?: ClaudeOptions): AsyncGenerator<ClaudeEvent>;
}

interface ClaudeOptions {
  workingDirectory?: string;
  model?: string;  // defaults to claude-opus-4-5-20250514
}

type ClaudeEvent =
  | { type: "system"; subtype: "init"; session_id: string; tools: string[] }
  | { type: "assistant"; message: { content: Array<ToolUse | TextContent> } }
  | { type: "user"; message: { content: Array<ToolResult> } }
  | { type: "result"; subtype: "success" | "error"; total_cost_usd: number };

interface ToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

// Implementation: spawn claude -p --output-format stream-json
// Parse NDJSON from stdout
```

#### 3. Event Handler (`src/client/events.ts`)

Process SSE events and write to database:

```typescript
interface EventHandler {
  onSessionStatus(sessionId: string, status: SessionStatus): void;
  onToolCall(sessionId: string, toolCall: ToolCallEvent): void;
  onTextChunk(sessionId: string, text: string): void;
  onFileEdit(path: string, diff: FileDiff): void;
  onError(sessionId: string, error: ErrorInfo): void;
  onComplete(sessionId: string): void;
}

interface ToolCallEvent {
  callId: string;
  tool: string;
  state: "pending" | "running" | "completed" | "error";
  input?: Record<string, unknown>;
  output?: string;
  time?: { start: number; end?: number };
}
```

#### 3. Task Executor (`src/execution/executor.ts`)

Replace `executeGLM` with proper session-based execution:

```typescript
interface TaskExecutor {
  execute(task: TaskDefinition): Promise<TaskResult>;
  executeWithStreaming(
    task: TaskDefinition,
    onProgress: ProgressCallback
  ): Promise<TaskResult>;
}

interface TaskDefinition {
  prompt: string;
  workingDirectory: string;
  systemPrompt?: string;
  model?: ModelConfig;
  timeout?: number;
}

interface TaskResult {
  sessionId: string;
  success: boolean;
  output: string;
  toolCalls: ToolCall[];
  filesCreated: string[];
  filesModified: string[];
  duration: number;
  tokens: TokenUsage;
}
```

#### 4. System Prompts (`src/prompts/`)

Specialized system prompts for different task types:

```typescript
// src/prompts/implementation.ts
export const IMPLEMENTATION_PROMPT = `
You are implementing a feature based on a specification.

RULES:
1. Read the spec file first to understand requirements
2. Create files in the order specified
3. After creating each file, verify it compiles/lints
4. Do NOT skip any requirements from the spec
5. Use existing patterns from the codebase

WORKFLOW:
1. Read spec file
2. Analyze existing code patterns
3. Create types/interfaces first
4. Implement core functionality
5. Add error handling
6. Verify with build/lint
`;

// src/prompts/review.ts
export const REVIEW_PROMPT = `
You are reviewing code for quality, security, and correctness.

FOCUS AREAS:
1. Security vulnerabilities (injection, path traversal, etc.)
2. Error handling completeness
3. Type safety
4. Performance implications
5. Code consistency with existing patterns

OUTPUT FORMAT:
- List issues by severity (P0, P1, P2, P3)
- Include file:line references
- Suggest specific fixes
`;

// src/prompts/spec-writing.ts
export const SPEC_PROMPT = `
You are writing a detailed implementation specification.

REQUIREMENTS:
1. Include exact file paths to create/modify
2. Define all interfaces/types
3. Specify error handling requirements
4. Include test requirements
5. Reference existing patterns to follow

FORMAT:
## Overview
## File Structure
## Types & Interfaces (with full definitions)
## Implementation Details (per file)
## Error Handling
## Testing Requirements
`;
```

---

## Database Schema Updates

### Current Schema (keep)
```sql
servers (id, folder_name, pid, connected_at, last_heartbeat, status)
tasks (id, server_id, workflow_id, status, description, prompt, output, error, started_at, completed_at)
tool_calls (id, task_id, tool_name, input, output, duration_ms, called_at)
workflows (id, server_id, name, status, current_stage, stages, created_at, updated_at)
```

### New Fields
```sql
-- Add to tasks table
ALTER TABLE tasks ADD COLUMN session_id TEXT;  -- opencode session ID
ALTER TABLE tasks ADD COLUMN model_id TEXT;    -- e.g., "glm-4.7"
ALTER TABLE tasks ADD COLUMN provider_id TEXT; -- e.g., "zai-coding-plan"
ALTER TABLE tasks ADD COLUMN tokens_input INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN tokens_output INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN cost REAL DEFAULT 0;

-- Add to tool_calls table
ALTER TABLE tool_calls ADD COLUMN call_id TEXT;  -- opencode's callID
ALTER TABLE tool_calls ADD COLUMN state TEXT;    -- pending/running/completed/error

-- New table for streaming text
CREATE TABLE IF NOT EXISTS task_output_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  chunk TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- New table for file operations
CREATE TABLE IF NOT EXISTS file_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  operation TEXT NOT NULL,  -- read/write/edit
  file_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

---

## Tool Definitions (Updated)

### delegate_to_glm (Updated)
```typescript
{
  name: "delegate_to_glm",
  description: "Delegate a coding task to GLM-4.7 with real-time progress tracking",
  parameters: {
    task: { type: "string", description: "Task description" },
    workingDirectory: { type: "string", description: "Project directory" },
    systemPrompt: { type: "string", description: "Custom system prompt (optional)" },
    timeoutMs: { type: "number", description: "Timeout (default: 180000)" }
  }
}
```

### delegate_to_opus (New)
```typescript
{
  name: "delegate_to_opus",
  description: "Delegate planning/review tasks to Claude Opus 4.5",
  parameters: {
    task: { type: "string", description: "Task (planning, review, spec writing)" },
    workingDirectory: { type: "string", description: "Project directory" },
    taskType: {
      type: "string",
      enum: ["plan", "review", "spec"],
      description: "Type of task (determines system prompt)"
    },
    timeoutMs: { type: "number", description: "Timeout (default: 300000)" }
  }
}
```

### write_spec (Updated)
```typescript
{
  name: "write_spec",
  description: "Have Opus write a detailed implementation spec",
  parameters: {
    featureName: { type: "string" },
    requirements: { type: "string", description: "High-level requirements" },
    workingDirectory: { type: "string" }
  }
}
// Internally uses delegate_to_opus with SPEC_PROMPT
```

### Remove: split_spec_into_chunks
The calling model (Opus) should generate chunks directly based on the spec content.
This tool was useless with its generic fallback.

---

## Provider Configuration

### GLM-4.7 (Implementation)
```typescript
{
  providerID: "zai-coding-plan",
  modelID: "glm-4.7"
}
```
- Fast execution
- Good at following instructions
- Use for: file creation, code implementation, bug fixes

### Claude Opus 4.5 (Planning/Review)

**Two providers supported:**

1. **Claude CLI** (Personal Max subscription - works anywhere):
```bash
claude -p "prompt" --output-format stream-json --model claude-opus-4-5-20250514
```

2. **Opencode github-copilot** (Work account - work only):
```typescript
{
  providerID: "github-copilot",
  modelID: "claude-opus-4.5"
}
```

**Claude CLI stream-json format (validated in POC):**
```json
{"type":"system","subtype":"init","session_id":"...","tools":[...]}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{...}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"..."}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
{"type":"result","subtype":"success","total_cost_usd":0.039,"usage":{...}}
```

- Better reasoning
- Better at architecture decisions
- Use for: spec writing, code review, planning

---

## Implementation Plan

### Phase 1: Core Client (Priority: P0)

**Files to create:**
1. `src/client/opencode.ts` - HTTP client for opencode API
2. `src/client/events.ts` - SSE event handler
3. `src/client/types.ts` - TypeScript types for API

**Tasks:**
- [ ] Implement `OpencodeClient` class
- [ ] Implement SSE subscription with reconnection
- [ ] Add event parsing and typing
- [ ] Add connection health checking
- [ ] Add retry logic for failed requests

### Phase 2: Event-Driven Execution (Priority: P0)

**Files to modify:**
1. `src/execution/task.ts` - Replace spawn with HTTP calls
2. `src/lib/db.ts` - Add new schema fields

**Tasks:**
- [ ] Create `TaskExecutor` using `OpencodeClient`
- [ ] Wire event handler to database writes
- [ ] Implement real-time tool call tracking
- [ ] Add streaming text capture
- [ ] Update task completion logic

### Phase 3: System Prompts (Priority: P1)

**Files to create:**
1. `src/prompts/implementation.ts`
2. `src/prompts/review.ts`
3. `src/prompts/spec.ts`
4. `src/prompts/index.ts`

**Tasks:**
- [ ] Define specialized system prompts
- [ ] Add prompt selection logic based on task type
- [ ] Test prompts with real tasks

### Phase 4: Opus Integration (Priority: P1)

**Files to modify:**
1. `src/tools/definitions.ts` - Add `delegate_to_opus`
2. `src/tools/delegate.ts` - Implement opus delegation
3. `src/tools/spec.ts` - Update to use opus

**Tasks:**
- [ ] Add `delegate_to_opus` tool
- [ ] Update `write_spec` to use opus
- [ ] Remove `split_spec_into_chunks`
- [ ] Test opus integration

### Phase 5: Dashboard Rewrite (Priority: P1)

The dashboard at `/Users/acartagena/project/glm-orchestrator-dashboard` should be rewritten to leverage real-time events.

**Architecture Change:**

```
CURRENT (Polling SQLite):
┌──────────┐     Poll every 2s      ┌──────────┐
│Dashboard │ ◄─────────────────────►│  SQLite  │
└──────────┘                        └──────────┘

NEW (SSE + SQLite):
┌──────────┐     SSE stream         ┌──────────┐
│Dashboard │ ◄─────────────────────►│ Opencode │
│          │                        │  Server  │
│          │     Read history       └──────────┘
│          │ ◄─────────────────────►┌──────────┐
└──────────┘                        │  SQLite  │
                                    └──────────┘
```

**Option A: Direct SSE from Dashboard**
- Dashboard connects directly to `http://localhost:4096/global/event`
- Real-time updates without polling
- SQLite only for historical data
- Simpler architecture

**Option B: Orchestrator as Proxy**
- Orchestrator proxies events via WebSocket
- Dashboard connects to orchestrator
- More control over event filtering
- Dashboard doesn't need opencode running

**Recommendation: Option A** - simpler, leverages existing opencode infrastructure.

**Dashboard Pages:**

1. **Live View** (`/`)
   - Real-time event stream
   - Active sessions with live tool calls
   - Streaming text output as it generates
   - Cancel button per session

2. **Session Detail** (`/session/[id]`)
   - Full conversation history
   - Tool call timeline with expand/collapse
   - File diff viewer
   - Token usage & cost

3. **History** (`/history`)
   - Past sessions (from SQLite)
   - Search & filter
   - Replay capability

4. **Servers** (`/servers`)
   - Connected MCP servers
   - Health status
   - Active session count per server

**New Components:**

```typescript
// Real-time event hook
function useOpencodeEvents() {
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    const eventSource = new EventSource('http://localhost:4096/global/event');
    eventSource.onmessage = (e) => {
      const event = JSON.parse(e.data);
      setEvents(prev => [...prev, event]);
    };
    return () => eventSource.close();
  }, []);

  return events;
}

// Tool call timeline component
function ToolCallTimeline({ sessionId }: { sessionId: string }) {
  const events = useOpencodeEvents();
  const toolCalls = events
    .filter(e => e.payload.type === 'message.part.updated')
    .filter(e => e.payload.properties.part?.type === 'tool');

  return (
    <div className="space-y-2">
      {toolCalls.map(tc => (
        <ToolCallCard
          key={tc.payload.properties.part.callID}
          tool={tc.payload.properties.part.tool}
          state={tc.payload.properties.part.state}
        />
      ))}
    </div>
  );
}

// Streaming text component
function StreamingText({ sessionId }: { sessionId: string }) {
  const [text, setText] = useState('');
  const events = useOpencodeEvents();

  useEffect(() => {
    const textParts = events
      .filter(e => e.payload.type === 'message.part.updated')
      .filter(e => e.payload.properties.part?.type === 'text');

    if (textParts.length > 0) {
      const latest = textParts[textParts.length - 1];
      setText(latest.payload.properties.part.text);
    }
  }, [events]);

  return <pre className="font-mono text-sm">{text}<Cursor /></pre>;
}
```

**Dashboard Tasks:**
- [ ] Add SSE connection to opencode server
- [ ] Create `useOpencodeEvents` hook
- [ ] Build `ToolCallTimeline` component
- [ ] Build `StreamingText` component
- [ ] Build `SessionCard` with live status
- [ ] Add session detail page with full history
- [ ] Keep SQLite for historical queries only
- [ ] Add connection status indicator
- [ ] Handle SSE reconnection

---

## Testing Strategy

### Unit Tests
- `OpencodeClient` mock server responses
- Event parser correctness
- Database write accuracy

### Integration Tests
- End-to-end task execution with real opencode server
- Event streaming reliability
- Session cleanup on errors

### POC Validation (Already Done)
```
✅ Session creation via API
✅ Prompt sending (async)
✅ SSE event streaming
✅ Tool call events (pending → running → completed)
✅ Text streaming (token by token)
✅ Session status (busy → idle)
```

---

## Migration Path

1. **Keep existing tools working** during transition
2. **Add new implementation** alongside old
3. **Feature flag** to switch between old/new
4. **Remove old code** after validation

```typescript
// Feature flag
const USE_HTTP_API = process.env.GLM_USE_HTTP_API === "true";

export async function delegateToGLM(task, workingDirectory, timeout) {
  if (USE_HTTP_API) {
    return executeViaHttpApi(task, workingDirectory, timeout);
  }
  return executeViaSpawn(task, workingDirectory, timeout);
}
```

---

## Dependencies

### Required
- opencode server running (`opencode serve`)
- Network access to localhost:4096

### Optional
- github-copilot subscription (for Opus tasks)

### NPM Packages (No new ones needed)
- Existing `zod` for validation
- Native `fetch` for HTTP
- Native `EventSource` alternative (manual SSE parsing, already in POC)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Opencode server not running | Health check on startup, clear error message |
| SSE connection drops | Auto-reconnect with exponential backoff |
| Session cleanup on crash | Heartbeat + cleanup on server registration |
| API changes in opencode | Pin to tested version, monitor releases |

---

## Success Metrics

1. **Visibility**: See every tool call in real-time (not after completion)
2. **Reliability**: No more stdout parsing failures
3. **Performance**: Dashboard updates within 100ms of events
4. **Control**: Abort works instantly via API

---

## Files Reference

### To Create
```
src/client/
  opencode.ts      # HTTP client
  events.ts        # SSE handler
  types.ts         # TypeScript types
src/prompts/
  implementation.ts
  review.ts
  spec.ts
  index.ts
```

### To Modify
```
src/execution/task.ts   # Use new executor
src/lib/db.ts           # New schema
src/tools/definitions.ts # New tools
src/tools/delegate.ts    # HTTP implementation
src/tools/spec.ts        # Remove split_spec_into_chunks
src/index.ts             # Server startup checks
```

### To Delete
```
src/utils/glm.ts        # After migration complete
```

---

## Appendix: POC Results

### GLM via Opencode HTTP API

From `poc/opencode-client.ts`:

```
✅ Opencode server healthy: { healthy: true, version: '1.1.10' }
✅ Session created: ses_443033851ffegzbq1Iq1uwlL1I
✅ Prompt accepted (async)
📊 Session status: busy
🔧 Tool call: read - state: {"status":"pending"}
🔧 Tool call: read - state: {"status":"running","input":{"filePath":"...package.json"}}
🔧 Tool call: read - state: {"status":"completed","output":"<file>..."}
📝 Text: "glm-orchestrator v1.0.0"
📊 Session status: idle
✅ Session idle (complete)
```

### Opus via Claude CLI stream-json

From `poc/claude-cli-opus.ts` (validated manually):

```
{"type":"system","subtype":"init","session_id":"f8816e1b-...","tools":["Read","Edit",...]}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"...package.json"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"...file content..."}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"The version is **1.0.0**."}]}}
{"type":"result","subtype":"success","total_cost_usd":0.039,"duration_ms":5834}
```

**Both approaches provide:**
- Real-time streaming events
- Tool call visibility (name, inputs, outputs)
- Cost tracking
- Session management

### POC Files
- `poc/opencode-client.ts` - GLM via opencode HTTP API + SSE
- `poc/claude-cli-opus.ts` - Opus via Claude CLI stream-json
- `poc/opencode-opus.ts` - Opus via opencode github-copilot (for work)
