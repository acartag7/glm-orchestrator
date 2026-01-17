/**
 * OpencodeClient unit tests
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { OpencodeClient } from "../../client/opencode.js";
import type { SessionStatus, ToolCallEvent } from "@specwright/shared";

// Mock server setup
const mockServer = setupServer();

beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
afterAll(() => mockServer.close());
afterEach(() => {
  mockServer.resetHandlers();
  vi.clearAllMocks();
});

describe("OpencodeClient", () => {
  const testDirectory = "/test/project";
  const testSessionId = "ses_test123";

  describe("createSession", () => {
    it("creates session via HTTP POST", async () => {
      const mockSession = {
        id: testSessionId,
        title: "Test Session",
        directory: testDirectory,
      };

      mockServer.use(
        http.post("http://localhost:4096/session", async ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("directory")).toBe(testDirectory);

          const body = await request.json();
          expect(body).toEqual({ title: "Test Task" });

          return HttpResponse.json(mockSession);
        })
      );

      const client = new OpencodeClient();
      const session = await client.createSession(testDirectory, "Test Task");

      expect(session).toEqual(mockSession);
    });

    it("throws error on failed session creation", async () => {
      mockServer.use(
        http.post("http://localhost:4096/session", () => {
          return new HttpResponse("Internal Server Error", { status: 500 });
        })
      );

      const client = new OpencodeClient();
      await expect(client.createSession(testDirectory)).rejects.toThrow(
        "Failed to create session: 500"
      );
    });
  });

  describe("sendPrompt", () => {
    it("sends prompt async via HTTP POST", async () => {
      const promptOptions = {
        parts: [{ type: "text" as const, text: "Test prompt" }],
        model: { providerID: "zai-coding-plan", modelID: "glm-4.7" },
        systemPrompt: "You are a helpful assistant",
      };

      mockServer.use(
        http.post(`http://localhost:4096/session/${testSessionId}/prompt_async`, async ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("directory")).toBe(testDirectory);

          const body = await request.json();
          expect(body).toEqual(promptOptions);

          return new HttpResponse(null, { status: 204 });
        })
      );

      const client = new OpencodeClient();
      await expect(client.sendPrompt(testSessionId, testDirectory, promptOptions)).resolves.toBeUndefined();
    });

    it("throws error on prompt failure", async () => {
      mockServer.use(
        http.post(`http://localhost:4096/session/${testSessionId}/prompt_async`, () => {
          return new HttpResponse("Session not found", { status: 404 });
        })
      );

      const client = new OpencodeClient();
      await expect(
        client.sendPrompt(testSessionId, testDirectory, {
          parts: [{ type: "text", text: "test" }],
          model: { providerID: "test", modelID: "test" },
        })
      ).rejects.toThrow("Failed to send prompt: 404");
    });
  });

  describe("SSE event parsing", () => {
    it("parses session.status events correctly", async () => {
      // Create a readable stream that emits SSE data
      const encoder = new TextEncoder();
      const events = [
        'data: {"payload":{"type":"session.status","properties":{"sessionID":"ses_123","status":{"type":"busy"}}}}\n\n',
        'data: {"payload":{"type":"session.status","properties":{"sessionID":"ses_123","status":{"type":"idle"}}}}\n\n',
      ];

      let eventIndex = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (eventIndex < events.length) {
            controller.enqueue(encoder.encode(events[eventIndex]));
            eventIndex++;
          } else {
            controller.close();
          }
        },
      });

      mockServer.use(
        http.get("http://localhost:4096/global/event", () => {
          return new HttpResponse(stream, {
            headers: { "Content-Type": "text/event-stream" },
          });
        })
      );

      const statusUpdates: Array<{ sessionId: string; status: string }> = [];
      const client = new OpencodeClient();

      const unsubscribe = client.subscribeToEvents({
        onSessionStatus: (sessionId: string, status: SessionStatus) => {
          statusUpdates.push({ sessionId, status });
        },
        onToolCall: () => {},
        onTextChunk: () => {},
        onFileEdit: () => {},
        onError: () => {},
        onComplete: () => {},
      });

      // Wait for events to be processed
      await new Promise((r) => setTimeout(r, 100));

      expect(statusUpdates).toHaveLength(2);
      expect(statusUpdates[0]).toEqual({ sessionId: "ses_123", status: "busy" });
      expect(statusUpdates[1]).toEqual({ sessionId: "ses_123", status: "idle" });

      unsubscribe();
    });

    it("parses tool call events correctly", async () => {
      const encoder = new TextEncoder();
      const toolCallEvent = {
        payload: {
          type: "message.part.updated",
          properties: {
            sessionID: "ses_456",
            part: {
              type: "tool",
              tool: "read",
              callID: "call_123",
              state: { status: "completed", input: { path: "/test" }, output: "file content" },
            },
          },
        },
      };

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolCallEvent)}\n\n`));
          controller.close();
        },
      });

      mockServer.use(
        http.get("http://localhost:4096/global/event", () => {
          return new HttpResponse(stream, {
            headers: { "Content-Type": "text/event-stream" },
          });
        })
      );

      const toolCalls: Array<{ sessionId: string; tool: string; state: string }> = [];
      const client = new OpencodeClient();

      const unsubscribe = client.subscribeToEvents({
        onSessionStatus: () => {},
        onToolCall: (sessionId: string, toolCall: ToolCallEvent) => {
          toolCalls.push({ sessionId, tool: toolCall.tool, state: toolCall.state });
        },
        onTextChunk: () => {},
        onFileEdit: () => {},
        onError: () => {},
        onComplete: () => {},
      });

      await new Promise((r) => setTimeout(r, 100));

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual({ sessionId: "ses_456", tool: "read", state: "completed" });

      unsubscribe();
    });
  });

  describe("connection error handling", () => {
    it("handles connection errors gracefully", async () => {
      mockServer.use(
        http.get("http://localhost:4096/global/event", () => {
          return HttpResponse.error();
        })
      );

      const connectionChanges: boolean[] = [];
      const client = new OpencodeClient({
        onConnectionChange: (connected) => {
          connectionChanges.push(connected);
        },
      });

      const unsubscribe = client.subscribeToEvents({
        onSessionStatus: () => {},
        onToolCall: () => {},
        onTextChunk: () => {},
        onFileEdit: () => {},
        onError: () => {},
        onComplete: () => {},
      });

      // Wait for connection attempt
      await new Promise((r) => setTimeout(r, 100));

      // Should report disconnection
      expect(connectionChanges).toContain(false);

      unsubscribe();
    });

    it("calls onConnectionChange(true) on successful connection", async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"payload":{"type":"ping","properties":{}}}\n\n'));
          // Don't close - keep stream open briefly
          setTimeout(() => controller.close(), 50);
        },
      });

      mockServer.use(
        http.get("http://localhost:4096/global/event", () => {
          return new HttpResponse(stream, {
            headers: { "Content-Type": "text/event-stream" },
          });
        })
      );

      const connectionChanges: boolean[] = [];
      const client = new OpencodeClient({
        onConnectionChange: (connected) => {
          connectionChanges.push(connected);
        },
      });

      const unsubscribe = client.subscribeToEvents({
        onSessionStatus: () => {},
        onToolCall: () => {},
        onTextChunk: () => {},
        onFileEdit: () => {},
        onError: () => {},
        onComplete: () => {},
      });

      await new Promise((r) => setTimeout(r, 100));

      // Should have reported connection success
      expect(connectionChanges[0]).toBe(true);

      unsubscribe();
    });
  });

  describe("health check", () => {
    it("returns healthy status when server responds", async () => {
      mockServer.use(
        http.get("http://localhost:4096/global/health", () => {
          return HttpResponse.json({ healthy: true, version: "1.1.10" });
        })
      );

      const client = new OpencodeClient();
      const health = await client.checkHealth();

      expect(health).toEqual({ healthy: true, version: "1.1.10" });
    });

    it("returns unhealthy when server fails", async () => {
      mockServer.use(
        http.get("http://localhost:4096/global/health", () => {
          return HttpResponse.error();
        })
      );

      const client = new OpencodeClient();
      const health = await client.checkHealth();

      expect(health).toEqual({ healthy: false });
    });
  });

  describe("session operations", () => {
    it("gets session status", async () => {
      mockServer.use(
        http.get(`http://localhost:4096/session/${testSessionId}/status`, () => {
          return HttpResponse.json({ type: "busy" });
        })
      );

      const client = new OpencodeClient();
      const status = await client.getSessionStatus(testSessionId, testDirectory);

      expect(status).toBe("busy");
    });

    it("deletes session", async () => {
      mockServer.use(
        http.delete(`http://localhost:4096/session/${testSessionId}`, () => {
          return new HttpResponse(null, { status: 204 });
        })
      );

      const client = new OpencodeClient();
      await expect(client.deleteSession(testSessionId, testDirectory)).resolves.toBeUndefined();
    });

    it("aborts session", async () => {
      mockServer.use(
        http.post(`http://localhost:4096/session/${testSessionId}/abort`, () => {
          return new HttpResponse(null, { status: 200 });
        })
      );

      const client = new OpencodeClient();
      await expect(client.abortSession(testSessionId, testDirectory)).resolves.toBeUndefined();
    });
  });
});
