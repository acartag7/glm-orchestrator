'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Spec } from '@glm/shared';

interface SpecEditorProps {
  spec: Spec;
  projectId: string;
  onUpdate?: (spec: Spec) => void;
}

export default function SpecEditor({ spec, projectId, onUpdate }: SpecEditorProps) {
  const [content, setContent] = useState(spec.content);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(200, textareaRef.current.scrollHeight)}px`;
    }
  }, [content]);

  // Save spec
  const saveSpec = useCallback(async (newContent: string) => {
    try {
      setIsSaving(true);
      setError(null);

      const response = await fetch(`/api/projects/${projectId}/spec`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save');
      }

      const updatedSpec = await response.json();
      setLastSaved(new Date());
      onUpdate?.(updatedSpec);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [projectId, onUpdate]);

  // Debounced save on content change
  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for auto-save
    saveTimeoutRef.current = setTimeout(() => {
      saveSpec(newContent);
    }, 1000);
  }, [saveSpec]);

  // Manual save
  const handleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveSpec(content);
  }, [content, saveSpec]);

  // Refine spec with Opus
  const handleRefine = useCallback(async () => {
    if (!content.trim()) {
      setError('Write a spec first before refining');
      return;
    }

    try {
      setIsRefining(true);
      setError(null);

      const response = await fetch(`/api/projects/${projectId}/spec/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to refine');
      }

      const result = await response.json();
      setContent(result.spec.content);
      setLastSaved(new Date());
      onUpdate?.(result.spec);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refine');
    } finally {
      setIsRefining(false);
    }
  }, [content, projectId, onUpdate]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Spec
          </h2>
          {isSaving && (
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Saving...
            </span>
          )}
          {!isSaving && lastSaved && (
            <span className="text-xs text-gray-500">
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={handleRefine}
            disabled={isRefining || !content.trim()}
            className="text-xs bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isRefining ? (
              <>
                <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Refining...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Ask Opus to Refine
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 text-xs text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleContentChange}
          placeholder="Write your specification here...

# Feature Name

## Overview
Describe what this feature does.

## Requirements
- Requirement 1
- Requirement 2

## Acceptance Criteria
- [ ] Criteria 1
- [ ] Criteria 2"
          className="w-full h-full min-h-[200px] bg-gray-900 border border-gray-800 rounded-lg p-4 text-sm text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          disabled={isRefining}
        />
      </div>

      {/* Footer info */}
      <div className="mt-2 flex items-center justify-between text-xs text-gray-500 flex-shrink-0">
        <span>Version {spec.version}</span>
        <span>{content.length} characters</span>
      </div>
    </div>
  );
}
