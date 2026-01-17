/**
 * Shared prompt templates for AI review operations
 */

import type { ReviewResult, ReviewStatus } from '@specwright/shared';

export const REVIEW_PROMPT_TEMPLATE = `You are reviewing the output of an AI coding assistant that just completed a task.

## Task
Title: {title}
Description: {description}

## Output from AI Assistant
{output}

## Your Job
Determine if the task was completed correctly.

Return JSON:
{
  "status": "pass" | "needs_fix" | "fail",
  "feedback": "Brief explanation of your assessment",
  "fixChunk": {
    "title": "Short title for the fix",
    "description": "Detailed instructions to fix the issue"
  }
}

Rules:
- "pass" = Task completed correctly, no issues found
- "needs_fix" = Task partially done or has fixable issues
- "fail" = Task cannot be completed, fundamental problem
- Be specific in feedback
- Fix descriptions should be actionable
- Only include fixChunk if status is "needs_fix"
- Return ONLY valid JSON, no markdown code blocks`;

export function buildReviewPrompt(chunk: { title: string; description: string; output?: string }): string {
  return REVIEW_PROMPT_TEMPLATE
    .replace('{title}', chunk.title)
    .replace('{description}', chunk.description)
    .replace('{output}', chunk.output || 'No output captured');
}

export function parseReviewResult(text: string): ReviewResult | null {
  try {
    let jsonStr = text.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    const parsed = JSON.parse(jsonStr);
    if (!parsed.status || !['pass', 'needs_fix', 'fail'].includes(parsed.status)) {
      return null;
    }
    const result: ReviewResult = {
      status: parsed.status as ReviewStatus,
      feedback: parsed.feedback || '',
    };
    if (parsed.status === 'needs_fix' && parsed.fixChunk) {
      result.fixChunk = {
        title: parsed.fixChunk.title || 'Fix required issue',
        description: parsed.fixChunk.description || 'Fix the issue identified in the previous task',
      };
    }
    return result;
  } catch {
    return null;
  }
}
