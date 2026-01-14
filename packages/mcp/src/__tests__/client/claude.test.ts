/**
 * ClaudeClient unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { EventEmitter, Readable } from "stream";
import type { ChildProcess } from "child_process";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "child_process";
import { ClaudeClient } from "../../client/claude.js";

// Helper to create a mock child process
function createMockProcess(stdoutData: string[]): ChildProcess {
  const stdout = new Readable({
    read() {
      if (stdoutData.length > 0) {
        this.push(stdoutData.shift() + "\n");
      } else {
        this.push(null);
      }
    },
  });

  const stderr = new Readable({
    read() {
      this.push(null);
    },
  });

  const proc = new EventEmitter() as ChildProcess;
  proc.stdout = stdout as any;
  proc.stderr = stderr as any;
  proc.kill = vi.fn();
  Object.defineProperty(proc, "pid", { value: 12345, writable: true });

  // Emit exit after stdout ends
  stdout.on("end", () => {
    setTimeout(() => proc.emit("close", 0), 10);
  });

  return proc;
}

describe("ClaudeClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("spawn arguments", () => {
    it("spawns claude -p with correct args", async () => {
      const mockProc = createMockProcess([
        JSON.stringify({ type: "result", total_cost_usd: 0.01 }),
      ]);

      (spawn as Mock).mockReturnValue(mockProc);

      const client = new ClaudeClient();
      await client.execute("Test prompt", {
        workingDirectory: "/test/dir",
      });

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining([
          "-p",
          "Test prompt",
          "--output-format",
          "stream-json",
          "--model",
          expect.any(String),
        ]),
        expect.objectContaining({
          cwd: "/test/dir",
          stdio: ["ignore", "pipe", "pipe"],
        })
      );
    });

    it("includes system prompt when provided", async () => {
      const mockProc = createMockProcess([
        JSON.stringify({ type: "result", total_cost_usd: 0.01 }),
      ]);

      (spawn as Mock).mockReturnValue(mockProc);

      const client = new ClaudeClient();
      await client.execute("Test prompt", {
        systemPrompt: "You are a code reviewer",
      });

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining([
          "--system-prompt",
          "You are a code reviewer",
        ]),
        expect.any(Object)
      );
    });

    it("uses custom model when specified", async () => {
      const mockProc = createMockProcess([
        JSON.stringify({ type: "result", total_cost_usd: 0.01 }),
      ]);

      (spawn as Mock).mockReturnValue(mockProc);

      const client = new ClaudeClient();
      await client.execute("Test prompt", {
        model: "claude-sonnet-4-20250514",
      });

      expect(spawn).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining([
          "--model",
          "claude-sonnet-4-20250514",
        ]),
        expect.any(Object)
      );
    });
  });

  describe("NDJSON parsing", () => {
    it("parses NDJSON stream correctly", async () => {
      const events = [
        { type: "system", subtype: "init", session_id: "sess_123", tools: ["Read", "Write"] },
        { type: "assistant", subtype: "content_block_start", content_block: { type: "text", text: "Hello" } },
        { type: "result", total_cost_usd: 0.05, usage: { input_tokens: 100, output_tokens: 50 } },
      ];

      const mockProc = createMockProcess(events.map((e) => JSON.stringify(e)));
      (spawn as Mock).mockReturnValue(mockProc);

      const client = new ClaudeClient();
      const result = await client.execute("Test prompt");

      expect(result.sessionId).toBe("sess_123");
      expect(result.cost).toBe(0.05);
      expect(result.tokens).toEqual({ input: 100, output: 50 });
    });

    it("handles malformed JSON lines gracefully", async () => {
      const events = [
        "not valid json",
        JSON.stringify({ type: "result", total_cost_usd: 0.01 }),
      ];

      const mockProc = createMockProcess(events);
      (spawn as Mock).mockReturnValue(mockProc);

      const client = new ClaudeClient();
      // Should not throw on invalid JSON
      const result = await client.execute("Test prompt");
      expect(result.success).toBe(true);
    });
  });

  describe("tool_use events", () => {
    it("handles tool_use events and tracks tool calls", async () => {
      const events = [
        {
          type: "assistant",
          subtype: "content_block_start",
          content_block: { type: "tool_use", id: "tool_1", name: "Read", input: { path: "/test.txt" } },
        },
        {
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "tool_1", content: "file content" }],
          },
        },
        { type: "result", total_cost_usd: 0.01 },
      ];

      const mockProc = createMockProcess(events.map((e) => JSON.stringify(e)));
      (spawn as Mock).mockReturnValue(mockProc);

      const toolUses: Array<{ tool: string; input: Record<string, unknown> }> = [];
      const toolResults: Array<{ toolId: string; result: string }> = [];

      const client = new ClaudeClient();
      const result = await client.execute("Test prompt", {}, {
        onToolUse: (tool, input) => toolUses.push({ tool, input }),
        onToolResult: (toolId, resultContent) => toolResults.push({ toolId, result: resultContent }),
      });

      expect(toolUses).toHaveLength(1);
      expect(toolUses[0]).toEqual({ tool: "Read", input: { path: "/test.txt" } });

      expect(toolResults).toHaveLength(1);
      expect(toolResults[0]).toEqual({ toolId: "tool_1", result: "file content" });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({
        id: "tool_1",
        name: "Read",
        state: "completed",
        output: "file content",
      });
    });
  });

  describe("cost tracking", () => {
    it("captures cost from result event", async () => {
      const events = [
        { type: "result", total_cost_usd: 0.1234 },
      ];

      const mockProc = createMockProcess(events.map((e) => JSON.stringify(e)));
      (spawn as Mock).mockReturnValue(mockProc);

      const client = new ClaudeClient();
      const result = await client.execute("Test prompt");

      expect(result.cost).toBe(0.1234);
    });

    it("captures token usage from result event", async () => {
      const events = [
        { type: "result", total_cost_usd: 0.05, usage: { input_tokens: 1500, output_tokens: 800 } },
      ];

      const mockProc = createMockProcess(events.map((e) => JSON.stringify(e)));
      (spawn as Mock).mockReturnValue(mockProc);

      const client = new ClaudeClient();
      const result = await client.execute("Test prompt");

      expect(result.tokens).toEqual({ input: 1500, output: 800 });
    });
  });

  describe("text streaming", () => {
    it("accumulates text output", async () => {
      const events = [
        { type: "assistant", subtype: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
        { type: "assistant", subtype: "content_block_delta", delta: { type: "text_delta", text: "World" } },
        { type: "result", total_cost_usd: 0.01 },
      ];

      const mockProc = createMockProcess(events.map((e) => JSON.stringify(e)));
      (spawn as Mock).mockReturnValue(mockProc);

      const textChunks: string[] = [];
      const client = new ClaudeClient();
      const result = await client.execute("Test prompt", {}, {
        onText: (text) => textChunks.push(text),
      });

      expect(textChunks).toEqual(["Hello ", "World"]);
      expect(result.output).toBe("Hello World");
    });
  });

  describe("error handling", () => {
    it("handles process exit with error code", async () => {
      const stdout = new Readable({
        read() {
          this.push(null);
        },
      });

      const stderr = new Readable({
        read() {
          this.push("Error: Something went wrong");
          this.push(null);
        },
      });

      const proc = new EventEmitter() as ChildProcess;
      proc.stdout = stdout as any;
      proc.stderr = stderr as any;
      proc.kill = vi.fn();
      Object.defineProperty(proc, "pid", { value: 12345, writable: true });

      setTimeout(() => proc.emit("close", 1), 20);

      (spawn as Mock).mockReturnValue(proc);

      const client = new ClaudeClient();
      const result = await client.execute("Test prompt");

      // Returns success: false with error in output, rather than throwing
      expect(result.success).toBe(false);
      expect(result.output).toContain("Error");
    });

    it("tracks execution duration", async () => {
      vi.useFakeTimers();

      const events = [
        { type: "result", total_cost_usd: 0.01 },
      ];

      const mockProc = createMockProcess(events.map((e) => JSON.stringify(e)));
      (spawn as Mock).mockReturnValue(mockProc);

      const client = new ClaudeClient();
      const executePromise = client.execute("Test prompt");

      // Advance timers to allow stream processing
      await vi.runAllTimersAsync();

      const result = await executePromise;
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("abort functionality", () => {
    it("can abort running process", async () => {
      const stdout = new Readable({
        read() {
          // Never end - simulate long running process
        },
      });

      const stderr = new Readable({
        read() {
          this.push(null);
        },
      });

      const proc = new EventEmitter() as ChildProcess;
      proc.stdout = stdout as any;
      proc.stderr = stderr as any;
      proc.kill = vi.fn();
      Object.defineProperty(proc, "pid", { value: 12345, writable: true });

      (spawn as Mock).mockReturnValue(proc);

      const client = new ClaudeClient();

      // Start execution without awaiting
      const executePromise = client.execute("Test prompt", { timeout: 10000 });

      // Give it time to start
      await new Promise((r) => setTimeout(r, 10));

      // Abort
      const aborted = client.abort();
      expect(aborted).toBe(true);
      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

      // Emit close to resolve promise
      proc.emit("close", 1);

      // Should return success: false (not throw) when aborted
      const result = await executePromise;
      expect(result.success).toBe(false);
    });
  });
});
