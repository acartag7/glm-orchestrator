/**
 * Tests for SpecExecutionService
 *
 * Tests the full spec execution flow:
 * - Run all chunks respecting dependencies
 * - Handle fix chunks from review
 * - Final spec review
 * - Git workflow integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Chunk, Spec, Project } from '@specwright/shared';

// Mock all dependencies before importing the module under test
vi.mock('../../db', () => ({
  getSpec: vi.fn(),
  updateSpec: vi.fn(),
  getChunksBySpec: vi.fn(),
  updateChunk: vi.fn(),
  getChunk: vi.fn(),
}));

vi.mock('../../db/projects', () => ({
  getProject: vi.fn(),
}));

vi.mock('../../services/chunk-pipeline', () => ({
  chunkPipeline: {
    execute: vi.fn(),
    abort: vi.fn(),
    isRunning: vi.fn(),
  },
}));

vi.mock('../../services/git-service', () => ({
  gitService: {
    initWorkflow: vi.fn(),
    commitChunk: vi.fn(),
    resetHard: vi.fn(),
    pushAndCreatePR: vi.fn(),
    cleanup: vi.fn(),
  },
}));

// Use vi.hoisted to create mocks that can be referenced in vi.mock factory
const { mockReviewSpecFinal, mockCreateFixChunks } = vi.hoisted(() => ({
  mockReviewSpecFinal: vi.fn(),
  mockCreateFixChunks: vi.fn(),
}));

vi.mock('../../services/review-service', () => ({
  reviewService: {
    reviewSpecFinal: mockReviewSpecFinal,
    createFixChunks: mockCreateFixChunks,
  },
  createReviewService: vi.fn(() => ({
    reviewSpecFinal: mockReviewSpecFinal,
    createFixChunks: mockCreateFixChunks,
  })),
}));

// Import after mocks are set up
import { SpecExecutionService, type SpecExecutionEvents } from '../../services/spec-execution-service';
import { getSpec, updateSpec, getChunksBySpec, updateChunk, getChunk } from '../../db';
import { getProject } from '../../db/projects';
import { chunkPipeline } from '../../services/chunk-pipeline';
import { gitService, type GitWorkflowState } from '../../services/git-service';
import { reviewService } from '../../services/review-service';

describe('SpecExecutionService', () => {
  let service: SpecExecutionService;

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

  const createMockChunk = (overrides: Partial<Chunk> = {}): Chunk => ({
    id: 'chunk-1',
    specId: 'spec-1',
    title: 'Test Chunk',
    description: 'Test description',
    order: 0,
    status: 'pending',
    dependencies: [],
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Create a fresh instance for each test to avoid state leakage
    service = new SpecExecutionService();

    // Default mocks
    vi.mocked(getSpec).mockReturnValue(mockSpec);
    vi.mocked(getProject).mockReturnValue(mockProject);
    vi.mocked(gitService.initWorkflow).mockResolvedValue(mockGitState);
    vi.mocked(gitService.cleanup).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('runAll', () => {
    it('validates spec exists before running', async () => {
      vi.mocked(getSpec).mockReturnValue(null);

      const events: SpecExecutionEvents = {
        onError: vi.fn(),
      };

      await service.runAll('nonexistent', events);

      expect(events.onError).toHaveBeenCalledWith('nonexistent', 'Spec not found');
    });

    it('validates project exists before running', async () => {
      vi.mocked(getProject).mockReturnValue(null);
      vi.mocked(getChunksBySpec).mockReturnValue([createMockChunk()]);

      const events: SpecExecutionEvents = {
        onError: vi.fn(),
      };

      await service.runAll('spec-1', events);

      expect(events.onError).toHaveBeenCalledWith('spec-1', 'Project not found');
    });

    it('validates there are pending chunks', async () => {
      vi.mocked(getChunksBySpec).mockReturnValue([
        createMockChunk({ status: 'completed' }),
      ]);

      const events: SpecExecutionEvents = {
        onError: vi.fn(),
      };

      await service.runAll('spec-1', events);

      expect(events.onError).toHaveBeenCalledWith('spec-1', 'No pending chunks to execute');
    });

    it('updates spec status to running', async () => {
      const chunk = createMockChunk();
      vi.mocked(getChunksBySpec).mockReturnValue([chunk]);
      vi.mocked(chunkPipeline.execute).mockResolvedValue({
        status: 'pass',
        output: 'Success',
      });
      vi.mocked(reviewService.reviewSpecFinal).mockResolvedValue({
        status: 'pass',
        feedback: 'Good',
      });
      vi.mocked(gitService.pushAndCreatePR).mockResolvedValue({ success: true });

      await service.runAll('spec-1');

      expect(updateSpec).toHaveBeenCalledWith('spec-1', { status: 'running' });
    });

    it('calls chunk pipeline for each pending chunk', async () => {
      const chunk1 = createMockChunk({ id: 'chunk-1', title: 'Chunk 1' });
      const chunk2 = createMockChunk({ id: 'chunk-2', title: 'Chunk 2' });
      vi.mocked(getChunksBySpec).mockReturnValue([chunk1, chunk2]);
      vi.mocked(chunkPipeline.execute).mockResolvedValue({
        status: 'pass',
        output: 'Success',
      });
      vi.mocked(reviewService.reviewSpecFinal).mockResolvedValue({
        status: 'pass',
        feedback: 'Good',
      });
      vi.mocked(gitService.pushAndCreatePR).mockResolvedValue({ success: true });

      await service.runAll('spec-1');

      // Both chunks should have been executed
      expect(chunkPipeline.execute).toHaveBeenCalledTimes(2);
      expect(chunkPipeline.execute).toHaveBeenCalledWith('chunk-1', mockGitState, expect.any(Object));
      expect(chunkPipeline.execute).toHaveBeenCalledWith('chunk-2', mockGitState, expect.any(Object));
    });

    it('emits spec start event', async () => {
      const chunk = createMockChunk();
      vi.mocked(getChunksBySpec).mockReturnValue([chunk]);
      vi.mocked(chunkPipeline.execute).mockResolvedValue({
        status: 'pass',
        output: 'Success',
      });
      vi.mocked(reviewService.reviewSpecFinal).mockResolvedValue({
        status: 'pass',
        feedback: 'Good',
      });
      vi.mocked(gitService.pushAndCreatePR).mockResolvedValue({ success: true });

      const events: SpecExecutionEvents = {
        onSpecStart: vi.fn(),
      };

      await service.runAll('spec-1', events);

      expect(events.onSpecStart).toHaveBeenCalledWith('spec-1', 1);
    });

    it('emits spec complete event with stats', async () => {
      const chunk = createMockChunk();
      vi.mocked(getChunksBySpec).mockReturnValue([chunk]);
      vi.mocked(chunkPipeline.execute).mockResolvedValue({
        status: 'pass',
        output: 'Success',
        commitHash: 'abc123',
      });
      vi.mocked(reviewService.reviewSpecFinal).mockResolvedValue({
        status: 'pass',
        feedback: 'Good',
      });
      vi.mocked(gitService.pushAndCreatePR).mockResolvedValue({
        success: true,
        prUrl: 'https://github.com/test/pr/1',
        prNumber: 1,
      });

      const events: SpecExecutionEvents = {
        onSpecComplete: vi.fn(),
      };

      await service.runAll('spec-1', events);

      expect(events.onSpecComplete).toHaveBeenCalledWith(
        'spec-1',
        expect.objectContaining({
          totalChunks: 1,
          passedChunks: 1,
          failedChunks: 0,
          prUrl: 'https://github.com/test/pr/1',
        })
      );
    });

    it('initializes git workflow', async () => {
      const chunk = createMockChunk();
      vi.mocked(getChunksBySpec).mockReturnValue([chunk]);
      vi.mocked(chunkPipeline.execute).mockResolvedValue({
        status: 'pass',
        output: 'Success',
      });
      vi.mocked(reviewService.reviewSpecFinal).mockResolvedValue({
        status: 'pass',
        feedback: 'Good',
      });
      vi.mocked(gitService.pushAndCreatePR).mockResolvedValue({ success: true });

      const events: SpecExecutionEvents = {
        onGitWorkflowInit: vi.fn(),
      };

      await service.runAll('spec-1', events);

      expect(gitService.initWorkflow).toHaveBeenCalledWith('spec-1', '/test/project');
      expect(events.onGitWorkflowInit).toHaveBeenCalledWith(mockGitState);
    });

    it('runs final review after all chunks pass', async () => {
      const chunk = createMockChunk();
      vi.mocked(getChunksBySpec).mockReturnValue([chunk]);
      vi.mocked(chunkPipeline.execute).mockResolvedValue({
        status: 'pass',
        output: 'Success',
      });
      vi.mocked(reviewService.reviewSpecFinal).mockResolvedValue({
        status: 'pass',
        feedback: 'Implementation complete',
      });
      vi.mocked(gitService.pushAndCreatePR).mockResolvedValue({ success: true });

      const events: SpecExecutionEvents = {
        onFinalReviewStart: vi.fn(),
        onFinalReviewComplete: vi.fn(),
      };

      await service.runAll('spec-1', events);

      expect(events.onFinalReviewStart).toHaveBeenCalledWith('spec-1');
      expect(events.onFinalReviewComplete).toHaveBeenCalledWith(
        'spec-1',
        expect.objectContaining({ status: 'pass' })
      );
    });

    it('creates PR after successful final review', async () => {
      const chunk = createMockChunk();
      vi.mocked(getChunksBySpec).mockReturnValue([chunk]);
      vi.mocked(chunkPipeline.execute).mockResolvedValue({
        status: 'pass',
        output: 'Success',
      });
      vi.mocked(reviewService.reviewSpecFinal).mockResolvedValue({
        status: 'pass',
        feedback: 'Good',
      });
      vi.mocked(gitService.pushAndCreatePR).mockResolvedValue({
        success: true,
        prUrl: 'https://github.com/test/pr/42',
        prNumber: 42,
      });

      const events: SpecExecutionEvents = {
        onPRCreated: vi.fn(),
      };

      await service.runAll('spec-1', events);

      expect(gitService.pushAndCreatePR).toHaveBeenCalled();
      expect(events.onPRCreated).toHaveBeenCalledWith('https://github.com/test/pr/42', 42);
      expect(updateSpec).toHaveBeenCalledWith('spec-1', { status: 'completed' });
    });

    it('handles chunk failure and resets git', async () => {
      const chunk = createMockChunk();
      vi.mocked(getChunksBySpec).mockReturnValue([chunk]);
      vi.mocked(chunkPipeline.execute).mockResolvedValue({
        status: 'fail',
        error: 'Execution failed',
      });
      vi.mocked(gitService.resetHard).mockReturnValue({ success: true });

      const events: SpecExecutionEvents = {
        onGitReset: vi.fn(),
        onChunkComplete: vi.fn(),
      };

      await service.runAll('spec-1', events);

      expect(gitService.resetHard).toHaveBeenCalledWith(mockGitState);
      expect(events.onGitReset).toHaveBeenCalled();
      expect(events.onChunkComplete).toHaveBeenCalledWith(
        'chunk-1',
        expect.objectContaining({ status: 'fail' })
      );
    });

    it('handles needs_fix and runs fix chunk', async () => {
      const chunk = createMockChunk();
      const fixChunk = createMockChunk({ id: 'fix-1', title: 'Fix Chunk' });

      vi.mocked(getChunksBySpec).mockReturnValue([chunk]);
      vi.mocked(getChunk).mockImplementation((id) => {
        if (id === 'chunk-1') return chunk;
        if (id === 'fix-1') return fixChunk;
        return null;
      });

      // First call returns needs_fix, second call (fix) returns pass
      vi.mocked(chunkPipeline.execute)
        .mockResolvedValueOnce({
          status: 'needs_fix',
          reviewFeedback: 'Missing tests',
          fixChunkId: 'fix-1',
        })
        .mockResolvedValueOnce({
          status: 'pass',
          output: 'Fixed',
        });

      vi.mocked(reviewService.reviewSpecFinal).mockResolvedValue({
        status: 'pass',
        feedback: 'Good',
      });
      vi.mocked(gitService.pushAndCreatePR).mockResolvedValue({ success: true });

      const events: SpecExecutionEvents = {
        onSpecComplete: vi.fn(),
      };

      await service.runAll('spec-1', events);

      // Both original and fix chunk were executed
      expect(chunkPipeline.execute).toHaveBeenCalledTimes(2);
      expect(events.onSpecComplete).toHaveBeenCalledWith(
        'spec-1',
        expect.objectContaining({
          fixChunksCreated: 1,
          totalChunks: 2, // Original + fix chunk
          passedChunks: 2, // Both original and fix passed
        })
      );
    });

    it('handles final review needs_fix and creates fix chunks', async () => {
      const chunk = createMockChunk();
      vi.mocked(getChunksBySpec).mockReturnValue([chunk]);
      vi.mocked(chunkPipeline.execute).mockResolvedValue({
        status: 'pass',
        output: 'Success',
      });
      vi.mocked(reviewService.reviewSpecFinal).mockResolvedValue({
        status: 'needs_fix',
        feedback: 'Missing integration',
        fixChunks: [{ title: 'Add integration', description: 'Connect components' }],
      });
      vi.mocked(reviewService.createFixChunks).mockResolvedValue(['fix-chunk-1']);

      const events: SpecExecutionEvents = {
        onFinalReviewFixChunks: vi.fn(),
      };

      await service.runAll('spec-1', events);

      expect(reviewService.createFixChunks).toHaveBeenCalled();
      expect(events.onFinalReviewFixChunks).toHaveBeenCalledWith('spec-1', ['fix-chunk-1']);
      expect(updateSpec).toHaveBeenCalledWith('spec-1', { status: 'review' });
    });

    it('cleans up git state after completion', async () => {
      const chunk = createMockChunk();
      vi.mocked(getChunksBySpec).mockReturnValue([chunk]);
      vi.mocked(chunkPipeline.execute).mockResolvedValue({
        status: 'pass',
        output: 'Success',
      });
      vi.mocked(reviewService.reviewSpecFinal).mockResolvedValue({
        status: 'pass',
        feedback: 'Good',
      });
      vi.mocked(gitService.pushAndCreatePR).mockResolvedValue({ success: true });

      await service.runAll('spec-1');

      expect(gitService.cleanup).toHaveBeenCalledWith(mockGitState);
    });
  });

  describe('abort', () => {
    it('does not throw when aborting non-running spec', () => {
      expect(() => service.abort('nonexistent')).not.toThrow();
    });
  });

  describe('isRunning', () => {
    it('returns false when spec is not running', () => {
      expect(service.isRunning('nonexistent')).toBe(false);
    });
  });

  describe('dependency handling', () => {
    it('respects chunk dependencies and runs in order', async () => {
      const chunk1 = createMockChunk({ id: 'chunk-1', title: 'Chunk 1', dependencies: [] });
      const chunk2 = createMockChunk({ id: 'chunk-2', title: 'Chunk 2', dependencies: ['chunk-1'] });

      vi.mocked(getChunksBySpec).mockReturnValue([chunk1, chunk2]);
      vi.mocked(getChunk).mockImplementation((id) => {
        if (id === 'chunk-1') return chunk1;
        if (id === 'chunk-2') return chunk2;
        return null;
      });

      vi.mocked(chunkPipeline.execute).mockResolvedValue({
        status: 'pass',
        output: 'Success',
      });
      vi.mocked(reviewService.reviewSpecFinal).mockResolvedValue({
        status: 'pass',
        feedback: 'Good',
      });
      vi.mocked(gitService.pushAndCreatePR).mockResolvedValue({ success: true });

      await service.runAll('spec-1');

      // Both chunks should be executed
      expect(chunkPipeline.execute).toHaveBeenCalledTimes(2);

      // Verify order: chunk1 first, chunk2 second
      const calls = vi.mocked(chunkPipeline.execute).mock.calls;
      expect(calls[0][0]).toBe('chunk-1');
      expect(calls[1][0]).toBe('chunk-2');
    });
  });
});
