/**
 * Shared prompt templates for AI review operations
 */

import type { ReviewResult, ReviewResultStatus } from '@specwright/shared';

// Import types inline to avoid circular dependency at runtime
// The actual validation formatting is done in the validation module
export interface ValidationResultForPrompt {
  success: boolean;
  filesChanged: number;
  filesChangedList: string[];
  gitDiff: string;
  buildResult: {
    success: boolean;
    output: string;
    exitCode: number;
  };
}

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

export const ENHANCED_REVIEW_PROMPT_TEMPLATE = `You are reviewing the output of an AI coding assistant that just completed a coding task.

## Task
Title: {title}
Description: {description}

## Output from AI Assistant
{output}

{validationContext}

## Your Job
Determine if the task was completed correctly based on BOTH the AI output AND the actual code changes.

CRITICAL RULES:
1. If the build FAILED, your feedback MUST quote the actual build error message
2. If the build PASSED but changes don't match the task description → "needs_fix"
3. If the AI output claims success but changes are incomplete → "needs_fix"
4. Only "pass" if BOTH:
   - Build passes (already verified above)
   - AND changes correctly implement the task

IMPORTANT - Error diagnosis:
- TypeScript "has no exported member 'X'" = Missing type EXPORT, not missing file
- TypeScript "Cannot find module 'X'" = Missing file OR missing package
- TypeScript "Property 'X' does not exist" = Type mismatch, not missing file
- Files created but build fails = Usually missing exports or imports, NOT missing files
- NEVER say "files don't exist" unless you see "Cannot find module" or "ENOENT" errors

Return JSON:
{
  "status": "pass" | "needs_fix" | "fail",
  "feedback": "Brief explanation citing the actual error message if build failed",
  "fixChunk": {
    "title": "Short title for the fix",
    "description": "Detailed instructions to fix the specific error"
  }
}

Rules:
- "pass" = Task completed correctly, changes match task, build passes
- "needs_fix" = Task partially done, changes incomplete, or logic errors
- "fail" = Task cannot be completed, fundamental problem
- Be specific in feedback - QUOTE the actual error message from build output
- Fix descriptions must address the ACTUAL error, not a misinterpretation
- Only include fixChunk if status is "needs_fix"
- Return ONLY valid JSON, no markdown code blocks`;

/**
 * Build basic review prompt (without validation context)
 * Used as fallback when validation is skipped
 */
export function buildReviewPrompt(chunk: { title: string; description: string; output?: string }): string {
  return REVIEW_PROMPT_TEMPLATE
    .replace('{title}', chunk.title)
    .replace('{description}', chunk.description)
    .replace('{output}', chunk.output || 'No output captured');
}

/**
 * Format validation results for inclusion in review prompt
 */
function formatValidationForPrompt(validation: ValidationResultForPrompt): string {
  const lines: string[] = [];

  // Files changed section
  lines.push('## Code Changes');
  lines.push(`Files changed: ${validation.filesChanged}`);

  if (validation.filesChangedList.length > 0) {
    lines.push('');
    lines.push('Changed files:');
    for (const file of validation.filesChangedList.slice(0, 20)) {
      lines.push(`- ${file}`);
    }
    if (validation.filesChangedList.length > 20) {
      lines.push(`- ... and ${validation.filesChangedList.length - 20} more files`);
    }
  }

  // Git diff summary
  if (validation.gitDiff && validation.gitDiff !== 'No changes') {
    lines.push('');
    lines.push('Diff summary:');
    lines.push('```');
    lines.push(validation.gitDiff);
    lines.push('```');
  }

  // Build result
  lines.push('');
  lines.push('## Build Validation');
  lines.push(`Build status: ${validation.buildResult.success ? 'PASSED' : 'FAILED'}`);

  if (!validation.buildResult.success && validation.buildResult.output) {
    lines.push('');
    lines.push('Build errors:');
    lines.push('```');
    lines.push(validation.buildResult.output.slice(0, 2000));
    if (validation.buildResult.output.length > 2000) {
      lines.push('... (output truncated)');
    }
    lines.push('```');
  }

  return lines.join('\n');
}

/**
 * Build enhanced review prompt with validation context
 * Includes file changes, build results, and git diff summary
 */
export function buildEnhancedReviewPrompt(
  chunk: { title: string; description: string; output?: string },
  validation: ValidationResultForPrompt
): string {
  const validationContext = formatValidationForPrompt(validation);

  return ENHANCED_REVIEW_PROMPT_TEMPLATE
    .replace('{title}', chunk.title)
    .replace('{description}', chunk.description)
    .replace('{output}', chunk.output || 'No output captured')
    .replace('{validationContext}', validationContext);
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
      status: parsed.status as ReviewResultStatus,
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
