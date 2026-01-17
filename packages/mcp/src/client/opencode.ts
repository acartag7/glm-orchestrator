/**
 * Opencode HTTP Client for GLM-4.7 execution
 *
 * Provides typed HTTP API access to opencode server for:
 * - Session management
 * - Prompt execution (async)
 * - SSE event streaming
 */

import type {
  OpencodeSession,
  OpencodePromptOptions,
  OpencodeSSEEvent,
  SessionStatus,
  EventHandler,
  ToolCallEvent,
  ErrorInfo,
  FileDiff,
} from "@specwright/shared";

const DEFAULT_OPENCODE_URL = "http://localhost:4096";
const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 5;

export interface OpencodeClientOptions {
  baseUrl?: string;
  onConnectionChange?: (connected: boolean) => void;
}

export class OpencodeClient {
  private baseUrl: string;
  private eventController: AbortController | null = null;
  private reconnectAttempts = 0;
  private eventHandlers: Set<EventHandler> = new Set();
  private onConnectionChange?: (connected: boolean) => void;

  constructor(options: OpencodeClientOptions = {}) {
    this.baseUrl = options.baseUrl || process.env.OPENCODE_URL || DEFAULT_OPENCODE_URL;
    this.onConnectionChange = options.onConnectionChange;
  }

  // =========================================================================
  // Health Check
  // =========================================================================

  async checkHealth(): Promise<{ healthy: boolean; version?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/global/health`);
      if (!res.ok) return { healthy: false };
      const data = await res.json() as { healthy: boolean; version?: string };
      return data;
    } catch {
      return { healthy: false };
    }
  }

  // =========================================================================
  // Session Management
  // =========================================================================

  async createSession(directory: string, title?: string): Promise<OpencodeSession> {
    const url = `${this.baseUrl}/session?directory=${encodeURIComponent(directory)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || "GLM Task" }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create session: ${res.status} ${text}`);
    }

    return res.json() as Promise<OpencodeSession>;
  }

  async getSession(sessionId: string, directory: string): Promise<OpencodeSession | null> {
    const url = `${this.baseUrl}/session/${sessionId}?directory=${encodeURIComponent(directory)}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return res.json() as Promise<OpencodeSession>;
    } catch {
      return null;
    }
  }

  async getSessionStatus(sessionId: string, directory: string): Promise<SessionStatus | null> {
    const url = `${this.baseUrl}/session/${sessionId}/status?directory=${encodeURIComponent(directory)}`;

    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as { type: string };
      return data.type as SessionStatus;
    } catch {
      return null;
    }
  }

  async deleteSession(sessionId: string, directory: string): Promise<void> {
    const url = `${this.baseUrl}/session/${sessionId}?directory=${encodeURIComponent(directory)}`;

    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`Failed to delete session: ${res.status} ${text}`);
    }
  }

  // =========================================================================
  // Prompt Execution
  // =========================================================================

  /**
   * Send a prompt asynchronously (returns immediately, use SSE for results)
   */
  async sendPrompt(
    sessionId: string,
    directory: string,
    options: OpencodePromptOptions
  ): Promise<void> {
    const url = `${this.baseUrl}/session/${sessionId}/prompt_async?directory=${encodeURIComponent(directory)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });

    if (res.status !== 204 && !res.ok) {
      const text = await res.text();
      throw new Error(`Failed to send prompt: ${res.status} ${text}`);
    }
  }

  /**
   * Send a prompt and wait for completion synchronously
   */
  async sendPromptSync(
    sessionId: string,
    directory: string,
    options: OpencodePromptOptions
  ): Promise<unknown> {
    const url = `${this.baseUrl}/session/${sessionId}/prompt?directory=${encodeURIComponent(directory)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to send prompt: ${res.status} ${text}`);
    }

    return res.json();
  }

  /**
   * Abort a running session
   */
  async abortSession(sessionId: string, directory: string): Promise<void> {
    const url = `${this.baseUrl}/session/${sessionId}/abort?directory=${encodeURIComponent(directory)}`;

    const res = await fetch(url, { method: "POST" });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`Failed to abort session: ${res.status} ${text}`);
    }
  }

  // =========================================================================
  // Messages
  // =========================================================================

  async getMessages(sessionId: string, directory: string): Promise<unknown[]> {
    const url = `${this.baseUrl}/session/${sessionId}/message?directory=${encodeURIComponent(directory)}`;

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get messages: ${res.status} ${text}`);
    }

    return res.json() as Promise<unknown[]>;
  }

  // =========================================================================
  // SSE Event Streaming
  // =========================================================================

  /**
   * Subscribe to global SSE events
   */
  subscribeToEvents(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);

    // Start streaming if not already
    if (!this.eventController) {
      this.startEventStream();
    }

    // Return unsubscribe function
    return () => {
      this.eventHandlers.delete(handler);
      if (this.eventHandlers.size === 0) {
        this.stopEventStream();
      }
    };
  }

  private async startEventStream(): Promise<void> {
    this.eventController = new AbortController();

    const connect = async () => {
      try {
        const res = await fetch(`${this.baseUrl}/global/event`, {
          signal: this.eventController?.signal,
          headers: { Accept: "text/event-stream" },
        });

        if (!res.ok || !res.body) {
          throw new Error(`Failed to connect to event stream: ${res.status}`);
        }

        this.reconnectAttempts = 0;
        this.onConnectionChange?.(true);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6)) as OpencodeSSEEvent;
                this.dispatchEvent(event);
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;

        this.onConnectionChange?.(false);
        this.reconnectAttempts++;

        if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          console.error(`[OpencodeClient] SSE reconnecting (attempt ${this.reconnectAttempts})...`);
          setTimeout(connect, RECONNECT_DELAY_MS * this.reconnectAttempts);
        } else {
          console.error(`[OpencodeClient] SSE max reconnect attempts reached`);
        }
      }
    };

    connect();
  }

  private stopEventStream(): void {
    if (this.eventController) {
      this.eventController.abort();
      this.eventController = null;
      this.onConnectionChange?.(false);
    }
  }

  private dispatchEvent(event: OpencodeSSEEvent): void {
    const { type, properties } = event.payload;
    // Get sessionID from properties or event directory
    const sessionId = (properties.sessionID || properties.session_id || event.directory || "unknown") as string;

    for (const handler of this.eventHandlers) {
      try {
        switch (type) {
          case "session.status": {
            const status = properties.status as { type: string };
            handler.onSessionStatus(sessionId, status.type as SessionStatus);
            break;
          }

          case "message.part.updated": {
            const part = properties.part as {
              type: string;
              tool?: string;
              callID?: string;
              id?: string;
              state?: { status: string; input?: unknown; output?: string };
              text?: string;
            };

            if (part.type === "tool" && part.tool) {
              // Generate callId if not present
              const callId = part.callID || part.id || `${part.tool}-${Date.now()}`;
              const toolEvent: ToolCallEvent = {
                callId,
                tool: part.tool,
                state: (part.state?.status || "pending") as "pending" | "running" | "completed" | "error",
                input: part.state?.input as Record<string, unknown> | undefined,
                output: part.state?.output,
              };
              console.error(`[SSE] Tool: ${part.tool} (${toolEvent.state})`);
              handler.onToolCall(sessionId, toolEvent);
            } else if (part.type === "text" && part.text) {
              handler.onTextChunk(sessionId, part.text);
            }
            break;
          }

          case "file.edited": {
            const filePath = properties.path as string;
            console.error(`[SSE] File edited: ${filePath}`);
            handler.onFileEdit(filePath, {
              operation: "edit",
              path: filePath,
            });
            break;
          }

          case "session.idle": {
            handler.onComplete(sessionId);
            break;
          }

          default:
            // Ignore other events
            break;
        }
      } catch (err) {
        console.error(`[OpencodeClient] Error in event handler:`, err);
      }
    }
  }

  /**
   * Create a session-specific event filter
   */
  createSessionHandler(
    sessionId: string,
    callbacks: Partial<EventHandler>
  ): EventHandler {
    return {
      onSessionStatus: (id: string, status: SessionStatus) => {
        if (id === sessionId) callbacks.onSessionStatus?.(id, status);
      },
      onToolCall: (id: string, toolCall: ToolCallEvent) => {
        if (id === sessionId) callbacks.onToolCall?.(id, toolCall);
      },
      onTextChunk: (id: string, text: string) => {
        if (id === sessionId) callbacks.onTextChunk?.(id, text);
      },
      onFileEdit: callbacks.onFileEdit || ((_path: string, _diff: FileDiff) => {}),
      onError: (id: string, error: ErrorInfo) => {
        if (id === sessionId) callbacks.onError?.(id, error);
      },
      onComplete: (id: string) => {
        if (id === sessionId) callbacks.onComplete?.(id);
      },
    };
  }
}

// Default instance
let defaultClient: OpencodeClient | null = null;

export function getOpencodeClient(options?: OpencodeClientOptions): OpencodeClient {
  if (!defaultClient) {
    defaultClient = new OpencodeClient(options);
  }
  return defaultClient;
}
