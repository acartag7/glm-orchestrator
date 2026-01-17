import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import {
  Workflow,
  Task,
  Stage,
  createFeatureWorkflow,
  createImplementationTasks,
  visualizeWorkflow,
  getExecutionOrder,
} from "../workflow.js";
import { executeStage } from "../execution/stage.js";

const MAX_WORKFLOWS = 100;
const WORKFLOW_TTL_MS = 24 * 60 * 60 * 1000;

type StoredWorkflow = {
  workflow: Workflow;
  createdAt: number;
};

const activeWorkflows = new Map<string, StoredWorkflow>();

function cleanupOldWorkflows() {
  const now = Date.now();
  const entries = Array.from(activeWorkflows.entries());

  entries.forEach(([id, stored]) => {
    const age = now - stored.createdAt;
    if (age > WORKFLOW_TTL_MS) {
      activeWorkflows.delete(id);
    }
  });

  if (activeWorkflows.size > MAX_WORKFLOWS) {
    const sortedEntries = entries
      .sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toRemove = sortedEntries.slice(0, activeWorkflows.size - MAX_WORKFLOWS);
    toRemove.forEach(([id]) => activeWorkflows.delete(id));
  }
}

export function getWorkflow(id: string): Workflow | undefined {
  return activeWorkflows.get(id)?.workflow;
}



export function getAllWorkflowIds(): string[] {
  return Array.from(activeWorkflows.keys());
}

export async function startFeatureWorkflow(
  featureName: string,
  workingDirectory: string,
  specFile?: string
) {
  const workflow = createFeatureWorkflow(featureName, workingDirectory, specFile);
  cleanupOldWorkflows();
  activeWorkflows.set(workflow.id, { workflow, createdAt: Date.now() });

  const handoffDir = join(workingDirectory, ".handoff");
  if (!existsSync(handoffDir)) {
    await mkdir(handoffDir, { recursive: true });
  }
  await writeFile(
    join(handoffDir, `workflow-${workflow.id}.json`),
    JSON.stringify(workflow, null, 2),
    "utf-8"
  );

  const visualization = visualizeWorkflow(workflow);

  return {
    content: [
      {
        type: "text" as const,
        text: `## Feature Workflow Created

**Workflow ID**: \`${workflow.id}\`

${visualization}

**Next Step**: Complete the Design stage tasks (Opus), then call \`run_implementation_stage\` to execute implementation with GLM.`,
      },
    ],
  };
}

export async function runImplementationStage(
  workingDirectory: string,
  specFile?: string,
  customTasks?: Array<{
    id: string;
    name: string;
    description: string;
    dependsOn?: string[];
  }>
) {
  let specContent: string | undefined;
  if (specFile) {
    try {
      specContent = await readFile(specFile, "utf-8");
    } catch (e) {
      console.error(`[Specwright] Could not read spec: ${e}`);
    }
  }

  let tasks: Task[];
  if (customTasks && customTasks.length > 0) {
    tasks = customTasks.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      dependsOn: t.dependsOn || [],
      executor: "glm" as const,
      status: "pending" as const,
    }));
  } else if (specContent) {
    const spec: {
      types?: string[];
      utils?: string[];
      core?: string[];
      sections?: string[];
      tests?: string[];
    } = {};

    const typeMatches = specContent.match(/types?\.ts|\.types\.ts/gi);
    if (typeMatches) spec.types = [...new Set(typeMatches)];

    const utilMatches = specContent.match(/util[s]?\.ts|helper[s]?\.ts/gi);
    if (utilMatches) spec.utils = [...new Set(utilMatches)];

    const testMatches = specContent.match(/\.test\.ts|\.spec\.ts/gi);
    if (testMatches) spec.tests = [...new Set(testMatches)];

    const sectionMatches = specContent.match(/^##\s+(.+)$/gm);
    if (sectionMatches) {
      spec.sections = sectionMatches
        .map((s) => s.replace(/^##\s+/, ""))
        .filter(
          (s) =>
            !s.toLowerCase().includes("type") &&
            !s.toLowerCase().includes("test") &&
            !s.toLowerCase().includes("overview")
        )
        .slice(0, 5);
    }

    tasks = createImplementationTasks(spec);
  } else {
    tasks = [
      {
        id: "implement",
        name: "Implement Feature",
        description: "Implement the full feature",
        dependsOn: [],
        executor: "glm",
        status: "pending",
      },
    ];
  }

  const stage: Stage = {
    id: "implement",
    name: "Implementation",
    executor: "glm",
    tasks,
  };

  const workflow: Workflow = {
    id: `impl-${Date.now()}`,
    name: "Implementation Stage",
    stages: [stage],
    currentStageIndex: 0,
    workingDirectory,
  };

  console.error(
    `[Specwright] Starting implementation with ${tasks.length} tasks`
  );

  const batches = getExecutionOrder(tasks);
  let planOutput = `## Execution Plan\n\n`;
  batches.forEach((batch, i) => {
    if (batch.length > 1) {
      planOutput += `**Batch ${i + 1}** (parallel): ${batch.map((t) => t.name).join(", ")}\n`;
    } else {
      planOutput += `**Batch ${i + 1}**: ${batch[0].name}\n`;
    }
  });
  planOutput += `\n---\n\n`;

  const { failed } = await executeStage(stage, workflow, specContent);

  let output = planOutput;
  output += `## Execution Results\n\n`;

  const successful = tasks.filter((t) => t.status === "completed").length;
  const failedCount = tasks.filter((t) => t.status === "failed").length;

  output += `**Completed**: ${successful}/${tasks.length}\n`;
  if (failedCount > 0) {
    output += `**Failed**: ${failedCount}\n`;
  }
  output += `\n`;

  for (const task of tasks) {
    const icon =
      task.status === "completed"
        ? "✅"
        : task.status === "failed"
          ? "❌"
          : "⬚";
    output += `### ${icon} ${task.name}\n`;
    if (task.output) {
      output += `${task.output.substring(0, 500)}\n`;
    }
    output += "\n";
  }

  if (failed.length > 0) {
    output += `\n**Some tasks failed. Review the errors above.**\n`;
  } else {
    output += `\n**All tasks completed successfully!**\n`;
  }

  return {
    content: [{ type: "text" as const, text: output }],
  };
}

export function visualizeWorkflowTool(workflowId: string) {
  const stored = activeWorkflows.get(workflowId);
  if (!stored) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Workflow not found: ${workflowId}\n\nActive workflows: ${Array.from(activeWorkflows.keys()).join(", ") || "none"}`,
        },
      ],
    };
  }

  const visualization = visualizeWorkflow(stored.workflow);
  return {
    content: [{ type: "text" as const, text: visualization }],
  };
}
