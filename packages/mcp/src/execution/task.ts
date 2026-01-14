import { Task, Workflow } from "../workflow.js";
import { executeGLM } from "../utils/glm.js";

export async function executeTask(
  task: Task,
  workflow: Workflow,
  specContent?: string
): Promise<{ output: string; duration: number }> {
  const startTime = Date.now();

  if (task.executor === "opus") {
    return {
      output: `[OPUS TASK] This task should be executed by Claude Opus:\n\nTask: ${task.name}\nDescription: ${task.description}\n\nPlease complete this task and then call continue_workflow to proceed.`,
      duration: Date.now() - startTime,
    };
  }

  // Simple prompt without spec context - let GLM focus on the task
  const prompt = `## Task: ${task.name}

${task.description}

Do this now. Create the files.`;

  return executeGLM(prompt, workflow.workingDirectory, { timeoutMs: 180000 });
}
