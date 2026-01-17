# ORC-21: Git Integration - Ralph Loop Pattern

## Overview

Add git branch/commit/rollback workflow to spec execution following the Ralph Loop pattern.

## Context

Currently, spec execution happens on the current branch with no git integration. Failed chunks leave dirty state, and there's no way to track what was attempted vs what succeeded.

## Implementation

### 1. Database Changes

Add columns to `specs` table in `packages/dashboard/src/lib/db.ts`:

```typescript
// In initializeDatabase(), add migration:
db.exec(`ALTER TABLE specs ADD COLUMN branch_name TEXT`);
db.exec(`ALTER TABLE specs ADD COLUMN original_branch TEXT`);
db.exec(`ALTER TABLE specs ADD COLUMN pr_url TEXT`);
```

Add columns to `chunks` table:

```typescript
db.exec(`ALTER TABLE chunks ADD COLUMN commit_hash TEXT`);
db.exec(`ALTER TABLE chunks ADD COLUMN iteration INTEGER DEFAULT 0`);
```

Update types in `packages/shared/src/types.ts`:

```typescript
interface Spec {
  // ... existing
  branchName?: string;
  originalBranch?: string;
  prUrl?: string;
}

interface Chunk {
  // ... existing
  commitHash?: string;
  iteration?: number;
}
```

### 2. Create Git Helper

Create `packages/dashboard/src/lib/git.ts`:

```typescript
import { spawnSync } from 'child_process';

export function getCurrentBranch(cwd: string): string {
  const result = spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf-8' });
  return result.stdout.trim();
}

export function createBranch(cwd: string, branchName: string): void {
  spawnSync('git', ['checkout', '-b', branchName], { cwd, encoding: 'utf-8' });
}

export function commitChanges(cwd: string, message: string): string {
  spawnSync('git', ['add', '-A'], { cwd, encoding: 'utf-8' });

  const status = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' });
  if (!status.stdout.trim()) {
    return ''; // No changes to commit
  }

  // Use stdin for message to avoid shell escaping issues
  spawnSync('git', ['commit', '-F', '-'], {
    cwd,
    input: message,
    encoding: 'utf-8'
  });

  const hash = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' });
  return hash.stdout.trim();
}

export function resetHard(cwd: string): void {
  spawnSync('git', ['reset', '--hard', 'HEAD'], { cwd, encoding: 'utf-8' });
}

export function switchBranch(cwd: string, branch: string): void {
  spawnSync('git', ['checkout', branch], { cwd, encoding: 'utf-8' });
}

export function hasUncommittedChanges(cwd: string): boolean {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' });
  return result.stdout.trim().length > 0;
}
```

### 3. Update run-all/route.ts

Modify `packages/dashboard/src/app/api/specs/[id]/run-all/route.ts`:

**At start of execution (after line 118):**

```typescript
import { getCurrentBranch, createBranch, commitChanges, resetHard, switchBranch } from '@/lib/git';

// Save original branch and create spec branch
const project = getProject(spec.projectId);
const cwd = project.directory;
const originalBranch = getCurrentBranch(cwd);
const specBranch = `spec/${spec.title.toLowerCase().replace(/\s+/g, '-').slice(0, 50)}`;

try {
  createBranch(cwd, specBranch);
  updateSpec(specId, { branchName: specBranch, originalBranch });
} catch (e) {
  // Branch might already exist, try to switch to it
  switchBranch(cwd, specBranch);
}
```

**After successful chunk + review pass (around line 345):**

```typescript
// Commit the successful chunk
const commitHash = commitChanges(cwd, `chunk ${currentIndex}: ${chunk.title}`);
if (commitHash) {
  updateChunk(chunk.id, { commitHash });
}
```

**On chunk failure (around line 330):**

```typescript
// Reset to discard failed work
resetHard(cwd);
```

**In finally block (on success):**

```typescript
} finally {
  // If all chunks completed successfully, create PR
  if (completedCount === totalChunks) {
    try {
      // Push branch to remote
      spawnSync('git', ['push', '-u', 'origin', specBranch], { cwd, encoding: 'utf-8' });

      // Create PR using gh CLI
      const prResult = spawnSync('gh', [
        'pr', 'create',
        '--title', `Spec: ${spec.title}`,
        '--body', `Automated PR for spec execution.\n\n${completedCount} chunks completed successfully.\n\nSpec: ${spec.title}`,
        '--base', originalBranch
      ], { cwd, encoding: 'utf-8' });

      const prUrl = prResult.stdout.trim();
      if (prUrl) {
        updateSpec(specId, { prUrl });
        sendEvent({
          type: 'pr_created',
          url: prUrl,
          message: `Pull request created: ${prUrl}`
        });
      }
    } catch (error) {
      console.error('[Git] Failed to create PR:', error);
      sendEvent({
        type: 'pr_creation_failed',
        message: 'Failed to create PR. You can create it manually.'
      });
    }
  }

  // Switch back to original branch
  if (originalBranch) {
    switchBranch(cwd, originalBranch);
  }
  endRunAllSession(specId);
  controller.close();
}
```

### 4. Add PR Creation Helper

In `packages/dashboard/src/lib/git.ts`:

```typescript
export function pushBranch(cwd: string, branchName: string): { success: boolean; error?: string } {
  const result = spawnSync('git', ['push', '-u', 'origin', branchName], {
    cwd,
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    return { success: false, error: result.stderr };
  }

  return { success: true };
}

export function createPullRequest(
  cwd: string,
  title: string,
  body: string,
  baseBranch: string
): { success: boolean; url?: string; error?: string } {
  const result = spawnSync('gh', [
    'pr', 'create',
    '--title', title,
    '--body', body,
    '--base', baseBranch
  ], { cwd, encoding: 'utf-8' });

  if (result.status !== 0) {
    return { success: false, error: result.stderr };
  }

  const prUrl = result.stdout.trim();
  return { success: true, url: prUrl };
}
```

### 5. Show PR Link in UI

**File:** `packages/dashboard/src/components/SpecCard.tsx`

```typescript
{spec.prUrl && (
  <a
    href={spec.prUrl}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300"
  >
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z" clipRule="evenodd" />
    </svg>
    View PR
  </a>
)}
```

## Files to Modify

- **packages/dashboard/src/lib/git.ts** (ALREADY EXISTS - add pushBranch and createPullRequest)
- **packages/dashboard/src/lib/db.ts** (add migrations for branch_name, original_branch, pr_url)
- **packages/shared/src/types.ts** (add branchName, originalBranch, prUrl to Spec interface)
- **packages/dashboard/src/app/api/specs/[id]/run-all/route.ts** (integrate git workflow)
- **packages/dashboard/src/components/SpecCard.tsx** (show PR link)

## Dependencies

- ✅ ORC-30 (Command injection fix - DONE, git.ts already uses spawnSync)
- **ORC-44** (Require git/gh CLI) - Users need gh CLI installed

## Testing

1. Create a spec with 3 chunks
2. Run all - verify:
   - Branch created: `spec/{slug}`
   - Commits made after each chunk
   - No uncommitted changes
3. Intentionally fail a chunk - verify git reset happens
4. Complete successfully - verify:
   - Branch pushed to remote
   - PR created automatically
   - PR link shown in UI
   - Switched back to original branch

## Acceptance Criteria

- [ ] Branch created on spec start: `spec/{slug}`
- [ ] Commit after each successful chunk
- [ ] Git reset on chunk failure
- [ ] All chunks succeed → branch pushed to remote
- [ ] PR created automatically with spec details
- [ ] PR URL stored and displayed in UI
- [ ] Switch back to original branch when done
- [ ] Branch name stored in spec record
- [ ] Commit hash stored in chunk record
- [ ] Works with existing git.ts implementation
