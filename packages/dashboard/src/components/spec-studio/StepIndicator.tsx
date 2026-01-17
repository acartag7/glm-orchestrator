'use client';

import type { SpecStudioStep } from '@specwright/shared';

interface StepIndicatorProps {
  currentStep: SpecStudioStep;
  onStepClick?: (step: SpecStudioStep) => void;
}

const STEPS: { step: SpecStudioStep; label: string }[] = [
  { step: 'intent', label: 'Intent' },
  { step: 'questions', label: 'Questions' },
  { step: 'review', label: 'Review' },
  { step: 'config', label: 'Config' },
  { step: 'chunks', label: 'Chunks' },
];

const stepOrder: Record<SpecStudioStep, number> = {
  intent: 0,
  questions: 1,
  review: 2,
  config: 3,
  chunks: 4,
  complete: 5,
};

export default function StepIndicator({ currentStep, onStepClick }: StepIndicatorProps) {
  const currentIndex = stepOrder[currentStep];

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-neutral-500 font-mono">
        Step {Math.min(currentIndex + 1, 5)} of 5
      </span>
      <div className="flex items-center gap-1.5">
        {STEPS.map((s, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const canClick = onStepClick && isCompleted;

          return (
            <button
              key={s.step}
              onClick={() => canClick && onStepClick(s.step)}
              disabled={!canClick}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                isCompleted || isCurrent
                  ? 'bg-emerald-400'
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
