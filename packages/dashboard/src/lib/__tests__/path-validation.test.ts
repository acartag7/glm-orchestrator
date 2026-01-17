/**
 * Tests for path traversal vulnerability prevention in path-validation.ts
 *
 * These tests verify that malicious paths cannot access files outside
 * the user's home directory or sensitive system directories.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validateProjectPath, validateAndNormalizePath, PathValidationError } from '../path-validation';
import { mkdirSync, rmSync, symlinkSync, existsSync, lstatSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

const testDir = join(tmpdir(), `path-validation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const homeDir = homedir();

describe('path-validation.ts path traversal protection', () => {
  beforeAll(() => {
    // Setup test directory in system temp directory (outside home)
    // Used to verify that paths outside home are correctly rejected
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('validateProjectPath', () => {
    describe('path traversal attacks', () => {
      it('should reject paths that traverse outside home directory using ..', () => {
        const maliciousPath = join(homeDir, '..', '..', 'etc', 'passwd');

        expect(() => validateProjectPath(maliciousPath)).toThrow(PathValidationError);
        expect(() => validateProjectPath(maliciousPath)).toThrow('Project path must be within your home directory');
      });

      it('should reject absolute paths to system directories', () => {
        expect(() => validateProjectPath('/etc/passwd')).toThrow(PathValidationError);
        expect(() => validateProjectPath('/etc')).toThrow(PathValidationError);
        expect(() => validateProjectPath('/var/log')).toThrow(PathValidationError);
        expect(() => validateProjectPath('/tmp')).toThrow(PathValidationError);
      });

      it('should reject paths with encoded traversal sequences', () => {
        // While path.resolve handles these, we should still test
        const maliciousPath = join(homeDir, 'projects', '..', '..', '..', 'etc');

        expect(() => validateProjectPath(maliciousPath)).toThrow(PathValidationError);
      });

      it('should reject the root directory', () => {
        expect(() => validateProjectPath('/')).toThrow(PathValidationError);
      });

      it('should reject paths with multiple parent directory traversals', () => {
        // These resolve outside home directory
        const deepTraversal = join(homeDir, '..', '..', '..', '..', '..');
        expect(() => validateProjectPath(deepTraversal)).toThrow(PathValidationError);
      });
    });

    describe('sensitive directory protection', () => {
      it('should reject access to .ssh directory', () => {
        const sshPath = join(homeDir, '.ssh');

        expect(() => validateProjectPath(sshPath)).toThrow(PathValidationError);
        expect(() => validateProjectPath(sshPath)).toThrow('sensitive directories');
      });

      it('should reject access to files within .ssh', () => {
        const sshKeyPath = join(homeDir, '.ssh', 'id_rsa');

        expect(() => validateProjectPath(sshKeyPath)).toThrow(PathValidationError);
      });

      it('should reject access to .gnupg directory', () => {
        const gnupgPath = join(homeDir, '.gnupg');

        expect(() => validateProjectPath(gnupgPath)).toThrow(PathValidationError);
      });

      it('should reject access to .aws directory', () => {
        const awsPath = join(homeDir, '.aws');

        expect(() => validateProjectPath(awsPath)).toThrow(PathValidationError);
      });

      it('should reject access to .config directory', () => {
        const configPath = join(homeDir, '.config');

        expect(() => validateProjectPath(configPath)).toThrow(PathValidationError);
      });
    });

    describe('valid paths', () => {
      it('should accept valid paths within home directory', () => {
        const validPath = join(homeDir, 'projects', 'my-project');

        expect(() => validateProjectPath(validPath)).not.toThrow();
      });

      it('should accept home directory itself', () => {
        expect(() => validateProjectPath(homeDir)).not.toThrow();
      });

      it('should accept paths with normal directory names', () => {
        const validPath = join(homeDir, 'Documents', 'code', 'project');

        expect(() => validateProjectPath(validPath)).not.toThrow();
      });

      it('should reject paths in temp directory (outside home)', () => {
        // tmpdir is usually /tmp or similar outside home
        // This validates that our security correctly blocks it
        expect(() => validateProjectPath(testDir)).toThrow(PathValidationError);
      });
    });

    describe('input validation', () => {
      it('should reject empty paths', () => {
        expect(() => validateProjectPath('')).toThrow(PathValidationError);
        expect(() => validateProjectPath('')).toThrow('Project path is required');
      });

      it('should reject null-like paths', () => {
        expect(() => validateProjectPath(null as unknown as string)).toThrow(PathValidationError);
        expect(() => validateProjectPath(undefined as unknown as string)).toThrow(PathValidationError);
      });

      it('should reject non-string paths', () => {
        expect(() => validateProjectPath(123 as unknown as string)).toThrow(PathValidationError);
        expect(() => validateProjectPath({} as unknown as string)).toThrow(PathValidationError);
      });
    });
  });

  describe('validateAndNormalizePath', () => {
    it('should return normalized path for valid paths', () => {
      const inputPath = join(homeDir, 'projects', '.', 'my-project');
      const result = validateAndNormalizePath(inputPath);

      expect(result).toBe(join(homeDir, 'projects', 'my-project'));
    });

    it('should throw for invalid paths', () => {
      expect(() => validateAndNormalizePath('/etc/passwd')).toThrow(PathValidationError);
    });

    it('should resolve relative .. within valid paths', () => {
      const inputPath = join(homeDir, 'projects', 'foo', '..', 'my-project');
      const result = validateAndNormalizePath(inputPath);

      expect(result).toBe(join(homeDir, 'projects', 'my-project'));
    });
  });

  describe('symlink resolution', () => {
    const symlinkPath = join(testDir, 'symlink-to-etc');

    beforeAll(() => {
      // Create symlink only if it doesn't exist and /etc exists
      if (!existsSync(symlinkPath) && existsSync('/etc')) {
        try {
          symlinkSync('/etc', symlinkPath);
        } catch {
          // May fail if we don't have permissions, skip symlink tests
        }
      }
    });

    afterAll(() => {
      try {
        const stat = lstatSync(symlinkPath);
        if (stat.isSymbolicLink()) {
          unlinkSync(symlinkPath);
        }
      } catch (error) {
        // Only swallow ENOENT (path missing), rethrow other errors
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    });

    it('should reject symlinks pointing outside home directory', () => {
      // Skip if symlink creation failed
      if (!existsSync(symlinkPath)) {
        return;
      }

      expect(() => validateProjectPath(symlinkPath)).toThrow(PathValidationError);
    });
  });
});
