'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Spec, Project } from '@specwright/shared';

interface GitStatus {
  isGitRepo: boolean;
  hasPR: boolean;
  prUrl: string | null;
  prNumber: number | null;
  branchName: string | null;
  currentBranch: string | null;
  commitCount: number;
  filesChanged: number;
  canCreatePR: boolean;
}

interface SpecCompletePanelProps {
  spec: Spec;
  project: Project;
  onCreatePR: () => Promise<void>;
  onCommitOnly: () => Promise<void>;
  onSkip: () => void;
  onMarkMerged: () => Promise<void>;
  onCreateBranch: () => Promise<void>;
}

export default function SpecCompletePanel({
  spec,
  project,
  onCreatePR,
  onCommitOnly,
  onSkip,
  onMarkMerged,
  onCreateBranch,
}: SpecCompletePanelProps) {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Fetch git status on mount
  useEffect(() => {
    async function fetchGitStatus() {
      try {
        setIsLoading(true);
        const response = await fetch(`/api/specs/${spec.id}/git/pr`);
        if (response.ok) {
          const data = await response.json();
          setGitStatus(data);
        } else {
          const errorData = await response.json();
          setError(errorData.error || 'Failed to fetch git status');
        }
      } catch (err) {
        setError('Failed to connect to server');
      } finally {
        setIsLoading(false);
      }
    }

    fetchGitStatus();
  }, [spec.id]);

  const handleAction = useCallback(async (action: string, handler: () => Promise<void>) => {
    setActionInProgress(action);
    setError(null);
    try {
      await handler();
      // Refresh git status after action
      const response = await fetch(`/api/specs/${spec.id}/git/pr`);
      if (response.ok) {
        const data = await response.json();
        setGitStatus(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionInProgress(null);
    }
  }, [spec.id]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg p-6">
        <div className="flex items-center gap-3 text-neutral-400">
          <svg className="animate-spin w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="font-mono text-sm">Checking git status...</span>
        </div>
      </div>
    );
  }

  // If PR already exists
  if (spec.prUrl) {
    return (
      <div className="bg-neutral-900/50 border border-emerald-500/30 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="text-neutral-100 font-mono font-medium">Pull Request Created</h3>
            <p className="text-neutral-500 text-sm font-mono">PR #{spec.prNumber}</p>
          </div>
        </div>

        <div className="space-y-3">
          <a
            href={spec.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 font-mono text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            View PR #{spec.prNumber} on GitHub
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>

          {spec.status !== 'merged' && (
            <button
              onClick={() => handleAction('merge', onMarkMerged)}
              disabled={!!actionInProgress}
              className="w-full px-4 py-2 bg-violet-500/10 text-violet-400 border border-violet-500/30 hover:bg-violet-500/20 disabled:opacity-50 rounded-md font-mono text-sm transition-colors flex items-center justify-center gap-2"
            >
              {actionInProgress === 'merge' ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Updating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Mark as Merged
                </>
              )}
            </button>
          )}

          {spec.status === 'merged' && (
            <div className="flex items-center gap-2 text-emerald-400 font-mono text-sm">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" />
              </svg>
              PR merged
            </div>
          )}
        </div>
      </div>
    );
  }

  // Not a git repo
  if (!gitStatus?.isGitRepo) {
    return (
      <div className="bg-neutral-900/50 border border-amber-500/30 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-neutral-100 font-mono font-medium">Not a Git Repository</h3>
            <p className="text-neutral-500 text-sm font-mono">Git features are disabled</p>
          </div>
        </div>
        <p className="text-neutral-400 text-sm font-mono">
          Initialize a git repository in {project.directory} to enable branch and PR creation.
        </p>
      </div>
    );
  }

  // All chunks complete - show completion panel
  return (
    <div className="bg-neutral-900/50 border border-emerald-500/30 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h3 className="text-neutral-100 font-mono font-medium">All chunks completed!</h3>
          <p className="text-neutral-500 text-sm font-mono">Ready to create PR?</p>
        </div>
      </div>

      {/* Git status info */}
      <div className="bg-neutral-800/50 rounded-md p-4 mb-6 font-mono text-sm space-y-2">
        <div className="flex justify-between">
          <span className="text-neutral-500">Branch:</span>
          <span className="text-neutral-300">{gitStatus?.branchName || gitStatus?.currentBranch || 'main'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Commits:</span>
          <span className="text-neutral-300">{gitStatus?.commitCount || 0}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Files changed:</span>
          <span className="text-neutral-300">{gitStatus?.filesChanged || 0}</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 mb-4">
          <p className="text-red-400 text-sm font-mono">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-3">
        {/* Create branch if needed */}
        {!spec.branchName && gitStatus?.currentBranch === 'main' && (
          <button
            onClick={() => handleAction('branch', onCreateBranch)}
            disabled={!!actionInProgress}
            className="w-full px-4 py-2.5 bg-neutral-800 text-neutral-300 border border-neutral-700 hover:bg-neutral-700 disabled:opacity-50 rounded-md font-mono text-sm transition-colors flex items-center justify-center gap-2"
          >
            {actionInProgress === 'branch' ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating branch...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                Create Branch First
              </>
            )}
          </button>
        )}

        {/* Create PR button */}
        <button
          onClick={() => handleAction('pr', onCreatePR)}
          disabled={!!actionInProgress || (gitStatus?.currentBranch === 'main' && !spec.branchName)}
          className="w-full px-4 py-2.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-md font-mono text-sm transition-colors flex items-center justify-center gap-2"
        >
          {actionInProgress === 'pr' ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Creating PR...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              Create PR
            </>
          )}
        </button>

        {/* Commit only button */}
        <button
          onClick={() => handleAction('commit', onCommitOnly)}
          disabled={!!actionInProgress}
          className="w-full px-4 py-2.5 text-neutral-400 border border-neutral-700 hover:border-neutral-600 hover:text-neutral-300 disabled:opacity-50 rounded-md font-mono text-sm transition-colors flex items-center justify-center gap-2"
        >
          {actionInProgress === 'commit' ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Committing...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              Commit Only
            </>
          )}
        </button>

        {/* Skip button */}
        <button
          onClick={onSkip}
          disabled={!!actionInProgress}
          className="w-full px-4 py-2 text-neutral-500 hover:text-neutral-400 disabled:opacity-50 rounded-md font-mono text-sm transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
