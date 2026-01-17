'use client';

import { useState, useEffect } from 'react';
import type { Question } from '@specwright/shared';

interface QuestionFieldProps {
  question: Question;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}

const OTHER_PREFIX = 'Other: ';

export default function QuestionField({
  question,
  value,
  onChange,
}: QuestionFieldProps) {
  // Track "Other" text for both choice and multiselect
  const isChoiceOtherSelected = typeof value === 'string' && value.startsWith(OTHER_PREFIX);
  const selectedValues = Array.isArray(value) ? value : [];
  const multiOtherValue = selectedValues.find(v => v.startsWith(OTHER_PREFIX));
  const hasMultiOther = !!multiOtherValue;

  const [otherText, setOtherText] = useState(() => {
    if (isChoiceOtherSelected) {
      return (value as string).slice(OTHER_PREFIX.length);
    }
    if (hasMultiOther && multiOtherValue) {
      return multiOtherValue.slice(OTHER_PREFIX.length);
    }
    return '';
  });

  // Update other text when value changes externally
  useEffect(() => {
    if (typeof value === 'string' && value.startsWith(OTHER_PREFIX)) {
      setOtherText(value.slice(OTHER_PREFIX.length));
    } else if (Array.isArray(value)) {
      const otherVal = value.find(v => v.startsWith(OTHER_PREFIX));
      if (otherVal) {
        setOtherText(otherVal.slice(OTHER_PREFIX.length));
      }
    }
  }, [value]);

  if (question.type === 'text') {
    return (
      <div className="space-y-2">
        <label className="block text-sm text-neutral-200 font-mono">
          {question.question}
          {question.required && <span className="text-red-400 ml-1">*</span>}
        </label>
        <textarea
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type your answer..."
          className="w-full min-h-[80px] px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-md text-neutral-300 placeholder:text-neutral-700 font-mono text-sm focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 resize-y"
        />
      </div>
    );
  }

  if (question.type === 'choice') {
    const handleOtherChange = (text: string) => {
      setOtherText(text);
      onChange(OTHER_PREFIX + text);
    };

    return (
      <div className="space-y-2">
        <label className="block text-sm text-neutral-200 font-mono">
          {question.question}
          {question.required && <span className="text-red-400 ml-1">*</span>}
        </label>
        <div className="space-y-1.5">
          {question.options?.map((option) => (
            <label
              key={option}
              className="flex items-center gap-3 px-3 py-2 bg-neutral-900/50 border border-neutral-800 rounded-md cursor-pointer hover:border-neutral-700 transition-colors"
            >
              <input
                type="radio"
                name={question.id}
                value={option}
                checked={(value as string) === option}
                onChange={(e) => onChange(e.target.value)}
                className="w-4 h-4 text-emerald-500 bg-neutral-800 border-neutral-700 focus:ring-emerald-500/20 focus:ring-offset-0"
              />
              <span className="text-sm text-neutral-300 font-mono">{option}</span>
            </label>
          ))}
          {/* Other option */}
          <label
            className={`flex items-center gap-3 px-3 py-2 bg-neutral-900/50 border rounded-md cursor-pointer transition-colors ${
              isChoiceOtherSelected
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-neutral-800 hover:border-neutral-700'
            }`}
          >
            <input
              type="radio"
              name={question.id}
              value="__other__"
              checked={isChoiceOtherSelected}
              onChange={() => onChange(OTHER_PREFIX + otherText)}
              className="w-4 h-4 text-emerald-500 bg-neutral-800 border-neutral-700 focus:ring-emerald-500/20 focus:ring-offset-0"
            />
            <span className="text-sm text-neutral-300 font-mono">Other:</span>
            <input
              type="text"
              value={otherText}
              onChange={(e) => handleOtherChange(e.target.value)}
              onFocus={() => onChange(OTHER_PREFIX + otherText)}
              placeholder="specify..."
              className="flex-1 px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-neutral-300 placeholder:text-neutral-700 font-mono text-sm focus:outline-none focus:border-emerald-500/50"
            />
          </label>
        </div>
      </div>
    );
  }

  if (question.type === 'multiselect') {
    const handleToggle = (option: string) => {
      if (selectedValues.includes(option)) {
        onChange(selectedValues.filter((v) => v !== option));
      } else {
        onChange([...selectedValues, option]);
      }
    };

    const handleOtherToggle = () => {
      if (hasMultiOther) {
        onChange(selectedValues.filter(v => !v.startsWith(OTHER_PREFIX)));
      } else {
        onChange([...selectedValues, OTHER_PREFIX + otherText]);
      }
    };

    const handleMultiOtherChange = (text: string) => {
      setOtherText(text);
      const withoutOther = selectedValues.filter(v => !v.startsWith(OTHER_PREFIX));
      onChange([...withoutOther, OTHER_PREFIX + text]);
    };

    return (
      <div className="space-y-2">
        <label className="block text-sm text-neutral-200 font-mono">
          {question.question}
          {question.required && <span className="text-red-400 ml-1">*</span>}
        </label>
        <div className="flex flex-wrap gap-2">
          {question.options?.map((option) => {
            const isSelected = selectedValues.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => handleToggle(option)}
                className={`px-3 py-1.5 rounded-md font-mono text-sm transition-colors ${
                  isSelected
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-neutral-900 text-neutral-400 border border-neutral-800 hover:border-neutral-700'
                }`}
              >
                <span className="mr-2">{isSelected ? '☑' : '☐'}</span>
                {option}
              </button>
            );
          })}
        </div>
        {/* Other option for multiselect */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-colors ${
          hasMultiOther
            ? 'bg-emerald-500/10 border-emerald-500/30'
            : 'bg-neutral-900/50 border-neutral-800'
        }`}>
          <button
            type="button"
            onClick={handleOtherToggle}
            className="text-sm text-neutral-300 font-mono flex items-center gap-2"
          >
            <span>{hasMultiOther ? '☑' : '☐'}</span>
            Other:
          </button>
          <input
            type="text"
            value={otherText}
            onChange={(e) => handleMultiOtherChange(e.target.value)}
            onFocus={() => {
              if (!hasMultiOther) {
                onChange([...selectedValues, OTHER_PREFIX + otherText]);
              }
            }}
            placeholder="specify..."
            className="flex-1 px-2 py-1 bg-neutral-900 border border-neutral-800 rounded text-neutral-300 placeholder:text-neutral-700 font-mono text-sm focus:outline-none focus:border-emerald-500/50"
          />
        </div>
      </div>
    );
  }

  return null;
}
