export const toolDefinitions = [
  {
    name: "delegate_to_glm",
    description: `Delegate a single coding task to GLM-4.7.

GLM runs as a full Claude Code instance with file access.

Best for small, focused tasks (< 3 minutes):
- Create a single file
- Implement one function
- Fix a specific bug`,
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "A focused task for GLM. Keep it small and specific.",
        },
        workingDirectory: {
          type: "string",
          description: "Absolute path to the project directory",
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
    name: "delegate_chunks_to_glm",
    description: `Execute multiple implementation chunks with GLM, with CONTEXT PASSING between chunks.

**This is the recommended tool for complex implementations.**

How it works:
1. You provide an array of task chunks + optional spec file
2. GLM executes each chunk IN ORDER
3. After each chunk, the orchestrator:
   - Scans for newly created files
   - Passes file list to next chunk
   - Tells next chunk what was already done
4. Results are aggregated and returned

**Context Passing**: Each chunk receives:
- List of files created by previous chunks
- Summary of what previous chunks accomplished
- The spec content (if specFile provided)

Example chunks for a parser:
- Chunk 1: "Create type definitions" → creates types.ts
- Chunk 2: "Implement parser" → knows types.ts exists, imports from it
- Chunk 3: "Add tests" → knows both files exist`,
    inputSchema: {
      type: "object",
      properties: {
        chunks: {
          type: "array",
          items: { type: "string" },
          description:
            "Array of task descriptions. Execute in order - later chunks can depend on earlier ones.",
        },
        workingDirectory: {
          type: "string",
          description: "Absolute path to the project directory",
        },
        specFile: {
          type: "string",
          description:
            "Optional: path to spec file. Content will be available to all chunks for reference.",
        },
        timeoutPerChunk: {
          type: "number",
          description: "Timeout per chunk in milliseconds (default: 180000 = 3 min)",
        },
      },
      required: ["chunks", "workingDirectory"],
    },
  },
  {
    name: "split_spec_into_chunks",
    description: `Analyze a feature spec and suggest how to split it into implementation chunks.

Returns a list of recommended chunks based on the spec structure.
You can then pass these chunks to delegate_chunks_to_glm.`,
    inputSchema: {
      type: "object",
      properties: {
        specFile: {
          type: "string",
          description: "Path to the feature specification file",
        },
      },
      required: ["specFile"],
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
    description: `Start a full feature implementation workflow with proper stage ordering and dependency management.

**This is the BEST tool for implementing features end-to-end.**

The workflow has 4 stages:
1. **Design (Opus)**: Analyze requirements and create architecture
2. **Implement (GLM)**: Build the feature with dependency-aware task execution
3. **Review (Opus)**: Review the implementation for issues
4. **Fix (GLM)**: Fix any issues found

Within each stage, tasks respect dependencies:
- Types are created first
- Utils depend on types
- Core depends on types + utils
- Tests depend on everything else
- Independent tasks (like multiple sections) run IN PARALLEL

Returns workflow ID for continuation.`,
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
    description: `Run the implementation stage of a workflow with proper dependency ordering.

Tasks are executed respecting dependencies:
- Sequential tasks run in order
- Independent tasks run in parallel
- Tests only run after all code is implemented

Provide either a specFile to auto-generate tasks, or custom tasks array.`,
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
    description: `Display the current state of a workflow, showing stages, tasks, and their execution status.`,
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

Returns task IDs that can be used with cancel_glm_task to stop a running task.
Use this to check progress or find tasks to cancel.`,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "cancel_glm_task",
    description: `Cancel a running GLM task by its ID.

Use list_active_glm_tasks to get the task ID.
The task will be terminated gracefully (SIGTERM, then SIGKILL after 2s).`,
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The task ID to cancel (from list_active_glm_tasks)",
        },
      },
      required: ["taskId"],
    },
  },
];
