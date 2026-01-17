'use client';

import type { Question } from '@specwright/shared';
import QuestionField from './QuestionField';

interface QuestionsStepProps {
  questions: Question[];
  answers: Record<string, string | string[]>;
  onAnswerChange: (questionId: string, value: string | string[]) => void;
  onBack: () => void;
  onNext: () => void;
  isGenerating: boolean;
}

export default function QuestionsStep({
  questions,
  answers,
  onAnswerChange,
  onBack,
  onNext,
  isGenerating,
}: QuestionsStepProps) {
  // Check if all required questions are answered
  const isValid = questions
    .filter((q) => q.required)
    .every((q) => {
      const answer = answers[q.id];
      if (q.type === 'multiselect') {
        return Array.isArray(answer) && answer.length > 0;
      }
      return answer && String(answer).trim().length > 0;
    });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium text-neutral-100 font-mono mb-2">
          Let me understand your requirements better
        </h2>
        <p className="text-sm text-neutral-500 font-mono">
          Answer these questions to help create a complete specification.
        </p>
      </div>

      <div className="space-y-5">
        {questions.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            value={answers[question.id] || (question.type === 'multiselect' ? [] : '')}
            onChange={(value) => onAnswerChange(question.id, value)}
          />
        ))}
      </div>

      {questions.length === 0 && (
        <div className="text-center py-8">
          <p className="text-neutral-500 font-mono text-sm">No questions generated yet.</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-4">
        <button
          onClick={onBack}
          disabled={isGenerating}
          className="px-4 py-2 text-neutral-400 hover:text-neutral-200 font-mono text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <button
          onClick={onNext}
          disabled={!isValid || isGenerating}
          className="px-4 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-md font-mono text-sm hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isGenerating ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Generating spec...
            </>
          ) : (
            <>
              Generate Spec
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
