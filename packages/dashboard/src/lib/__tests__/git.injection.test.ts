/**
 * Tests for command injection vulnerability fixes in git.ts
 *
 * These tests verify that malicious input in commit messages and branch names
 * cannot execute arbitrary commands.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createCommit, createBranch, checkoutBranch } from '../git';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

const testDir = join(tmpdir(), `git-injection-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
let defaultBranch = 'main';

describe('git.ts command injection protection', () => {
  beforeAll(() => {
    // Setup test git repository
    mkdirSync(testDir, { recursive: true });
    execSync('git init', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: testDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'pipe' });

    // Create initial commit
    writeFileSync(join(testDir, 'README.md'), '# Test\n');
    execSync('git add .', { cwd: testDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: 'pipe' });

    // Get the default branch name (could be 'main' or 'master')
    defaultBranch = execSync('git branch --show-current', { cwd: testDir, encoding: 'utf-8' }).trim();
  });

  afterAll(() => {
    // Cleanup test directory
    rmSync(testDir, { recursive: true, force: true });
    // Clean up any artifacts that might have been created by injection attempts
    ['/tmp/pwned', '/tmp/pwned2', '/tmp/pwned3'].forEach((path) => {
      if (existsSync(path)) {
        rmSync(path, { force: true });
      }
    });
  });

  describe('createCommit', () => {
    it('should handle malicious commit message without executing injected commands', async () => {
      const maliciousMessage = 'test"; touch /tmp/pwned; echo "pwned';

      // Create a file to commit
      writeFileSync(join(testDir, 'test1.txt'), 'test content\n');

      const result = await createCommit(testDir, maliciousMessage);

      expect(result.success).toBe(true);

      // Verify the injected command did NOT execute
      expect(existsSync('/tmp/pwned')).toBe(false);
    });

    it('should preserve malicious message as-is in commit history', async () => {
      const maliciousMessage = 'fix: $(rm -rf /) vulnerability';

      writeFileSync(join(testDir, 'test2.txt'), 'test content 2\n');

      const result = await createCommit(testDir, maliciousMessage);

      expect(result.success).toBe(true);

      // Verify the message was stored correctly
      const lastCommitMessage = execSync('git log -1 --pretty=%B', {
        cwd: testDir,
        encoding: 'utf-8',
      }).trim();

      expect(lastCommitMessage).toBe(maliciousMessage);
    });

    it('should handle special shell characters in commit message', async () => {
      const specialCharsMessage = 'test $PATH `whoami` & | ;';

      writeFileSync(join(testDir, 'test3.txt'), 'test content 3\n');

      const result = await createCommit(testDir, specialCharsMessage);

      expect(result.success).toBe(true);

      const lastCommitMessage = execSync('git log -1 --pretty=%B', {
        cwd: testDir,
        encoding: 'utf-8',
      }).trim();

      expect(lastCommitMessage).toBe(specialCharsMessage);
    });

    it('should handle quotes and backslashes in commit message', async () => {
      const quotesMessage = 'fix: handle "quoted" and \'single\' and \\backslash';

      writeFileSync(join(testDir, 'test4.txt'), 'test content 4\n');

      const result = await createCommit(testDir, quotesMessage);

      expect(result.success).toBe(true);

      const lastCommitMessage = execSync('git log -1 --pretty=%B', {
        cwd: testDir,
        encoding: 'utf-8',
      }).trim();

      expect(lastCommitMessage).toBe(quotesMessage);
    });
  });

  describe('createBranch', () => {
    it('should reject branch names with shell injection attempts', async () => {
      const maliciousBranch = 'test; touch /tmp/pwned2; echo';

      const result = await createBranch(testDir, maliciousBranch);

      // Should fail validation
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('invalid_branch_name');

      // Verify the injected command did NOT execute
      expect(existsSync('/tmp/pwned2')).toBe(false);
    });

    it('should reject branch names with backticks', async () => {
      const maliciousBranch = 'test`touch /tmp/pwned3`branch';

      const result = await createBranch(testDir, maliciousBranch);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('invalid_branch_name');
      expect(existsSync('/tmp/pwned3')).toBe(false);
    });

    it('should reject branch names starting with dash', async () => {
      const result = await createBranch(testDir, '-malicious');

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('invalid_branch_name');
    });

    it('should reject empty branch names', async () => {
      const result = await createBranch(testDir, '');

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('invalid_branch_name');
    });

    it('should allow valid branch names', async () => {
      const validBranch = 'feature/test-branch_123';

      const result = await createBranch(testDir, validBranch);

      expect(result.success).toBe(true);

      // Clean up by going back to the default branch
      execSync(`git checkout ${defaultBranch}`, { cwd: testDir, stdio: 'pipe' });
    });
  });

  describe('checkoutBranch', () => {
    it('should reject branch names with shell metacharacters', () => {
      const maliciousBranch = 'test$(whoami)branch';

      const result = checkoutBranch(testDir, maliciousBranch);

      expect(result).toBe(false);
    });

    it('should work with valid branch names', () => {
      // Create a branch first
      execSync('git checkout -b valid-test-branch', { cwd: testDir, stdio: 'pipe' });
      execSync(`git checkout ${defaultBranch}`, { cwd: testDir, stdio: 'pipe' });

      const result = checkoutBranch(testDir, 'valid-test-branch');

      expect(result).toBe(true);

      // Clean up
      execSync(`git checkout ${defaultBranch}`, { cwd: testDir, stdio: 'pipe' });
    });
  });
});
