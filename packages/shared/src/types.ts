/**
 * Shared types for GLM Orchestrator
 */

// ============================================================================
// Opencode API Types (for GLM)
// ============================================================================

export interface OpencodeSession {
  id: string;
  title: string;
  directory: string;
}

export interface OpencodePromptOptions {
  parts: Array<{ type: "text"; text: string }>;
  model: {
    providerID: string;  // "zai-coding-plan" or "github-copilot"
    modelID: string;     // "glm-4.7" or "claude-opus-4.5"
  };
  systemPrompt?: string;
}

export interface OpencodeSSEEvent {
  directory?: string;
  payload: {
    type: string;
    properties: Record<string, unknown>;
  };
}

export type SessionStatus = "idle" | "busy";

export interface ToolCallState {
  status: "pending" | "running" | "completed" | "error";
  input?: Record<string, unknown>;
  output?: string;
}

export interface ToolCallPart {
  type: "tool";
  callID: string;
  tool: string;
  state: ToolCallState;
}

export interface TextPart {
  type: "text";
  text: string;
}

export interface ReasoningPart {
  type: "reasoning";
  content: string;
}

export type MessagePart = ToolCallPart | TextPart | ReasoningPart;

// ============================================================================
// Claude CLI Types (for Opus)
// ============================================================================

export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  [key: string]: unknown;
}

export interface ClaudeSystemInit {
  type: "system";
  subtype: "init";
  session_id: string;
  tools: string[];
}

export interface ClaudeToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export interface ClaudeTextContent {
  type: "text";
  text: string;
}

export type ClaudeContentBlock = ClaudeToolUse | ClaudeToolResult | ClaudeTextContent;

export interface ClaudeAssistantMessage {
  type: "assistant";
  message: {
    content: ClaudeContentBlock[];
  };
}

export interface ClaudeUserMessage {
  type: "user";
  message: {
    content: ClaudeToolResult[];
  };
}

export interface ClaudeResult {
  type: "result";
  subtype: "success" | "error";
  total_cost_usd?: number;
  duration_ms?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export type ClaudeEvent =
  | ClaudeSystemInit
  | ClaudeAssistantMessage
  | ClaudeUserMessage
  | ClaudeResult
  | ClaudeStreamEvent;

// ============================================================================
// Task Execution Types
// ============================================================================

export interface TaskDefinition {
  prompt: string;
  workingDirectory: string;
  systemPrompt?: string;
  model?: ModelConfig;
  timeout?: number;
}

export interface ModelConfig {
  providerID: string;
  modelID: string;
}

export interface TaskResult {
  sessionId: string;
  success: boolean;
  output: string;
  toolCalls: ToolCallRecord[];
  filesCreated: string[];
  filesModified: string[];
  duration: number;
  tokens?: TokenUsage;
  cost?: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input?: Record<string, unknown>;
  output?: string;
  state: "pending" | "running" | "completed" | "error";
  duration?: number;
}

export interface TokenUsage {
  input: number;
  output: number;
}

// ============================================================================
// Event Handler Types
// ============================================================================

export interface EventHandler {
  onSessionStatus(sessionId: string, status: SessionStatus): void;
  onToolCall(sessionId: string, toolCall: ToolCallEvent): void;
  onTextChunk(sessionId: string, text: string): void;
  onFileEdit(path: string, diff: FileDiff): void;
  onError(sessionId: string, error: ErrorInfo): void;
  onComplete(sessionId: string): void;
}

export interface ToolCallEvent {
  callId: string;
  tool: string;
  state: "pending" | "running" | "completed" | "error";
  input?: Record<string, unknown>;
  output?: string;
  time?: { start: number; end?: number };
}

export interface FileDiff {
  operation: "read" | "write" | "edit";
  path: string;
  content?: string;
}

export interface ErrorInfo {
  message: string;
  code?: string;
  details?: unknown;
}

// ============================================================================
// Database Record Types
// ============================================================================

export interface ServerRecord {
  id: string;
  folder_name: string;
  pid: number;
  connected_at: number;
  last_heartbeat: number;
  status: "connected" | "disconnected";
}

export interface TaskRecord {
  id: string;
  server_id: string;
  workflow_id: string | null;
  session_id: string | null;  // v2: opencode session ID
  model_id: string | null;    // v2: e.g., "glm-4.7"
  provider_id: string | null; // v2: e.g., "zai-coding-plan"
  status: "pending" | "running" | "completed" | "failed";
  description: string | null;
  prompt: string | null;
  output: string | null;
  error: string | null;
  tokens_input: number;
  tokens_output: number;
  cost: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface ToolCallDbRecord {
  id: string;
  task_id: string;
  call_id: string | null;  // v2: opencode's callID
  tool_name: string;
  state: "pending" | "running" | "completed" | "error";
  input: string | null;
  output: string | null;
  duration_ms: number | null;
  called_at: number;
}

export interface WorkflowRecord {
  id: string;
  server_id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  current_stage: string | null;
  stages: string;
  created_at: number;
  updated_at: number;
}

export interface TaskOutputChunkRecord {
  id: number;
  task_id: string;
  chunk: string;
  chunk_index: number;
  created_at: number;
}

export interface FileOperationRecord {
  id: number;
  task_id: string;
  operation: "read" | "write" | "edit";
  file_path: string;
  created_at: number;
}

// ============================================================================
// Dashboard Types
// ============================================================================

export interface DashboardState {
  servers: ServerRecord[];
  activeTasks: TaskRecord[];
  recentTasks: TaskRecord[];
  activeWorkflows: WorkflowRecord[];
}

export interface LiveSession {
  id: string;
  status: SessionStatus;
  toolCalls: ToolCallEvent[];
  textOutput: string;
  startedAt: number;
}
