/**
 * Workflow Engine for Claude + GLM Orchestration
 *
 * Supports:
 * - Sequential stages (design → implement → review → fix)
 * - Dependency-aware task execution within stages
 * - Parallel execution of independent tasks
 */

export interface Task {
  id: string;
  name: string;
  description: string;
  dependsOn: string[];  // Task IDs this depends on
  executor: "opus" | "glm";
  status: "pending" | "running" | "completed" | "failed";
  output?: string;
}

export interface Stage {
  id: string;
  name: string;
  executor: "opus" | "glm";
  tasks: Task[];
}

export interface Workflow {
  id: string;
  name: string;
  stages: Stage[];
  currentStageIndex: number;
  specFile?: string;
  workingDirectory: string;
}

/**
 * Topological sort - returns tasks in execution order respecting dependencies
 */
export function getExecutionOrder(tasks: Task[]): Task[][] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const completed = new Set<string>();
  const batches: Task[][] = [];

  while (completed.size < tasks.length) {
    // Find all tasks whose dependencies are satisfied
    const ready = tasks.filter(t =>
      !completed.has(t.id) &&
      t.dependsOn.every(dep => completed.has(dep))
    );

    if (ready.length === 0 && completed.size < tasks.length) {
      throw new Error("Circular dependency detected in tasks");
    }

    // These can run in parallel
    batches.push(ready);
    ready.forEach(t => completed.add(t.id));
  }

  return batches;
}

/**
 * Create a standard feature implementation workflow
 */
export function createFeatureWorkflow(
  featureName: string,
  workingDirectory: string,
  specFile?: string
): Workflow {
  return {
    id: `workflow-${featureName}-${Date.now()}`,
    name: `Implement ${featureName}`,
    workingDirectory,
    specFile,
    currentStageIndex: 0,
    stages: [
      {
        id: "design",
        name: "Design & Architecture",
        executor: "opus",
        tasks: [
          {
            id: "analyze",
            name: "Analyze Requirements",
            description: "Analyze the codebase and understand requirements",
            dependsOn: [],
            executor: "opus",
            status: "pending"
          },
          {
            id: "design",
            name: "Design Architecture",
            description: "Design the feature architecture and create spec",
            dependsOn: ["analyze"],
            executor: "opus",
            status: "pending"
          }
        ]
      },
      {
        id: "implement",
        name: "Implementation",
        executor: "glm",
        tasks: [] // Will be populated from spec
      },
      {
        id: "review",
        name: "Code Review",
        executor: "opus",
        tasks: [
          {
            id: "review",
            name: "Review Implementation",
            description: "Review the implemented code for issues",
            dependsOn: [],
            executor: "opus",
            status: "pending"
          }
        ]
      },
      {
        id: "fix",
        name: "Fix Issues",
        executor: "glm",
        tasks: [] // Will be populated from review
      }
    ]
  };
}

/**
 * Create implementation tasks from a parsed spec
 */
export function createImplementationTasks(spec: {
  types?: string[];
  utils?: string[];
  core?: string[];
  sections?: string[];
  tests?: string[];
}): Task[] {
  const tasks: Task[] = [];

  // Types - no dependencies, must be first
  if (spec.types && spec.types.length > 0) {
    tasks.push({
      id: "types",
      name: "Create Type Definitions",
      description: `Create type files: ${spec.types.join(", ")}`,
      dependsOn: [],
      executor: "glm",
      status: "pending"
    });
  }

  // Utils - depends on types
  if (spec.utils && spec.utils.length > 0) {
    tasks.push({
      id: "utils",
      name: "Create Utilities",
      description: `Create utility files: ${spec.utils.join(", ")}`,
      dependsOn: ["types"],
      executor: "glm",
      status: "pending"
    });
  }

  // Core - depends on types and utils
  if (spec.core && spec.core.length > 0) {
    tasks.push({
      id: "core",
      name: "Implement Core",
      description: `Create core files: ${spec.core.join(", ")}`,
      dependsOn: ["types", "utils"].filter(d => tasks.some(t => t.id === d)),
      executor: "glm",
      status: "pending"
    });
  }

  // Sections - can be parallel, depend on types
  if (spec.sections && spec.sections.length > 0) {
    // Each section as separate parallel task
    spec.sections.forEach((section, i) => {
      tasks.push({
        id: `section-${i}`,
        name: `Implement ${section}`,
        description: `Create section: ${section}`,
        dependsOn: ["types"],
        executor: "glm",
        status: "pending"
      });
    });
  }

  // Tests - depends on everything else
  if (spec.tests && spec.tests.length > 0) {
    const allOtherTasks = tasks.map(t => t.id);
    tasks.push({
      id: "tests",
      name: "Write Tests",
      description: `Create test files: ${spec.tests.join(", ")}`,
      dependsOn: allOtherTasks,
      executor: "glm",
      status: "pending"
    });
  }

  return tasks;
}

/**
 * Visualize workflow execution plan
 */
export function visualizeWorkflow(workflow: Workflow): string {
  let output = `# Workflow: ${workflow.name}\n\n`;

  workflow.stages.forEach((stage, stageIndex) => {
    const isCurrent = stageIndex === workflow.currentStageIndex;
    const marker = isCurrent ? "→ " : "  ";
    output += `${marker}## Stage ${stageIndex + 1}: ${stage.name} (${stage.executor.toUpperCase()})\n\n`;

    if (stage.tasks.length === 0) {
      output += "   (tasks will be generated)\n\n";
      return;
    }

    const batches = getExecutionOrder(stage.tasks);
    batches.forEach((batch, batchIndex) => {
      if (batch.length > 1) {
        output += `   Batch ${batchIndex + 1} (parallel):\n`;
        batch.forEach(task => {
          const status = task.status === "completed" ? "✅" :
                        task.status === "running" ? "🔄" :
                        task.status === "failed" ? "❌" : "⬚";
          output += `   ${status} ${task.name}\n`;
        });
      } else {
        const task = batch[0];
        const status = task.status === "completed" ? "✅" :
                      task.status === "running" ? "🔄" :
                      task.status === "failed" ? "❌" : "⬚";
        output += `   ${status} ${task.name}\n`;
      }
    });
    output += "\n";
  });

  return output;
}
