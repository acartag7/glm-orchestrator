import { z } from "zod";

export const DelegateInputSchema = z.object({
  task: z.string().min(1).max(50000),
  workingDirectory: z.string(),
  timeoutMs: z.number().int().min(1000).max(600000).default(180000)
});

export type DelegateInput = z.infer<typeof DelegateInputSchema>;

export const ChunksInputSchema = z.object({
  chunks: z.array(z.string().min(1).max(50000)).min(1).max(20),
  workingDirectory: z.string(),
  specFile: z.string().optional(),
  timeoutPerChunk: z.number().int().min(1000).max(600000)
});

export type ChunksInput = z.infer<typeof ChunksInputSchema>;

export const WorkflowInputSchema = z.object({
  featureName: z.string().min(1).max(500),
  workingDirectory: z.string(),
  specFile: z.string().optional()
});

export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(50000),
  dependsOn: z.array(z.string()).default([]),
  executor: z.enum(["opus", "glm"]),
  status: z.enum(["pending", "running", "completed", "failed"]).default("pending"),
  output: z.string().optional()
});

export type Task = z.infer<typeof TaskSchema>;

export const ImplementationInputSchema = z.object({
  workingDirectory: z.string(),
  specFile: z.string().optional(),
  customTasks: z.array(z.object({
    id: z.string(),
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(50000),
    dependsOn: z.array(z.string()).optional()
  })).optional()
});

export type ImplementationInput = z.infer<typeof ImplementationInputSchema>;
