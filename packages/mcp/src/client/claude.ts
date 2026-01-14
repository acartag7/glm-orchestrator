/**
 * Claude CLI Client for Opus execution
 *
 * Provides typed wrapper for Claude CLI with stream-json output for:
 * - Prompt execution with real-time streaming
 * - Tool call visibility
 * - Cost tracking
 */

import { spawn, type ChildProcess } from "child_process";
import { createInterface } from "readline";
import type {
  ClaudeEvent,
  ClaudeToolUse,
  ClaudeToolResult,
  ToolCallRecord,
  TokenUsage,
} from "@glm/shared";

const DEFAULT_MODEL = "claude-opus-4-5-20250514";
const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes

export interface ClaudeClientOptions {
  model?: string;
  workingDirectory?: string;
  timeout?: number;
  systemPrompt?: string;
}

export interface ClaudeExecutionResult {
  success: boolean;
  output: string;
  toolCalls: ToolCallRecord[];
  cost?: number;
  tokens?: TokenUsage;
  duration: number;
  sessionId?: string;
}

export interface ClaudeProgressCallback {
  onToolUse?: (tool: string, input: Record<string, unknown>) => void;
  onToolResult?: (toolId: string, result: string) => void;
  onText?: (text: string) => void;
  onThinking?: () => void;
}

export class ClaudeClient {
  private defaultModel: string;
  private activeProcess: ChildProcess | null = null;

  constructor(options: { model?: string } = {}) {
    this.defaultModel = options.model || DEFAULT_MODEL;
  }

  /**
   * Execute a prompt using Claude CLI with stream-json output
   */
  async execute(
    prompt: string,
    options: ClaudeClientOptions = {},
    onProgress?: ClaudeProgressCallback
  ): Promise<ClaudeExecutionResult> {
    const {
      model = this.defaultModel,
      workingDirectory = process.cwd(),
      timeout = DEFAULT_TIMEOUT_MS,
      systemPrompt,
    } = options;

    const startTime = Date.now();
    const toolCalls: ToolCallRecord[] = [];
    let textOutput = "";
    let sessionId: string | undefined;
    let cost: number | undefined;
    let tokens: TokenUsage | undefined;

    const args = ["-p", prompt, "--output-format", "stream-json", "--model", model];

    if (systemPrompt) {
      args.push("--system-prompt", systemPrompt);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn("claude", args, {
        cwd: workingDirectory,
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.activeProcess = proc;

      const rl = createInterface({ input: proc.stdout! });
      let stderr = "";

      // Track tool uses for matching with results
      const pendingToolUses = new Map<string, ClaudeToolUse>();

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5000);
        reject(new Error(`Claude execution timed out after ${timeout}ms`));
      }, timeout);

      rl.on("line", (line) => {
        if (!line.trim()) return;

        try {
          const event = JSON.parse(line) as ClaudeEvent;
          this.processEvent(event, {
            onSystemInit: (e) => {
              sessionId = e.session_id;
            },
            onToolUse: (tool) => {
              pendingToolUses.set(tool.id, tool);
              toolCalls.push({
                id: tool.id,
                name: tool.name,
                input: tool.input,
                state: "running",
              });
              onProgress?.onToolUse?.(tool.name, tool.input);
            },
            onToolResult: (result) => {
              const toolUse = pendingToolUses.get(result.tool_use_id);
              if (toolUse) {
                const existing = toolCalls.find((tc) => tc.id === result.tool_use_id);
                if (existing) {
                  existing.output = result.content;
                  existing.state = "completed";
                }
                pendingToolUses.delete(result.tool_use_id);
              }
              onProgress?.onToolResult?.(result.tool_use_id, result.content);
            },
            onText: (text) => {
              textOutput += text;
              onProgress?.onText?.(text);
            },
            onThinking: () => {
              onProgress?.onThinking?.();
            },
            onResult: (result) => {
              cost = result.total_cost_usd;
              if (result.usage) {
                tokens = {
                  input: result.usage.input_tokens,
                  output: result.usage.output_tokens,
                };
              }
            },
          });
        } catch {
          // Ignore parse errors
        }
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        this.activeProcess = null;
        const duration = Date.now() - startTime;

        if (code === 0) {
          resolve({
            success: true,
            output: textOutput,
            toolCalls,
            cost,
            tokens,
            duration,
            sessionId,
          });
        } else {
          resolve({
            success: false,
            output: stderr || `Claude exited with code ${code}`,
            toolCalls,
            cost,
            tokens,
            duration,
            sessionId,
          });
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        this.activeProcess = null;
        reject(err);
      });
    });
  }

  /**
   * Execute and yield events as an async generator
   */
  async *executeStream(
    prompt: string,
    options: ClaudeClientOptions = {}
  ): AsyncGenerator<ClaudeEvent> {
    const {
      model = this.defaultModel,
      workingDirectory = process.cwd(),
      systemPrompt,
    } = options;

    const args = ["-p", prompt, "--output-format", "stream-json", "--model", model];

    if (systemPrompt) {
      args.push("--system-prompt", systemPrompt);
    }

    const proc = spawn("claude", args, {
      cwd: workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.activeProcess = proc;

    const rl = createInterface({ input: proc.stdout! });

    try {
      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as ClaudeEvent;
          yield event;
        } catch {
          // Ignore parse errors
        }
      }
    } finally {
      this.activeProcess = null;
    }
  }

  /**
   * Abort the current execution
   */
  abort(): boolean {
    if (this.activeProcess) {
      this.activeProcess.kill("SIGTERM");
      setTimeout(() => this.activeProcess?.kill("SIGKILL"), 2000);
      return true;
    }
    return false;
  }

  private processEvent(
    event: ClaudeEvent,
    handlers: {
      onSystemInit?: (e: { session_id: string; tools: string[] }) => void;
      onToolUse?: (tool: ClaudeToolUse) => void;
      onToolResult?: (result: ClaudeToolResult) => void;
      onText?: (text: string) => void;
      onThinking?: () => void;
      onResult?: (result: { total_cost_usd?: number; usage?: { input_tokens: number; output_tokens: number } }) => void;
    }
  ): void {
    const { type } = event;
    const subtype = "subtype" in event ? event.subtype : undefined;

    switch (type) {
      case "system":
        if (subtype === "init") {
          handlers.onSystemInit?.(event as unknown as { session_id: string; tools: string[] });
        }
        break;

      case "assistant":
        if (subtype === "content_block_start") {
          const block = (event as any).content_block;
          if (block?.type === "tool_use") {
            handlers.onToolUse?.({
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: block.input || {},
            });
          }
        } else if (subtype === "content_block_delta") {
          const delta = (event as any).delta;
          if (delta?.type === "text_delta") {
            handlers.onText?.(delta.text || "");
          } else if (delta?.type === "thinking_delta") {
            handlers.onThinking?.();
          } else if (delta?.type === "input_json_delta") {
            // Tool input being streamed - could track if needed
          }
        }
        break;

      case "user":
        // User messages contain tool results
        const content = (event as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              handlers.onToolResult?.(block as ClaudeToolResult);
            }
          }
        }
        break;

      case "result":
        handlers.onResult?.(event as any);
        break;
    }
  }
}

// Default instance
let defaultClient: ClaudeClient | null = null;

export function getClaudeClient(options?: { model?: string }): ClaudeClient {
  if (!defaultClient) {
    defaultClient = new ClaudeClient(options);
  }
  return defaultClient;
}
