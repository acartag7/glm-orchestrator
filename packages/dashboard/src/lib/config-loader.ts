import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import * as http from 'node:http';
import { ProjectConfig, DEFAULT_PROJECT_CONFIG, getConfigPath, ExecutorConfig, PlannerConfig, ReviewerConfig } from '@specwright/shared';

export class ConfigValidationError extends Error {
  constructor(public field: string, message: string) {
    super(`Configuration error in ${field}: ${message}`);
    this.name = 'ConfigValidationError';
  }
}

export function validateConfig(config: ProjectConfig): void {
  if (!Number.isInteger(config.maxIterations) || config.maxIterations < 1 || config.maxIterations > 20) {
    throw new ConfigValidationError('maxIterations', 'Must be an integer between 1 and 20');
  }

  if (config.executor.type !== 'opencode' && config.executor.type !== 'claude-code') {
    throw new ConfigValidationError('executor.type', 'Must be "opencode" or "claude-code"');
  }

  if (config.executor.type === 'opencode' && config.executor.endpoint) {
    try {
      new URL(config.executor.endpoint);
    } catch {
      throw new ConfigValidationError('executor.endpoint', 'Must be a valid URL');
    }
  }

  if (config.executor.timeout !== undefined) {
    if (!Number.isInteger(config.executor.timeout) || config.executor.timeout <= 0) {
      throw new ConfigValidationError('executor.timeout', 'Must be a positive integer');
    }
  }

  if (config.executor.maxTokens !== undefined) {
    if (!Number.isInteger(config.executor.maxTokens) || config.executor.maxTokens <= 0) {
      throw new ConfigValidationError('executor.maxTokens', 'Must be a positive integer');
    }
  }

  if (config.planner.type !== 'opus' && config.planner.type !== 'sonnet') {
    throw new ConfigValidationError('planner.type', 'Must be "opus" or "sonnet"');
  }

  if (config.reviewer.type !== 'sonnet-quick' && config.reviewer.type !== 'opus-thorough') {
    throw new ConfigValidationError('reviewer.type', 'Must be "sonnet-quick" or "opus-thorough"');
  }
}

function parseEnvOverrides(): Partial<ProjectConfig> {
  const overrides: Partial<ProjectConfig> = {};
  const env = process.env;

  const executor: Partial<ExecutorConfig> = {};
  if (env.SPECWRIGHT_EXECUTOR_TYPE) {
    executor.type = env.SPECWRIGHT_EXECUTOR_TYPE as 'opencode' | 'claude-code';
  }
  if (env.SPECWRIGHT_EXECUTOR_ENDPOINT) {
    executor.endpoint = env.SPECWRIGHT_EXECUTOR_ENDPOINT;
  }
  if (env.SPECWRIGHT_EXECUTOR_MODEL) {
    executor.model = env.SPECWRIGHT_EXECUTOR_MODEL;
  }
  if (env.SPECWRIGHT_EXECUTOR_TIMEOUT) {
    const timeout = parseInt(env.SPECWRIGHT_EXECUTOR_TIMEOUT, 10);
    if (!isNaN(timeout)) {
      executor.timeout = timeout;
    }
  }
  if (env.SPECWRIGHT_EXECUTOR_MAX_TOKENS) {
    const maxTokens = parseInt(env.SPECWRIGHT_EXECUTOR_MAX_TOKENS, 10);
    if (!isNaN(maxTokens)) {
      executor.maxTokens = maxTokens;
    }
  }
  if (Object.keys(executor).length > 0) {
    overrides.executor = executor as ExecutorConfig;
  }

  const planner: Partial<PlannerConfig> = {};
  if (env.SPECWRIGHT_PLANNER_TYPE) {
    planner.type = env.SPECWRIGHT_PLANNER_TYPE as 'opus' | 'sonnet';
  }
  if (env.SPECWRIGHT_PLANNER_CLI_PATH) {
    planner.cliPath = env.SPECWRIGHT_PLANNER_CLI_PATH;
  }
  if (Object.keys(planner).length > 0) {
    overrides.planner = planner as PlannerConfig;
  }

  const reviewer: Partial<ReviewerConfig> = {};
  if (env.SPECWRIGHT_REVIEWER_TYPE) {
    reviewer.type = env.SPECWRIGHT_REVIEWER_TYPE as 'sonnet-quick' | 'opus-thorough';
  }
  if (env.SPECWRIGHT_REVIEWER_CLI_PATH) {
    reviewer.cliPath = env.SPECWRIGHT_REVIEWER_CLI_PATH;
  }
  if (env.SPECWRIGHT_REVIEWER_AUTO_APPROVE) {
    reviewer.autoApprove = env.SPECWRIGHT_REVIEWER_AUTO_APPROVE.toLowerCase() === 'true';
  }
  if (Object.keys(reviewer).length > 0) {
    overrides.reviewer = reviewer as ReviewerConfig;
  }

  if (env.SPECWRIGHT_MAX_ITERATIONS) {
    const maxIterations = parseInt(env.SPECWRIGHT_MAX_ITERATIONS, 10);
    if (!isNaN(maxIterations)) {
      overrides.maxIterations = maxIterations;
    }
  }

  return overrides;
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  const result = { ...base };
  
  for (const key in override) {
    const overrideValue = override[key];
    const baseValue = result[key];
    
    if (overrideValue !== undefined && baseValue !== undefined && typeof overrideValue === 'object' && typeof baseValue === 'object' && !Array.isArray(overrideValue) && !Array.isArray(baseValue)) {
      result[key] = deepMerge(baseValue, overrideValue as Partial<typeof baseValue>);
    } else if (overrideValue !== undefined) {
      result[key] = overrideValue as typeof result[typeof key];
    }
  }
  
  return result;
}

export async function getProjectConfig(projectId: string): Promise<ProjectConfig> {
  const configPath = getConfigPath(projectId);
  let config: ProjectConfig = { ...DEFAULT_PROJECT_CONFIG };

  if (fs.existsSync(configPath)) {
    try {
      const yamlContent = fs.readFileSync(configPath, 'utf-8');
      const yamlConfig = yaml.parse(yamlContent) as Partial<ProjectConfig>;
      config = deepMerge(config, yamlConfig);
    } catch (error) {
      console.error(`Failed to parse config file at ${configPath}:`, error);
    }
  }

  const envOverrides = parseEnvOverrides();
  config = deepMerge(config, envOverrides);

  return config;
}

export async function saveProjectConfig(projectId: string, config: ProjectConfig): Promise<void> {
  validateConfig(config);
  
  const configPath = getConfigPath(projectId);
  const dirPath = path.dirname(configPath);
  
  fs.mkdirSync(dirPath, { recursive: true });
  
  const yamlContent = yaml.stringify(config);
  fs.writeFileSync(configPath, yamlContent, 'utf-8');
}

export async function validateExecutor(config: ExecutorConfig): Promise<{ accessible: boolean; error?: string }> {
  if (config.type === 'opencode') {
    const endpoint = config.endpoint || 'http://localhost:4096';
    const url = new URL(endpoint);
    
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          req.destroy();
          reject(new Error('Connection timeout after 5 seconds'));
        }, 5000);

        const req = http.request({
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: '/health',
          method: 'GET',
          timeout: 5000
        }, (res) => {
          clearTimeout(timeout);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
          req.destroy();
        });

        req.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        req.end();
      });
      
      return { accessible: true };
    } catch (error) {
      return { accessible: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  } else if (config.type === 'claude-code') {
    try {
      const { spawn } = await import('node:child_process');
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          proc.kill();
          reject(new Error('CLI check timeout after 5 seconds'));
        }, 5000);

        const proc = spawn('claude', ['--version'], { stdio: 'pipe' });
        
        proc.on('close', (code) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`CLI exited with code ${code}`));
          }
        });

        proc.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
      
      return { accessible: true };
    } catch (error) {
      return { accessible: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  return { accessible: false, error: `Unknown executor type: ${config.type}` };
}

export async function validatePlanner(config: PlannerConfig): Promise<{ accessible: boolean; error?: string }> {
  try {
    const { spawn } = await import('node:child_process');
    const cliPath = config.cliPath || 'claude';
    
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error('CLI check timeout after 5 seconds'));
      }, 5000);

      const proc = spawn(cliPath, ['--version'], { stdio: 'pipe' });
      
      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`CLI exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    
    return { accessible: true };
  } catch (error) {
    return { accessible: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function validateReviewer(config: ReviewerConfig): Promise<{ accessible: boolean; error?: string }> {
  try {
    const { spawn } = await import('node:child_process');
    const cliPath = config.cliPath || 'claude';
    
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        proc.kill();
        reject(new Error('CLI check timeout after 5 seconds'));
      }, 5000);

      const proc = spawn(cliPath, ['--version'], { stdio: 'pipe' });
      
      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`CLI exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    
    return { accessible: true };
  } catch (error) {
    return { accessible: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
