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
  type: 'sonnet-quick' | 'opus-thorough';
  cliPath?: string;
  autoApprove?: boolean;
}

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
    autoApprove: false
  },
  maxIterations: 5
};

export const getConfigPath = (projectId: string): string => {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
  return path.join(homeDir, '.specwright', 'projects', projectId, 'config.yaml');
};
