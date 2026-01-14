'use client';

import { useDashboard } from '@/hooks/useDashboard';
import ActiveServersPanel from '@/components/ActiveServersPanel';
import ActiveTasksPanel from '@/components/ActiveTasksPanel';
import WorkflowPanel from '@/components/WorkflowPanel';
import HistoryPanel from '@/components/HistoryPanel';
import LiveSessionsPanel from '@/components/LiveSessionsPanel';

export default function Home() {
  const { data, isLoading, error, lastUpdated } = useDashboard();

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-blue-400">
            GLM Orchestrator
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-gray-400">
              Real-time task monitoring dashboard
            </p>
            {lastUpdated && (
              <span className="text-xs text-gray-500">
                DB updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
        </header>

        {error && (
          <div className="mb-4 bg-red-900/20 border border-red-800 rounded-lg p-3 text-sm text-red-400">
            Error loading data: {error.message}
          </div>
        )}

        {/* Live Sessions - Real-time SSE from opencode */}
        <div className="mb-6">
          <LiveSessionsPanel />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <ActiveServersPanel servers={data?.servers || []} />
          <ActiveTasksPanel tasks={data?.activeTasks || []} />
          <WorkflowPanel workflows={data?.workflows || []} />
        </div>

        <div className="mt-6">
          <HistoryPanel />
        </div>
      </div>
    </main>
  );
}
