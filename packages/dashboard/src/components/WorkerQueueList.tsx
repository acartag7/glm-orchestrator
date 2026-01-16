'use client';

import type { WorkerQueueItem } from '@glm/shared';

interface WorkerQueueListProps {
  queue: WorkerQueueItem[];
  onRemove: (queueId: string) => void;
}

export default function WorkerQueueList({
  queue,
  onRemove,
}: WorkerQueueListProps) {
  if (queue.length === 0) {
    return (
      <div className="text-center py-8">
        <span className="font-mono text-sm text-neutral-500">
          Queue is empty
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {queue.map((item, index) => (
        <div
          key={item.id}
          className="flex items-center justify-between px-4 py-3 bg-neutral-900/50 border border-neutral-800 rounded-lg hover:border-neutral-700 transition-colors"
        >
          <div className="flex items-center gap-4">
            <span className="font-mono text-sm text-neutral-500 w-6">
              {index + 1}.
            </span>
            <div className="flex flex-col">
              <span className="font-mono text-sm text-neutral-200">
                {item.projectName || 'Unknown Project'}
              </span>
              <span className="font-mono text-xs text-neutral-500">
                {item.specTitle || 'Unknown Spec'}
              </span>
            </div>
          </div>
          <button
            onClick={() => onRemove(item.id)}
            className="px-2.5 py-1 bg-neutral-800 text-neutral-400 border border-neutral-700 hover:bg-neutral-700 hover:text-neutral-300 rounded font-mono text-xs transition-colors"
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
