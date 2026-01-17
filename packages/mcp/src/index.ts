/**
 * Specwright MCP Server v4
 *
 * Delegates coding tasks to GLM-4.7 (via opencode HTTP API)
 * and planning/review tasks to Opus (via Claude CLI)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { toolDefinitions } from "./tools/definitions.js";
import { delegateToGLM, delegateToOpus, delegateChunksToGLM } from "./tools/delegate.js";
import { writeSpec, writeReview } from "./tools/spec.js";
import { cancelGLM, getActiveTaskIds } from "./utils/glm.js";
import {
  startFeatureWorkflow,
  runImplementationStage,
  visualizeWorkflowTool,
} from "./tools/workflow.js";
import {
  DelegateInputSchema,
  DelegateOpusInputSchema,
  ChunksInputSchema,
  WorkflowInputSchema,
  ImplementationInputSchema,
} from "./utils/validation.js";
import { registerServer, startHeartbeat } from "./lib/db.js";

const server = new Server(
  { name: "specwright", version: "4.0.0" },
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
        const { task, workingDirectory, systemPrompt, timeoutMs } = parsed.data;
        return delegateToGLM(task, workingDirectory, timeoutMs, systemPrompt);
      }

      case "delegate_to_opus": {
        const parsed = DelegateOpusInputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            content: [{ type: "text", text: `Validation error: ${parsed.error}` }],
            isError: true,
          };
        }
        const { task, workingDirectory, taskType, timeoutMs } = parsed.data;
        return delegateToOpus(task, workingDirectory, taskType, timeoutMs);
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
  console.error(`Specwright MCP server v4.0 running (${serverId})`);
}

main().catch(console.error);
