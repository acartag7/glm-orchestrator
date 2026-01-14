/**
 * POC: Validate Claude CLI stream-json output for Opus tasks
 *
 * Run with: npx tsx poc/claude-cli-opus.ts
 *
 * Tests: claude -p --output-format stream-json
 */

import { spawn } from "child_process";
import { createInterface } from "readline";

const WORKING_DIR = process.cwd();

interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  // Different fields based on type
  [key: string]: unknown;
}

async function executeClaudeOpus(prompt: string): Promise<void> {
  console.log("=".repeat(60));
  console.log("POC: Claude CLI stream-json (Opus)");
  console.log("=".repeat(60));
  console.log(`Working dir: ${WORKING_DIR}`);
  console.log(`Prompt: "${prompt.substring(0, 50)}..."`);
  console.log("");

  const startTime = Date.now();

  const proc = spawn("claude", [
    "-p", prompt,
    "--output-format", "stream-json",
    "--model", "claude-opus-4-5-20250514"
  ], {
    cwd: WORKING_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });

  console.log("📡 Started Claude CLI process...\n");

  // Parse NDJSON from stdout
  const rl = createInterface({ input: proc.stdout! });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const event = JSON.parse(line) as ClaudeStreamEvent;
      handleEvent(event);
    } catch (err) {
      console.log(`⚠️ Parse error: ${line.substring(0, 100)}`);
    }
  }

  // Handle stderr
  let stderr = "";
  proc.stderr?.on("data", (data) => {
    stderr += data.toString();
  });

  await new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => {
      const duration = Date.now() - startTime;
      console.log("\n" + "=".repeat(60));
      if (code === 0) {
        console.log(`✅ POC SUCCESS - Completed in ${Math.round(duration / 1000)}s`);
      } else {
        console.log(`❌ POC FAILED - Exit code ${code}`);
        if (stderr) console.log(`Stderr: ${stderr}`);
      }
      console.log("=".repeat(60));
      resolve();
    });

    proc.on("error", (err) => {
      console.error("❌ Process error:", err);
      reject(err);
    });
  });
}

function handleEvent(event: ClaudeStreamEvent): void {
  const { type, subtype } = event;

  switch (type) {
    case "system":
      console.log(`🔧 System: ${subtype}`);
      break;

    case "assistant":
      if (subtype === "message_start") {
        console.log("💬 Assistant message started");
      } else if (subtype === "content_block_start") {
        const blockType = (event as any).content_block?.type;
        console.log(`📦 Content block: ${blockType}`);
      } else if (subtype === "content_block_delta") {
        const delta = (event as any).delta;
        if (delta?.type === "text_delta") {
          const text = delta.text || "";
          if (text.length > 0) {
            process.stdout.write(`📝 `);
            process.stdout.write(text.substring(0, 80));
            if (text.length > 80) process.stdout.write("...");
            process.stdout.write("\n");
          }
        } else if (delta?.type === "thinking_delta") {
          console.log("🧠 Thinking...");
        }
      } else if (subtype === "content_block_stop") {
        console.log("📦 Content block complete");
      } else if (subtype === "message_delta") {
        console.log("💬 Message delta");
      } else if (subtype === "message_stop") {
        console.log("💬 Message complete");
      }
      break;

    case "tool_use":
      const toolName = (event as any).tool?.name || (event as any).name || "unknown";
      console.log(`🔧 Tool use: ${toolName}`);
      break;

    case "tool_result":
      const result = (event as any).result || (event as any).output;
      const preview = typeof result === "string"
        ? result.substring(0, 100)
        : JSON.stringify(result).substring(0, 100);
      console.log(`📤 Tool result: ${preview}...`);
      break;

    case "result":
      console.log("✅ Final result received");
      if ((event as any).cost_usd) {
        console.log(`💰 Cost: $${(event as any).cost_usd}`);
      }
      break;

    case "error":
      console.log(`❌ Error: ${(event as any).error?.message || JSON.stringify(event)}`);
      break;

    default:
      // Log unknown events for debugging
      console.log(`📨 Event: ${type}${subtype ? `.${subtype}` : ""}`);
  }
}

// Run POC
const testPrompt = `Read the file package.json and tell me the project name and version. Be very brief, just respond with "name vX.Y.Z" format.`;

executeClaudeOpus(testPrompt).catch(console.error);
