import { execSync, exec, spawnSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Safe wrapper for git commands that prevents command injection
 */
function gitSync(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    shell: false, // Critical: don't use shell to prevent injection
  });

  // Handle spawnSync errors (e.g., command not found, permission denied)
  if (result.error) {
    return {
      stdout: '',
      stderr: result.error.message,
      status: 1,
    };
  }

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? 1,
  };
}

/**
 * Safe wrapper for gh CLI commands that prevents command injection
 */
function ghSync(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('gh', args, {
    cwd,
    encoding: 'utf-8',
    shell: false, // Critical: don't use shell to prevent injection
  });

  // Handle spawnSync errors (e.g., command not found, permission denied)
  if (result.error) {
    return {
      stdout: '',
      stderr: result.error.message,
      status: 1,
    };
  }

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? 1,
  };
}

export interface GitStatus {
  branch: string;
  hasChanges: boolean;
  filesChanged: number;
  isClean: boolean;
  ahead: number;
  behind: number;
}

export interface GitError {
  type: 'not_git_repo' | 'no_gh_cli' | 'not_authenticated' | 'branch_exists' | 'no_remote' | 'invalid_branch_name' | 'unknown';
  message: string;
}

/**
 * Valid git branch name pattern (defense in depth)
 * Allows alphanumeric, dash, underscore, slash, and dot
 */
const VALID_BRANCH_NAME = /^[\w\-\/.]+$/;

/**
 * Validates a git branch name for safety and correctness
 */
function validateBranchName(branchName: string): { valid: boolean; error?: string } {
  if (!branchName || branchName.length === 0) {
    return { valid: false, error: 'Branch name cannot be empty' };
  }
  if (branchName.length > 255) {
    return { valid: false, error: 'Branch name is too long (max 255 characters)' };
  }
  if (!VALID_BRANCH_NAME.test(branchName)) {
    return { valid: false, error: 'Branch name contains invalid characters. Use only alphanumeric, dash, underscore, slash, or dot.' };
  }
  if (branchName.startsWith('-') || branchName.startsWith('.')) {
    return { valid: false, error: 'Branch name cannot start with a dash or dot' };
  }
  if (branchName.endsWith('.lock') || branchName.endsWith('/')) {
    return { valid: false, error: 'Branch name cannot end with .lock or /' };
  }
  if (branchName.includes('..') || branchName.includes('//')) {
    return { valid: false, error: 'Branch name cannot contain consecutive dots or slashes' };
  }
  return { valid: true };
}

/**
 * Check if a directory is a git repository
 */
export function checkGitRepo(directory: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: directory,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current git status of a directory
 */
export async function getGitStatus(directory: string): Promise<GitStatus> {
  // Get current branch
  const branch = execSync('git branch --show-current', {
    cwd: directory,
    encoding: 'utf-8',
  }).trim();

  // Get status (staged + unstaged)
  const status = execSync('git status --porcelain', {
    cwd: directory,
    encoding: 'utf-8',
  }).trim();

  const files = status ? status.split('\n').filter(Boolean) : [];
  const hasChanges = files.length > 0;

  // Get ahead/behind counts
  let ahead = 0;
  let behind = 0;
  try {
    const tracking = execSync('git rev-list --left-right --count HEAD...@{upstream}', {
      cwd: directory,
      encoding: 'utf-8',
    }).trim();
    const [a, b] = tracking.split('\t').map(Number);
    ahead = a || 0;
    behind = b || 0;
  } catch {
    // No upstream tracking
  }

  return {
    branch,
    hasChanges,
    filesChanged: files.length,
    isClean: !hasChanges,
    ahead,
    behind,
  };
}

/**
 * Generate a branch name from spec ID and title
 */
export function generateBranchName(specId: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `spec/${specId.slice(0, 8)}-${slug}`;
}

/**
 * Check if a branch exists locally or remotely
 */
export function branchExists(directory: string, branchName: string): boolean {
  try {
    // Check local branches
    const localBranches = execSync('git branch --list', {
      cwd: directory,
      encoding: 'utf-8',
    });
    if (localBranches.includes(branchName)) {
      return true;
    }

    // Check remote branches
    const remoteBranches = execSync('git branch -r --list', {
      cwd: directory,
      encoding: 'utf-8',
    });
    if (remoteBranches.includes(`origin/${branchName}`)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Create a new branch and check it out
 */
export async function createBranch(
  directory: string,
  branchName: string,
  baseBranch?: string
): Promise<{ success: boolean; error?: GitError }> {
  // Validate branch name (defense in depth)
  const validation = validateBranchName(branchName);
  if (!validation.valid) {
    return {
      success: false,
      error: { type: 'invalid_branch_name', message: validation.error! },
    };
  }

  // Also validate base branch if provided
  if (baseBranch) {
    const baseValidation = validateBranchName(baseBranch);
    if (!baseValidation.valid) {
      return {
        success: false,
        error: { type: 'invalid_branch_name', message: `Base branch: ${baseValidation.error}` },
      };
    }
  }

  // If base branch specified, make sure we're on it first
  if (baseBranch) {
    const checkoutResult = gitSync(['checkout', baseBranch], directory);
    if (checkoutResult.status === 0) {
      // Pull latest - ignore failures (remote may not exist)
      gitSync(['pull', 'origin', baseBranch], directory);
    }
    // If checkout failed, continue anyway (may already be on the branch)
  }

  // Create and checkout new branch
  const result = gitSync(['checkout', '-b', branchName], directory);
  if (result.status !== 0) {
    const message = result.stderr;
    if (message.includes('already exists')) {
      return {
        success: false,
        error: { type: 'branch_exists', message: `Branch '${branchName}' already exists` },
      };
    }
    return {
      success: false,
      error: { type: 'unknown', message },
    };
  }

  return { success: true };
}

/**
 * Checkout an existing branch
 */
export function checkoutBranch(directory: string, branchName: string): boolean {
  // Validate branch name (defense in depth)
  const validation = validateBranchName(branchName);
  if (!validation.valid) {
    return false;
  }

  const result = gitSync(['checkout', branchName], directory);
  return result.status === 0;
}

/**
 * Get the current branch name
 */
export function getCurrentBranch(directory: string): string | null {
  try {
    return execSync('git branch --show-current', {
      cwd: directory,
      encoding: 'utf-8',
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Stage all changes and create a commit
 */
export async function createCommit(
  directory: string,
  message: string
): Promise<{ success: boolean; commitHash?: string; filesChanged?: number; error?: string }> {
  try {
    // Check for changes
    const statusResult = gitSync(['status', '--porcelain'], directory);
    const status = statusResult.stdout.trim();

    if (!status) {
      return { success: false, error: 'No changes to commit' };
    }

    const filesChanged = status.split('\n').filter(Boolean).length;

    // Stage all changes
    const addResult = gitSync(['add', '-A'], directory);
    if (addResult.status !== 0) {
      return { success: false, error: addResult.stderr || 'Failed to stage changes' };
    }

    // Create commit - message is passed as argument, preventing injection
    const commitResult = gitSync(['commit', '-m', message], directory);
    if (commitResult.status !== 0) {
      return { success: false, error: commitResult.stderr || 'Failed to create commit' };
    }

    // Get commit hash
    const hashResult = gitSync(['rev-parse', 'HEAD'], directory);
    const commitHash = hashResult.stdout.trim();

    return { success: true, commitHash, filesChanged };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Check if GitHub CLI is installed and authenticated
 */
export function checkGitHubCLI(): { installed: boolean; authenticated: boolean; error?: string } {
  // Check if gh is installed
  try {
    execSync('gh --version', { stdio: 'pipe' });
  } catch {
    return { installed: false, authenticated: false, error: 'GitHub CLI (gh) is not installed' };
  }

  // Check if authenticated
  try {
    execSync('gh auth status', { stdio: 'pipe' });
    return { installed: true, authenticated: true };
  } catch {
    return { installed: true, authenticated: false, error: 'Not authenticated with GitHub. Run: gh auth login' };
  }
}

/**
 * Push the current branch to remote
 */
export async function pushBranch(
  directory: string,
  branchName: string
): Promise<{ success: boolean; error?: string }> {
  // Validate branch name (defense in depth)
  const validation = validateBranchName(branchName);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const result = gitSync(['push', '-u', 'origin', branchName], directory);
  if (result.status === 0) {
    return { success: true };
  }
  // May already be pushed
  if (result.stderr.includes('Everything up-to-date')) {
    return { success: true };
  }
  return { success: false, error: result.stderr };
}

/**
 * Create a pull request using GitHub CLI
 */
export async function createPullRequest(
  directory: string,
  title: string,
  body: string,
  baseBranch: string = 'main'
): Promise<{ success: boolean; prUrl?: string; prNumber?: number; error?: string }> {
  try {
    // Get current branch
    const currentBranch = getCurrentBranch(directory);
    if (!currentBranch) {
      return { success: false, error: 'Not on a branch (detached HEAD)' };
    }

    if (currentBranch === baseBranch) {
      return { success: false, error: `Already on ${baseBranch} branch. Create a feature branch first.` };
    }

    // Push branch first
    const pushResult = await pushBranch(directory, currentBranch);
    if (!pushResult.success) {
      return { success: false, error: pushResult.error };
    }

    // Create PR using gh CLI
    // Use a temp file for body to handle special characters
    const { writeFileSync, unlinkSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');

    const bodyFile = join(tmpdir(), `pr-body-${Date.now()}.md`);
    writeFileSync(bodyFile, body, 'utf-8');

    try {
      // Use array syntax to prevent injection
      const result = ghSync(
        ['pr', 'create', '--title', title, '--body-file', bodyFile, '--base', baseBranch],
        directory
      );

      if (result.status !== 0) {
        const message = result.stderr;
        // Check if PR already exists
        if (message.includes('already exists')) {
          return { success: false, error: 'A pull request already exists for this branch' };
        }
        return { success: false, error: message };
      }

      const prUrl = result.stdout.trim();

      // Extract PR number from URL
      const prNumberMatch = prUrl.match(/\/pull\/(\d+)$/);
      const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : undefined;

      return { success: true, prUrl, prNumber };
    } finally {
      // Clean up temp file
      try {
        unlinkSync(bodyFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    // Check if PR already exists
    if (message.includes('already exists')) {
      return { success: false, error: 'A pull request already exists for this branch' };
    }

    return { success: false, error: message };
  }
}

/**
 * Get commit count between current branch and base
 */
export function getCommitCount(directory: string, baseBranch: string = 'main'): number {
  try {
    const result = gitSync(['rev-list', '--count', `${baseBranch}..HEAD`], directory);
    if (result.status === 0) {
      return parseInt(result.stdout.trim(), 10) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Get changed files count between current branch and base
 */
export function getChangedFilesCount(directory: string, baseBranch: string = 'main'): number {
  try {
    const result = gitSync(['diff', '--name-only', `${baseBranch}...HEAD`], directory);
    if (result.status === 0) {
      const files = result.stdout.trim();
      return files ? files.split('\n').filter(Boolean).length : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}
