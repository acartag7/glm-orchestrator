/**
 * Delegation tools for GLM and Opus execution
 *
 * v2: Uses HTTP API for GLM and CLI for Opus with real-time event streaming
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { OpencodeClient, getOpencodeClient } from "../client/opencode.js";
import { ClaudeClient, getClaudeClient } from "../client/claude.js";
import { getSystemPrompt, type TaskType, FOCUSED_TASK_PROMPT } from "../prompts/index.js";
import { validateWorkingDirectory } from "../utils/paths.js";
import { getProjectFiles } from "../utils/files.js";
import {
  createTask,
  completeTask,
  failTask,
  recordToolCall,
  recordToolCallWithState,
  updateTaskSession,
} from "../lib/db.js";
import type { ToolCallEvent, SessionStatus } from "@glm/shared";

// Feature flag for v2 HTTP API
const USE_HTTP_API = process.env.GLM_USE_HTTP_API !== "false";

// Default timeouts
const DEFAULT_GLM_TIMEOUT = 180000;  // 3 minutes
const DEFAULT_OPUS_TIMEOUT = 300000; // 5 minutes

// ============================================================================
// GLM Delegation (v2: HTTP API with SSE)
// ============================================================================

export async function delegateToGLM(
  task: string,
  workingDirectory: string,
  timeoutMs: number = DEFAULT_GLM_TIMEOUT,
  systemPrompt?: string
) {
  validateWorkingDirectory(workingDirectory);

  if (USE_HTTP_API) {
    return delegateToGLMViaHttp(task, workingDirectory, timeoutMs, systemPrompt);
  }

  // Fallback to legacy spawn-based execution
  return delegateToGLMLegacy(task, workingDirectory, timeoutMs);
}

async function delegateToGLMViaHttp(
  task: string,
  workingDirectory: string,
  timeoutMs: number,
  systemPrompt?: string
) {
  const client = getOpencodeClient();
  const startTime = Date.now();
  const taskId = `glm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Create task record
  createTask(taskId, task.substring(0, 200), task);

  try {
    // Check server health first
    const health = await client.checkHealth();
    if (!health.healthy) {
      throw new Error("Opencode server not running. Start it with: opencode serve");
    }

    // Create session
    const session = await client.createSession(workingDirectory, `GLM Task: ${task.substring(0, 50)}`);
    updateTaskSession(taskId, session.id, "zai-coding-plan", "glm-4.7");

    console.error(`[GLM] Session created: ${session.id}`);

    // Track tool calls and output
    const toolCalls: ToolCallEvent[] = [];
    let textOutput = "";
    let completed = false;

    // Subscribe to events for this session
    const sessionHandler = client.createSessionHandler(session.id, {
      onSessionStatus: (_, status: SessionStatus) => {
        console.error(`[GLM] Status: ${status}`);
        if (status === "idle") {
          completed = true;
        }
      },
      onToolCall: (_, toolCall: ToolCallEvent) => {
        console.error(`[GLM] Tool: ${toolCall.tool} (${toolCall.state})`);
        toolCalls.push(toolCall);

        // Record to database
        recordToolCallWithState(
          taskId,
          toolCall.callId,
          toolCall.tool,
          toolCall.state,
          toolCall.input ? JSON.stringify(toolCall.input) : null,
          toolCall.output || null
        );
      },
      onTextChunk: (_, text: string) => {
        textOutput = text; // Latest full text
      },
      onComplete: () => {
        completed = true;
      },
    });

    const unsubscribe = client.subscribeToEvents(sessionHandler);

    try {
      // Send the prompt
      const prompt = systemPrompt
        ? `${systemPrompt}\n\n---\n\n${task}`
        : `${FOCUSED_TASK_PROMPT}\n\n---\n\n${task}`;

      await client.sendPrompt(session.id, workingDirectory, {
        parts: [{ type: "text", text: prompt }],
        model: {
          providerID: "zai-coding-plan",
          modelID: "glm-4.7",
        },
      });

      console.error(`[GLM] Prompt sent, waiting for completion...`);

      // Wait for completion or timeout
      const startWait = Date.now();
      while (!completed && Date.now() - startWait < timeoutMs) {
        const status = await client.getSessionStatus(session.id, workingDirectory);
        if (status === "idle") {
          completed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      const duration = Date.now() - startTime;

      // Build result summary
      const completedTools = toolCalls.filter((tc) => tc.state === "completed");
      const summary = buildGLMSummary(textOutput, completedTools, duration, completed);

      completeTask(taskId, summary);

      return {
        content: [{ type: "text" as const, text: summary }],
      };
    } finally {
      unsubscribe();
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    failTask(taskId, errorMsg);

    return {
      content: [{ type: "text" as const, text: `GLM Error: ${errorMsg}` }],
      isError: true,
    };
  }
}

function buildGLMSummary(
  textOutput: string,
  toolCalls: ToolCallEvent[],
  duration: number,
  completed: boolean
): string {
  const sections: string[] = [];

  sections.push(`## GLM Execution ${completed ? "Complete" : "Timed Out"}`);
  sections.push(`**Duration:** ${Math.round(duration / 1000)}s`);
  sections.push(`**Tool Calls:** ${toolCalls.length}`);

  if (toolCalls.length > 0) {
    sections.push("\n### Tools Used:");
    for (const tc of toolCalls.slice(-10)) {
      sections.push(`- ${tc.tool}`);
    }
  }

  if (textOutput) {
    sections.push("\n### Output:");
    sections.push(textOutput.substring(0, 2000));
    if (textOutput.length > 2000) {
      sections.push("...(truncated)");
    }
  }

  return sections.join("\n");
}

// Legacy spawn-based execution (kept for fallback)
async function delegateToGLMLegacy(
  task: string,
  workingDirectory: string,
  timeoutMs: number
) {
  const { executeGLM } = await import("../utils/glm.js");

  const prompt = `${task}\n\nDo this now. Create the files.`;
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

// ============================================================================
// Opus Delegation (v2: Claude CLI with stream-json)
// ============================================================================

export async function delegateToOpus(
  task: string,
  workingDirectory: string,
  taskType: TaskType = "plan",
  timeoutMs: number = DEFAULT_OPUS_TIMEOUT
) {
  validateWorkingDirectory(workingDirectory);

  const client = getClaudeClient();
  const startTime = Date.now();
  const taskId = `opus-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Create task record
  createTask(taskId, task.substring(0, 200), task);
  updateTaskSession(taskId, null, "claude-cli", "claude-opus-4-5-20250514");

  const systemPrompt = getSystemPrompt(taskType);

  console.error(`[Opus] Starting ${taskType} task...`);

  try {
    const result = await client.execute(
      task,
      {
        workingDirectory,
        timeout: timeoutMs,
        systemPrompt,
      },
      {
        onToolUse: (tool, input) => {
          console.error(`[Opus] Tool: ${tool}`);
          recordToolCall(taskId, tool, JSON.stringify(input), null, 0);
        },
        onText: (text) => {
          // Could stream to dashboard here
        },
      }
    );

    const duration = Date.now() - startTime;

    // Build summary
    const summary = buildOpusSummary(result, taskType, duration);

    if (result.success) {
      completeTask(taskId, summary);
    } else {
      failTask(taskId, result.output);
    }

    return {
      content: [{ type: "text" as const, text: summary }],
      isError: !result.success,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    failTask(taskId, errorMsg);

    return {
      content: [{ type: "text" as const, text: `Opus Error: ${errorMsg}` }],
      isError: true,
    };
  }
}

function buildOpusSummary(
  result: { success: boolean; output: string; toolCalls: any[]; cost?: number; duration: number },
  taskType: string,
  duration: number
): string {
  const sections: string[] = [];

  sections.push(`## Opus ${taskType.charAt(0).toUpperCase() + taskType.slice(1)} ${result.success ? "Complete" : "Failed"}`);
  sections.push(`**Duration:** ${Math.round(duration / 1000)}s`);
  sections.push(`**Tool Calls:** ${result.toolCalls.length}`);

  if (result.cost) {
    sections.push(`**Cost:** $${result.cost.toFixed(4)}`);
  }

  if (result.output) {
    sections.push("\n### Output:");
    sections.push(result.output);
  }

  return sections.join("\n");
}

// ============================================================================
// Chunk Delegation (uses GLM)
// ============================================================================

export async function delegateChunksToGLM(
  chunks: string[],
  workingDirectory: string,
  specFile?: string,
  timeoutPerChunk: number = DEFAULT_GLM_TIMEOUT
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

  const initialFiles = await getProjectFiles(workingDirectory);

  const results: Array<{
    chunk: string;
    status: "success" | "error" | "timeout";
    output: string;
    duration: number;
  }> = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    const prompt = `## Task ${i + 1}/${chunks.length}

${chunk}

Do this now. Create the files.`;

    try {
      console.error(`\n[Orchestrator] ⏳ Chunk ${i + 1}/${chunks.length} sending...`);

      const startTime = Date.now();
      const result = await delegateToGLM(prompt, workingDirectory, timeoutPerChunk);
      const duration = Date.now() - startTime;

      console.error(`[Orchestrator] ✅ Chunk ${i + 1} done in ${Math.round(duration/1000)}s`);

      results.push({
        chunk: chunk.substring(0, 80) + "...",
        status: "success",
        output: (result.content[0] as any).text?.substring(0, 500) || "",
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

  const finalFiles = await getProjectFiles(workingDirectory);
  const newFiles = finalFiles.filter(f => !initialFiles.includes(f));

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
