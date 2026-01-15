/**
 * Shared types for GLM Orchestrator
 */

// ============================================================================
// MVP Data Model Types
// ============================================================================

export interface Project {
  id: string;
  name: string;
  directory: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export type SpecStatus = 'draft' | 'ready' | 'running' | 'review' | 'completed' | 'merged';

export interface Spec {
  id: string;
  projectId: string;
  title: string;
  content: string;
  version: number;
  status: SpecStatus;
  branchName?: string;
  prNumber?: number;
  prUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Chunk {
  id: string;
  specId: string;
  title: string;
  description: string;
  order: number;
  status: ChunkStatus;
  output?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  // Review fields
  reviewStatus?: ReviewStatus;
  reviewFeedback?: string;
}

export type ReviewStatus = 'pass' | 'needs_fix' | 'fail';

export interface ReviewResult {
  status: ReviewStatus;
  feedback: string;
  fixChunk?: {
    title: string;
    description: string;
  };
}

export type ChunkStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ChunkToolCall {
  id: string;
  chunkId: string;
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  status: ChunkToolCallStatus;
  startedAt: number;
  completedAt?: number;
}

export type ChunkToolCallStatus = 'running' | 'completed' | 'error';

// API Request/Response types
export interface CreateProjectRequest {
  name: string;
  directory: string;
  description?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  directory?: string;
  description?: string;
}

export interface CreateChunkRequest {
  title: string;
  description: string;
  order?: number;
}

export interface UpdateChunkRequest {
  title?: string;
  description?: string;
  order?: number;
}

export interface CreateSpecRequest {
  title: string;
  content?: string;
}

export interface UpdateSpecRequest {
  title?: string;
  content?: string;
  status?: SpecStatus;
  branchName?: string;
  prNumber?: number;
  prUrl?: string;
}

export interface RefineSpecRequest {
  instructions?: string;
}

export interface ReorderChunksRequest {
  chunkIds: string[];
}

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

// ============================================================================
// Spec Studio Types
// ============================================================================

export interface SpecStudioState {
  id: string;
  projectId: string;
  step: SpecStudioStep;
  intent: string;
  questions: Question[];
  answers: Record<string, string | string[]>;
  generatedSpec: string;
  suggestedChunks: ChunkSuggestion[];
  createdAt: number;
  updatedAt: number;
}

export type SpecStudioStep = 'intent' | 'questions' | 'review' | 'chunks' | 'complete';

export interface Question {
  id: string;
  question: string;
  type: QuestionType;
  options?: string[];
  required: boolean;
}

export type QuestionType = 'text' | 'choice' | 'multiselect';

export interface ChunkSuggestion {
  id: string;
  title: string;
  description: string;
  selected: boolean;
  order: number;
}

// Spec Studio API Request/Response types
export interface UpdateStudioStateRequest {
  step?: SpecStudioStep;
  intent?: string;
  questions?: Question[];
  answers?: Record<string, string | string[]>;
  generatedSpec?: string;
  suggestedChunks?: ChunkSuggestion[];
}

export interface GenerateQuestionsRequest {
  intent: string;
}

export interface GenerateQuestionsResponse {
  questions: Question[];
}

export interface GenerateSpecRequest {
  intent: string;
  answers: Record<string, string | string[]>;
}

export interface GenerateSpecResponse {
  spec: string;
}

export interface RefineSpecRequest {
  spec: string;
  feedback: string;
}

export interface RefineSpecResponse {
  spec: string;
}

export interface GenerateChunksRequest {
  spec: string;
}

export interface GenerateChunksResponse {
  chunks: ChunkSuggestion[];
}

export interface CompleteStudioRequest {
  spec: string;
  chunks: ChunkSuggestion[];
}

export interface CompleteStudioResponse {
  success: boolean;
}

// ============================================================================
// Run All Types
// ============================================================================

export type RunAllEventType =
  | 'chunk_start'
  | 'tool_call'
  | 'chunk_complete'
  | 'review_start'
  | 'review_complete'
  | 'fix_chunk_start'
  | 'fix_chunk_complete'
  | 'error'
  | 'all_complete'
  | 'stopped';

export interface RunAllEvent {
  type: RunAllEventType;
  chunkId?: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface RunAllProgress {
  current: number;
  total: number;
  passed: number;
  failed: number;
  fixes: number;
}

export interface RunAllState {
  isRunning: boolean;
  isPaused: boolean;
  currentChunkId: string | null;
  currentStep: 'executing' | 'reviewing' | 'fix' | null;
  progress: RunAllProgress;
  events: RunAllEvent[];
  error: string | null;
}

// SSE event payloads
export interface ChunkStartEvent {
  chunkId: string;
  title: string;
  index: number;
  total: number;
}

export interface ChunkCompleteEvent {
  chunkId: string;
  output: string;
}

export interface ReviewStartEvent {
  chunkId: string;
}

export interface ReviewCompleteEvent {
  chunkId: string;
  status: ReviewStatus;
  feedback: string;
  fixChunkId?: string;
}

export interface FixChunkStartEvent {
  chunkId: string;
  title: string;
}

export interface FixChunkCompleteEvent {
  chunkId: string;
}

export interface RunAllErrorEvent {
  chunkId?: string;
  message: string;
}

export interface AllCompleteEvent {
  specId: string;
  passed: number;
  failed: number;
  fixes: number;
}

export interface StoppedEvent {
  reason: string;
}
