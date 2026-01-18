/**
 * Tests for ChunkPipeline
 *
 * Tests the full chunk execution flow: execute → validate → review → commit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Chunk, Spec, Project, ChunkToolCall } from '@specwright/shared';

// Mock all dependencies before importing the module under test
vi.mock('../../db', () => ({
  getChunk: vi.fn(),
  updateChunk: vi.fn(),
  getSpec: vi.fn(),
  insertFixChunk: vi.fn(),
  getChunksBySpec: vi.fn(),
}));

vi.mock('../../db/projects', () => ({
  getProject: vi.fn(),
}));

vi.mock('../../services/chunk-executor', () => ({
  chunkExecutor: {
    execute: vi.fn(),
    abort: vi.fn(),
    isRunning: vi.fn(),
  },
}));

vi.mock('../../services/validation-service', () => ({
  validationService: {
    validate: vi.fn(),
  },
}));

// Use vi.hoisted to create mock that can be referenced in vi.mock factory
const { mockReviewChunkFn } = vi.hoisted(() => ({
  mockReviewChunkFn: vi.fn(),
}));

vi.mock('../../services/review-service', () => ({
  reviewService: {
    reviewChunk: mockReviewChunkFn,
  },
  createReviewService: vi.fn(() => ({
    reviewChunk: mockReviewChunkFn,
  })),
}));

vi.mock('../../services/git-service', () => ({
  gitService: {
    commitChunk: vi.fn(),
    resetHard: vi.fn(),
  },
}));

// Import after mocks are set up
import { ChunkPipeline, type ChunkPipelineEvents } from '../../services/chunk-pipeline';
import { getChunk, updateChunk, getSpec } from '../../db';
import { getProject } from '../../db/projects';
import { chunkExecutor } from '../../services/chunk-executor';
import { validationService } from '../../services/validation-service';
import { reviewService, createReviewService } from '../../services/review-service';
import { gitService, type GitWorkflowState } from '../../services/git-service';

describe('ChunkPipeline', () => {
  let pipeline: ChunkPipeline;

  const mockChunk: Chunk = {
    id: 'chunk-1',
    specId: 'spec-1',
    title: 'Test Chunk',
    description: 'Test description',
    order: 0,
    status: 'pending',
    dependencies: [],
  };

  const mockSpec: Spec = {
    id: 'spec-1',
    projectId: 'project-1',
    title: 'Test Spec',
    content: 'Test content',
    version: 1,
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const mockProject: Project = {
    id: 'project-1',
    name: 'Test Project',
    directory: '/test/project',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const mockGitState: GitWorkflowState = {
    enabled: true,
    projectDir: '/test/project',
    workingDir: '/test/project',
    isWorktree: false,
    originalBranch: 'main',
    specBranch: 'spec/test',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pipeline = new ChunkPipeline();

    // Default mocks
    vi.mocked(getChunk).mockReturnValue(mockChunk);
    vi.mocked(getSpec).mockReturnValue(mockSpec);
    vi.mocked(getProject).mockReturnValue(mockProject);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('execute', () => {
    it('runs full pipeline: execute → validate → review → commit', async () => {
      vi.mocked(chunkExecutor.execute).mockResolvedValue({
        status: 'completed',
        output: 'Execution output',
      });

      vi.mocked(validationService.validate).mockResolvedValue({
        success: true,
        filesChanged: 2,
        filesChangedList: ['file1.ts', 'file2.ts'],
        gitDiff: 'diff content',
        buildResult: { success: true, output: '', exitCode: 0 },
      });

      vi.mocked(reviewService.reviewChunk).mockResolvedValue({
        status: 'pass',
        feedback: 'Looks good',
      });

      vi.mocked(gitService.commitChunk).mockResolvedValue({
        success: true,
        commitHash: 'abc123',
        filesChanged: 2,
      });

      const result = await pipeline.execute('chunk-1', mockGitState);

      expect(result.status).toBe('pass');
      expect(result.output).toBe('Execution output');
      expect(result.commitHash).toBe('abc123');

      expect(chunkExecutor.execute).toHaveBeenCalledWith('chunk-1', expect.any(Object));
      expect(validationService.validate).toHaveBeenCalledWith('chunk-1', '/test/project');
      expect(reviewService.reviewChunk).toHaveBeenCalled();
      expect(gitService.commitChunk).toHaveBeenCalled();
    });

    it('emits events at each stage', async () => {
      const events: ChunkPipelineEvents = {
        onExecutionStart: vi.fn(),
        onExecutionComplete: vi.fn(),
        onToolCall: vi.fn(),
        onValidationStart: vi.fn(),
        onValidationComplete: vi.fn(),
        onReviewStart: vi.fn(),
        onReviewComplete: vi.fn(),
        onCommit: vi.fn(),
        onError: vi.fn(),
      };

      vi.mocked(chunkExecutor.execute).mockResolvedValue({
        status: 'completed',
        output: 'Output',
      });

      vi.mocked(validationService.validate).mockResolvedValue({
        success: true,
        filesChanged: 1,
        filesChangedList: ['file.ts'],
        gitDiff: 'diff',
        buildResult: { success: true, output: '', exitCode: 0 },
      });

      vi.mocked(reviewService.reviewChunk).mockResolvedValue({
        status: 'pass',
        feedback: 'Good',
      });

      vi.mocked(gitService.commitChunk).mockResolvedValue({
        success: true,
        commitHash: 'def456',
      });

      await pipeline.execute('chunk-1', mockGitState, events);

      expect(events.onExecutionStart).toHaveBeenCalledWith('chunk-1');
      expect(events.onExecutionComplete).toHaveBeenCalledWith('chunk-1', 'Output');
      expect(events.onValidationStart).toHaveBeenCalledWith('chunk-1');
      expect(events.onValidationComplete).toHaveBeenCalled();
      expect(events.onReviewStart).toHaveBeenCalledWith('chunk-1');
      expect(events.onReviewComplete).toHaveBeenCalled();
      expect(events.onCommit).toHaveBeenCalledWith('chunk-1', 'def456');
    });

    it('stops on execution failure', async () => {
      vi.mocked(chunkExecutor.execute).mockResolvedValue({
        status: 'failed',
        error: 'Execution error',
      });

      const events: ChunkPipelineEvents = {
        onError: vi.fn(),
      };

      const result = await pipeline.execute('chunk-1', mockGitState, events);

      expect(result.status).toBe('fail');
      expect(result.error).toBe('Execution error');
      expect(events.onError).toHaveBeenCalledWith('chunk-1', 'Execution error');

      // Validation and review should not be called
      expect(validationService.validate).not.toHaveBeenCalled();
      expect(reviewService.reviewChunk).not.toHaveBeenCalled();
    });

    it('stops on validation failure', async () => {
      vi.mocked(chunkExecutor.execute).mockResolvedValue({
        status: 'completed',
        output: 'Output',
      });

      vi.mocked(validationService.validate).mockResolvedValue({
        success: false,
        filesChanged: 0,
        filesChangedList: [],
        gitDiff: '',
        buildResult: { success: true, output: '', exitCode: 0 },
        autoFail: {
          reason: 'no_changes',
          feedback: 'No files changed',
        },
      });

      const events: ChunkPipelineEvents = {
        onError: vi.fn(),
      };

      const result = await pipeline.execute('chunk-1', mockGitState, events);

      expect(result.status).toBe('fail');
      expect(result.reviewFeedback).toBe('No files changed');
      expect(events.onError).toHaveBeenCalled();

      // Review and commit should not be called
      expect(reviewService.reviewChunk).not.toHaveBeenCalled();
      expect(gitService.commitChunk).not.toHaveBeenCalled();
    });

    it('creates fix chunk on needs_fix', async () => {
      vi.mocked(chunkExecutor.execute).mockResolvedValue({
        status: 'completed',
        output: 'Output',
      });

      vi.mocked(validationService.validate).mockResolvedValue({
        success: true,
        filesChanged: 1,
        filesChangedList: ['file.ts'],
        gitDiff: 'diff',
        buildResult: { success: true, output: '', exitCode: 0 },
      });

      vi.mocked(reviewService.reviewChunk).mockResolvedValue({
        status: 'needs_fix',
        feedback: 'Missing tests',
        fixChunk: { title: 'Add tests', description: 'Add unit tests' },
        fixChunkId: 'fix-chunk-1',
      });

      vi.mocked(gitService.resetHard).mockReturnValue({ success: true });

      const result = await pipeline.execute('chunk-1', mockGitState);

      expect(result.status).toBe('needs_fix');
      expect(result.fixChunkId).toBe('fix-chunk-1');
      expect(result.reviewFeedback).toBe('Missing tests');

      // Git should be reset
      expect(gitService.resetHard).toHaveBeenCalledWith(mockGitState);

      // Commit should not be called
      expect(gitService.commitChunk).not.toHaveBeenCalled();
    });

    it('commits only on review pass', async () => {
      vi.mocked(chunkExecutor.execute).mockResolvedValue({
        status: 'completed',
        output: 'Output',
      });

      vi.mocked(validationService.validate).mockResolvedValue({
        success: true,
        filesChanged: 1,
        filesChangedList: ['file.ts'],
        gitDiff: 'diff',
        buildResult: { success: true, output: '', exitCode: 0 },
      });

      // Test with fail status
      vi.mocked(reviewService.reviewChunk).mockResolvedValue({
        status: 'fail',
        feedback: 'Bad implementation',
      });

      vi.mocked(gitService.resetHard).mockReturnValue({ success: true });

      const result = await pipeline.execute('chunk-1', mockGitState);

      expect(result.status).toBe('fail');
      expect(gitService.commitChunk).not.toHaveBeenCalled();
      expect(gitService.resetHard).toHaveBeenCalled();
    });

    it('works without git state', async () => {
      vi.mocked(chunkExecutor.execute).mockResolvedValue({
        status: 'completed',
        output: 'Output',
      });

      vi.mocked(validationService.validate).mockResolvedValue({
        success: true,
        filesChanged: 1,
        filesChangedList: ['file.ts'],
        gitDiff: 'diff',
        buildResult: { success: true, output: '', exitCode: 0 },
      });

      vi.mocked(reviewService.reviewChunk).mockResolvedValue({
        status: 'pass',
        feedback: 'Good',
      });

      // Execute without gitState
      const result = await pipeline.execute('chunk-1', undefined);

      expect(result.status).toBe('pass');
      expect(result.commitHash).toBeUndefined();

      // Git operations should not be called
      expect(gitService.commitChunk).not.toHaveBeenCalled();
      expect(gitService.resetHard).not.toHaveBeenCalled();
    });

    it('handles cancelled execution', async () => {
      vi.mocked(chunkExecutor.execute).mockResolvedValue({
        status: 'cancelled',
        output: 'Cancelled by user',
      });

      const result = await pipeline.execute('chunk-1', mockGitState);

      expect(result.status).toBe('cancelled');

      // Nothing else should be called
      expect(validationService.validate).not.toHaveBeenCalled();
      expect(reviewService.reviewChunk).not.toHaveBeenCalled();
    });

    it('returns error when chunk not found', async () => {
      vi.mocked(getChunk).mockReturnValue(null);

      const events: ChunkPipelineEvents = {
        onError: vi.fn(),
      };

      const result = await pipeline.execute('nonexistent', mockGitState, events);

      expect(result.status).toBe('error');
      expect(result.error).toBe('Chunk not found');
      expect(events.onError).toHaveBeenCalledWith('nonexistent', 'Chunk not found');
    });

    it('returns error when spec not found', async () => {
      vi.mocked(getSpec).mockReturnValue(null);

      const events: ChunkPipelineEvents = {
        onError: vi.fn(),
      };

      const result = await pipeline.execute('chunk-1', mockGitState, events);

      expect(result.status).toBe('error');
      expect(result.error).toBe('Spec not found');
    });
  });

  describe('abort', () => {
    it('delegates to chunk executor', async () => {
      vi.mocked(chunkExecutor.abort).mockResolvedValue({ success: true });

      const result = await pipeline.abort('chunk-1');

      expect(result.success).toBe(true);
      expect(chunkExecutor.abort).toHaveBeenCalledWith('chunk-1');
    });
  });

  describe('isRunning', () => {
    it('delegates to chunk executor', () => {
      vi.mocked(chunkExecutor.isRunning).mockReturnValue(true);

      const result = pipeline.isRunning('chunk-1');

      expect(result).toBe(true);
      expect(chunkExecutor.isRunning).toHaveBeenCalledWith('chunk-1');
    });
  });
});
