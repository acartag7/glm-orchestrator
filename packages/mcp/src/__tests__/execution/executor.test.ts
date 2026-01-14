/**
 * Task Executor unit tests
 *
 * Tests the delegate functions for proper database interaction
 * and event handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";

// Mock all dependencies
vi.mock("../../client/opencode.js", () => ({
  getOpencodeClient: vi.fn(),
  OpencodeClient: vi.fn(),
}));

vi.mock("../../client/claude.js", () => ({
  getClaudeClient: vi.fn(),
  ClaudeClient: vi.fn(),
}));

vi.mock("../../lib/db.js", () => ({
  createTask: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn(),
  recordToolCall: vi.fn(),
  recordToolCallWithState: vi.fn(),
  updateTaskSession: vi.fn(),
}));

vi.mock("../../utils/paths.js", () => ({
  validateWorkingDirectory: vi.fn(),
}));

vi.mock("../../utils/files.js", () => ({
  getProjectFiles: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../prompts/index.js", () => ({
  getSystemPrompt: vi.fn().mockReturnValue("System prompt"),
  FOCUSED_TASK_PROMPT: "Focused task prompt",
}));

import { getOpencodeClient } from "../../client/opencode.js";
import { getClaudeClient } from "../../client/claude.js";
import {
  createTask,
  completeTask,
  failTask,
  recordToolCall,
  recordToolCallWithState,
  updateTaskSession,
} from "../../lib/db.js";
import { delegateToGLM, delegateToOpus } from "../../tools/delegate.js";

describe("TaskExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("delegateToGLM", () => {
    it("creates task in DB on start", async () => {
      const mockClient = {
        checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
        createSession: vi.fn().mockResolvedValue({ id: "ses_123", directory: "/test" }),
        createSessionHandler: vi.fn().mockReturnValue({
          onSessionStatus: vi.fn(),
          onToolCall: vi.fn(),
          onTextChunk: vi.fn(),
          onComplete: vi.fn(),
          onError: vi.fn(),
          onFileEdit: vi.fn(),
        }),
        subscribeToEvents: vi.fn().mockReturnValue(() => {}),
        sendPrompt: vi.fn().mockResolvedValue(undefined),
        getSessionStatus: vi.fn().mockResolvedValue("idle"),
      };

      (getOpencodeClient as Mock).mockReturnValue(mockClient);

      await delegateToGLM("Test task", "/test/dir");

      expect(createTask).toHaveBeenCalledWith(
        expect.stringMatching(/^glm-/),
        expect.any(String),
        "Test task"
      );
    });

    it("records tool calls as they happen", async () => {
      let capturedHandler: any;

      const mockClient = {
        checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
        createSession: vi.fn().mockResolvedValue({ id: "ses_123", directory: "/test" }),
        createSessionHandler: vi.fn().mockImplementation((sessionId, callbacks) => {
          capturedHandler = callbacks;
          return {
            onSessionStatus: (id: string, status: string) => callbacks.onSessionStatus?.(id, status),
            onToolCall: (id: string, tc: any) => callbacks.onToolCall?.(id, tc),
            onTextChunk: (id: string, text: string) => callbacks.onTextChunk?.(id, text),
            onComplete: (id: string) => callbacks.onComplete?.(id),
            onError: vi.fn(),
            onFileEdit: vi.fn(),
          };
        }),
        subscribeToEvents: vi.fn().mockImplementation((handler) => {
          // Simulate tool call event
          setTimeout(() => {
            handler.onToolCall("ses_123", {
              callId: "call_1",
              tool: "read",
              state: "completed",
              input: { path: "/test.txt" },
              output: "file content",
            });
            handler.onSessionStatus("ses_123", "idle");
          }, 10);
          return () => {};
        }),
        sendPrompt: vi.fn().mockResolvedValue(undefined),
        getSessionStatus: vi.fn().mockResolvedValue("idle"),
      };

      (getOpencodeClient as Mock).mockReturnValue(mockClient);

      await delegateToGLM("Test task", "/test/dir");

      // Wait for async events
      await new Promise((r) => setTimeout(r, 50));

      expect(recordToolCallWithState).toHaveBeenCalledWith(
        expect.stringMatching(/^glm-/),
        "call_1",
        "read",
        "completed",
        JSON.stringify({ path: "/test.txt" }),
        "file content"
      );
    });

    it("marks task complete on success", async () => {
      const mockClient = {
        checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
        createSession: vi.fn().mockResolvedValue({ id: "ses_123", directory: "/test" }),
        createSessionHandler: vi.fn().mockReturnValue({
          onSessionStatus: vi.fn(),
          onToolCall: vi.fn(),
          onTextChunk: vi.fn(),
          onComplete: vi.fn(),
          onError: vi.fn(),
          onFileEdit: vi.fn(),
        }),
        subscribeToEvents: vi.fn().mockReturnValue(() => {}),
        sendPrompt: vi.fn().mockResolvedValue(undefined),
        getSessionStatus: vi.fn().mockResolvedValue("idle"),
      };

      (getOpencodeClient as Mock).mockReturnValue(mockClient);

      await delegateToGLM("Test task", "/test/dir");

      expect(completeTask).toHaveBeenCalledWith(
        expect.stringMatching(/^glm-/),
        expect.stringContaining("GLM Execution Complete")
      );
    });

    it("marks task failed on error", async () => {
      const mockClient = {
        checkHealth: vi.fn().mockResolvedValue({ healthy: false }),
      };

      (getOpencodeClient as Mock).mockReturnValue(mockClient);

      const result = await delegateToGLM("Test task", "/test/dir");

      expect(failTask).toHaveBeenCalledWith(
        expect.stringMatching(/^glm-/),
        expect.stringContaining("Opencode server not running")
      );
      expect((result as any).isError).toBe(true);
    });
  });

  describe("delegateToOpus", () => {
    it("creates task in DB on start", async () => {
      const mockClient = {
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: "Result",
          toolCalls: [],
          cost: 0.01,
          duration: 1000,
        }),
      };

      (getClaudeClient as Mock).mockReturnValue(mockClient);

      await delegateToOpus("Review code", "/test/dir", "review");

      expect(createTask).toHaveBeenCalledWith(
        expect.stringMatching(/^opus-/),
        expect.any(String),
        "Review code"
      );
    });

    it("records tool calls from Claude", async () => {
      const mockClient = {
        execute: vi.fn().mockImplementation(
          async (prompt, options, callbacks) => {
            // Simulate tool call callback
            callbacks?.onToolUse?.("Read", { path: "/test.txt" });
            return {
              success: true,
              output: "Done",
              toolCalls: [{ id: "tool_1", name: "Read", input: {}, state: "completed" }],
              duration: 1000,
            };
          }
        ),
      };

      (getClaudeClient as Mock).mockReturnValue(mockClient);

      await delegateToOpus("Review code", "/test/dir", "review");

      expect(recordToolCall).toHaveBeenCalledWith(
        expect.stringMatching(/^opus-/),
        "Read",
        expect.any(String),
        null,
        0
      );
    });

    it("marks task complete on success", async () => {
      const mockClient = {
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: "Review complete",
          toolCalls: [],
          cost: 0.05,
          duration: 2000,
        }),
      };

      (getClaudeClient as Mock).mockReturnValue(mockClient);

      await delegateToOpus("Review code", "/test/dir", "review");

      expect(completeTask).toHaveBeenCalledWith(
        expect.stringMatching(/^opus-/),
        expect.stringContaining("Opus Review Complete")
      );
    });

    it("marks task failed on error", async () => {
      const mockClient = {
        execute: vi.fn().mockRejectedValue(new Error("Claude not found")),
      };

      (getClaudeClient as Mock).mockReturnValue(mockClient);

      const result = await delegateToOpus("Review code", "/test/dir", "review");

      expect(failTask).toHaveBeenCalledWith(
        expect.stringMatching(/^opus-/),
        "Claude not found"
      );
      expect(result.isError).toBe(true);
    });

    it("uses correct system prompt for task type", async () => {
      const mockClient = {
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: "Done",
          toolCalls: [],
          duration: 1000,
        }),
      };

      (getClaudeClient as Mock).mockReturnValue(mockClient);

      await delegateToOpus("Security audit", "/test/dir", "security-review");

      expect(mockClient.execute).toHaveBeenCalledWith(
        "Security audit",
        expect.objectContaining({
          systemPrompt: expect.any(String),
        }),
        expect.any(Object)
      );
    });

    it("includes cost in result when available", async () => {
      const mockClient = {
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: "Done",
          toolCalls: [],
          cost: 0.1234,
          duration: 1000,
        }),
      };

      (getClaudeClient as Mock).mockReturnValue(mockClient);

      const result = await delegateToOpus("Plan feature", "/test/dir", "plan");

      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("$0.1234"),
      });
    });
  });

  describe("session management", () => {
    it("updates task with session info for GLM", async () => {
      const mockClient = {
        checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
        createSession: vi.fn().mockResolvedValue({ id: "ses_456", directory: "/test" }),
        createSessionHandler: vi.fn().mockReturnValue({
          onSessionStatus: vi.fn(),
          onToolCall: vi.fn(),
          onTextChunk: vi.fn(),
          onComplete: vi.fn(),
          onError: vi.fn(),
          onFileEdit: vi.fn(),
        }),
        subscribeToEvents: vi.fn().mockReturnValue(() => {}),
        sendPrompt: vi.fn().mockResolvedValue(undefined),
        getSessionStatus: vi.fn().mockResolvedValue("idle"),
      };

      (getOpencodeClient as Mock).mockReturnValue(mockClient);

      await delegateToGLM("Test task", "/test/dir");

      expect(updateTaskSession).toHaveBeenCalledWith(
        expect.stringMatching(/^glm-/),
        "ses_456",
        "zai-coding-plan",
        "glm-4.7"
      );
    });

    it("updates task with session info for Opus", async () => {
      const mockClient = {
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: "Done",
          toolCalls: [],
          duration: 1000,
        }),
      };

      (getClaudeClient as Mock).mockReturnValue(mockClient);

      await delegateToOpus("Test task", "/test/dir", "plan");

      expect(updateTaskSession).toHaveBeenCalledWith(
        expect.stringMatching(/^opus-/),
        null,
        "claude-cli",
        "claude-opus-4-5-20250514"
      );
    });
  });
});
