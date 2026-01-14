# GLM Orchestrator Dashboard UI

## Overview

A web-based dashboard to visualize GLM orchestrator activity in real-time. Runs as a local web server that users can open in their browser.

## Architecture

```
┌─────────────────┐     writes      ┌──────────────────┐
│  MCP Server     │ ───────────────▶│  .handoff/state  │
│  (orchestrator) │                 │  (JSON files)    │
└─────────────────┘                 └────────┬─────────┘
                                             │ reads
                                             ▼
┌─────────────────┐     serves      ┌──────────────────┐
│  Browser        │ ◀───────────────│  Dashboard       │
│  (localhost)    │                 │  HTTP Server     │
└─────────────────┘                 └──────────────────┘
```

## Features

### 1. Active Tasks Panel
- Show currently running GLM tasks
- Task ID, start time, elapsed time
- Working directory
- Live status indicator (spinner)
- Cancel button (calls API)

### 2. Workflow Visualization
- Show workflow stages as a pipeline
- Task dependencies as a graph
- Status colors: pending (gray), running (blue), completed (green), failed (red)
- Expand to see task details

### 3. History Panel
- List of completed tasks/workflows
- Timestamp, duration, status
- Expandable to see full output
- Filterable by status, date

### 4. Real-time Updates
- Poll server every 2 seconds
- Or use Server-Sent Events (SSE) for push updates
- Visual indicators for new activity

## Implementation

### File: `src/dashboard/server.ts`

Simple HTTP server using Node.js built-in `http` module (no dependencies).

```typescript
import { createServer } from "http";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const PORT = 3847; // Unique port for orchestrator dashboard

// State file paths
const STATE_DIR = ".handoff/state";

export function startDashboard(workingDirectory: string) {
  const stateDir = join(workingDirectory, STATE_DIR);
  
  const server = createServer((req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    
    if (req.url === "/" || req.url === "/index.html") {
      // Serve dashboard HTML
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(DASHBOARD_HTML);
    } 
    else if (req.url === "/api/state") {
      // Return current state
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getState(stateDir)));
    }
    else if (req.url === "/api/history") {
      // Return task history
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getHistory(stateDir)));
    }
    else if (req.url?.startsWith("/api/cancel/")) {
      // Cancel a task
      const taskId = req.url.split("/").pop();
      // ... cancel logic
    }
    else {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  
  server.listen(PORT, () => {
    console.error(`Dashboard: http://localhost:${PORT}`);
  });
  
  return server;
}
```

### File: `src/dashboard/html.ts`

Inline HTML/CSS/JS for the dashboard (single file, no build step).

```typescript
export const DASHBOARD_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>GLM Orchestrator</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #58a6ff; margin-bottom: 20px; }
    .panel {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .panel h2 { 
      font-size: 14px; 
      color: #8b949e; 
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .task {
      background: #21262d;
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 8px;
    }
    .task-id { font-family: monospace; color: #58a6ff; }
    .task-time { color: #8b949e; font-size: 12px; }
    .status-running { color: #3fb950; }
    .status-completed { color: #8b949e; }
    .status-failed { color: #f85149; }
    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid #3fb950;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .empty { color: #484f58; font-style: italic; }
    .btn {
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn:hover { background: #30363d; }
    .btn-danger { border-color: #f85149; color: #f85149; }
    .output {
      background: #0d1117;
      padding: 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      margin-top: 8px;
    }
    .workflow-graph {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .workflow-stage {
      background: #21262d;
      padding: 8px 12px;
      border-radius: 4px;
      border-left: 3px solid #484f58;
    }
    .workflow-stage.active { border-left-color: #3fb950; }
    .workflow-stage.completed { border-left-color: #8b949e; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🤖 GLM Orchestrator</h1>
    
    <div class="panel">
      <h2>Active Tasks</h2>
      <div id="active-tasks"><span class="empty">No active tasks</span></div>
    </div>
    
    <div class="panel">
      <h2>Workflows</h2>
      <div id="workflows"><span class="empty">No workflows</span></div>
    </div>
    
    <div class="panel">
      <h2>History</h2>
      <div id="history"><span class="empty">No history yet</span></div>
    </div>
  </div>
  
  <script>
    async function fetchState() {
      try {
        const res = await fetch('/api/state');
        const state = await res.json();
        renderActiveTasks(state.activeTasks || []);
        renderWorkflows(state.workflows || []);
      } catch (e) {
        console.error('Failed to fetch state:', e);
      }
    }
    
    async function fetchHistory() {
      try {
        const res = await fetch('/api/history');
        const history = await res.json();
        renderHistory(history || []);
      } catch (e) {
        console.error('Failed to fetch history:', e);
      }
    }
    
    function renderActiveTasks(tasks) {
      const el = document.getElementById('active-tasks');
      if (tasks.length === 0) {
        el.innerHTML = '<span class="empty">No active tasks</span>';
        return;
      }
      el.innerHTML = tasks.map(t => \`
        <div class="task">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="task-id">\${t.id}</span>
            <button class="btn btn-danger" onclick="cancelTask('\${t.id}')">Cancel</button>
          </div>
          <div class="task-time">
            <span class="spinner"></span>
            Running for \${Math.round((Date.now() - t.startTime) / 1000)}s
          </div>
          <div style="margin-top:4px;font-size:12px;color:#8b949e">\${t.workingDirectory || ''}</div>
        </div>
      \`).join('');
    }
    
    function renderWorkflows(workflows) {
      const el = document.getElementById('workflows');
      if (workflows.length === 0) {
        el.innerHTML = '<span class="empty">No workflows</span>';
        return;
      }
      el.innerHTML = workflows.map(w => \`
        <div class="task">
          <div class="task-id">\${w.name}</div>
          <div class="workflow-graph">
            \${w.stages.map(s => \`
              <div class="workflow-stage \${s.status}">
                \${s.name} (\${s.tasks?.length || 0} tasks)
              </div>
            \`).join('→')}
          </div>
        </div>
      \`).join('');
    }
    
    function renderHistory(items) {
      const el = document.getElementById('history');
      if (items.length === 0) {
        el.innerHTML = '<span class="empty">No history yet</span>';
        return;
      }
      el.innerHTML = items.slice(0, 20).map(h => \`
        <div class="task">
          <div style="display:flex;justify-content:space-between">
            <span class="task-id">\${h.type}: \${h.id}</span>
            <span class="status-\${h.status}">\${h.status}</span>
          </div>
          <div class="task-time">\${new Date(h.timestamp).toLocaleString()} · \${h.duration}s</div>
          \${h.output ? \`<div class="output">\${h.output.substring(0, 500)}</div>\` : ''}
        </div>
      \`).join('');
    }
    
    async function cancelTask(taskId) {
      await fetch('/api/cancel/' + taskId, { method: 'POST' });
      fetchState();
    }
    
    // Poll every 2 seconds
    fetchState();
    fetchHistory();
    setInterval(fetchState, 2000);
    setInterval(fetchHistory, 5000);
  </script>
</body>
</html>
`;
```

### File: `src/dashboard/state.ts`

State management - writes state to files, reads for API.

```typescript
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";

export interface TaskState {
  id: string;
  type: "task" | "chunk" | "workflow";
  status: "running" | "completed" | "failed";
  startTime: number;
  endTime?: number;
  duration?: number;
  workingDirectory: string;
  output?: string;
}

export interface DashboardState {
  activeTasks: TaskState[];
  workflows: any[];
}

const STATE_FILE = "dashboard-state.json";
const HISTORY_FILE = "dashboard-history.json";

export function getStateDir(workingDirectory: string): string {
  const dir = join(workingDirectory, ".handoff", "state");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function saveState(workingDirectory: string, state: DashboardState) {
  const dir = getStateDir(workingDirectory);
  writeFileSync(join(dir, STATE_FILE), JSON.stringify(state, null, 2));
}

export function loadState(workingDirectory: string): DashboardState {
  const file = join(getStateDir(workingDirectory), STATE_FILE);
  if (!existsSync(file)) {
    return { activeTasks: [], workflows: [] };
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

export function addToHistory(workingDirectory: string, task: TaskState) {
  const dir = getStateDir(workingDirectory);
  const file = join(dir, HISTORY_FILE);
  let history: TaskState[] = [];
  if (existsSync(file)) {
    history = JSON.parse(readFileSync(file, "utf-8"));
  }
  history.unshift({ ...task, timestamp: Date.now() });
  // Keep last 100 items
  history = history.slice(0, 100);
  writeFileSync(file, JSON.stringify(history, null, 2));
}

export function loadHistory(workingDirectory: string): TaskState[] {
  const file = join(getStateDir(workingDirectory), HISTORY_FILE);
  if (!existsSync(file)) {
    return [];
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}
```

### Integration with GLM execution

Update `src/utils/glm.ts` to write state:

```typescript
import { saveState, loadState, addToHistory } from "../dashboard/state.js";

// In executeGLM, before spawning:
const state = loadState(workingDirectory);
state.activeTasks.push({
  id: taskId,
  type: "task",
  status: "running",
  startTime: Date.now(),
  workingDirectory,
});
saveState(workingDirectory, state);

// On completion:
state.activeTasks = state.activeTasks.filter(t => t.id !== taskId);
saveState(workingDirectory, state);
addToHistory(workingDirectory, {
  id: taskId,
  type: "task",
  status: code === 0 ? "completed" : "failed",
  startTime,
  endTime: Date.now(),
  duration: Math.round((Date.now() - startTime) / 1000),
  workingDirectory,
  output: stdout.substring(0, 1000),
});
```

### New MCP Tool: `start_dashboard`

Add tool to start the dashboard server:

```typescript
{
  name: "start_dashboard",
  description: "Start the web dashboard to visualize orchestrator activity. Opens http://localhost:3847",
  inputSchema: {
    type: "object",
    properties: {
      workingDirectory: {
        type: "string",
        description: "Project directory to monitor",
      },
    },
    required: ["workingDirectory"],
  },
}
```

## File Structure

```
src/
  dashboard/
    server.ts      # HTTP server
    html.ts        # Dashboard HTML/CSS/JS
    state.ts       # State management
  index.ts         # Add start_dashboard tool
  utils/
    glm.ts         # Add state tracking
```

## Usage

1. Call `start_dashboard` tool with working directory
2. Open http://localhost:3847 in browser
3. See real-time task activity, workflows, history
4. Cancel tasks from the UI

## Design

- Dark theme (GitHub-style)
- Minimal, clean interface
- Real-time updates via polling
- Mobile-responsive
- No external dependencies (pure HTML/CSS/JS)
