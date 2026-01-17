/**
 * Worker Orchestrator
 *
 * Manages multiple concurrent GLM workers across different specs.
 * Singleton pattern - one orchestrator per process.
 */

import type { Worker, WorkerQueueItem, WorkerEvent, WorkerProgress } from '@specwright/shared';
import {
  getAllWorkers,
  getActiveWorkers,
  getWorker,
  getWorkerBySpec,
  createWorker,
  updateWorker,
  deleteWorker,
  getWorkerQueue,
  getNextQueueItem,
  removeFromQueue,
  getSpec,
  getProject,
  getChunksBySpec,
} from './db';
import { WorkerInstance } from './worker-instance';

const DEFAULT_MAX_WORKERS = 5;

type EventListener = (event: WorkerEvent) => void;

class WorkerOrchestrator {
  private maxWorkers: number;
  private instances: Map<string, WorkerInstance> = new Map();
  private listeners: Set<EventListener> = new Set();
  private eventBuffer: WorkerEvent[] = [];
  private maxBufferSize = 100;
  private processingQueue = false;

  constructor() {
    this.maxWorkers = parseInt(process.env.MAX_WORKERS || String(DEFAULT_MAX_WORKERS), 10);
    // Restore active workers on startup
    this.restoreWorkers();
  }

  /**
   * Restore workers from database on startup
   * This handles the case where the server restarts while workers are running
   */
  private restoreWorkers(): void {
    const activeWorkers = getActiveWorkers();
    for (const worker of activeWorkers) {
      if (worker.status === 'running' || worker.status === 'idle') {
        // Mark as failed since we lost the execution context
        updateWorker(worker.id, {
          status: 'failed',
          error: 'Server restarted during execution',
        });
      }
    }
  }

  /**
   * Get maximum number of workers
   */
  getMaxWorkers(): number {
    return this.maxWorkers;
  }

  /**
   * Set maximum number of workers
   */
  setMaxWorkers(max: number): void {
    this.maxWorkers = Math.max(1, max);
  }

  /**
   * Get count of active workers
   */
  getActiveCount(): number {
    return this.instances.size;
  }

  /**
   * Check if there's capacity for more workers
   */
  hasCapacity(): boolean {
    return this.instances.size < this.maxWorkers;
  }

  /**
   * Get all workers (active and completed)
   */
  getWorkers(): Worker[] {
    return getAllWorkers();
  }

  /**
   * Get active workers only
   */
  getActiveWorkers(): Worker[] {
    return getActiveWorkers();
  }

  /**
   * Get the queue
   */
  getQueue(): WorkerQueueItem[] {
    return getWorkerQueue();
  }

  /**
   * Start a worker for a spec
   */
  async startWorker(specId: string): Promise<Worker> {
    // Check if already running
    const existing = getWorkerBySpec(specId);
    if (existing && ['idle', 'running', 'paused'].includes(existing.status)) {
      throw new Error('A worker is already active for this spec');
    }

    // Check capacity
    if (!this.hasCapacity()) {
      throw new Error(`All worker slots in use (${this.instances.size}/${this.maxWorkers}). Spec will be queued.`);
    }

    // Get spec and project
    const spec = getSpec(specId);
    if (!spec) {
      throw new Error('Spec not found');
    }

    const project = getProject(spec.projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Check if there are chunks to run
    const chunks = getChunksBySpec(specId);
    const pendingChunks = chunks.filter(c =>
      c.status === 'pending' || c.status === 'failed' || c.status === 'cancelled'
    );

    if (pendingChunks.length === 0) {
      throw new Error('No pending chunks to execute');
    }

    // Create worker in database
    const worker = createWorker(specId, spec.projectId);

    // Create worker instance
    const instance = new WorkerInstance(
      worker.id,
      specId,
      spec.projectId,
      project.directory,
      (event) => this.handleWorkerEvent(worker.id, event)
    );

    this.instances.set(worker.id, instance);

    // Start execution
    instance.start().catch((error) => {
      console.error(`Worker ${worker.id} failed:`, error);
    });

    // Emit started event
    this.emitEvent({
      type: 'worker_started',
      workerId: worker.id,
      timestamp: Date.now(),
      data: { worker: getWorker(worker.id) },
    });

    return getWorker(worker.id)!;
  }

  /**
   * Stop a worker
   */
  async stopWorker(workerId: string): Promise<void> {
    const instance = this.instances.get(workerId);
    if (!instance) {
      // Just delete from database if no instance
      deleteWorker(workerId);
      return;
    }

    // Abort the instance
    await instance.abort();

    // Remove from instances
    this.instances.delete(workerId);

    // Update database
    updateWorker(workerId, {
      status: 'failed',
      error: 'Stopped by user',
    });

    // Emit event
    this.emitEvent({
      type: 'worker_stopped',
      workerId,
      timestamp: Date.now(),
      data: { reason: 'Stopped by user' },
    });

    // Process queue
    this.processQueue();
  }

  /**
   * Pause a worker
   */
  async pauseWorker(workerId: string): Promise<void> {
    const instance = this.instances.get(workerId);
    if (!instance) {
      throw new Error('Worker not found');
    }

    instance.pause();

    // Update database
    updateWorker(workerId, { status: 'paused' });

    // Emit event
    this.emitEvent({
      type: 'worker_paused',
      workerId,
      timestamp: Date.now(),
      data: {},
    });
  }

  /**
   * Resume a worker
   */
  async resumeWorker(workerId: string): Promise<void> {
    const instance = this.instances.get(workerId);
    if (!instance) {
      throw new Error('Worker not found');
    }

    instance.resume();

    // Update database
    updateWorker(workerId, { status: 'running' });

    // Emit event
    this.emitEvent({
      type: 'worker_resumed',
      workerId,
      timestamp: Date.now(),
      data: {},
    });
  }

  /**
   * Handle events from worker instances
   */
  private handleWorkerEvent(workerId: string, event: {
    type: string;
    data: Record<string, unknown>;
  }): void {
    const worker = getWorker(workerId);

    switch (event.type) {
      case 'progress':
        if (worker) {
          updateWorker(workerId, {
            status: 'running',
            currentChunkId: event.data.currentChunkId as string | undefined,
            currentStep: event.data.currentStep as 'executing' | 'reviewing' | undefined,
            progress: event.data.progress as Partial<WorkerProgress>,
          });
        }
        this.emitEvent({
          type: 'worker_progress',
          workerId,
          timestamp: Date.now(),
          data: event.data,
        });
        break;

      case 'chunk_start':
        this.emitEvent({
          type: 'worker_chunk_start',
          workerId,
          timestamp: Date.now(),
          data: event.data,
        });
        break;

      case 'chunk_complete':
        this.emitEvent({
          type: 'worker_chunk_complete',
          workerId,
          timestamp: Date.now(),
          data: event.data,
        });
        break;

      case 'review_start':
        this.emitEvent({
          type: 'worker_review_start',
          workerId,
          timestamp: Date.now(),
          data: event.data,
        });
        break;

      case 'review_complete':
        this.emitEvent({
          type: 'worker_review_complete',
          workerId,
          timestamp: Date.now(),
          data: event.data,
        });
        break;

      case 'completed':
        // Update worker status
        updateWorker(workerId, {
          status: 'completed',
          currentChunkId: null,
          currentStep: null,
          progress: event.data.progress as Partial<WorkerProgress>,
        });

        // Remove from instances
        this.instances.delete(workerId);

        // Emit event
        this.emitEvent({
          type: 'worker_completed',
          workerId,
          timestamp: Date.now(),
          data: event.data,
        });

        // Process queue
        this.processQueue();
        break;

      case 'failed':
        // Update worker status
        updateWorker(workerId, {
          status: 'failed',
          error: event.data.error as string,
        });

        // Remove from instances
        this.instances.delete(workerId);

        // Emit event
        this.emitEvent({
          type: 'worker_failed',
          workerId,
          timestamp: Date.now(),
          data: event.data,
        });

        // Process queue
        this.processQueue();
        break;
    }
  }

  /**
   * Process the queue - start workers for queued specs if capacity available
   */
  async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    try {
      while (this.hasCapacity()) {
        const nextItem = getNextQueueItem();
        if (!nextItem) break;

        // Remove from queue
        removeFromQueue(nextItem.id);

        // Try to start worker
        try {
          await this.startWorker(nextItem.specId);
        } catch (error) {
          console.error(`Failed to start worker for queued spec ${nextItem.specId}:`, error);
        }
      }

      // Emit queue updated event
      this.emitEvent({
        type: 'queue_updated',
        timestamp: Date.now(),
        data: { queue: getWorkerQueue() },
      });
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Subscribe to worker events
   */
  subscribe(listener: EventListener): () => void {
    // Replay buffered events
    for (const event of this.eventBuffer) {
      try {
        listener(event);
      } catch (e) {
        console.error('Error replaying event to listener:', e);
      }
    }

    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners
   */
  private emitEvent(event: WorkerEvent): void {
    // Buffer event
    this.eventBuffer.push(event);
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift();
    }

    // Send to listeners
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('Error in worker event listener:', e);
      }
    }
  }

  /**
   * Get recent events (for late subscribers)
   */
  getRecentEvents(): WorkerEvent[] {
    return [...this.eventBuffer];
  }

  /**
   * Stop all workers
   */
  async stopAll(): Promise<void> {
    const workerIds = Array.from(this.instances.keys());
    await Promise.all(workerIds.map(id => this.stopWorker(id)));
  }

  /**
   * Pause all workers
   */
  async pauseAll(): Promise<void> {
    const workerIds = Array.from(this.instances.keys());
    await Promise.all(workerIds.map(id => this.pauseWorker(id)));
  }

  /**
   * Resume all paused workers
   */
  async resumeAll(): Promise<void> {
    const pausedWorkers = getActiveWorkers().filter(w => w.status === 'paused');
    await Promise.all(pausedWorkers.map(w => this.resumeWorker(w.id)));
  }
}

// Singleton instance
let orchestrator: WorkerOrchestrator | null = null;

export function getOrchestrator(): WorkerOrchestrator {
  if (!orchestrator) {
    orchestrator = new WorkerOrchestrator();
  }
  return orchestrator;
}

// Export the class for typing
export { WorkerOrchestrator };
