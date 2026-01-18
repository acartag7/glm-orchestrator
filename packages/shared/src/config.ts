import * as path from 'node:path';

export const DEFAULT_CHUNK_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export interface ExecutorConfig {
  type: 'opencode' | 'claude-code';
  endpoint?: string;
  model?: string;
  timeout?: number;
  maxTokens?: number;
}

export interface PlannerConfig {
  type: 'opus' | 'sonnet';
  cliPath?: string;
  workingDir?: string;
}

export interface ReviewerConfig {
  // Legacy fields (kept for backwards compat)
  type: 'sonnet-quick' | 'opus-thorough';
  cliPath?: string;
  autoApprove?: boolean;

  // New fields for dual-review strategy
  chunkModel?: 'haiku' | 'sonnet';         // Default: 'haiku'
  finalModel?: 'opus' | 'sonnet';          // Default: 'opus'
  chunkTimeout?: number;                    // Default: 180000 (3 min)
  finalTimeout?: number;                    // Default: 600000 (10 min)
  maxRetries?: number;                      // Default: 3
  retryBackoffMs?: number;                  // Default: 2000
  finalReviewMaxFixAttempts?: number;       // Default: 2 (how many fix rounds for final review)
}

export const CLAUDE_MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
  opus: 'claude-opus-4-5-20251101'
} as const;

export type ClaudeModelKey = keyof typeof CLAUDE_MODELS;
export type ClaudeModelId = typeof CLAUDE_MODELS[ClaudeModelKey];

export interface ProjectConfig {
  executor: ExecutorConfig;
  planner: PlannerConfig;
  reviewer: ReviewerConfig;
  maxIterations: number;
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  executor: {
    type: 'opencode',
    endpoint: 'http://localhost:4096',
    model: 'glm-4.7',
    timeout: DEFAULT_CHUNK_TIMEOUT_MS, // 15 minutes (increased from 5 min for complex UI work)
    maxTokens: 8192
  },
  planner: {
    type: 'opus',
    cliPath: 'claude'
  },
  reviewer: {
    type: 'sonnet-quick',
    cliPath: 'claude',
    autoApprove: false,
    chunkModel: 'haiku',
    finalModel: 'opus',
    chunkTimeout: 180000,      // 3 minutes
    finalTimeout: 600000,      // 10 minutes
    maxRetries: 3,
    retryBackoffMs: 2000,
    finalReviewMaxFixAttempts: 2
  },
  maxIterations: 5
};

export const getConfigPath = (projectId: string): string => {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
  return path.join(homeDir, '.specwright', 'projects', projectId, 'config.yaml');
};
