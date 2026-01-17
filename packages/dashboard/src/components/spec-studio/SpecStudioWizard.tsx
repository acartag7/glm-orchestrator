'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Spec, SpecStudioState, SpecStudioStep, Question, ChunkSuggestion, ProjectConfig } from '@specwright/shared';
import { DEFAULT_PROJECT_CONFIG } from '@specwright/shared';
import StepIndicator from './StepIndicator';
import IntentStep from './IntentStep';
import QuestionsStep from './QuestionsStep';
import ReviewStep, { type ChunkDetailLevel } from './ReviewStep';
import ConfigStep from './ConfigStep';
import ChunksStep, { type GitOptions } from './ChunksStep';
import ConfirmModal from '../ConfirmModal';

interface SpecStudioWizardProps {
  projectId: string;
  projectName: string;
  projectDirectory: string;
  specId?: string;
  existingSpec?: Spec;
  onComplete: () => void;
}

export default function SpecStudioWizard({
  projectId,
  projectName,
  projectDirectory,
  specId,
  existingSpec,
  onComplete,
}: SpecStudioWizardProps) {
  const router = useRouter();
  const [studioState, setStudioState] = useState<SpecStudioState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNavigationWarning, setShowNavigationWarning] = useState(false);
  const [pendingNavigationUrl, setPendingNavigationUrl] = useState<string | null>(null);
  const [config, setConfig] = useState<ProjectConfig>(DEFAULT_PROJECT_CONFIG);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [accessibilityStatus, setAccessibilityStatus] = useState<any | null>(null);

  // Track the last saved state to detect unsaved changes
  const savedStateRef = useRef<SpecStudioState | null>(null);

  // Compute whether there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!studioState || !savedStateRef.current) return false;

    const saved = savedStateRef.current;

    // Compare relevant fields that indicate user work
    const intentChanged = studioState.intent !== saved.intent && studioState.intent.trim() !== '';
    const answersChanged = JSON.stringify(studioState.answers) !== JSON.stringify(saved.answers) &&
                          Object.keys(studioState.answers).length > 0;
    const specChanged = studioState.generatedSpec !== saved.generatedSpec && studioState.generatedSpec.trim() !== '';
    const chunksChanged = JSON.stringify(studioState.suggestedChunks) !== JSON.stringify(saved.suggestedChunks);

    return intentChanged || answersChanged || specChanged || chunksChanged;
  }, [studioState]);

  // Fetch or create studio state on mount
  useEffect(() => {
    async function fetchState() {
      try {
        setIsLoading(true);
        const response = await fetch(`/api/projects/${projectId}/studio`);
        if (!response.ok) {
          throw new Error('Failed to fetch studio state');
        }
        const state = await response.json();

        // Pre-fill intent from existing spec if available and state is fresh
        if (existingSpec?.content && state.step === 'intent' && !state.intent) {
          state.intent = existingSpec.content;
        }

        setStudioState(state);
        // Track the initial saved state
        savedStateRef.current = JSON.parse(JSON.stringify(state));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    fetchState();
  }, [projectId, existingSpec]);

  // Load project config on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch(`/api/projects/${projectId}/config?validate=true`);
        if (!response.ok) {
          throw new Error('Failed to fetch project config');
        }
        const data = await response.json();
        setConfig(data.config);
        setAccessibilityStatus(data.validation);
      } catch (err) {
        console.error('Error loading config:', err);
      }
    }

    loadConfig();
  }, [projectId]);

  // Warn on browser close/refresh if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        // Modern browsers ignore custom messages, but this is still required
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Save state to API
  const saveState = useCallback(async (updates: Partial<SpecStudioState>) => {
    if (!studioState) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/studio`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error('Failed to save state');
      }

      const updatedState = await response.json();
      setStudioState(updatedState);
      // Update the saved state reference after successful save
      savedStateRef.current = JSON.parse(JSON.stringify(updatedState));
      return updatedState;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [projectId, studioState]);

  // Step navigation
  const goToStep = useCallback(async (step: SpecStudioStep) => {
    await saveState({ step });
  }, [saveState]);

  // Intent step handlers
  const handleIntentChange = useCallback((intent: string) => {
    setStudioState(prev => prev ? { ...prev, intent } : null);
  }, []);

  const handleIntentNext = useCallback(async () => {
    if (!studioState) return;

    setIsGenerating(true);
    try {
      // Save intent first
      await saveState({ intent: studioState.intent });

      // Generate questions from Opus
      const response = await fetch(`/api/projects/${projectId}/studio/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: studioState.intent }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate questions');
      }

      const { questions } = await response.json();
      await saveState({ step: 'questions', questions });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate questions');
    } finally {
      setIsGenerating(false);
    }
  }, [projectId, studioState, saveState]);

  // Questions step handlers
  const handleAnswerChange = useCallback((questionId: string, value: string | string[]) => {
    setStudioState(prev => {
      if (!prev) return null;
      return {
        ...prev,
        answers: { ...prev.answers, [questionId]: value },
      };
    });
  }, []);

  const handleQuestionsBack = useCallback(async () => {
    await goToStep('intent');
  }, [goToStep]);

  const handleQuestionsNext = useCallback(async () => {
    if (!studioState) return;

    setIsGenerating(true);
    try {
      // Save answers first
      await saveState({ answers: studioState.answers });

      // Generate spec from Opus
      const response = await fetch(`/api/projects/${projectId}/studio/spec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: studioState.intent,
          answers: studioState.answers,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate spec');
      }

      const { spec } = await response.json();
      await saveState({ step: 'review', generatedSpec: spec });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate spec');
    } finally {
      setIsGenerating(false);
    }
  }, [projectId, studioState, saveState]);

  // Review step handlers
  const handleSpecChange = useCallback((generatedSpec: string) => {
    setStudioState(prev => prev ? { ...prev, generatedSpec } : null);
  }, []);

  const handleReviewBack = useCallback(async () => {
    await goToStep('questions');
  }, [goToStep]);

  const handleRefine = useCallback(async (feedback: string) => {
    if (!studioState) return;

    setIsGenerating(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/studio/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: studioState.generatedSpec,
          feedback,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to refine spec');
      }

      const { spec } = await response.json();
      await saveState({ generatedSpec: spec });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refine spec');
    } finally {
      setIsGenerating(false);
    }
  }, [projectId, studioState, saveState]);

  const handleReviewNext = useCallback(async (chunkPreference: ChunkDetailLevel = 'standard') => {
    if (!studioState) return;

    setIsGenerating(true);
    try {
      // Save spec first
      await saveState({ generatedSpec: studioState.generatedSpec });

      // Save config before moving to next step
      const configResponse = await fetch(`/api/projects/${projectId}/config?validate=true`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!configResponse.ok) {
        const configError = await configResponse.json();
        if (configResponse.status === 400) {
          setValidationError(configError.error);
          await saveState({ step: 'config' });
          return;
        } else if (configResponse.status === 503) {
          setAccessibilityStatus({
            executor: { accessible: false, error: configError.error },
            planner: { accessible: true },
            reviewer: { accessible: true },
          });
        } else {
          throw new Error('Failed to save config');
        }
      }

      const configData = await configResponse.json();
      if (configData.validation) {
        setAccessibilityStatus(configData.validation);
      }

      // Generate chunks from Opus
      const response = await fetch(`/api/projects/${projectId}/studio/chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: studioState.generatedSpec,
          chunkPreference,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate chunks');
      }

      const { chunks } = await response.json();
      await saveState({ step: 'chunks', suggestedChunks: chunks });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate chunks');
    } finally {
      setIsGenerating(false);
    }
  }, [projectId, studioState, saveState, config]);

  // Config step handlers
  const handleConfigChange = useCallback((newConfig: ProjectConfig) => {
    setConfig(newConfig);
    setValidationError(null);
  }, []);

  const handleConfigBack = useCallback(async () => {
    await goToStep('review');
  }, [goToStep]);

  const handleConfigNext = useCallback(async () => {
    setIsGenerating(true);
    try {
      // Save config first
      const response = await fetch(`/api/projects/${projectId}/config?validate=true`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const configError = await response.json();
        if (response.status === 400) {
          setValidationError(configError.error);
          return;
        } else if (response.status === 503) {
          setAccessibilityStatus({
            executor: { accessible: false, error: configError.error },
            planner: { accessible: true },
            reviewer: { accessible: true },
          });
        } else {
          throw new Error('Failed to save config');
        }
      }

      const configData = await response.json();
      if (configData.validation) {
        setAccessibilityStatus(configData.validation);
      }

      await saveState({ step: 'chunks' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setIsGenerating(false);
    }
  }, [projectId, config, saveState]);

  const handleChunksBack = useCallback(async () => {
    await goToStep('config');
  }, [goToStep]);

  // Chunks step handlers
  const handleChunksChange = useCallback((chunks: ChunkSuggestion[]) => {
    setStudioState(prev => prev ? { ...prev, suggestedChunks: chunks } : null);
  }, []);

  // Navigation handlers for unsaved changes warning
  const handleNavigationAttempt = useCallback((url: string) => {
    if (hasUnsavedChanges) {
      setPendingNavigationUrl(url);
      setShowNavigationWarning(true);
    } else {
      router.push(url);
    }
  }, [hasUnsavedChanges, router]);

  const handleConfirmNavigation = useCallback(() => {
    setShowNavigationWarning(false);
    if (pendingNavigationUrl) {
      router.push(pendingNavigationUrl);
    }
  }, [pendingNavigationUrl, router]);

  const handleCancelNavigation = useCallback(() => {
    setShowNavigationWarning(false);
    setPendingNavigationUrl(null);
  }, []);

  const handleComplete = useCallback(async (gitOptions: GitOptions) => {
    if (!studioState) return;

    setIsGenerating(true);
    try {
      // Save chunks first
      await saveState({ suggestedChunks: studioState.suggestedChunks });

      // Save config
      await fetch(`/api/projects/${projectId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      // Complete: save spec and create chunks
      // Use spec-specific endpoint if specId is provided
      const completeUrl = specId
        ? `/api/specs/${specId}/studio/complete`
        : `/api/projects/${projectId}/studio/complete`;

      const response = await fetch(completeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spec: studioState.generatedSpec,
          chunks: studioState.suggestedChunks.filter(c => c.selected),
          gitOptions,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to complete setup');
      }

      await saveState({ step: 'complete' });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete setup');
    } finally {
      setIsGenerating(false);
    }
  }, [projectId, specId, studioState, saveState, onComplete]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]">
        <div className="flex items-center gap-3 text-neutral-400 font-mono">
          <svg className="animate-spin w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading studio...
        </div>
      </div>
    );
  }

  if (error && !studioState) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]">
        <div className="text-center">
          <h2 className="text-xl font-medium text-neutral-100 mb-2 font-mono">{error}</h2>
          <button
            onClick={() => router.push('/')}
            className="text-emerald-400 hover:text-emerald-300 text-sm font-mono"
          >
            Back to projects
          </button>
        </div>
      </div>
    );
  }

  if (!studioState) return null;

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]">
      {/* Header */}
      <header className="border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-6 py-3 flex items-center gap-4">
          <button
            onClick={() => handleNavigationAttempt('/')}
            className="p-1.5 text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-md transition-colors"
            title="Back to projects"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div className="flex items-center gap-2 text-sm font-mono">
            <span className="text-neutral-500">/</span>
            <span className="text-neutral-400">project</span>
            <span className="text-neutral-500">/</span>
            <span className="text-neutral-100">{projectName}</span>
          </div>
          <div className="flex-1" />
          <StepIndicator currentStep={studioState.step} onStepClick={goToStep} />
          {isSaving && (
            <span className="text-[10px] text-neutral-500 font-mono">saving...</span>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-start justify-center p-6">
        <div className="w-full max-w-3xl">
          {/* Error Banner */}
          {error && (
            <div className="mb-4 p-3 bg-red-900/20 border border-red-500/30 rounded-md">
              <p className="text-sm text-red-400 font-mono">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-xs text-red-500 hover:text-red-400 mt-1 font-mono"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Step Content */}
          <div className="bg-neutral-900/50 border border-neutral-800 rounded-lg overflow-hidden">
            {/* Step Header */}
            <div className="px-6 py-4 border-b border-neutral-800 flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-red-500/80" />
                <div className="h-3 w-3 rounded-full bg-amber-500/80" />
                <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
              </div>
              <span className="font-mono text-xs text-neutral-600">spec-studio</span>
              <div className="flex-1" />
              <span className="font-mono text-xs text-neutral-600">{projectDirectory}</span>
            </div>

            {/* Step Body */}
            <div className="p-6">
              {studioState.step === 'intent' && (
                <IntentStep
                  intent={studioState.intent}
                  onChange={handleIntentChange}
                  onNext={handleIntentNext}
                  isGenerating={isGenerating}
                />
              )}

              {studioState.step === 'questions' && (
                <QuestionsStep
                  questions={studioState.questions}
                  answers={studioState.answers}
                  onAnswerChange={handleAnswerChange}
                  onBack={handleQuestionsBack}
                  onNext={handleQuestionsNext}
                  isGenerating={isGenerating}
                />
              )}

              {studioState.step === 'review' && (
                <ReviewStep
                  spec={studioState.generatedSpec}
                  onSpecChange={handleSpecChange}
                  onBack={handleReviewBack}
                  onNext={handleReviewNext}
                  onRefine={handleRefine}
                  isRefining={isGenerating}
                />
              )}

              {studioState.step === 'config' && (
                <ConfigStep
                  config={config}
                  onChange={handleConfigChange}
                  onBack={handleConfigBack}
                  onNext={handleConfigNext}
                  validationError={validationError}
                  accessibilityStatus={accessibilityStatus}
                />
              )}

              {studioState.step === 'chunks' && (
                <ChunksStep
                  chunks={studioState.suggestedChunks}
                  onChunksChange={handleChunksChange}
                  onBack={handleChunksBack}
                  onComplete={handleComplete}
                  isCompleting={isGenerating}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Warning Modal */}
      {showNavigationWarning && (
        <ConfirmModal
          title="Unsaved Changes"
          message="You have unsaved changes in the spec wizard. Are you sure you want to leave? Your progress will be lost."
          confirmLabel="Leave"
          cancelLabel="Stay"
          onConfirm={handleConfirmNavigation}
          onCancel={handleCancelNavigation}
          isDanger
        />
      )}
    </div>
  );
}
