/**
 * Worker Events SSE API
 *
 * GET /api/workers/events - SSE stream of worker events
 */

import { getOrchestrator } from '@/lib/worker-orchestrator';

// GET /api/workers/events
export async function GET() {
  const encoder = new TextEncoder();
  const orchestrator = getOrchestrator();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial state
      const workers = orchestrator.getWorkers();
      const queue = orchestrator.getQueue();
      const activeCount = orchestrator.getActiveCount();
      const maxWorkers = orchestrator.getMaxWorkers();

      const initialEvent = {
        type: 'init',
        timestamp: Date.now(),
        data: {
          workers,
          queue,
          activeCount,
          maxWorkers,
        },
      };
      controller.enqueue(
        encoder.encode(`event: init\ndata: ${JSON.stringify(initialEvent)}\n\n`)
      );

      // Subscribe to events
      const unsubscribe = orchestrator.subscribe((event) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          );
        } catch {
          // Controller closed
        }
      });

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`: heartbeat\n\n`)
          );
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Cleanup on close
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      // Handle stream close
      return cleanup;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
