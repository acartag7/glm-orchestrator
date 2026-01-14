import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { existsSync } from "fs";

export interface ExtractedFile {
  path: string;
  content: string;
}

/**
 * Parse GLM response for code blocks with file paths
 * Supports formats:
 * - triple-backtick typescript:path/to/file.ts
 * - triple-backtick ts:path/to/file.ts
 * - // file: path/to/file.ts (at start of code block)
 */
export function extractCodeBlocks(response: string): ExtractedFile[] {
  const files: ExtractedFile[] = [];

  // Pattern 1: ```lang:filepath or ```filepath
  const codeBlockRegex = /```(?:typescript|ts|javascript|js|json)?:?([^\n`]+)?\n([\s\S]*?)```/g;

  let match;
  while ((match = codeBlockRegex.exec(response)) !== null) {
    let filePath = match[1]?.trim();
    let content = match[2];

    // If no path in header, check first line of content
    if (!filePath || !filePath.includes('.')) {
      const firstLineMatch = content.match(/^(?:\/\/|\/\*)\s*(?:file:?\s*)?([^\n*]+\.(?:ts|tsx|js|jsx|json))/i);
      if (firstLineMatch) {
        filePath = firstLineMatch[1].trim();
        // Remove the file path comment from content
        content = content.replace(/^(?:\/\/|\/\*)[^\n]*\n?/, '').trim();
      }
    }

    if (filePath && filePath.includes('.')) {
      // Clean up the path
      filePath = filePath.replace(/^\s*`?|`?\s*$/g, '').trim();
      files.push({
        path: filePath,
        content: content.trim()
      });
    }
  }

  // Pattern 2: Look for "Create file X:" or "File: X" followed by code block
  const fileHeaderRegex = /(?:create|file|writing)(?:\s+file)?[:\s]+[`"]?([^\n`"]+\.(?:ts|tsx|js|jsx|json))[`"]?\s*:?\s*\n```(?:typescript|ts|javascript|js|json)?\n([\s\S]*?)```/gi;

  while ((match = fileHeaderRegex.exec(response)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();

    // Avoid duplicates
    if (!files.some(f => f.path === filePath)) {
      files.push({ path: filePath, content });
    }
  }

  return files;
}

/**
 * Write extracted files to disk
 */
export async function writeExtractedFiles(
  files: ExtractedFile[],
  workingDirectory: string
): Promise<{ written: string[]; errors: string[] }> {
  const written: string[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      // Resolve full path
      const fullPath = file.path.startsWith('/')
        ? file.path
        : `${workingDirectory}/${file.path}`;

      // Ensure directory exists
      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      // Write file
      await writeFile(fullPath, file.content, 'utf-8');
      written.push(file.path);
      console.error(`[Orchestrator] Wrote: ${file.path}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${file.path}: ${errMsg}`);
      console.error(`[Orchestrator] Failed to write ${file.path}: ${errMsg}`);
    }
  }

  return { written, errors };
}
