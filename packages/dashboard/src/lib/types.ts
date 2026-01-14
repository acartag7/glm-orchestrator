/**
 * Dashboard types - extended for v2 with SSE events
 */

export interface Server {
  id: string;
  folder_name: string;
  pid: number;
  connected_at: number;
  last_heartbeat: number;
  status: string;
}

export interface Task {
  id: string;
  server_id: string;
  workflow_id: string | null;
  session_id: string | null;  // v2
  model_id: string | null;    // v2
  provider_id: string | null; // v2
  status: string;
  description: string | null;
  prompt: string | null;
  output: string | null;
  error: string | null;
  tokens_input: number;       // v2
  tokens_output: number;      // v2
  cost: number;               // v2
  started_at: number | null;
  completed_at: number | null;
}

export interface ToolCall {
  id: string;
  task_id: string;
  call_id: string | null;     // v2
  tool_name: string;
  state: string;              // v2
  input: string | null;
  output: string | null;
  duration_ms: number | null;
  called_at: number;
}

export interface Workflow {
  id: string;
  server_id: string;
  name: string;
  status: string;
  current_stage: string | null;
  stages: string | null;
  created_at: number;
  updated_at: number;
}

export interface DashboardState {
  activeServers: Server[];
  activeTasks: Task[];
  workflows: Workflow[];
  selectedTaskId: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface HistoryQueryOptions {
  limit?: number;
  offset?: number;
  status?: string;
  server_id?: string;
  workflow_id?: string;
  searchQuery?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface TaskDetailsResponse {
  task: Task | null;
  toolCalls: ToolCall[];
}

export interface CancelTaskResponse {
  success: boolean;
  message?: string;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ServerStatus = 'active' | 'inactive' | 'disconnected';
export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// ============================================================================
// SSE Event Types (v2)
// ============================================================================

export interface OpencodeSSEEvent {
  directory?: string;
  payload: {
    type: string;
    properties: Record<string, unknown>;
  };
}

export interface LiveToolCall {
  callId: string;
  tool: string;
  state: 'pending' | 'running' | 'completed' | 'error';
  input?: Record<string, unknown>;
  output?: string;
  startTime?: number;
}

export interface LiveSession {
  id: string;
  status: 'idle' | 'busy';
  toolCalls: LiveToolCall[];
  textOutput: string;
  startedAt: number;
}
