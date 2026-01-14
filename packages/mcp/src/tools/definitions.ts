/**
 * MCP Tool Definitions for GLM Orchestrator v2
 */

export const toolDefinitions = [
  {
    name: "delegate_to_glm",
    description: `Delegate a coding task to GLM-4.7 with real-time progress tracking.

GLM runs as a full Claude Code instance with file access via opencode.

Best for implementation tasks:
- Create files and implement features
- Fix bugs and refactor code
- Any coding task that needs file access

Progress is tracked via SSE events for real-time visibility.`,
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Task description for GLM",
        },
        workingDirectory: {
          type: "string",
          description: "Absolute path to the project directory",
        },
        systemPrompt: {
          type: "string",
          description: "Optional custom system prompt",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds (default: 180000 = 3 min)",
        },
      },
      required: ["task", "workingDirectory"],
    },
  },
  {
    name: "delegate_to_opus",
    description: `Delegate planning/review tasks to Claude Opus 4.5.

Best for tasks requiring strong reasoning:
- **plan**: Architecture planning and design decisions
- **spec**: Writing detailed implementation specifications
- **review**: Code review for quality and security
- **security-review**: Security-focused code audit

Opus provides thoughtful analysis and recommendations.`,
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Task description for Opus",
        },
        workingDirectory: {
          type: "string",
          description: "Absolute path to the project directory",
        },
        taskType: {
          type: "string",
          enum: ["plan", "review", "security-review", "spec"],
          description: "Type of task (determines system prompt)",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds (default: 300000 = 5 min)",
        },
      },
      required: ["task", "workingDirectory"],
    },
  },
  {
    name: "delegate_chunks_to_glm",
    description: `Execute multiple implementation chunks with GLM sequentially.

How it works:
1. You provide an array of task chunks + optional spec file
2. GLM executes each chunk IN ORDER
3. Results are aggregated and returned

Example chunks for a parser:
- Chunk 1: "Create type definitions" → creates types.ts
- Chunk 2: "Implement parser" → knows types.ts exists
- Chunk 3: "Add tests" → knows both files exist`,
    inputSchema: {
      type: "object",
      properties: {
        chunks: {
          type: "array",
          items: { type: "string" },
          description: "Array of task descriptions. Execute in order.",
        },
        workingDirectory: {
          type: "string",
          description: "Absolute path to the project directory",
        },
        specFile: {
          type: "string",
          description: "Optional: path to spec file for reference",
        },
        timeoutPerChunk: {
          type: "number",
          description: "Timeout per chunk in milliseconds (default: 180000)",
        },
      },
      required: ["chunks", "workingDirectory"],
    },
  },
  {
    name: "write_spec",
    description: `Write a feature specification to the handoff directory.`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Feature name (used in filename)",
        },
        spec: {
          type: "string",
          description: "Full feature specification in markdown",
        },
        workingDirectory: {
          type: "string",
          description: "Project directory",
        },
      },
      required: ["name", "spec", "workingDirectory"],
    },
  },
  {
    name: "write_review",
    description: `Write code review findings to the handoff directory.`,
    inputSchema: {
      type: "object",
      properties: {
        findings: {
          type: "string",
          description: "Review findings in markdown",
        },
        workingDirectory: {
          type: "string",
          description: "Project directory",
        },
      },
      required: ["findings", "workingDirectory"],
    },
  },
  {
    name: "start_feature_workflow",
    description: `Start a full feature implementation workflow.

The workflow has 4 stages:
1. **Design (Opus)**: Analyze requirements and create architecture
2. **Implement (GLM)**: Build the feature
3. **Review (Opus)**: Review the implementation
4. **Fix (GLM)**: Fix any issues found

Returns workflow ID for tracking.`,
    inputSchema: {
      type: "object",
      properties: {
        featureName: {
          type: "string",
          description: "Name of the feature to implement",
        },
        workingDirectory: {
          type: "string",
          description: "Absolute path to the project directory",
        },
        specFile: {
          type: "string",
          description: "Optional: path to existing spec file",
        },
      },
      required: ["featureName", "workingDirectory"],
    },
  },
  {
    name: "run_implementation_stage",
    description: `Run the implementation stage with dependency ordering.

Tasks are executed respecting dependencies. Provide either a specFile to auto-generate tasks, or custom tasks array.`,
    inputSchema: {
      type: "object",
      properties: {
        workingDirectory: {
          type: "string",
          description: "Absolute path to the project directory",
        },
        specFile: {
          type: "string",
          description: "Path to spec file (will auto-generate tasks)",
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string" },
              dependsOn: {
                type: "array",
                items: { type: "string" },
                description: "IDs of tasks this depends on",
              },
            },
            required: ["id", "name", "description"],
          },
          description: "Custom task list with dependencies",
        },
      },
      required: ["workingDirectory"],
    },
  },
  {
    name: "visualize_workflow",
    description: `Display the current state of a workflow.`,
    inputSchema: {
      type: "object",
      properties: {
        workflowId: {
          type: "string",
          description: "Workflow ID to visualize",
        },
      },
      required: ["workflowId"],
    },
  },
  {
    name: "list_active_glm_tasks",
    description: `List all currently running GLM tasks.

Returns task IDs that can be used with cancel_glm_task.`,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "cancel_glm_task",
    description: `Cancel a running GLM task by its ID.

Use list_active_glm_tasks to get the task ID.`,
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The task ID to cancel",
        },
      },
      required: ["taskId"],
    },
  },
];
