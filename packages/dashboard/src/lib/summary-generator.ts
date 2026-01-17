/**
 * Summary Generator for Chunk Outputs
 *
 * Generates concise summaries of what a chunk accomplished,
 * to be used as context for dependent chunks.
 */

import { ClaudeClient } from '@specwright/mcp/client';
import type { Chunk } from '@specwright/shared';

const SUMMARY_SYSTEM_PROMPT = `You are a technical summarizer. Your job is to create concise summaries of completed development tasks that can be used as context for subsequent tasks.

Focus on:
1. Files created or modified (with exact paths)
2. Functions, classes, or components added
3. Key patterns or decisions made
4. Exports or interfaces available for other code to use

Be precise and technical. Do not include meta-commentary or filler.`;

const SUMMARY_PROMPT_TEMPLATE = `Summarize what was accomplished in this development task. This summary will be passed to the next task as context.

## Task Title
{title}

## Task Description
{description}

## Task Output
{output}

---

Provide a structured summary in this exact format:

## What Was Done
[1-2 sentences describing the main accomplishment]

## Files Changed
- path/to/file.ts: [brief description of changes]
- path/to/another.ts: [brief description]

## Key Exports/Interfaces
- FunctionName(): [what it does]
- InterfaceName: [what it represents]

## Notes for Next Tasks
[Any important decisions or patterns that subsequent tasks should know about]

Keep the summary under 500 words. Be specific about file paths and function names.`;

interface SummaryResult {
  success: boolean;
  summary?: string;
  error?: string;
}

/**
 * Generate a summary of what a chunk accomplished
 */
export async function generateChunkSummary(
  chunk: Chunk,
  workingDirectory: string
): Promise<SummaryResult> {
  if (!chunk.output) {
    return {
      success: false,
      error: 'No output to summarize',
    };
  }

  const prompt = SUMMARY_PROMPT_TEMPLATE
    .replace('{title}', chunk.title)
    .replace('{description}', chunk.description)
    .replace('{output}', truncateOutput(chunk.output, 8000));

  try {
    // Use a fast model for summarization
    const client = new ClaudeClient({ model: 'claude-sonnet-4-5-20250929' });
    const result = await client.execute(prompt, {
      workingDirectory,
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      timeout: 30000,
    });

    if (!result.success) {
      return {
        success: false,
        error: `Summary generation failed: ${result.output}`,
      };
    }

    return {
      success: true,
      summary: result.output.trim(),
    };
  } catch (error) {
    return {
      success: false,
      error: `Summary generation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Truncate output to fit within token limits
 */
function truncateOutput(output: string, maxLength: number): string {
  if (output.length <= maxLength) return output;

  const half = Math.floor(maxLength / 2) - 100;
  return (
    output.slice(0, half) +
    '\n\n... [middle truncated for brevity] ...\n\n' +
    output.slice(-half)
  );
}

/**
 * Generate a quick summary without calling Claude (fallback)
 * Extracts key information from the output using patterns
 */
export function generateQuickSummary(chunk: Chunk): string {
  if (!chunk.output) {
    return `Completed: ${chunk.title}`;
  }

  const output = chunk.output;
  const files: Set<string> = new Set();

  // Extract file paths from common patterns
  const filePatterns = [
    /(?:created|modified|updated|wrote|reading|writing)\s+[`"']?([^\s`"'\n]+\.[a-z]{1,5})[`"']?/gi,
    /(?:file|path):\s*[`"']?([^\s`"'\n]+\.[a-z]{1,5})[`"']?/gi,
    /`([^`\s]+\.[a-z]{1,5})`/g,
  ];

  for (const pattern of filePatterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const file = match[1];
      if (!file.startsWith('http') && !file.includes('node_modules')) {
        files.add(file);
      }
    }
  }

  const filesStr = files.size > 0
    ? `\n\nFiles: ${Array.from(files).slice(0, 10).join(', ')}`
    : '';

  return `## ${chunk.title}\n\nCompleted successfully.${filesStr}`;
}
