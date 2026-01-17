'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import ConfirmModal from '@/components/ConfirmModal';

interface StaleWorktree {
  specId: string;
  specTitle: string;
  worktreePath: string;
  daysInactive: number;
  prUrl?: string;
}

export default function WorktreesPage() {
  const [stale, setStale] = useState<StaleWorktree[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ cleaned: number; stale: number; errors: string[] } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchStaleWorktrees = useCallback(async () => {
    try {
      const response = await fetch('/api/worktrees/stale');
      if (response.ok) {
        const data = await response.json();
        setStale(data.staleWorktrees);
      }
    } catch (error) {
      console.error('Error fetching stale worktrees:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStaleWorktrees();
  }, [fetchStaleWorktrees]);

  const handleRunCleanup = async () => {
    setIsCleaningUp(true);
    setCleanupResult(null);
    try {
      const response = await fetch('/api/worktrees/cleanup', { method: 'POST' });
      if (response.ok) {
        const result = await response.json();
        setCleanupResult(result);
        // Refresh stale list
        await fetchStaleWorktrees();
      }
    } catch (error) {
      console.error('Error running cleanup:', error);
    } finally {
      setIsCleaningUp(false);
    }
  };

  const handleDeleteWorktree = (specId: string) => {
    setDeleteConfirm(specId);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/worktrees/${deleteConfirm}`, { method: 'DELETE' });
      if (response.ok) {
        setStale(prev => prev.filter(w => w.specId !== deleteConfirm));
      }
    } catch (error) {
      console.error('Error deleting worktree:', error);
    } finally {
      setIsDeleting(false);
      setDeleteConfirm(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-neutral-400 font-mono">
          <svg className="animate-spin w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]">
      {/* Header */}
      <header className="border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-6 py-3 flex items-center gap-4">
          <Link
            href="/"
            className="p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-md transition-colors"
            title="Back to projects"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div className="flex items-center gap-2 text-sm font-mono">
            <span className="text-neutral-500">/</span>
            <span className="text-neutral-100">worktrees</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={handleRunCleanup}
            disabled={isCleaningUp}
            className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 rounded-md font-mono text-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {isCleaningUp ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Running...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Run Cleanup
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {/* Cleanup Result */}
        {cleanupResult && (
          <div className="mb-6 p-4 bg-neutral-900/50 border border-neutral-800 rounded-md">
            <h3 className="text-sm font-medium text-neutral-100 font-mono mb-2">Cleanup Result</h3>
            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="text-emerald-400">{cleanupResult.cleaned} cleaned</span>
              <span className="text-amber-400">{cleanupResult.stale} stale</span>
              {cleanupResult.errors.length > 0 && (
                <span className="text-red-400">{cleanupResult.errors.length} errors</span>
              )}
            </div>
            {cleanupResult.errors.length > 0 && (
              <div className="mt-2 text-xs text-red-400 font-mono">
                {cleanupResult.errors.map((err, i) => (
                  <p key={i}>{err}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stale Worktrees Section */}
        <div className="space-y-3">
          <h2 className="text-xs text-neutral-500 font-mono uppercase tracking-wider mb-3">
            Stale Worktrees (7+ days inactive)
          </h2>

          {stale.length === 0 ? (
            <div className="bg-neutral-900/50 border border-neutral-800 rounded-md p-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-neutral-800 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-neutral-300 font-mono mb-2">No stale worktrees</h3>
              <p className="text-xs text-neutral-500 font-mono">
                All worktrees are active or have been cleaned up.
              </p>
            </div>
          ) : (
            stale.map(item => (
              <div key={item.specId} className="bg-neutral-900/50 border border-neutral-800 rounded-md p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-neutral-100 font-mono">{item.specTitle}</h3>
                    <p className="text-xs text-neutral-500 font-mono mt-1 truncate" title={item.worktreePath}>
                      {item.worktreePath}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-amber-400 font-mono">
                        Inactive for {item.daysInactive} day{item.daysInactive !== 1 ? 's' : ''}
                      </span>
                      {item.prUrl && (
                        <a
                          href={item.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 font-mono"
                        >
                          View PR
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteWorktree(item.specId)}
                    className="px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 rounded-md font-mono text-xs transition-colors flex-shrink-0"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Info Section */}
        <div className="mt-8 p-4 bg-neutral-900/30 border border-neutral-800/50 rounded-md">
          <h3 className="text-xs text-neutral-500 font-mono uppercase tracking-wider mb-2">About Worktrees</h3>
          <div className="text-xs text-neutral-500 font-mono space-y-1">
            <p>Worktrees allow parallel spec execution without conflicts.</p>
            <p>Each spec runs in its own isolated directory.</p>
            <p>Worktrees are automatically cleaned up when PRs are merged.</p>
            <p>Stale worktrees (7+ days inactive) are flagged for manual review.</p>
          </div>
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <ConfirmModal
          title="Remove Worktree"
          message="Are you sure you want to remove this worktree? Any uncommitted changes will be lost."
          confirmLabel="remove"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirm(null)}
          isDanger
          isLoading={isDeleting}
        />
      )}
    </div>
  );
}
