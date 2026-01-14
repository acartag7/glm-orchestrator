/**
 * System prompts for different task types
 */

export * from "./implementation.js";
export * from "./review.js";
export * from "./spec.js";

import { IMPLEMENTATION_PROMPT, FOCUSED_TASK_PROMPT } from "./implementation.js";
import { REVIEW_PROMPT, SECURITY_REVIEW_PROMPT } from "./review.js";
import { SPEC_PROMPT, PLANNING_PROMPT } from "./spec.js";

export type TaskType = "implement" | "review" | "security-review" | "spec" | "plan" | "focused";

/**
 * Get the appropriate system prompt for a task type
 */
export function getSystemPrompt(taskType: TaskType): string {
  switch (taskType) {
    case "implement":
      return IMPLEMENTATION_PROMPT;
    case "review":
      return REVIEW_PROMPT;
    case "security-review":
      return SECURITY_REVIEW_PROMPT;
    case "spec":
      return SPEC_PROMPT;
    case "plan":
      return PLANNING_PROMPT;
    case "focused":
    default:
      return FOCUSED_TASK_PROMPT;
  }
}
