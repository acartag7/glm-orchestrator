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
      {/* Terminal-style card */}
      <div className="flex-1 bg-neutral-900/50 border border-neutral-800 rounded-lg overflow-hidden flex flex-col min-h-0">
        {/* Window header with macOS controls */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 bg-neutral-900/80 flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* macOS window controls */}
            <div className="flex gap-1.5">
              <div className="h-3 w-3 rounded-full bg-red-500/80" />
              <div className="h-3 w-3 rounded-full bg-amber-500/80" />
              <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
            </div>
            <span className="font-mono text-xs text-neutral-500">spec.md</span>
          </div>
          <div className="flex items-center gap-2">
            {isSaving && (
              <span className="text-[10px] text-neutral-500 font-mono flex items-center gap-1">
                <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                saving...
              </span>
            )}
            {!isSaving && lastSaved && (
              <span className="text-[10px] text-neutral-600 font-mono">
                saved {lastSaved.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="text-[10px] font-mono text-neutral-500 hover:text-neutral-300 px-2 py-0.5 rounded hover:bg-neutral-800 transition-colors disabled:opacity-50"
            >
              save
            </button>
            <button
              onClick={handleRefine}
              disabled={isRefining || !content.trim()}
              className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 px-2 py-0.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {isRefining ? (
                <>
                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  refining...
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  opus refine
                </>
              )}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-3 mt-2 text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded px-3 py-2 font-mono">
            {error}
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 min-h-0 p-3 overflow-hidden">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            placeholder="# Feature Name

## Overview
Describe what this feature does.

## Requirements
- Requirement 1
- Requirement 2

## Acceptance Criteria
- [ ] Criteria 1
- [ ] Criteria 2"
            className="w-full h-full min-h-[200px] bg-transparent text-sm text-neutral-300 font-mono placeholder-neutral-700 focus:outline-none resize-none overflow-y-auto"
            disabled={isRefining}
          />
        </div>

        {/* Footer info */}
        <div className="px-3 py-2 flex items-center justify-between text-[10px] text-neutral-600 border-t border-neutral-800/50 flex-shrink-0 font-mono">
          <span>v{spec.version}</span>
          <span>{content.length} chars</span>
        </div>
      </div>
    </div>
  );
}
