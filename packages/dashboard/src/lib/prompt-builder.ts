/**
 * Prompt Builder for Chunk Context
 *
 * Builds prompts that include context from completed dependency chunks,
 * so GLM knows what previous work was accomplished.
 */

import type { Chunk, Spec } from '@specwright/shared';

interface ChunkPromptOptions {
  includeSpecContent?: boolean;
  maxOutputLength?: number;
  includeFilesModified?: boolean;
}

const DEFAULT_OPTIONS: ChunkPromptOptions = {
  includeSpecContent: true,
  maxOutputLength: 2000,
  includeFilesModified: true,
};

/**
 * Extract a summary of files modified from chunk output
 * Looks for common patterns in AI tool output
 */
function extractFilesModified(output: string): string[] {
  const files: Set<string> = new Set();

  // Match file paths in common output patterns
  const patterns = [
    /(?:created|modified|updated|wrote|edited|reading|writing)\s+[`"']?([^\s`"'\n]+\.[a-z]{1,5})[`"']?/gi,
    /(?:file|path):\s*[`"']?([^\s`"'\n]+\.[a-z]{1,5})[`"']?/gi,
    /`([^`]+\.[a-z]{1,5})`/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const file = match[1];
      // Filter out common false positives
      if (!file.startsWith('http') && !file.includes('node_modules')) {
        files.add(file);
      }
    }
  }

  return Array.from(files);
}

/**
 * Truncate output to a reasonable length
 */
function truncateOutput(output: string, maxLength: number): string {
  if (output.length <= maxLength) return output;

  const half = Math.floor(maxLength / 2) - 50;
  return (
    output.slice(0, half) +
    '\n\n... [output truncated] ...\n\n' +
    output.slice(-half)
  );
}

/**
 * Build context section from completed dependencies
 * Prefers outputSummary (concise) over raw output (verbose)
 */
function buildDependencyContext(
  deps: Chunk[],
  options: ChunkPromptOptions
): string {
  if (deps.length === 0) {
    return 'This is the first chunk - no prior work has been done.';
  }

  const sections = deps.map(dep => {
    let section = `### Chunk: "${dep.title}"\n`;
    section += `Status: ${dep.status === 'completed' ? 'Completed' : dep.status}\n`;

    // Prefer outputSummary (concise, structured) over raw output (verbose)
    if (dep.outputSummary) {
      section += `\n${dep.outputSummary}\n`;
    } else if (dep.output) {
      // Fall back to truncated raw output if no summary available
      const truncated = truncateOutput(dep.output, options.maxOutputLength || 2000);
      section += `Output:\n${truncated}\n`;

      if (options.includeFilesModified) {
        const files = extractFilesModified(dep.output);
        if (files.length > 0) {
          section += `Files Modified: ${files.slice(0, 10).join(', ')}`;
          if (files.length > 10) {
            section += ` (+${files.length - 10} more)`;
          }
          section += '\n';
        }
      }
    } else {
      section += 'Output: No output recorded\n';
    }

    return section;
  });

  return sections.join('\n');
}

/**
 * Build the full prompt for a chunk, including context from dependencies
 */
export function buildChunkPrompt(
  chunk: Chunk,
  spec: Spec,
  dependencyChunks: Chunk[],
  options: Partial<ChunkPromptOptions> = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Filter to only completed dependencies
  const completedDeps = dependencyChunks.filter(c => c.status === 'completed');

  // Build the context section
  const contextSection = buildDependencyContext(completedDeps, opts);

  // Build spec section
  let specSection = '';
  if (opts.includeSpecContent && spec.content) {
    // Truncate spec if too long
    const maxSpecLength = 3000;
    const truncatedSpec = spec.content.length > maxSpecLength
      ? spec.content.slice(0, maxSpecLength) + '\n\n... [spec truncated] ...'
      : spec.content;
    specSection = `## Spec Overview\n${truncatedSpec}\n\n`;
  }

  // Build files context
  let filesContext = '';
  if (completedDeps.length > 0) {
    const allFiles = new Set<string>();
    for (const dep of completedDeps) {
      if (dep.output) {
        extractFilesModified(dep.output).forEach(f => allFiles.add(f));
      }
    }
    if (allFiles.size > 0) {
      filesContext = `## Files Created/Modified by Previous Chunks\n`;
      filesContext += Array.from(allFiles).slice(0, 20).map(f => `- ${f}`).join('\n');
      if (allFiles.size > 20) {
        filesContext += `\n- ... and ${allFiles.size - 20} more files`;
      }
      filesContext += '\n\n';
    }
  }

  return `You are implementing part of a larger feature. Here's the context:

${specSection}## Previously Completed Work
${contextSection}

${filesContext}## Your Current Task
Title: ${chunk.title}
Description: ${chunk.description}

## Important Instructions
- Build on the work already done by previous chunks
- Do NOT recreate files that already exist - modify them instead
- Reference existing code created by previous chunks
- If you need to import something that should exist, assume it's at the path created by the previous chunk
- Focus only on THIS task - don't do work that belongs to other chunks
- Be thorough but efficient

Now complete this task.`;
}

/**
 * Build a simpler prompt for the first chunk (no dependencies)
 */
export function buildFirstChunkPrompt(chunk: Chunk, spec: Spec): string {
  return `You are implementing the first part of a larger feature.

## Spec Overview
${spec.content}

## Your Task
Title: ${chunk.title}
Description: ${chunk.description}

## Important Instructions
- This is the first chunk - you're starting from scratch
- Set up any necessary foundations for subsequent tasks
- Be thorough but efficient
- Future chunks will build on your work

Now complete this task.`;
}

/**
 * High-level function to build the appropriate prompt
 */
export async function buildPromptForChunk(
  chunk: Chunk,
  spec: Spec,
  getChunk: (id: string) => Chunk | undefined,
  options: Partial<ChunkPromptOptions> = {}
): Promise<string> {
  // If no dependencies, use the simpler first chunk prompt
  if (chunk.dependencies.length === 0) {
    return buildFirstChunkPrompt(chunk, spec);
  }

  // Fetch all dependency chunks
  const dependencyChunks: Chunk[] = [];
  for (const depId of chunk.dependencies) {
    const dep = getChunk(depId);
    if (dep) {
      dependencyChunks.push(dep);
    }
  }

  return buildChunkPrompt(chunk, spec, dependencyChunks, options);
}
