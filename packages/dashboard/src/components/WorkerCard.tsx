'use client';

import type { Worker } from '@glm/shared';

interface WorkerCardProps {
  worker: Worker;
  onStop: (workerId: string) => void;
  onPause: (workerId: string) => void;
  onResume: (workerId: string) => void;
}

export default function WorkerCard({
  worker,
  onStop,
  onPause,
  onResume,
}: WorkerCardProps) {
  // Calculate elapsed time
  const getElapsedTime = () => {
    if (!worker.startedAt) return '';
    const elapsed = Date.now() - worker.startedAt;
    const seconds = Math.floor(elapsed / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ago`;
  };

  // Get status icon and color
  const getStatusDisplay = () => {
    switch (worker.status) {
      case 'idle':
        return { icon: '○', color: 'text-neutral-400', label: 'Idle' };
      case 'running':
        return { icon: '◐', color: 'text-emerald-400', label: 'Running', pulse: true };
      case 'paused':
        return { icon: '⏸', color: 'text-amber-400', label: 'Paused' };
      case 'completed':
        return { icon: '✓', color: 'text-emerald-400', label: 'Completed' };
      case 'failed':
        return { icon: '✕', color: 'text-red-400', label: 'Failed' };
      default:
        return { icon: '○', color: 'text-neutral-400', label: 'Unknown' };
    }
  };

  const status = getStatusDisplay();
  const isActive = ['idle', 'running', 'paused'].includes(worker.status);
  const progressPercent = worker.progress.total > 0
    ? Math.round((worker.progress.current / worker.progress.total) * 100)
    : 0;

  return (
    <div className={`bg-neutral-900/80 border rounded-lg overflow-hidden ${
      worker.status === 'running'
        ? 'border-emerald-500/30'
        : worker.status === 'paused'
        ? 'border-amber-500/30'
        : worker.status === 'failed'
        ? 'border-red-500/30'
        : 'border-neutral-800'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <span className={`${status.color} ${status.pulse ? 'animate-pulse' : ''}`}>
            {status.icon}
          </span>
          <div className="flex flex-col">
            <span className="font-mono text-sm text-neutral-200">
              {worker.projectName || 'Unknown Project'}
            </span>
            <span className="font-mono text-xs text-neutral-500">
              {worker.specTitle || 'Unknown Spec'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`font-mono text-xs ${status.color}`}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Progress */}
      {isActive && (
        <div className="px-4 py-2 border-b border-neutral-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-mono text-xs text-neutral-400">
              Progress: {worker.progress.current}/{worker.progress.total}
            </span>
            <span className="font-mono text-xs text-neutral-500">
              {progressPercent}%
            </span>
          </div>
          <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Current chunk */}
      {worker.currentChunkTitle && (
        <div className="px-4 py-2 border-b border-neutral-800 bg-neutral-800/30">
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-neutral-500">
              {worker.currentStep === 'reviewing' ? 'Reviewing:' : 'Executing:'}
            </span>
            <span className="text-neutral-300 truncate">
              {worker.currentChunkTitle}
            </span>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="px-4 py-2 border-b border-neutral-800 flex gap-4 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <span className="text-emerald-400">✓</span>
          <span className="text-neutral-400">Passed:</span>
          <span className="text-neutral-200">{worker.progress.passed}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-red-400">✕</span>
          <span className="text-neutral-400">Failed:</span>
          <span className="text-neutral-200">{worker.progress.failed}</span>
        </div>
        {worker.startedAt && (
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-neutral-500">Started</span>
            <span className="text-neutral-400">{getElapsedTime()}</span>
          </div>
        )}
      </div>

      {/* Error */}
      {worker.error && (
        <div className="px-4 py-2 border-b border-neutral-800 bg-red-500/10">
          <div className="flex items-start gap-2 text-xs font-mono">
            <span className="text-red-400">error</span>
            <span className="text-red-300">{worker.error}</span>
          </div>
        </div>
      )}

      {/* Actions */}
      {isActive && (
        <div className="px-4 py-2 flex items-center gap-2">
          {worker.status === 'running' && (
            <button
              onClick={() => onPause(worker.id)}
              className="px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 rounded font-mono text-xs transition-colors"
            >
              Pause
            </button>
          )}
          {worker.status === 'paused' && (
            <button
              onClick={() => onResume(worker.id)}
              className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 rounded font-mono text-xs transition-colors"
            >
              Resume
            </button>
          )}
          <button
            onClick={() => onStop(worker.id)}
            className="px-2.5 py-1 bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 rounded font-mono text-xs transition-colors"
          >
            Stop
          </button>
        </div>
      )}
    </div>
  );
}
