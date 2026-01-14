import { executeGLM, GLMOptions } from "../utils/glm.js";
import { getProjectFiles } from "../utils/files.js";
import { validateWorkingDirectory } from "../utils/paths.js";
import { readFile } from "fs/promises";
import { join } from "path";

export async function delegateToGLM(
  task: string,
  workingDirectory: string,
  timeoutMs: number = 180000
) {
  validateWorkingDirectory(workingDirectory);

  // Simple, direct prompt - let GLM use its tools
  const prompt = `${task}

Do this now. Create the files.`;

  const progressFile = join(workingDirectory, ".handoff", `progress-${Date.now()}.log`);

  const { output, duration } = await executeGLM(prompt, workingDirectory, {
    timeoutMs,
    progressFile,
  });

  return {
    content: [{
      type: "text" as const,
      text: `GLM completed in ${Math.round(duration / 1000)}s:\n\n${output}\n\n📋 Progress log: ${progressFile}`
    }],
  };
}

export async function delegateChunksToGLM(
  chunks: string[],
  workingDirectory: string,
  specFile?: string,
  timeoutPerChunk: number = 180000
) {
  validateWorkingDirectory(workingDirectory);

  let specContent: string | undefined;
  if (specFile) {
    try {
      specContent = await readFile(specFile, "utf-8");
      console.error(`[Orchestrator] Loaded spec from ${specFile}`);
    } catch (e) {
      console.error(`[Orchestrator] Could not read spec file: ${e}`);
    }
  }

  console.error(`[Orchestrator] Starting ${chunks.length} chunks`);

  // Track files before we start
  const initialFiles = await getProjectFiles(workingDirectory);

  const results: Array<{
    chunk: string;
    status: "success" | "error" | "timeout";
    output: string;
    duration: number;
  }> = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Simple prompt without spec context - tasks should be self-contained
    const prompt = `## Task ${i + 1}/${chunks.length}

${chunk}

Do this now. Create the files.`;

    try {
      console.error(`\n[Orchestrator] ⏳ Chunk ${i + 1}/${chunks.length} sending...`);
      const progressFile = join(workingDirectory, ".handoff", `chunk-${i + 1}-progress.log`);

      const { output, duration } = await executeGLM(prompt, workingDirectory, {
        timeoutMs: timeoutPerChunk,
        progressFile,
      });
      console.error(`[Orchestrator] ✅ Chunk ${i + 1} done in ${Math.round(duration/1000)}s`);

      results.push({
        chunk: chunk.substring(0, 80) + "...",
        status: "success",
        output: output.substring(0, 500),
        duration,
      });
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes("timed out");
      console.error(`[Orchestrator] ❌ Chunk ${i + 1} failed: ${error}`);

      results.push({
        chunk: chunk.substring(0, 80) + "...",
        status: isTimeout ? "timeout" : "error",
        output: error instanceof Error ? error.message : String(error),
        duration: timeoutPerChunk,
      });
    }
  }

  // Check what files were created
  const finalFiles = await getProjectFiles(workingDirectory);
  const newFiles = finalFiles.filter(f => !initialFiles.includes(f));

  // Build summary
  const successful = results.filter(r => r.status === "success").length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  let summary = `## GLM Execution Summary

**Chunks:** ${successful}/${chunks.length} successful
**New Files:** ${newFiles.length}
**Total Time:** ${Math.round(totalDuration / 1000)}s

### Chunks:

`;

  results.forEach((result, i) => {
    const icon = result.status === "success" ? "✅" : result.status === "timeout" ? "⏱️" : "❌";
    summary += `**${i + 1}. ${icon}** (${Math.round(result.duration / 1000)}s) ${result.output.substring(0, 100)}\n\n`;
  });

  if (newFiles.length > 0) {
    summary += `### Files Created:\n${newFiles.map(f => `- ${f}`).join('\n')}\n`;
  }

  return {
    content: [{ type: "text" as const, text: summary }],
  };
}
