'use client';

import Link from 'next/link';
import { Terminal, Cpu } from 'lucide-react';
import { useWorkers } from '@/hooks/useWorkers';
import WorkerDashboard from '@/components/WorkerDashboard';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function WorkersPage() {
  const {
    state,
    stopWorker,
    pauseWorker,
    resumeWorker,
    removeFromQueue,
  } = useWorkers();

  return (
    <ErrorBoundary>
    <main className="min-h-screen bg-neutral-950 flex flex-col bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]">
      {/* Header */}
      <header className="border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Terminal icon logo */}
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="flex items-center justify-center w-8 h-8 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                <Terminal className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-sm font-medium text-neutral-100 font-mono">
                  spec-driven-dev
                </h1>
                <p className="text-[10px] text-neutral-500 font-mono">
                  write specs, break into chunks, execute with ai
                </p>
              </div>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-mono rounded-md">
              <Cpu className="w-3.5 h-3.5" />
              workers
              {state.activeCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium bg-emerald-500/20 text-emerald-400 rounded-full">
                  {state.activeCount}
                </span>
              )}
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-neutral-800/50 hover:bg-neutral-800 text-neutral-300 border border-neutral-700 text-xs font-mono rounded-md transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              projects
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1">
        {!state.isConnected ? (
          <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
            <div className="relative">
              <div className="w-10 h-10 border-2 border-neutral-700 rounded-full" />
              <div className="absolute inset-0 w-10 h-10 border-2 border-emerald-500 rounded-full border-t-transparent animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-sm font-mono text-neutral-400">connecting to worker stream...</p>
              <p className="text-xs font-mono text-neutral-600 mt-1">establishing SSE connection</p>
            </div>
          </div>
        ) : (
          <WorkerDashboard
            workers={state.workers}
            queue={state.queue}
            activeCount={state.activeCount}
            maxWorkers={state.maxWorkers}
            isConnected={state.isConnected}
            onStopWorker={stopWorker}
            onPauseWorker={pauseWorker}
            onResumeWorker={resumeWorker}
            onRemoveFromQueue={removeFromQueue}
          />
        )}
      </div>
    </main>
    </ErrorBoundary>
  );
}
