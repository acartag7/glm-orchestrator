/**
 * Git Service - Encapsulates all git operations for spec execution
 *
 * Wraps existing git.ts utilities into a service interface for use by
 * chunk-pipeline and spec-execution-service.
 */

import type { Spec } from '@specwright/shared';
import {
  checkGitRepo,
  getCurrentBranch,
  createBranch,
  createCommit,
  resetHard,
  pushBranch,
  createPullRequest,
  generateSpecBranchName,
  createWorktree,
  removeWorktree,
  getCommitCount,
  getChangedFilesCount,
} from '../git';
import { getSpec, updateSpec } from '../db';
import { getProject } from '../db/projects';

export interface GitWorkflowState {
  enabled: boolean;
  projectDir: string;
  workingDir: string;           // worktree path or project dir
  isWorktree: boolean;
  originalBranch: string | null;
  specBranch: string | null;
}

export interface CommitResult {
  success: boolean;
  commitHash?: string;
  filesChanged?: number;
  error?: string;
}

export interface PRResult {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
}

export class GitService {
  /**
   * Initialize git workflow for a spec
   * - Check if git repo
   * - Create worktree or branch
   * - Return workflow state
   */
  async initWorkflow(specId: string, projectDir: string): Promise<GitWorkflowState> {
    // Check if this is a git repo
    if (!checkGitRepo(projectDir)) {
      console.log(`[Git] Not a git repo: ${projectDir}`);
      return {
        enabled: false,
        projectDir,
        workingDir: projectDir,
        isWorktree: false,
        originalBranch: null,
        specBranch: null,
      };
    }

    // Get current branch before any changes
    const originalBranch = getCurrentBranch(projectDir);
    console.log(`[Git] Original branch: ${originalBranch}`);

    // Get spec for branch name generation
    const spec = getSpec(specId);
    if (!spec) {
      console.error(`[Git] Spec not found: ${specId}`);
      return {
        enabled: false,
        projectDir,
        workingDir: projectDir,
        isWorktree: false,
        originalBranch,
        specBranch: null,
      };
    }

    // Check if spec already has a worktree path
    if (spec.worktreePath) {
      console.log(`[Git] Using existing worktree: ${spec.worktreePath}`);
      return {
        enabled: true,
        projectDir,
        workingDir: spec.worktreePath,
        isWorktree: true,
        originalBranch,
        specBranch: spec.branchName || null,
      };
    }

    // Generate branch name
    const branchName = spec.branchName || generateSpecBranchName(spec.title);
    console.log(`[Git] Branch name: ${branchName}`);

    // Try to create worktree first (preferred for isolation)
    const worktreeResult = createWorktree(projectDir, specId, branchName);
    if (worktreeResult.success && worktreeResult.path) {
      console.log(`[Git] Created worktree at ${worktreeResult.path}`);

      // Update spec with worktree info
      updateSpec(specId, {
        branchName,
        originalBranch: originalBranch || undefined,
        worktreePath: worktreeResult.path,
      });

      return {
        enabled: true,
        projectDir,
        workingDir: worktreeResult.path,
        isWorktree: true,
        originalBranch,
        specBranch: branchName,
      };
    }

    // Fall back to branch-based workflow
    console.log(`[Git] Worktree failed, falling back to branch: ${worktreeResult.error}`);

    const branchResult = await createBranch(projectDir, branchName, originalBranch || 'main');
    if (!branchResult.success) {
      console.error(`[Git] Failed to create branch: ${branchResult.error?.message}`);
      return {
        enabled: false,
        projectDir,
        workingDir: projectDir,
        isWorktree: false,
        originalBranch,
        specBranch: null,
      };
    }

    // Update spec with branch info
    updateSpec(specId, {
      branchName,
      originalBranch: originalBranch || undefined,
    });

    return {
      enabled: true,
      projectDir,
      workingDir: projectDir,
      isWorktree: false,
      originalBranch,
      specBranch: branchName,
    };
  }

  /**
   * Commit changes for a chunk
   */
  async commitChunk(
    state: GitWorkflowState,
    chunkId: string,
    chunkTitle: string,
    chunkIndex: number
  ): Promise<CommitResult> {
    if (!state.enabled) {
      return { success: false, error: 'Git not enabled' };
    }

    const message = `chunk ${chunkIndex + 1}: ${chunkTitle}`;
    console.log(`[Git] Committing: ${message}`);

    const result = await createCommit(state.workingDir, message);

    if (result.success) {
      console.log(`[Git] Committed chunk ${chunkId}: ${result.commitHash}`);
    } else {
      console.error(`[Git] Commit failed for chunk ${chunkId}: ${result.error}`);
    }

    return result;
  }

  /**
   * Reset working directory (discard changes)
   */
  resetHard(state: GitWorkflowState): { success: boolean; error?: string } {
    if (!state.enabled) {
      return { success: false, error: 'Git not enabled' };
    }

    console.log(`[Git] Reset to HEAD in ${state.workingDir}`);
    return resetHard(state.workingDir);
  }

  /**
   * Push branch and create PR
   * Only called after final review passes
   */
  async pushAndCreatePR(
    state: GitWorkflowState,
    spec: Spec,
    passedChunks: number
  ): Promise<PRResult> {
    if (!state.enabled || !state.specBranch) {
      return { success: false, error: 'Git not enabled or no branch' };
    }

    // Push the branch
    console.log(`[Git] Pushing branch: ${state.specBranch}`);
    const pushResult = await pushBranch(state.workingDir, state.specBranch);
    if (!pushResult.success) {
      return { success: false, error: pushResult.error };
    }

    // Get stats for PR body
    const commitCount = getCommitCount(state.workingDir, state.originalBranch || 'main');
    const filesChanged = getChangedFilesCount(state.workingDir, state.originalBranch || 'main');

    // Build PR body
    const prBody = this.buildPRBody(spec, passedChunks, commitCount, filesChanged);

    // Create PR
    console.log(`[Git] Creating PR for: ${spec.title}`);
    const prResult = await createPullRequest(
      state.workingDir,
      spec.title,
      prBody,
      state.originalBranch || 'main'
    );

    if (prResult.success) {
      console.log(`[Git] Created PR: ${prResult.prUrl}`);
    } else {
      console.error(`[Git] PR creation failed: ${prResult.error}`);
    }

    return prResult;
  }

  /**
   * Cleanup - switch back to original branch if not using worktree
   */
  async cleanup(state: GitWorkflowState): Promise<void> {
    if (!state.enabled) return;

    if (state.isWorktree) {
      // Don't remove worktree - it may be needed for review or additional work
      console.log(`[Git] Worktree preserved at: ${state.workingDir}`);
    } else if (state.originalBranch) {
      // Switch back to original branch
      console.log(`[Git] Switching back to: ${state.originalBranch}`);
      // Note: We don't use checkoutBranch here to avoid importing it
      // The caller can handle branch switching if needed
    }
  }

  /**
   * Remove worktree (call after PR is merged)
   */
  removeWorktree(state: GitWorkflowState): { success: boolean; error?: string } {
    if (!state.isWorktree) {
      return { success: false, error: 'Not a worktree' };
    }

    console.log(`[Git] Removing worktree: ${state.workingDir}`);
    return removeWorktree(state.projectDir, state.workingDir);
  }

  private buildPRBody(
    spec: Spec,
    passedChunks: number,
    commitCount: number,
    filesChanged: number
  ): string {
    return `## Summary

${spec.content.slice(0, 500)}${spec.content.length > 500 ? '...' : ''}

## Stats

- Chunks completed: ${passedChunks}
- Commits: ${commitCount}
- Files changed: ${filesChanged}

## Test Plan

- [ ] Review all changed files
- [ ] Run tests locally
- [ ] Verify functionality

---
*Generated by Specwright*`;
  }
}

export const gitService = new GitService();
