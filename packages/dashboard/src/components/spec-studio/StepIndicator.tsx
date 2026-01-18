'use client';

import type { SpecStudioStep } from '@specwright/shared';

interface StepIndicatorProps {
  currentStep: SpecStudioStep;
  /** Maximum step index that has been completed (based on data presence) */
  maxCompletedIndex?: number;
  onStepClick?: (step: SpecStudioStep) => void;
}

const STEPS: { step: SpecStudioStep; label: string }[] = [
  { step: 'intent', label: 'Intent' },
  { step: 'questions', label: 'Questions' },
  { step: 'review', label: 'Review' },
  { step: 'config', label: 'Config' },
  { step: 'chunks', label: 'Chunks' },
];

export const stepOrder: Record<SpecStudioStep, number> = {
  intent: 0,
  questions: 1,
  review: 2,
  config: 3,
  chunks: 4,
  complete: 5,
};

export default function StepIndicator({ currentStep, maxCompletedIndex, onStepClick }: StepIndicatorProps) {
  const currentIndex = stepOrder[currentStep];
  // Use maxCompletedIndex if provided, otherwise fall back to current step logic
  const effectiveMaxIndex = maxCompletedIndex !== undefined ? maxCompletedIndex : currentIndex;

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-neutral-500 font-mono">
        Step {Math.min(currentIndex + 1, 5)} of 5
      </span>
      <div className="flex items-center gap-1.5">
        {STEPS.map((s, index) => {
          const isCompleted = index < currentIndex;
          const isAccessible = index <= effectiveMaxIndex;
          const isCurrent = index === currentIndex;
          // Allow clicking any step that's been completed at some point (not just before current)
          const canClick = onStepClick && isAccessible && !isCurrent;

          return (
            <button
              key={s.step}
              onClick={() => canClick && onStepClick(s.step)}
              disabled={!canClick}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                isCompleted || isCurrent
                  ? 'bg-emerald-400'
                  : isAccessible
                    ? 'bg-emerald-400/50'
                    : 'border border-neutral-600'
              } ${canClick ? 'cursor-pointer hover:bg-emerald-300' : 'cursor-default'}`}
              title={canClick ? `Go to ${s.label}` : s.label}
            />
          );
        })}
      </div>
    </div>
  );
}
