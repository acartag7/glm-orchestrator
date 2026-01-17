'use client';

import type { ProjectConfig } from '@specwright/shared';

interface ConfigStepProps {
  config: ProjectConfig;
  onChange: (config: ProjectConfig) => void;
  onBack: () => void;
  onNext: () => void;
  validationError: string | null;
  accessibilityStatus: {
    executor: { accessible: boolean; error?: string };
    planner: { accessible: boolean; error?: string };
    reviewer: { accessible: boolean; error?: string };
  } | null;
}

export default function ConfigStep({
  config,
  onChange,
  onBack,
  onNext,
  validationError,
  accessibilityStatus,
}: ConfigStepProps) {
  const updateExecutor = (updates: Partial<ProjectConfig['executor']>) => {
    onChange({ ...config, executor: { ...config.executor, ...updates } });
  };

  const updateReviewer = (updates: Partial<ProjectConfig['reviewer']>) => {
    onChange({ ...config, reviewer: { ...config.reviewer, ...updates } });
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-medium text-neutral-100 mb-2">Configuration</h2>
        <p className="text-sm text-neutral-400">Configure execution settings for your project</p>
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-neutral-200 mb-2">Executor</label>
          <select
            value={config.executor.type}
            onChange={(e) => updateExecutor({ type: e.target.value as 'opencode' | 'claude-code' })}
            className="w-full p-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
          >
            <option value="opencode">OpenCode (GLM-4.7)</option>
            <option value="claude-code">Claude Code</option>
          </select>
          {config.executor.type === 'opencode' && (
            <input
              type="text"
              placeholder="Endpoint (default: http://localhost:4096)"
              value={config.executor.endpoint || ''}
              onChange={(e) => updateExecutor({ endpoint: e.target.value })}
              className="w-full mt-2 p-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-200 mb-2">Reviewer</label>
          <select
            value={config.reviewer.type}
            onChange={(e) => updateReviewer({ type: e.target.value as 'sonnet-quick' | 'opus-thorough' })}
            className="w-full p-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
          >
            <option value="sonnet-quick">Sonnet (Quick Reviews)</option>
            <option value="opus-thorough">Opus (Thorough Reviews)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-200 mb-2">
            Max Iterations
            <span className="text-xs text-neutral-500 ml-2">(1-20, default: 5)</span>
          </label>
          <input
            type="number"
            min="1"
            max="20"
            value={config.maxIterations}
            onChange={(e) => onChange({ ...config, maxIterations: parseInt(e.target.value) || 5 })}
            className="w-full p-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent"
          />
        </div>

        {validationError && (
          <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-md">
            <p className="text-sm text-red-400 font-mono">{validationError}</p>
          </div>
        )}

        {accessibilityStatus && !accessibilityStatus.executor.accessible && (
          <div className="p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-md">
            <p className="text-sm text-yellow-400 font-mono">
              Warning: Executor not accessible - {accessibilityStatus.executor.error}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-4">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 font-mono transition-colors"
        >
          Back
        </button>
        <div className="flex-1" />
        <button
          onClick={onNext}
          className="px-4 py-2 bg-emerald-400 text-neutral-950 rounded-md text-sm font-medium hover:bg-emerald-300 transition-colors font-mono"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
