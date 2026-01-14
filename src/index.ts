import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { toolDefinitions } from "./tools/definitions.js";
import { delegateToGLM, delegateChunksToGLM } from "./tools/delegate.js";
import { splitSpecIntoChunks, writeSpec, writeReview } from "./tools/spec.js";
import { cancelGLM, getActiveTaskIds } from "./utils/glm.js";
import {
  startFeatureWorkflow,
  runImplementationStage,
  visualizeWorkflowTool,
} from "./tools/workflow.js";
import {
  DelegateInputSchema,
  ChunksInputSchema,
  WorkflowInputSchema,
  ImplementationInputSchema,
} from "./utils/validation.js";
import { registerServer, startHeartbeat } from "./lib/db.js";

const server = new Server(
  { name: "glm-orchestrator", version: "3.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "delegate_to_glm": {
        const parsed = DelegateInputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            content: [{ type: "text", text: `Validation error: ${parsed.error}` }],
            isError: true,
          };
        }
        const { task, workingDirectory, timeoutMs } = parsed.data;
        return delegateToGLM(task, workingDirectory, timeoutMs);
      }

      case "delegate_chunks_to_glm": {
        const parsed = ChunksInputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            content: [{ type: "text", text: `Validation error: ${parsed.error}` }],
            isError: true,
          };
        }
        const { chunks, workingDirectory, specFile, timeoutPerChunk } = parsed.data;
        return delegateChunksToGLM(chunks, workingDirectory, specFile, timeoutPerChunk);
      }

      case "split_spec_into_chunks": {
        const { specFile } = args as { specFile: string };
        return splitSpecIntoChunks(specFile);
      }

      case "write_spec": {
        const { name: featureName, spec, workingDirectory } = args as {
          name: string;
          spec: string;
          workingDirectory: string;
        };
        return writeSpec(featureName, spec, workingDirectory);
      }

      case "write_review": {
        const { findings, workingDirectory } = args as {
          findings: string;
          workingDirectory: string;
        };
        return writeReview(findings, workingDirectory);
      }

      case "start_feature_workflow": {
        const parsed = WorkflowInputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            content: [{ type: "text", text: `Validation error: ${parsed.error}` }],
            isError: true,
          };
        }
        const { featureName, workingDirectory, specFile } = parsed.data;
        return startFeatureWorkflow(featureName, workingDirectory, specFile);
      }

      case "run_implementation_stage": {
        const parsed = ImplementationInputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            content: [{ type: "text", text: `Validation error: ${parsed.error}` }],
            isError: true,
          };
        }
        const { workingDirectory, specFile, customTasks: tasks } = parsed.data;
        return runImplementationStage(workingDirectory, specFile, tasks);
      }

      case "visualize_workflow": {
        const { workflowId } = args as { workflowId: string };
        return visualizeWorkflowTool(workflowId);
      }

      case "list_active_glm_tasks": {
        const taskIds = getActiveTaskIds();
        if (taskIds.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No active GLM tasks running."
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: `**Active GLM Tasks (${taskIds.length}):**\n\n${taskIds.map(id => `- \`${id}\``).join("\n")}\n\nUse cancel_glm_task with a task ID to stop it.`
          }],
        };
      }

      case "cancel_glm_task": {
        const { taskId } = args as { taskId: string };
        const cancelled = cancelGLM(taskId);
        if (cancelled) {
          return {
            content: [{
              type: "text",
              text: `✅ Task \`${taskId}\` has been cancelled.`
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: `❌ Task \`${taskId}\` not found. It may have already completed.\n\nUse list_active_glm_tasks to see running tasks.`
          }],
          isError: true,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error}` }],
      isError: true,
    };
  }
});

async function main() {
  // Register this server instance with the dashboard DB
  const serverId = registerServer(process.cwd());
  startHeartbeat();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`GLM Orchestrator MCP server v3.0 running (${serverId})`);
}

main().catch(console.error);
