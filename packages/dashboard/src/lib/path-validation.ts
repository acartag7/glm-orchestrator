import path from 'path';
import os from 'os';
import { existsSync, statSync, realpathSync } from 'fs';

/**
 * Path validation error thrown when a path fails validation
 */
export class PathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathValidationError';
  }
}

/**
 * Validates that a project path is safe and within allowed directories.
 *
 * Security checks performed:
 * 1. Path must be absolute
 * 2. Path is normalized (resolves .., symlinks, etc.)
 * 3. Path must be within the user's home directory
 * 4. Path cannot access sensitive system directories
 *
 * @param projectPath - The path to validate
 * @throws PathValidationError if the path is invalid or unsafe
 */
export function validateProjectPath(projectPath: string): void {
  if (!projectPath || typeof projectPath !== 'string') {
    throw new PathValidationError('Project path is required');
  }

  // Normalize the path to resolve any .. or . segments
  const normalizedPath = path.normalize(projectPath);

  // Resolve to absolute path
  const resolvedPath = path.resolve(normalizedPath);

  // Get the user's home directory
  const homeDir = os.homedir();

  // If the path exists, resolve symlinks to get the real path
  let realPath = resolvedPath;
  if (existsSync(resolvedPath)) {
    try {
      realPath = realpathSync(resolvedPath);
    } catch {
      // If we can't resolve symlinks, use the resolved path
      realPath = resolvedPath;
    }
  }

  // Check that the path is within the home directory
  if (!realPath.startsWith(homeDir + path.sep) && realPath !== homeDir) {
    throw new PathValidationError(
      `Project path must be within your home directory (${homeDir})`
    );
  }

  // Block access to sensitive directories within home
  const blockedPaths = [
    path.join(homeDir, '.ssh'),
    path.join(homeDir, '.gnupg'),
    path.join(homeDir, '.aws'),
    path.join(homeDir, '.config'),
    path.join(homeDir, '.local', 'share', 'keyrings'),
    path.join(homeDir, '.password-store'),
    path.join(homeDir, '.netrc'),
    path.join(homeDir, '.docker'),
    path.join(homeDir, '.kube'),
    path.join(homeDir, '.npmrc'),
    path.join(homeDir, '.pypirc'),
  ];

  for (const blocked of blockedPaths) {
    if (realPath === blocked || realPath.startsWith(blocked + path.sep)) {
      throw new PathValidationError(
        'Access to sensitive directories is not allowed'
      );
    }
  }

  // If path exists, verify it's a directory
  if (existsSync(realPath)) {
    try {
      const stats = statSync(realPath);
      if (!stats.isDirectory()) {
        throw new PathValidationError('Project path must be a directory');
      }
    } catch (error) {
      if (error instanceof PathValidationError) {
        throw error;
      }
      throw new PathValidationError('Unable to verify path is a directory');
    }
  }
}

/**
 * Validates and normalizes a project path.
 * Returns the normalized, resolved path if valid.
 *
 * @param projectPath - The path to validate
 * @returns The normalized, resolved path
 * @throws PathValidationError if the path is invalid or unsafe
 */
export function validateAndNormalizePath(projectPath: string): string {
  validateProjectPath(projectPath);

  const normalizedPath = path.normalize(projectPath);
  const resolvedPath = path.resolve(normalizedPath);

  // If path exists, return the real path (with symlinks resolved)
  if (existsSync(resolvedPath)) {
    try {
      return realpathSync(resolvedPath);
    } catch {
      return resolvedPath;
    }
  }

  return resolvedPath;
}
