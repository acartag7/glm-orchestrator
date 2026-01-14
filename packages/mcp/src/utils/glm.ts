import { spawn, ChildProcess } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { validateWorkingDirectory, PathValidationError } from "./paths.js";
import { createTask, completeTask, failTask, recordToolCall } from "../lib/db.js";

export interface GLMResult {
  output: string;
  duration: number;
}

export interface GLMOptions {
  timeoutMs?: number;
  onProgress?: (chunk: string, elapsed: number) => void;
  progressFile?: string;  // Path to write streaming progress
  silent?: boolean;       // Suppress stderr streaming
}

const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB

// Track active processes for cancellation
const activeProcesses = new Map<string, ChildProcess>();

export function cancelGLM(taskId: string): boolean {
  const proc = activeProcesses.get(taskId);
  if (proc) {
    proc.kill("SIGTERM");
    setTimeout(() => proc.kill("SIGKILL"), 2000);
    activeProcesses.delete(taskId);
    return true;
  }
  return false;
}

export function getActiveTaskIds(): string[] {
  return Array.from(activeProcesses.keys());
}

export async function executeGLM(
  task: string,
  workingDirectory: string,
  options: GLMOptions = {}
): Promise<GLMResult> {
  const {
    timeoutMs = 300000,
    onProgress,
    progressFile,
    silent = false
  } = options;

  const startTime = Date.now();
  const taskId = `glm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    validateWorkingDirectory(workingDirectory);
  } catch (err) {
    if (err instanceof PathValidationError) {
      return Promise.reject(err);
    }
    throw err;
  }

  // Setup progress file if requested
  if (progressFile) {
    const dir = join(workingDirectory, ".handoff");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(progressFile, `[${new Date().toISOString()}] Starting GLM task: ${taskId}\n`);
  }

  const logProgress = (message: string) => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const line = `[${elapsed}s] ${message}`;

    if (!silent) {
      process.stderr.write(`\x1b[36m${line}\x1b[0m\n`);  // Cyan color
    }

    if (progressFile) {
      try {
        writeFileSync(progressFile, line + "\n", { flag: "a" });
      } catch { /* ignore */ }
    }

    if (onProgress) {
      onProgress(message, elapsed);
    }
  };

  return new Promise((resolve, reject) => {
    const proc = spawn("opencode", ["run", "-m", "zai-coding-plan/glm-4.7", "--title", "glm-task", task], {
      cwd: workingDirectory,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    activeProcesses.set(taskId, proc);
    logProgress(`Task started (ID: ${taskId})`);

    // Record task in DB
    createTask(taskId, task.substring(0, 200), task);

    let stdout = "";
    let stderr = "";
    let totalOutputSize = 0;
    let lastProgressLine = "";

    const cleanup = () => {
      activeProcesses.delete(taskId);
    };

    const timer = setTimeout(() => {
      logProgress("⏱️ Timeout reached, terminating...");
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5000);

      cleanup();
      if (stdout.length > 0) {
        const duration = Date.now() - startTime;
        resolve({ output: stdout, duration });
      } else {
        reject(new Error(`GLM execution timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    proc.stdout?.on("data", (data) => {
      totalOutputSize += data.length;
      if (totalOutputSize > MAX_OUTPUT_SIZE) {
        logProgress("⚠️ Output limit reached, terminating...");
        proc.kill("SIGTERM");
        return;
      }

      const chunk = data.toString();
      stdout += chunk;

      // Extract meaningful progress from output
      const lines = chunk.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        // Look for tool usage, file creation, etc.
        if (line.includes("Tool:") || line.includes("Created") ||
            line.includes("Writing") || line.includes("Reading") ||
            line.includes("✓") || line.includes("✗") ||
            line.includes("Error") || line.includes("error")) {
          if (line !== lastProgressLine) {
            lastProgressLine = line;
            logProgress(line.substring(0, 100));
          }
        }
      }
    });

    proc.stderr?.on("data", (data) => {
      totalOutputSize += data.length;
      if (totalOutputSize > MAX_OUTPUT_SIZE) {
        proc.kill("SIGTERM");
        return;
      }
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      cleanup();
      const duration = Date.now() - startTime;
      logProgress(`Completed in ${Math.round(duration / 1000)}s (exit: ${code})`);

      if (code === 0 || stdout.length > 0) {
        completeTask(taskId, stdout || "Task completed");
        resolve({ output: stdout || "Task completed", duration });
      } else {
        const errorMsg = `GLM exited with code ${code}: ${stderr}`;
        failTask(taskId, errorMsg);
        reject(new Error(errorMsg));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      cleanup();
      logProgress(`Error: ${err.message}`);
      failTask(taskId, err.message);
      reject(err);
    });
  });
}
