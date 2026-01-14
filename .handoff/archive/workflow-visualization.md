# Workflow Visualization Spec (n8n-style)

## Problem Statement

Currently, GLM Orchestrator tasks appear in Claude Code as a single long-running operation with no visibility into:

1. **Task breakdown** - What sub-tasks are being executed
2. **Progress** - How far along the workflow is
3. **Dependencies** - Which tasks depend on others
4. **Status** - Real-time state of each task node
5. **Timing** - Duration of each step

This makes debugging difficult and provides poor UX for multi-step workflows.

## Goals

1. Visual DAG (Directed Acyclic Graph) representation of workflows
2. Real-time status updates as nodes execute
3. Clickable nodes showing details, logs, and tool calls
4. Timeline view showing execution order and duration
5. Support for parallel and sequential task execution
6. Exportable workflow history for debugging

## Design Inspiration

### n8n Workflow View
```
┌─────────┐     ┌─────────┐     ┌─────────┐
│  Start  │────▶│  Step 1 │────▶│  Step 2 │
│    ●    │     │    ●    │     │    ○    │
└─────────┘     └─────────┘     └─────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
              ┌─────────┐                       ┌─────────┐
              │ Step 3a │                       │ Step 3b │
              │    ○    │                       │    ○    │
              └─────────┘                       └─────────┘
                    │                                 │
                    └────────────────┬────────────────┘
                                     ▼
                               ┌─────────┐
                               │   End   │
                               │    ○    │
                               └─────────┘

Legend: ● Completed  ◐ Running  ○ Pending  ✗ Failed
```

## Architecture

### 1. Workflow Data Model

```typescript
interface WorkflowGraph {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface WorkflowNode {
  id: string;
  type: 'start' | 'task' | 'decision' | 'parallel' | 'end';
  label: string;
  description?: string;
  executor: 'opus' | 'glm';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  position: { x: number; y: number }; // For visual layout
  data: {
    taskId?: string;
    toolCalls?: ToolCallSummary[];
    output?: string;
    error?: string;
  };
}

interface WorkflowEdge {
  id: string;
  source: string; // Node ID
  target: string; // Node ID
  label?: string; // e.g., "on success", "on failure"
  animated?: boolean; // For running state
}

interface ToolCallSummary {
  tool: string;
  status: 'completed' | 'failed';
  duration: number;
}
```

### 2. Database Schema

```sql
-- Workflows table
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  started_at INTEGER,
  completed_at INTEGER,
  server_id TEXT,
  metadata TEXT, -- JSON for additional data
  FOREIGN KEY (server_id) REFERENCES servers(id)
);

-- Workflow nodes
CREATE TABLE workflow_nodes (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  executor TEXT,
  status TEXT DEFAULT 'pending',
  position_x INTEGER DEFAULT 0,
  position_y INTEGER DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  task_id TEXT,
  output TEXT,
  error TEXT,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Workflow edges
CREATE TABLE workflow_edges (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  label TEXT,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id),
  FOREIGN KEY (source_node_id) REFERENCES workflow_nodes(id),
  FOREIGN KEY (target_node_id) REFERENCES workflow_nodes(id)
);

-- Indexes
CREATE INDEX idx_nodes_workflow ON workflow_nodes(workflow_id);
CREATE INDEX idx_edges_workflow ON workflow_edges(workflow_id);
CREATE INDEX idx_workflows_status ON workflows(status);
```

### 3. Workflow Creation from Tasks

When `glm_implementation` or `glm_workflow` is called, convert the task list into a workflow graph:

```typescript
function createWorkflowFromTasks(
  workflowName: string,
  tasks: Task[]
): WorkflowGraph {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  // Add start node
  nodes.push({
    id: 'start',
    type: 'start',
    label: 'Start',
    status: 'completed',
    position: { x: 0, y: 0 },
    data: {}
  });

  // Layout algorithm: topological sort + level assignment
  const levels = assignLevels(tasks);

  // Create task nodes
  for (const task of tasks) {
    const level = levels.get(task.id)!;
    const levelTasks = tasks.filter(t => levels.get(t.id) === level);
    const indexInLevel = levelTasks.indexOf(task);

    nodes.push({
      id: task.id,
      type: 'task',
      label: task.name,
      description: task.description,
      executor: task.executor,
      status: 'pending',
      position: {
        x: level * 250,
        y: indexInLevel * 120 - (levelTasks.length - 1) * 60
      },
      data: { taskId: task.id }
    });

    // Create edges from dependencies
    if (task.dependsOn.length === 0) {
      edges.push({
        id: `start-${task.id}`,
        source: 'start',
        target: task.id
      });
    } else {
      for (const depId of task.dependsOn) {
        edges.push({
          id: `${depId}-${task.id}`,
          source: depId,
          target: task.id
        });
      }
    }
  }

  // Add end node
  const maxLevel = Math.max(...Array.from(levels.values()));
  const leafNodes = tasks.filter(t =>
    !tasks.some(other => other.dependsOn.includes(t.id))
  );

  nodes.push({
    id: 'end',
    type: 'end',
    label: 'Complete',
    status: 'pending',
    position: { x: (maxLevel + 1) * 250, y: 0 },
    data: {}
  });

  for (const leaf of leafNodes) {
    edges.push({
      id: `${leaf.id}-end`,
      source: leaf.id,
      target: 'end'
    });
  }

  return {
    id: generateId(),
    name: workflowName,
    status: 'pending',
    startedAt: Date.now(),
    nodes,
    edges
  };
}
```

### 4. Real-time Updates via SSE

Extend the existing SSE system to include workflow events:

```typescript
// New event types
interface WorkflowSSEEvent {
  type: 'workflow.created' | 'workflow.node.updated' | 'workflow.completed';
  workflowId: string;
  data: WorkflowGraph | WorkflowNode | { status: string };
}

// Emit when node status changes
function updateNodeStatus(
  workflowId: string,
  nodeId: string,
  status: NodeStatus,
  data?: Partial<WorkflowNode['data']>
) {
  const node = db.updateWorkflowNode(workflowId, nodeId, { status, ...data });

  sseEmitter.emit({
    type: 'workflow.node.updated',
    workflowId,
    data: node
  });

  // Check if workflow is complete
  if (isWorkflowComplete(workflowId)) {
    completeWorkflow(workflowId);
  }
}
```

### 5. Dashboard Components

#### WorkflowCanvas Component
```typescript
// Using React Flow for graph rendering
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap
} from 'reactflow';

function WorkflowCanvas({ workflow }: { workflow: WorkflowGraph }) {
  const nodes = workflow.nodes.map(n => ({
    id: n.id,
    type: n.type === 'task' ? 'taskNode' : 'controlNode',
    position: n.position,
    data: n
  }));

  const edges = workflow.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.animated,
    label: e.label
  }));

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
    >
      <Background />
      <Controls />
      <MiniMap />
    </ReactFlow>
  );
}
```

#### TaskNode Component
```typescript
function TaskNode({ data }: { data: WorkflowNode }) {
  const statusColors = {
    pending: 'bg-slate-700 border-slate-500',
    running: 'bg-blue-900 border-blue-500 animate-pulse',
    completed: 'bg-emerald-900 border-emerald-500',
    failed: 'bg-red-900 border-red-500',
    skipped: 'bg-slate-800 border-slate-600 opacity-50'
  };

  const statusIcons = {
    pending: '○',
    running: '◐',
    completed: '●',
    failed: '✗',
    skipped: '◌'
  };

  return (
    <div className={`
      px-4 py-3 rounded-lg border-2 min-w-[180px]
      ${statusColors[data.status]}
    `}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{statusIcons[data.status]}</span>
        <span className="font-medium">{data.label}</span>
      </div>
      {data.duration && (
        <div className="text-xs text-white/60 mt-1">
          {formatDuration(data.duration)}
        </div>
      )}
      <div className="text-[10px] text-white/40 mt-1">
        {data.executor === 'opus' ? 'Claude Opus' : 'GLM-4.7'}
      </div>
    </div>
  );
}
```

#### NodeDetailPanel Component
```typescript
function NodeDetailPanel({ node }: { node: WorkflowNode | null }) {
  if (!node) return null;

  return (
    <div className="w-80 bg-slate-900 border-l border-slate-700 p-4">
      <h3 className="text-lg font-semibold">{node.label}</h3>
      <p className="text-sm text-white/60 mt-1">{node.description}</p>

      <div className="mt-4 space-y-3">
        <StatusBadge status={node.status} />

        {node.startedAt && (
          <div className="text-xs">
            <span className="text-white/40">Started:</span>
            <span className="ml-2">{formatTime(node.startedAt)}</span>
          </div>
        )}

        {node.duration && (
          <div className="text-xs">
            <span className="text-white/40">Duration:</span>
            <span className="ml-2">{formatDuration(node.duration)}</span>
          </div>
        )}

        {node.data.toolCalls && (
          <div>
            <h4 className="text-sm font-medium mb-2">Tool Calls</h4>
            <div className="space-y-1">
              {node.data.toolCalls.map((tc, i) => (
                <ToolCallBadge key={i} toolCall={tc} />
              ))}
            </div>
          </div>
        )}

        {node.data.output && (
          <div>
            <h4 className="text-sm font-medium mb-2">Output</h4>
            <pre className="text-xs bg-black/30 p-2 rounded overflow-auto max-h-48">
              {node.data.output}
            </pre>
          </div>
        )}

        {node.data.error && (
          <div className="bg-red-900/30 border border-red-700 rounded p-2">
            <h4 className="text-sm font-medium text-red-400">Error</h4>
            <pre className="text-xs text-red-300 mt-1">
              {node.data.error}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
```

### 6. Timeline View (Alternative)

For simpler workflows, provide a timeline/Gantt view:

```
Timeline View
─────────────────────────────────────────────────────────────────
                0s        30s       1m        1m30s     2m
                │         │         │         │         │
Task 1 (Opus)   ████████████
Task 2 (GLM)              ██████████████████████
Task 3 (GLM)                        ████████████████████████
Task 4 (Opus)                                           ████████
─────────────────────────────────────────────────────────────────
```

```typescript
function TimelineView({ workflow }: { workflow: WorkflowGraph }) {
  const sortedNodes = [...workflow.nodes]
    .filter(n => n.type === 'task')
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));

  const minTime = workflow.startedAt;
  const maxTime = workflow.completedAt || Date.now();
  const totalDuration = maxTime - minTime;

  return (
    <div className="space-y-2">
      {sortedNodes.map(node => (
        <TimelineRow
          key={node.id}
          node={node}
          minTime={minTime}
          totalDuration={totalDuration}
        />
      ))}
    </div>
  );
}
```

### 7. API Endpoints

```typescript
// GET /api/workflows - List all workflows
// GET /api/workflows/:id - Get workflow with nodes and edges
// GET /api/workflows/:id/nodes - Get nodes for a workflow
// GET /api/workflows/:id/nodes/:nodeId - Get specific node details
// POST /api/workflows/:id/retry/:nodeId - Retry a failed node

// SSE endpoint already exists, just add workflow event types
```

### 8. Implementation Tasks

#### Phase 1: Data Model (Day 1)
- [ ] Create workflow tables (workflows, nodes, edges)
- [ ] Add TypeScript types for workflow data
- [ ] Create workflow from task list function
- [ ] Add layout algorithm for node positioning

#### Phase 2: Backend Integration (Day 1-2)
- [ ] Hook workflow creation into `glm_implementation`
- [ ] Update node status when tasks execute
- [ ] Emit SSE events for workflow updates
- [ ] Store tool call summaries per node

#### Phase 3: React Flow Integration (Day 2)
- [ ] Install and configure React Flow
- [ ] Create custom node components (TaskNode, ControlNode)
- [ ] Create WorkflowCanvas component
- [ ] Add edge animations for running state

#### Phase 4: Detail Panel (Day 3)
- [ ] Create NodeDetailPanel component
- [ ] Show tool calls, output, errors
- [ ] Add expand/collapse for large outputs
- [ ] Link to full task details

#### Phase 5: Timeline View (Day 3)
- [ ] Create TimelineRow component
- [ ] Create TimelineView component
- [ ] Add view toggle (Graph/Timeline)
- [ ] Sync selection between views

#### Phase 6: Polish (Day 4)
- [ ] Add minimap for large workflows
- [ ] Add zoom/pan controls
- [ ] Keyboard navigation
- [ ] Export workflow as image/JSON
- [ ] Mobile responsive design

## Dependencies

- **react-flow** or **@xyflow/react** - Graph rendering
- **dagre** - Auto-layout algorithm for DAGs
- Existing dashboard infrastructure
- SSE event system

## Wireframes

### Main Workflow Page
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ GLM Orchestrator                                                            │
├────────────────────────────────────────────────────────────────┬────────────┤
│                                                                │            │
│  Workflow: Feature Implementation                              │  Details   │
│  Status: ◐ Running (3/7 tasks complete)                        │            │
│                                                                │  Task 3    │
│  [Graph View] [Timeline View]                   [Export] [Zoom]│  ─────────│
│  ──────────────────────────────────────────────────────────────│            │
│                                                                │  Status:   │
│      ┌───────┐                                                 │  ◐ Running │
│      │ Start │                                                 │            │
│      │   ●   │                                                 │  Duration: │
│      └───┬───┘                                                 │  2m 15s    │
│          │                                                     │            │
│          ▼                                                     │  Tool Calls│
│      ┌───────┐     ┌───────┐                                   │  ──────────│
│      │ Plan  │────▶│ Types │                                   │  read (5)  │
│      │   ●   │     │   ●   │                                   │  write (3) │
│      └───────┘     └───┬───┘                                   │  edit (2)  │
│                        │                                       │            │
│          ┌─────────────┼─────────────┐                         │  Output    │
│          ▼             ▼             ▼                         │  ──────────│
│      ┌───────┐     ┌───────┐     ┌───────┐                     │  Created   │
│      │ API   │     │  UI   │     │ Tests │                     │  5 files   │
│      │   ◐   │     │   ○   │     │   ○   │                     │  Modified  │
│      └───┬───┘     └───┬───┘     └───┬───┘                     │  2 files   │
│          │             │             │                         │            │
│          └─────────────┼─────────────┘                         │            │
│                        ▼                                       │            │
│                    ┌───────┐                                   │            │
│                    │  End  │                                   │            │
│                    │   ○   │                                   │            │
│                    └───────┘                                   │            │
│                                                                │            │
└────────────────────────────────────────────────────────────────┴────────────┘
```

### Timeline View
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Timeline View                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Time    0s         1m          2m          3m          4m          5m      │
│          │          │           │           │           │           │       │
│  Plan    █████████● (45s)                                                   │
│  Types             ████████████● (1m 10s)                                   │
│  API                            ████████████████████◐ (running)             │
│  UI                             ░░░░░░░░░░░░ (pending)                      │
│  Tests                          ░░░░░░░░░░░░ (pending)                      │
│                                                                             │
│  Legend: █ Completed  ████◐ Running  ░░░░ Pending                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Success Criteria

1. Visual representation of all workflow steps
2. Real-time updates as tasks execute (< 1s latency)
3. Clickable nodes showing full details
4. Clear indication of parallel vs sequential execution
5. Timeline view for duration analysis
6. Works with workflows up to 50 nodes
7. Responsive on tablet and desktop

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Large workflows slow to render | Virtualization, progressive loading |
| Layout algorithm fails | Fall back to simple grid layout |
| SSE events missed | Reconnect logic, full refresh option |
| React Flow bundle size | Dynamic import, code splitting |

## Future Enhancements

1. **Workflow Templates** - Save and reuse common patterns
2. **Manual Intervention** - Pause workflow, modify, resume
3. **Conditional Branches** - Decision nodes based on output
4. **Parallel Limits** - Control max concurrent tasks
5. **Notifications** - Alert on completion/failure
6. **Comparison View** - Compare two workflow runs
