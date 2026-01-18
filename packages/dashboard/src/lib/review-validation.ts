/**
 * Review Validation - Pre-review validation for chunk execution
 *
 * Validates that chunks actually made code changes and that the build passes
 * before sending to Claude for review. This prevents false positives where
 * chunks claim success but made no changes or broke the build.
 */

import { spawnSync } from 'child_process';
import { gitSync } from './git';

const DEFAULT_BUILD_TIMEOUT_MS = 180000; // 3 minutes max for build

export interface ValidationResult {
  success: boolean;
  filesChanged: number;
  filesChangedList: string[];
  gitDiff: string;
  buildResult: {
    success: boolean;
    output: string;
    exitCode: number;
  };
  autoFail?: {
    reason: 'no_changes' | 'build_failed' | 'validation_error';
    feedback: string;
  };
}

/**
 * Get list of changed files (uncommitted changes)
 */
function getChangedFiles(directory: string): { files: string[]; error?: string } {
  const result = gitSync(['status', '--porcelain'], directory);

  if (result.status !== 0) {
    return { files: [], error: result.stderr || 'Failed to get git status' };
  }

  const files = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3).trim()); // Remove status prefix (e.g., " M ", "?? ")

  return { files };
}

/**
 * Get git diff summary for review context
 */
function getGitDiff(directory: string, maxLines: number = 100): string {
  const result = gitSync(['diff', '--stat'], directory);

  if (result.status !== 0) {
    return 'Unable to get diff summary';
  }

  const lines = result.stdout.trim().split('\n');
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
  }

  return result.stdout.trim() || 'No diff available';
}

/**
 * Run build command in the working directory
 */
function runBuild(directory: string, timeoutMs: number): { success: boolean; output: string; exitCode: number } {
  // Try pnpm build first (most common for this project)
  const result = spawnSync('pnpm', ['build'], {
    cwd: directory,
    encoding: 'utf-8',
    shell: false,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large build output
  });

  if (result.error) {
    // Check if it's a timeout
    if ((result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
      const timeoutMinutes = Math.floor(timeoutMs / 60000);
      return {
        success: false,
        output: `Build timed out after ${timeoutMinutes} minutes`,
        exitCode: -1,
      };
    }
    return {
      success: false,
      output: result.error.message,
      exitCode: -1,
    };
  }

  const output = [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n');

  return {
    success: result.status === 0,
    output: output.slice(-5000), // Keep last 5000 chars to avoid massive output
    exitCode: result.status ?? -1,
  };
}

/**
 * Validate chunk completion before review
 *
 * Checks:
 * 1. Whether any files were changed
 * 2. Whether the build passes
 *
 * Returns validation results including auto-fail conditions
 */
export async function validateChunkCompletion(
  workingDirectory: string,
  chunkId: string,
  options: {
    skipBuild?: boolean;
    buildTimeout?: number;
  } = {}
): Promise<ValidationResult> {
  console.log(`[Review Validation] Validating chunk ${chunkId} in ${workingDirectory}`);

  const buildTimeout = options.buildTimeout ?? DEFAULT_BUILD_TIMEOUT_MS;

  try {
    // 1. Check for file changes
    const { files, error: filesError } = getChangedFiles(workingDirectory);

    if (filesError) {
      return {
        success: false,
        filesChanged: 0,
        filesChangedList: [],
        gitDiff: '',
        buildResult: { success: false, output: '', exitCode: -1 },
        autoFail: {
          reason: 'validation_error',
          feedback: `Failed to check git status: ${filesError}`,
        },
      };
    }

    const filesChanged = files.length;
    const filesChangedList = files;

    // Get diff summary
    const gitDiff = getGitDiff(workingDirectory);

    // 2. Auto-fail if no changes
    if (filesChanged === 0) {
      console.log(`[Review Validation] Auto-fail: No files changed for chunk ${chunkId}`);
      return {
        success: false,
        filesChanged: 0,
        filesChangedList: [],
        gitDiff: 'No changes',
        buildResult: { success: true, output: 'Skipped - no changes to build', exitCode: 0 },
        autoFail: {
          reason: 'no_changes',
          feedback:
            'No code changes were made. The AI assistant may have output text without actually implementing the task. This chunk needs to be re-executed or manually completed.',
        },
      };
    }

    // 3. Run build validation (unless skipped)
    let buildResult = { success: true, output: 'Build validation skipped', exitCode: 0 };

    if (!options.skipBuild) {
      console.log(`[Review Validation] Running build for chunk ${chunkId}...`);
      buildResult = runBuild(workingDirectory, buildTimeout);
      console.log(`[Review Validation] Build result: ${buildResult.success ? 'SUCCESS' : 'FAILED'}`);

      // Auto-fail if build fails
      if (!buildResult.success) {
        console.log(`[Review Validation] Auto-fail: Build failed for chunk ${chunkId}`);
        return {
          success: false,
          filesChanged,
          filesChangedList,
          gitDiff,
          buildResult,
          autoFail: {
            reason: 'build_failed',
            feedback: `Build failed with exit code ${buildResult.exitCode}. Errors:\n${buildResult.output}`,
          },
        };
      }
    }

    // Validation passed - let Claude do the detailed review
    console.log(`[Review Validation] Validation passed for chunk ${chunkId}: ${filesChanged} files changed, build OK`);
    return {
      success: true,
      filesChanged,
      filesChangedList,
      gitDiff,
      buildResult,
    };
  } catch (error) {
    console.error(`[Review Validation] Error validating chunk ${chunkId}:`, error);
    return {
      success: false,
      filesChanged: 0,
      filesChangedList: [],
      gitDiff: '',
      buildResult: { success: false, output: '', exitCode: -1 },
      autoFail: {
        reason: 'validation_error',
        feedback: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    };
  }
}
