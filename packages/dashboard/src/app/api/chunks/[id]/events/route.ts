import { subscribeToExecution, getExecution, type ExecutionEvent } from '@/lib/execution';
import { getChunk, getToolCallsByChunk } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/chunks/[id]/events - SSE stream for chunk execution events
export async function GET(_request: Request, context: RouteContext) {
  const { id: chunkId } = await context.params;

  // Get chunk to verify it exists
  const chunk = getChunk(chunkId);
  if (!chunk) {
    return new Response(JSON.stringify({ error: 'Chunk not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create SSE response
  const encoder = new TextEncoder();
  let isActive = true;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial status
      const toolCalls = getToolCallsByChunk(chunkId);
      console.error(`[SSE Events] Sending init for chunk ${chunkId}, status: ${chunk.status}, toolCalls: ${toolCalls.length}`);
      const initialData = {
        type: 'init',
        chunk: {
          id: chunk.id,
          status: chunk.status,
          output: chunk.output,
          error: chunk.error,
        },
        toolCalls,
      };
      controller.enqueue(encoder.encode(`event: init\ndata: ${JSON.stringify(initialData)}\n\n`));

      // If chunk is already completed/failed/cancelled, just close
      if (chunk.status !== 'running' && chunk.status !== 'pending') {
        controller.close();
        return;
      }

      // Check if execution is active
      const execution = getExecution(chunkId);
      if (!execution) {
        // Not currently running, close stream
        controller.close();
        return;
      }

      // Subscribe to execution events
      const listener = (event: ExecutionEvent) => {
        if (!isActive) return;

        try {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));

          // Close stream on completion
          if (event.type === 'complete' || event.type === 'error' ||
              (event.type === 'status' && (event.status === 'completed' || event.status === 'failed' || event.status === 'cancelled'))) {
            isActive = false;
            if (unsubscribe) unsubscribe();
            controller.close();
          }
        } catch (e) {
          console.error('Error sending SSE event:', e);
        }
      };

      console.error(`[SSE] Subscribing to execution for chunk: ${chunkId}`);
      unsubscribe = subscribeToExecution(chunkId, listener);

      // Send heartbeat every 15 seconds to keep connection alive
      const heartbeatInterval = setInterval(() => {
        if (!isActive) {
          clearInterval(heartbeatInterval);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`:heartbeat\n\n`));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15000);
    },
    cancel() {
      isActive = false;
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
