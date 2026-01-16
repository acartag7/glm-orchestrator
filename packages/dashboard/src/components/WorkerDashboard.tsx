'use client';

import type { Worker, WorkerQueueItem } from '@glm/shared';
import WorkerCard from './WorkerCard';
import WorkerQueueList from './WorkerQueueList';

interface WorkerDashboardProps {
  workers: Worker[];
  queue: WorkerQueueItem[];
  activeCount: number;
  maxWorkers: number;
  isConnected: boolean;
  onStopWorker: (workerId: string) => void;
  onPauseWorker: (workerId: string) => void;
  onResumeWorker: (workerId: string) => void;
  onRemoveFromQueue: (queueId: string) => void;
}

export default function WorkerDashboard({
  workers,
  queue,
  activeCount,
  maxWorkers,
  isConnected,
  onStopWorker,
  onPauseWorker,
  onResumeWorker,
  onRemoveFromQueue,
}: WorkerDashboardProps) {
  // Separate active and completed workers
  const activeWorkers = workers.filter(w =>
    ['idle', 'running', 'paused'].includes(w.status)
  );
  const completedWorkers = workers.filter(w =>
    ['completed', 'failed'].includes(w.status)
  );

  return (
    <div className="flex flex-col h-full">
      {/* Status Bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-neutral-900/50 border-b border-neutral-800/50">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <span className="font-mono text-xs text-neutral-500">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="font-mono text-xs">
            <span className="text-neutral-500">Active: </span>
            <span className={`${activeCount >= maxWorkers ? 'text-amber-400' : 'text-emerald-400'}`}>
              {activeCount}/{maxWorkers}
            </span>
          </div>
          {activeCount >= maxWorkers && (
            <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded font-mono text-[10px]">
              At capacity
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0 p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Active Workers */}
          <section>
            <h2 className="font-mono text-sm text-neutral-400 mb-4">
              Active Workers ({activeWorkers.length})
            </h2>
            {activeWorkers.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-neutral-800 rounded-lg">
                <span className="font-mono text-sm text-neutral-500">
                  No active workers
                </span>
                <p className="font-mono text-xs text-neutral-600 mt-2">
                  Start a worker from a spec workspace or add specs to the queue
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {activeWorkers.map(worker => (
                  <WorkerCard
                    key={worker.id}
                    worker={worker}
                    onStop={onStopWorker}
                    onPause={onPauseWorker}
                    onResume={onResumeWorker}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Queue */}
          <section>
            <h2 className="font-mono text-sm text-neutral-400 mb-4">
              Queue ({queue.length} waiting)
            </h2>
            <div className="bg-neutral-900/40 border border-neutral-800 rounded-lg p-4">
              <WorkerQueueList
                queue={queue}
                onRemove={onRemoveFromQueue}
              />
            </div>
          </section>

          {/* Recent Completed */}
          {completedWorkers.length > 0 && (
            <section>
              <h2 className="font-mono text-sm text-neutral-400 mb-4">
                Recent ({completedWorkers.length})
              </h2>
              <div className="space-y-3">
                {completedWorkers.slice(0, 5).map(worker => (
                  <div
                    key={worker.id}
                    className={`flex items-center justify-between px-4 py-3 bg-neutral-900/30 border rounded-lg ${
                      worker.status === 'completed'
                        ? 'border-emerald-500/20'
                        : 'border-red-500/20'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={worker.status === 'completed' ? 'text-emerald-400' : 'text-red-400'}>
                        {worker.status === 'completed' ? '✓' : '✕'}
                      </span>
                      <div className="flex flex-col">
                        <span className="font-mono text-sm text-neutral-300">
                          {worker.projectName} / {worker.specTitle}
                        </span>
                        <span className="font-mono text-xs text-neutral-500">
                          {worker.progress.passed} passed, {worker.progress.failed} failed
                        </span>
                      </div>
                    </div>
                    <span className={`font-mono text-xs ${
                      worker.status === 'completed' ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {worker.status === 'completed' ? 'Completed' : 'Failed'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
