import { executeGLM } from "../utils/glm.js";
import { getProjectFiles } from "../utils/files.js";
import { buildContext, ChunkResult } from "../utils/context.js";

export async function executeChunksSequentially(
  chunks: string[],
  workingDirectory: string,
  specContent?: string,
  timeoutPerChunk: number = 180000
): Promise<ChunkResult[]> {
  const results: ChunkResult[] = [];
  let filesCreated: string[] = [];

  const initialFiles = await getProjectFiles(workingDirectory);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.error(`[Specwright] Executing chunk ${i + 1}/${chunks.length}`);

    const context = buildContext(results, filesCreated, specContent);

    const promptWithContext = `${context}## Your Current Task (Chunk ${i + 1}/${chunks.length})

${chunk}

CRITICAL: You MUST use the Write tool to create files. Do NOT just output code - actually CREATE the files on disk.

Steps:
1. Use Write tool to create each file
2. Confirm what files you created`;

    try {
      const { output, duration } = await executeGLM(
        promptWithContext,
        workingDirectory,
        { timeoutMs: timeoutPerChunk }
      );

      results.push({
        chunk: chunk.substring(0, 100) + "...",
        status: "success",
        output,
        duration,
      });

      const currentFiles = await getProjectFiles(workingDirectory);
      filesCreated = currentFiles.filter((f) => !initialFiles.includes(f));
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes("timed out");
      results.push({
        chunk: chunk.substring(0, 100) + "...",
        status: isTimeout ? "timeout" : "error",
        output: error instanceof Error ? error.message : String(error),
        duration: timeoutPerChunk,
      });

      const currentFiles = await getProjectFiles(workingDirectory);
      filesCreated = currentFiles.filter((f) => !initialFiles.includes(f));

      console.error(`[Specwright] Chunk ${i + 1} failed: ${error}`);
    }
  }

  return results;
}
