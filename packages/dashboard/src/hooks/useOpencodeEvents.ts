'use client';

/**
 * Hook for real-time SSE events from opencode server
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { OpencodeSSEEvent, LiveSession, LiveToolCall } from '@/lib/types';

const OPENCODE_URL = process.env.NEXT_PUBLIC_OPENCODE_URL || 'http://localhost:4096';
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;

interface UseOpencodeEventsReturn {
  sessions: Map<string, LiveSession>;
  isConnected: boolean;
  connectionError: string | null;
  events: OpencodeSSEEvent[];
}

export function useOpencodeEvents(): UseOpencodeEventsReturn {
  const [sessions, setSessions] = useState<Map<string, LiveSession>>(new Map());
  const [events, setEvents] = useState<OpencodeSSEEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const reconnectAttempts = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const processEvent = useCallback((event: OpencodeSSEEvent) => {
    const { type, properties } = event.payload;

    // Add to events list (keep last 100)
    setEvents(prev => [...prev.slice(-99), event]);

    // Process based on event type
    switch (type) {
      case 'session.status': {
        const sessionId = properties.sessionID as string;
        const status = properties.status as { type: string };

        setSessions(prev => {
          const newSessions = new Map(prev);
          const existing = newSessions.get(sessionId);

          if (existing) {
            newSessions.set(sessionId, {
              ...existing,
              status: status.type as 'idle' | 'busy',
            });
          } else {
            newSessions.set(sessionId, {
              id: sessionId,
              status: status.type as 'idle' | 'busy',
              toolCalls: [],
              textOutput: '',
              startedAt: Date.now(),
            });
          }

          return newSessions;
        });
        break;
      }

      case 'message.part.updated': {
        const sessionId = properties.sessionID as string;
        const part = properties.part as {
          type: string;
          tool?: string;
          callID?: string;
          state?: { status: string; input?: unknown; output?: string };
          text?: string;
        };

        setSessions(prev => {
          const newSessions = new Map(prev);
          const session = newSessions.get(sessionId);

          if (!session) return prev;

          if (part.type === 'tool' && part.tool && part.callID) {
            const toolCall: LiveToolCall = {
              callId: part.callID,
              tool: part.tool,
              state: (part.state?.status || 'pending') as LiveToolCall['state'],
              input: part.state?.input as Record<string, unknown> | undefined,
              output: part.state?.output,
              startTime: Date.now(),
            };

            // Update or add tool call
            const existingIndex = session.toolCalls.findIndex(
              tc => tc.callId === part.callID
            );

            const newToolCalls = [...session.toolCalls];
            if (existingIndex >= 0) {
              newToolCalls[existingIndex] = {
                ...newToolCalls[existingIndex],
                ...toolCall,
              };
            } else {
              newToolCalls.push(toolCall);
            }

            newSessions.set(sessionId, {
              ...session,
              toolCalls: newToolCalls,
            });
          } else if (part.type === 'text' && part.text) {
            newSessions.set(sessionId, {
              ...session,
              textOutput: part.text,
            });
          }

          return newSessions;
        });
        break;
      }

      case 'session.idle': {
        const sessionId = properties.sessionID as string;
        setSessions(prev => {
          const newSessions = new Map(prev);
          const session = newSessions.get(sessionId);
          if (session) {
            newSessions.set(sessionId, {
              ...session,
              status: 'idle',
            });
          }
          return newSessions;
        });
        break;
      }

      default:
        // Ignore other events
        break;
    }
  }, []);

  const connect = useCallback(async () => {
    try {
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      const response = await fetch(`${OPENCODE_URL}/global/event`, {
        signal: abortControllerRef.current.signal,
        headers: { Accept: 'text/event-stream' },
      });

      if (!response.ok || !response.body) {
        throw new Error(`Failed to connect: ${response.status}`);
      }

      setIsConnected(true);
      setConnectionError(null);
      reconnectAttempts.current = 0;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as OpencodeSSEEvent;
              processEvent(event);
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;

      setIsConnected(false);
      setConnectionError((err as Error).message);

      reconnectAttempts.current++;
      if (reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(connect, RECONNECT_DELAY_MS * reconnectAttempts.current);
      }
    }
  }, [processEvent]);

  useEffect(() => {
    connect();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [connect]);

  return {
    sessions,
    isConnected,
    connectionError,
    events,
  };
}

/**
 * Hook to filter events for a specific session
 */
export function useSessionEvents(sessionId: string): {
  session: LiveSession | null;
  toolCalls: LiveToolCall[];
  textOutput: string;
} {
  const { sessions } = useOpencodeEvents();
  const session = sessions.get(sessionId) || null;

  return {
    session,
    toolCalls: session?.toolCalls || [],
    textOutput: session?.textOutput || '',
  };
}
