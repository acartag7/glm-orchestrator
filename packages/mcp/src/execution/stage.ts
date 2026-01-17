import { Stage, Workflow, getExecutionOrder } from "../workflow.js";
import { executeTask } from "./task.js";

export async function executeStage(
  stage: Stage,
  workflow: Workflow,
  specContent?: string
): Promise<{ results: Map<string, string>; failed: string[] }> {
  const results = new Map<string, string>();
  const failed: string[] = [];

  if (stage.tasks.length === 0) {
    return { results, failed };
  }

  const batches = getExecutionOrder(stage.tasks);

  for (const batch of batches) {
    console.error(
      `[Specwright] Executing batch of ${batch.length} task(s): ${batch.map((t) => t.name).join(", ")}`
    );

    const batchPromises = batch.map(async (task) => {
      task.status = "running";
      try {
        const result = await executeTask(task, workflow, specContent);
        task.status = "completed";
        task.output = result.output;
        return { taskId: task.id, success: true, output: result.output };
      } catch (error) {
        task.status = "failed";
        const errorMsg = error instanceof Error ? error.message : String(error);
        task.output = errorMsg;
        return { taskId: task.id, success: false, output: errorMsg };
      }
    });

    const batchResults = await Promise.all(batchPromises);

    for (const result of batchResults) {
      results.set(result.taskId, result.output);
      if (!result.success) {
        failed.push(result.taskId);
      }
    }

    if (failed.length > 0) {
      console.error(
        `[Specwright] Stopping stage execution due to failed tasks: ${failed.join(", ")}`
      );
      break;
    }
  }

  return { results, failed };
}
