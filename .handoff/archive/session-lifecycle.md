# Session Lifecycle Management Spec

## Problem Statement

Currently, opencode sessions continue running independently after the Claude Code session that spawned them closes. This leads to:

1. **Orphaned processes** - Sessions keep running with no parent monitoring them
2. **Resource leaks** - Memory and connections accumulate over time
3. **Dashboard confusion** - Shows "active" sessions that are actually abandoned
4. **No cleanup mechanism** - Manual intervention required to stop stale sessions

## Goals

1. Track session ownership (which Claude session/server spawned each task)
2. Detect when parent sessions disconnect
3. Automatically cleanup orphaned sessions
4. Provide manual session management in the dashboard
5. Maintain session history for debugging

## Architecture

### 1. Session Ownership Model

```
┌─────────────────────────────────────────────────────────────────┐
│                      MCP Server Instance                        │
│                        (orchestrator:12345)                     │
├─────────────────────────────────────────────────────────────────┤
│  server_id: "orchestrator:12345"                                │
│  started_at: timestamp                                          │
│  last_heartbeat: timestamp                                      │
│  status: "active" | "disconnected" | "stale"                    │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  GLM Task   │  │  GLM Task   │  │  Opus Task  │              │
│  │  session_1  │  │  session_2  │  │  task_1     │              │
│  │  (opencode) │  │  (opencode) │  │  (claude)   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Database Schema Updates

```sql
-- Existing servers table (add heartbeat tracking)
ALTER TABLE servers ADD COLUMN last_heartbeat INTEGER;
ALTER TABLE servers ADD COLUMN status TEXT DEFAULT 'active';

-- New session_tasks junction table
CREATE TABLE session_tasks (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  opencode_session_id TEXT,  -- For GLM tasks
  claude_process_id INTEGER, -- For Opus tasks
  task_id TEXT NOT NULL,
  status TEXT DEFAULT 'running',
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  cleanup_reason TEXT,
  FOREIGN KEY (server_id) REFERENCES servers(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Index for fast orphan detection
CREATE INDEX idx_session_tasks_status ON session_tasks(status, server_id);
```

### 3. Heartbeat System

#### MCP Server Side
```typescript
// Send heartbeat every 30 seconds
const HEARTBEAT_INTERVAL = 30_000;
const STALE_THRESHOLD = 90_000; // 3 missed heartbeats = stale

class HeartbeatManager {
  private interval: NodeJS.Timeout;

  start(serverId: string, db: Database) {
    this.interval = setInterval(() => {
      db.updateServerHeartbeat(serverId, Date.now());
    }, HEARTBEAT_INTERVAL);
  }

  stop() {
    clearInterval(this.interval);
  }
}
```

#### Dashboard Side (Stale Detection)
```typescript
// API route: GET /api/cleanup/stale
async function detectStaleSessions(db: Database) {
  const staleThreshold = Date.now() - STALE_THRESHOLD;

  return db.query(`
    SELECT s.*, COUNT(st.id) as active_tasks
    FROM servers s
    LEFT JOIN session_tasks st ON s.id = st.server_id AND st.status = 'running'
    WHERE s.last_heartbeat < ? AND s.status = 'active'
    GROUP BY s.id
  `, [staleThreshold]);
}
```

### 4. Cleanup Strategies

#### Strategy A: Graceful Cleanup (Default)
1. Detect stale server (no heartbeat for 90s)
2. Mark server as "disconnected"
3. For each running task:
   - Try to abort opencode session via HTTP API
   - Wait 5s for graceful shutdown
   - Mark task as "orphaned" if still running
4. Mark server as "stale" after cleanup

#### Strategy B: Aggressive Cleanup (User-triggered)
1. User clicks "Force Cleanup" in dashboard
2. Kill all opencode sessions for that server
3. Mark all tasks as "cancelled"
4. Remove server from active list

#### Strategy C: Auto-cleanup on Timeout
1. Task-level timeout (configurable, default 30 min)
2. If task exceeds timeout with no progress:
   - Mark as "timed_out"
   - Attempt to abort session
   - Log for debugging

### 5. API Endpoints

```typescript
// GET /api/sessions - List all sessions with ownership info
interface SessionListResponse {
  sessions: {
    id: string;
    serverId: string;
    status: 'running' | 'completed' | 'orphaned' | 'cancelled';
    taskId: string;
    startedAt: number;
    duration: number;
    toolCalls: number;
  }[];
}

// POST /api/sessions/:id/abort - Abort a specific session
interface AbortResponse {
  success: boolean;
  message: string;
}

// POST /api/cleanup/stale - Cleanup all stale sessions
interface CleanupResponse {
  cleaned: number;
  failed: string[];
}

// DELETE /api/servers/:id - Remove server and cleanup sessions
interface ServerDeleteResponse {
  success: boolean;
  sessionsCleanedUp: number;
}
```

### 6. Dashboard UI Components

#### Session Management Panel
```
┌─────────────────────────────────────────────────────────────────┐
│ Session Management                                    [Cleanup] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ orchestrator:97772                          ● Active  [Kill]│ │
│ │ Last heartbeat: 5s ago                                      │ │
│ │ Running tasks: 2                                            │ │
│ │ ├── glm-task-abc123 (15m 32s) [Abort]                       │ │
│ │ └── opus-review-xyz (2m 10s) [Abort]                        │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ orchestrator:85421                          ○ Stale  [Clean]│ │
│ │ Last heartbeat: 5m ago                                      │ │
│ │ Orphaned tasks: 1                                           │ │
│ │ └── glm-task-old789 (45m 12s) ⚠️ ORPHANED                    │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7. Implementation Tasks

#### Phase 1: Database & Heartbeat (Day 1)
- [ ] Add heartbeat columns to servers table
- [ ] Create session_tasks table
- [ ] Implement HeartbeatManager in MCP server
- [ ] Add heartbeat update on server registration

#### Phase 2: Stale Detection (Day 1)
- [ ] Create stale detection query
- [ ] Add `/api/cleanup/stale` endpoint
- [ ] Add `/api/sessions` endpoint with ownership info
- [ ] Background job for periodic stale check (every 60s)

#### Phase 3: Cleanup Actions (Day 2)
- [ ] Implement graceful session abort
- [ ] Add `/api/sessions/:id/abort` endpoint
- [ ] Add `/api/servers/:id` DELETE endpoint
- [ ] Handle opencode session termination

#### Phase 4: Dashboard UI (Day 2)
- [ ] Create SessionManagementPanel component
- [ ] Add server status indicators
- [ ] Add abort/cleanup buttons
- [ ] Show orphaned session warnings
- [ ] Real-time updates via SSE

#### Phase 5: Testing & Polish (Day 3)
- [ ] Unit tests for cleanup logic
- [ ] Integration tests for session lifecycle
- [ ] Handle edge cases (network failures, etc.)
- [ ] Add logging for debugging

## Success Criteria

1. No orphaned sessions after Claude Code closes
2. Dashboard shows accurate session status
3. One-click cleanup for stale sessions
4. < 2 minute detection time for disconnected servers
5. Graceful handling of in-progress tasks

## Dependencies

- Existing MCP server infrastructure
- SQLite database
- SSE event system
- Dashboard Next.js app

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Heartbeat adds overhead | Use lightweight DB update (single column) |
| False stale detection | Conservative threshold (90s), user confirmation |
| Cleanup fails mid-task | Retry mechanism, manual override |
| Race conditions | Database transactions, optimistic locking |
