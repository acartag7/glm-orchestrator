# ORC-29: Git Worktrees for Parallel Spec Execution

## Overview

Each spec runs in its own git worktree, enabling parallel spec execution. Background job monitors PRs and cleans up merged worktrees. Stale worktrees are flagged for manual cleanup.

## Context

Currently specs run sequentially in the same project directory. This means:
- Can't run multiple specs in parallel
- One spec's changes conflict with another
- Must wait for spec A to finish before starting spec B
- No isolation between spec executions

With git worktrees:
- Each spec gets its own directory copy
- Run 5-10 specs simultaneously
- Complete isolation (no conflicts)
- Resume/switch between specs easily

## Why This Matters

- **Parallelization**: Run 5-10 specs simultaneously instead of sequentially
- **Isolation**: One spec's failures don't affect others
- **Clean PRs**: Each spec = one branch = one PR
- **Resume capability**: Switch between spec work easily
- **Faster iteration**: Don't wait for long specs to finish

## User Requirements

1. **Background cleanup job** - Periodically check PRs, cleanup merged worktrees
2. **Unique worktrees per run** - Re-running spec creates fresh worktree (no conflicts)
3. **Stale worktree detection** - Mark inactive worktrees, prompt user cleanup
4. **Unlimited parallel specs** - No hard limit, but warn if too many (5+)
5. **Worktree location** - Sibling to project: `{projectPath}-spec-{shortId}-{timestamp}`
6. **Rich UI** - Show status, path, all active worktrees, disk usage

## Architecture

### Worktree Lifecycle

```
Spec Start
  ↓
Create unique worktree: {projectPath}-spec-{shortId}-{timestamp}
  ↓
Create branch in worktree (ORC-21)
  ↓
Execute chunks in worktree directory
  ↓
Commit per chunk (ORC-21)
  ↓
Push branch + Create PR (ORC-21)
  ↓
User merges PR on GitHub
  ↓
Background job detects merge
  ↓
Cleanup worktree directory
  ↓
Mark spec as completed
```

### Directory Structure

```
/Users/acartagena/project/orchestrator                        (main repo)
/Users/acartagena/project/orchestrator-spec-abc123de-1705501234  (spec 1 worktree)
/Users/acartagena/project/orchestrator-spec-def456gh-1705501456  (spec 2 worktree)
/Users/acartagena/project/orchestrator-spec-abc123de-1705502000  (spec 1 re-run)
```

Each worktree is a **full copy** of the repo at a specific branch, allowing parallel work.

### Integration with ORC-21

**ORC-21 provides:**
- Branch creation: `spec/{slug}`
- Per-chunk commits
- PR creation via `gh pr create`
- Git reset on failures

**ORC-29 adds:**
- Isolated worktree directory per spec
- All ORC-21 operations run **inside** the worktree
- Parallel execution capability
- Automatic cleanup after merge
- Stale worktree detection

The git workflow from ORC-21 runs transparently in each worktree's directory.

## Implementation

### 1. Database Schema Changes

**Add columns to specs table:**

```sql
ALTER TABLE specs ADD COLUMN worktree_path TEXT;
ALTER TABLE specs ADD COLUMN worktree_created_at INTEGER;
ALTER TABLE specs ADD COLUMN worktree_last_activity INTEGER;
ALTER TABLE specs ADD COLUMN pr_merged INTEGER DEFAULT 0;
```

**Update types in `packages/shared/src/types.ts`:**

```typescript
export interface Spec {
  // ... existing fields
  branchName?: string;        // from ORC-21
  originalBranch?: string;    // from ORC-21
  prUrl?: string;             // from ORC-21
  worktreePath?: string;      // NEW: path to worktree
  worktreeCreatedAt?: number; // NEW: timestamp when worktree created
  worktreeLastActivity?: number; // NEW: last time worktree was used
  prMerged?: boolean;         // NEW: whether PR has been merged
}
```

**Migration code in `packages/dashboard/src/lib/db/connection.ts`:**

```typescript
function runWorktreeMigrations(database: DatabaseType): void {
  const tableInfo = database.prepare(`PRAGMA table_info(specs)`).all() as { name: string }[];
  const hasWorktreePath = tableInfo.some(col => col.name === 'worktree_path');

  if (!hasWorktreePath) {
    console.log('Running worktree migrations (ORC-29)...');

    const migrations = [
      `ALTER TABLE specs ADD COLUMN worktree_path TEXT`,
      `ALTER TABLE specs ADD COLUMN worktree_created_at INTEGER`,
      `ALTER TABLE specs ADD COLUMN worktree_last_activity INTEGER`,
      `ALTER TABLE specs ADD COLUMN pr_merged INTEGER DEFAULT 0`,
    ];

    for (const migration of migrations) {
      try {
        database.exec(migration);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes('duplicate column')) {
          console.warn(`Migration warning: ${message}`);
        }
      }
    }

    console.log('Worktree migrations completed');
  }
}

// Call in getDb() after other migrations
runWorktreeMigrations(db);
```

### 2. Worktree Management Functions

**Add to `packages/dashboard/src/lib/git.ts`:**

```typescript
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

/**
 * Create a git worktree for isolated spec execution
 */
export function createWorktree(
  projectPath: string,
  specId: string,
  branchName: string
): { success: boolean; path?: string; error?: string } {
  const shortId = specId.slice(0, 8);
  const timestamp = Date.now();
  const worktreePath = `${projectPath}-spec-${shortId}-${timestamp}`;

  // Check if path already exists (shouldn't happen with timestamp, but be safe)
  if (existsSync(worktreePath)) {
    return {
      success: false,
      error: `Worktree path already exists: ${worktreePath}`
    };
  }

  // Create worktree with new branch
  const result = spawnSync('git', [
    'worktree', 'add',
    worktreePath,
    '-b', branchName
  ], {
    cwd: projectPath,
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    // Branch might already exist, try without -b
    const retryResult = spawnSync('git', [
      'worktree', 'add',
      worktreePath,
      branchName
    ], {
      cwd: projectPath,
      encoding: 'utf-8'
    });

    if (retryResult.status !== 0) {
      return {
        success: false,
        error: retryResult.stderr || 'Failed to create worktree'
      };
    }
  }

  return {
    success: true,
    path: worktreePath
  };
}

/**
 * Remove a git worktree (after PR merge or cleanup)
 */
export function removeWorktree(
  projectPath: string,
  worktreePath: string
): { success: boolean; error?: string } {
  // First try to remove normally
  let result = spawnSync('git', [
    'worktree', 'remove',
    worktreePath
  ], {
    cwd: projectPath,
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    // If worktree has uncommitted changes, force remove
    result = spawnSync('git', [
      'worktree', 'remove',
      '--force',
      worktreePath
    ], {
      cwd: projectPath,
      encoding: 'utf-8'
    });

    if (result.status !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to remove worktree'
      };
    }
  }

  return { success: true };
}

/**
 * List all worktrees for a project
 */
export function listWorktrees(projectPath: string): WorktreeInfo[] {
  const result = spawnSync('git', [
    'worktree', 'list',
    '--porcelain'
  ], {
    cwd: projectPath,
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    return [];
  }

  const worktrees: WorktreeInfo[] = [];
  const lines = result.stdout.split('\n');
  let current: Partial<WorktreeInfo> = {};

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      current.path = line.replace('worktree ', '');
    } else if (line.startsWith('branch ')) {
      current.branch = line.replace('branch ', '').replace('refs/heads/', '');
    } else if (line.startsWith('HEAD ')) {
      current.head = line.replace('HEAD ', '');
    } else if (line === '') {
      if (current.path) {
        worktrees.push(current as WorktreeInfo);
      }
      current = {};
    }
  }

  return worktrees;
}

/**
 * Check if PR is merged using gh CLI
 */
export function checkPRMerged(
  projectPath: string,
  prUrl: string
): { merged: boolean; error?: string } {
  // Extract PR number from URL
  const prMatch = prUrl.match(/\/pull\/(\d+)/);
  if (!prMatch) {
    return { merged: false, error: 'Invalid PR URL' };
  }

  const prNumber = prMatch[1];

  const result = spawnSync('gh', [
    'pr', 'view',
    prNumber,
    '--json', 'state,merged'
  ], {
    cwd: projectPath,
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    return { merged: false, error: result.stderr };
  }

  try {
    const data = JSON.parse(result.stdout);
    return { merged: data.merged === true };
  } catch {
    return { merged: false, error: 'Failed to parse PR status' };
  }
}
```

### 3. Update Run-All Route

**File: `packages/dashboard/src/app/api/specs/[id]/run-all/route.ts`**

**At start (after getting spec and project):**

```typescript
import { createWorktree, removeWorktree } from '@/lib/git';

// Check if spec already has a worktree
let workingDirectory: string;
let isWorktree = false;

if (spec.worktreePath && existsSync(spec.worktreePath)) {
  // Reuse existing worktree
  workingDirectory = spec.worktreePath;
  isWorktree = true;

  // Update last activity
  updateSpec(specId, {
    worktreeLastActivity: Date.now()
  });
} else {
  // Create new worktree
  const branchName = spec.branchName || generateBranchName(specId, spec.title);
  const worktreeResult = createWorktree(project.directory, specId, branchName);

  if (!worktreeResult.success) {
    sendEvent({
      type: 'error',
      message: `Failed to create worktree: ${worktreeResult.error}`
    });
    controller.close();
    return;
  }

  workingDirectory = worktreeResult.path!;
  isWorktree = true;

  // Store worktree info
  updateSpec(specId, {
    worktreePath: workingDirectory,
    worktreeCreatedAt: Date.now(),
    worktreeLastActivity: Date.now(),
    branchName
  });

  sendEvent({
    type: 'worktree_created',
    path: workingDirectory,
    message: `Worktree created at: ${workingDirectory}`
  });
}

// Use worktree directory for all operations
const cwd = workingDirectory;
```

**Update all chunk executions to use `cwd` instead of `project.directory`.**

**In finally block (no change needed - ORC-21 handles git operations):**

ORC-21's PR creation, commits, etc. all happen in `cwd` which is now the worktree.

### 4. Background Cleanup Job

**Create `packages/dashboard/src/lib/worktree-cleanup.ts`:**

```typescript
import { getDb } from './db';
import { checkPRMerged, removeWorktree, listWorktrees } from './git';
import { getProject } from './db/projects';
import { getSpec, updateSpec } from './db/specs';
import type { Database as DatabaseType } from 'better-sqlite3';

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Background job to cleanup merged PR worktrees
 * Run this periodically (e.g., every 5 minutes)
 */
export async function cleanupMergedWorktrees(): Promise<{
  cleaned: number;
  stale: number;
  errors: string[];
}> {
  const db = getDb();
  const errors: string[] = [];
  let cleaned = 0;
  let stale = 0;

  // Find all specs with worktrees and PRs
  const specs = db.prepare(`
    SELECT * FROM specs
    WHERE worktree_path IS NOT NULL
    AND pr_url IS NOT NULL
    AND pr_merged = 0
  `).all() as any[];

  for (const specRow of specs) {
    try {
      const project = getProject(specRow.project_id);
      if (!project) continue;

      // Check if PR is merged
      const prCheck = checkPRMerged(project.directory, specRow.pr_url);

      if (prCheck.merged) {
        // PR is merged, cleanup worktree
        const removeResult = removeWorktree(project.directory, specRow.worktree_path);

        if (removeResult.success) {
          // Mark as merged and clear worktree path
          updateSpec(specRow.id, {
            prMerged: true,
            worktreePath: undefined
          });
          cleaned++;
          console.log(`[Cleanup] Removed merged worktree: ${specRow.worktree_path}`);
        } else {
          errors.push(`Failed to remove ${specRow.worktree_path}: ${removeResult.error}`);
        }
      } else if (prCheck.error) {
        // Error checking PR (might be deleted)
        const now = Date.now();
        const lastActivity = specRow.worktree_last_activity || specRow.worktree_created_at;

        if (now - lastActivity > STALE_THRESHOLD_MS) {
          // Mark as stale (7+ days inactive, PR check failed)
          stale++;
        }
      }
    } catch (error) {
      errors.push(`Error processing spec ${specRow.id}: ${error}`);
    }
  }

  // Also check for orphaned worktrees (not in database)
  // This handles edge cases where DB entry was deleted but worktree remains
  const allProjects = db.prepare(`SELECT * FROM projects`).all() as any[];

  for (const projectRow of allProjects) {
    try {
      const gitWorktrees = listWorktrees(projectRow.directory);
      const dbWorktreePaths = new Set(
        db.prepare(`SELECT worktree_path FROM specs WHERE project_id = ? AND worktree_path IS NOT NULL`)
          .all(projectRow.id)
          .map((row: any) => row.worktree_path)
      );

      for (const worktree of gitWorktrees) {
        // Skip main worktree
        if (worktree.path === projectRow.directory) continue;

        // If worktree exists in git but not in DB, it's orphaned
        if (!dbWorktreePaths.has(worktree.path)) {
          console.log(`[Cleanup] Found orphaned worktree: ${worktree.path}`);
          const removeResult = removeWorktree(projectRow.directory, worktree.path);

          if (removeResult.success) {
            cleaned++;
            console.log(`[Cleanup] Removed orphaned worktree: ${worktree.path}`);
          } else {
            errors.push(`Failed to remove orphaned ${worktree.path}: ${removeResult.error}`);
          }
        }
      }
    } catch (error) {
      errors.push(`Error cleaning project ${projectRow.id}: ${error}`);
    }
  }

  return { cleaned, stale, errors };
}

/**
 * Get stale worktrees (7+ days inactive, PR not merged)
 */
export function getStaleWorktrees(): Array<{
  specId: string;
  specTitle: string;
  worktreePath: string;
  daysInactive: number;
  prUrl?: string;
}> {
  const db = getDb();
  const now = Date.now();

  const specs = db.prepare(`
    SELECT * FROM specs
    WHERE worktree_path IS NOT NULL
    AND pr_merged = 0
  `).all() as any[];

  return specs
    .map(spec => {
      const lastActivity = spec.worktree_last_activity || spec.worktree_created_at;
      const daysInactive = Math.floor((now - lastActivity) / (24 * 60 * 60 * 1000));

      if (daysInactive >= 7) {
        return {
          specId: spec.id,
          specTitle: spec.title,
          worktreePath: spec.worktree_path,
          daysInactive,
          prUrl: spec.pr_url
        };
      }
      return null;
    })
    .filter(Boolean) as any[];
}
```

**Create cleanup API endpoint `packages/dashboard/src/app/api/worktrees/cleanup/route.ts`:**

```typescript
import { NextResponse } from 'next/server';
import { cleanupMergedWorktrees } from '@/lib/worktree-cleanup';

export async function POST() {
  try {
    const result = await cleanupMergedWorktrees();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: 'Cleanup failed' },
      { status: 500 }
    );
  }
}
```

**Create stale worktrees API `packages/dashboard/src/app/api/worktrees/stale/route.ts`:**

```typescript
import { NextResponse } from 'next/server';
import { getStaleWorktrees } from '@/lib/worktree-cleanup';

export async function GET() {
  try {
    const staleWorktrees = getStaleWorktrees();
    return NextResponse.json({ staleWorktrees });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to get stale worktrees' },
      { status: 500 }
    );
  }
}
```

**Setup periodic cleanup (in Next.js server):**

If using custom server, add cron job. Otherwise, trigger via external cron:

```bash
# Add to crontab: run every 5 minutes
*/5 * * * * curl -X POST http://localhost:4740/api/worktrees/cleanup
```

Or use Vercel Cron (if deploying to Vercel):

```json
// vercel.json
{
  "crons": [{
    "path": "/api/worktrees/cleanup",
    "schedule": "*/5 * * * *"
  }]
}
```

### 5. UI Components

**Update `packages/dashboard/src/components/SpecCard.tsx`:**

```typescript
// Add worktree status indicator
{spec.worktreePath && !spec.prMerged && (
  <div className="flex items-center gap-2 text-sm">
    <div className="flex items-center gap-1 text-blue-400">
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M7 2a1 1 0 00-.707 1.707L7 4.414v3.758a1 1 0 01-.293.707l-4 4C.817 14.769 2.156 18 4.828 18h10.343c2.673 0 4.012-3.231 2.122-5.121l-4-4A1 1 0 0113 8.172V4.414l.707-.707A1 1 0 0013 2H7zm2 6.172V4h2v4.172a3 3 0 00.879 2.12l1.027 1.028a4 4 0 00-2.171.102l-.47.156a4 4 0 01-2.53 0l-.563-.187a1.993 1.993 0 00-.114-.035l1.063-1.063A3 3 0 009 8.172z" clipRule="evenodd" />
      </svg>
      <span className="text-xs">Running in worktree</span>
    </div>

    {/* Show worktree path on hover */}
    <span className="text-xs text-neutral-500 truncate" title={spec.worktreePath}>
      {spec.worktreePath.split('/').pop()}
    </span>
  </div>
)}

{/* Show PR merged status */}
{spec.prMerged && (
  <div className="flex items-center gap-1 text-emerald-400 text-sm">
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
    <span className="text-xs">PR Merged</span>
  </div>
)}
```

**Create stale worktrees page `packages/dashboard/src/app/worktrees/page.tsx`:**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { removeWorktree } from '@/lib/git';

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

  useEffect(() => {
    fetch('/api/worktrees/stale')
      .then(res => res.json())
      .then(data => {
        setStale(data.staleWorktrees);
        setLoading(false);
      });
  }, []);

  const handleCleanup = async (worktreePath: string) => {
    if (!confirm(`Delete worktree at ${worktreePath}?`)) return;

    await fetch('/api/worktrees/cleanup', { method: 'POST' });

    // Refresh list
    const res = await fetch('/api/worktrees/stale');
    const data = await res.json();
    setStale(data.staleWorktrees);
  };

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-neutral-950 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-neutral-100 mb-6">Stale Worktrees</h1>

        {stale.length === 0 ? (
          <p className="text-neutral-400">No stale worktrees found.</p>
        ) : (
          <div className="space-y-4">
            {stale.map(item => (
              <div key={item.specId} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium text-neutral-100">{item.specTitle}</h3>
                    <p className="text-sm text-neutral-400 mt-1">{item.worktreePath}</p>
                    <p className="text-sm text-amber-400 mt-2">
                      Inactive for {item.daysInactive} days
                    </p>
                    {item.prUrl && (
                      <a
                        href={item.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:text-blue-300 mt-1 inline-block"
                      >
                        View PR →
                      </a>
                    )}
                  </div>

                  <button
                    onClick={() => handleCleanup(item.worktreePath)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded"
                  >
                    Cleanup
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Add warning when too many parallel specs:**

In `packages/dashboard/src/app/project/[id]/page.tsx`:

```typescript
// Count active worktrees
const activeWorktrees = specs.filter(s => s.worktreePath && !s.prMerged).length;

{activeWorktrees >= 5 && (
  <div className="mb-4 p-3 bg-amber-950/30 border border-amber-800/50 rounded">
    <p className="text-sm text-amber-300">
      ⚠️ {activeWorktrees} specs running in parallel. Performance may be impacted.
    </p>
  </div>
)}
```

### 6. SSE Event Types

**Add to `packages/shared/src/types.ts`:**

```typescript
export type SSEEvent =
  // ... existing events
  | { type: 'worktree_created'; path: string; message: string }
  | { type: 'worktree_cleanup'; success: boolean; message: string }
  | { type: 'pr_merged_detected'; prUrl: string }
```

## Files to Modify

1. **packages/dashboard/src/lib/db/connection.ts**
   - Add `runWorktreeMigrations()` function
   - Call it in `getDb()`

2. **packages/shared/src/types.ts**
   - Add worktree fields to Spec interface
   - Add SSE event types

3. **packages/dashboard/src/lib/git.ts**
   - Add `createWorktree()`
   - Add `removeWorktree()`
   - Add `listWorktrees()`
   - Add `checkPRMerged()`

4. **packages/dashboard/src/lib/worktree-cleanup.ts** (CREATE)
   - Cleanup job logic
   - Stale detection

5. **packages/dashboard/src/app/api/specs/[id]/run-all/route.ts**
   - Create/reuse worktree at start
   - Use worktree as working directory

6. **packages/dashboard/src/app/api/worktrees/cleanup/route.ts** (CREATE)
   - Trigger cleanup endpoint

7. **packages/dashboard/src/app/api/worktrees/stale/route.ts** (CREATE)
   - List stale worktrees

8. **packages/dashboard/src/components/SpecCard.tsx**
   - Show worktree status
   - Show PR merged indicator
   - Show worktree path

9. **packages/dashboard/src/app/worktrees/page.tsx** (CREATE)
   - Stale worktrees management UI

10. **packages/dashboard/src/app/project/[id]/page.tsx**
    - Warning for too many parallel specs

## Dependencies

- ✅ **ORC-21**: Git integration (merged) - provides branch/commit/PR workflow
- **ORC-44**: Require git/gh CLI - users need gh installed for PR checks

## Testing

### Test 1: Basic Worktree Creation
1. Create spec A
2. Click "Run All"
3. Verify worktree created at `{projectPath}-spec-{shortId}-{timestamp}`
4. Verify spec shows "Running in worktree" indicator
5. Verify chunks execute successfully

### Test 2: Parallel Execution
1. Create spec A and B
2. Start both specs
3. Verify two worktrees created with different paths
4. Verify both run simultaneously without conflicts
5. Verify separate branches and PRs created

### Test 3: Spec Re-run
1. Complete spec A (creates worktree + PR)
2. Click "Run All" again on spec A
3. Verify NEW worktree created (different timestamp)
4. Verify old worktree still exists
5. Both worktrees independent

### Test 4: PR Merge Cleanup
1. Complete spec A, PR created
2. Merge PR on GitHub
3. Wait 5 minutes (or trigger cleanup manually)
4. Verify worktree removed
5. Verify spec marked as `prMerged: true`
6. Verify spec no longer shows "Running in worktree"

### Test 5: Stale Worktree Detection
1. Create spec, run in worktree
2. Don't merge PR
3. Wait 7+ days (or modify `worktreeLastActivity` in DB to simulate)
4. Visit `/worktrees` page
5. Verify spec shown as stale
6. Click cleanup button
7. Verify worktree removed

### Test 6: Orphaned Worktree Cleanup
1. Create worktree
2. Manually delete spec from database
3. Run cleanup job
4. Verify orphaned worktree detected and removed

### Test 7: Too Many Parallel Specs Warning
1. Start 5+ specs in worktrees
2. Visit project page
3. Verify warning shown: "5 specs running in parallel"

### Test 8: Error Handling
1. Try creating worktree when path exists (simulate collision)
2. Verify error shown, execution doesn't start
3. Try removing worktree that doesn't exist
4. Verify graceful error handling

## Acceptance Criteria

- [ ] Worktree created automatically when spec execution starts
- [ ] Each run creates unique worktree (timestamp in path)
- [ ] Multiple specs run in parallel without conflicts
- [ ] Chunks execute in worktree directory
- [ ] ORC-21 git workflow runs transparently in worktree
- [ ] Background job checks PRs every 5 minutes
- [ ] Merged PRs trigger automatic worktree cleanup
- [ ] Worktrees older than 7 days marked as stale
- [ ] Stale worktrees shown in `/worktrees` page
- [ ] Manual cleanup button for stale worktrees
- [ ] Orphaned worktrees detected and cleaned
- [ ] UI shows worktree status on spec cards
- [ ] UI shows PR merged status
- [ ] Warning shown when 5+ specs run in parallel
- [ ] All worktree operations logged
- [ ] No conflicts between parallel executions

## Out of Scope

- Spec-to-spec dependencies (managed in Linear, not Specwright)
- Automatic merge conflict resolution
- Disk usage limits (user responsibility)
- Cross-repository worktrees
- Webhooks for instant PR merge detection (use polling for MVP)

## Performance Considerations

- Each worktree is full repo copy (~same size as main repo)
- 5 parallel specs = 5x disk space usage
- Background job runs every 5 minutes (lightweight check)
- Cleanup removes directories (can take seconds for large repos)
- List worktrees uses `git worktree list` (fast operation)

## Security Considerations

- Worktree paths predictable but unique (timestamp)
- No user input in worktree paths (spec ID + timestamp only)
- Cleanup uses `--force` to handle uncommitted changes
- Orphaned worktree cleanup prevents disk buildup
- All git operations use `spawnSync` (no shell injection)
