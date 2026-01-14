/**
 * POC: Validate opencode HTTP API with github-copilot provider for Opus
 *
 * Run with: npx tsx poc/opencode-opus.ts
 *
 * Prerequisites:
 * - opencode server running (opencode serve)
 * - github-copilot provider configured
 */

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096";
const WORKING_DIR = process.cwd();

interface OpencodeSession {
  id: string;
  title: string;
  directory: string;
}

interface SSEEvent {
  directory?: string;
  payload: {
    type: string;
    properties: Record<string, unknown>;
  };
}

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${OPENCODE_URL}/global/health`);
    if (!res.ok) return false;
    const data = await res.json();
    console.log("✅ Opencode server healthy:", data);
    return true;
  } catch (err) {
    console.error("❌ Opencode server not running at", OPENCODE_URL);
    console.error("   Start it with: opencode serve");
    return false;
  }
}

async function createSession(): Promise<OpencodeSession | null> {
  try {
    const res = await fetch(`${OPENCODE_URL}/session?directory=${encodeURIComponent(WORKING_DIR)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "POC Opus Test Session" }),
    });

    if (!res.ok) {
      console.error("❌ Failed to create session:", await res.text());
      return null;
    }

    const session = await res.json();
    console.log("✅ Session created:", session.id);
    return session;
  } catch (err) {
    console.error("❌ Error creating session:", err);
    return null;
  }
}

async function subscribeToEvents(onEvent: (event: SSEEvent) => void): Promise<AbortController> {
  const controller = new AbortController();

  console.log("📡 Subscribing to SSE events...");

  fetch(`${OPENCODE_URL}/global/event`, {
    signal: controller.signal,
    headers: { Accept: "text/event-stream" },
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      console.error("❌ Failed to subscribe to events");
      return;
    }

    console.log("✅ Connected to event stream");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6)) as SSEEvent;
            onEvent(event);
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== "AbortError") {
      console.error("❌ Event stream error:", err);
    }
  });

  return controller;
}

async function sendPrompt(sessionId: string, prompt: string): Promise<void> {
  console.log(`\n📤 Sending prompt to session ${sessionId}...`);
  console.log(`   Prompt: "${prompt.substring(0, 50)}..."`);
  console.log(`   Provider: github-copilot / claude-opus-4.5`);

  try {
    const res = await fetch(
      `${OPENCODE_URL}/session/${sessionId}/prompt_async?directory=${encodeURIComponent(WORKING_DIR)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [{ type: "text", text: prompt }],
          model: {
            providerID: "github-copilot",
            modelID: "claude-opus-4.5",
          },
        }),
      }
    );

    if (res.status === 204) {
      console.log("✅ Prompt accepted (async)");
    } else {
      const text = await res.text();
      console.error("❌ Failed to send prompt:", res.status, text);
    }
  } catch (err) {
    console.error("❌ Error sending prompt:", err);
  }
}

function handleEvent(event: SSEEvent): void {
  const { type, properties } = event.payload;

  switch (type) {
    case "server.connected":
      console.log("🔗 Server connected");
      break;

    case "session.status":
      const status = properties.status as { type: string };
      console.log(`📊 Session status: ${status.type}`);
      break;

    case "message.updated":
      console.log(`💬 Message updated`);
      break;

    case "message.part.updated":
      const part = properties.part as { type: string; tool?: string; state?: unknown; text?: string };
      if (part.type === "tool") {
        console.log(`🔧 Tool call: ${part.tool} - state: ${JSON.stringify(part.state)}`);
      } else if (part.type === "text") {
        const text = part.text || "";
        if (text.length > 0) {
          console.log(`📝 Text: "${text.substring(0, 80)}${text.length > 80 ? "..." : ""}"`);
        }
      } else if (part.type === "reasoning") {
        console.log(`🧠 Reasoning...`);
      }
      break;

    case "file.edited":
      const file = properties as { path?: string };
      console.log(`📁 File edited: ${file.path}`);
      break;

    case "session.idle":
      console.log(`✅ Session idle (complete)`);
      break;

    case "session.error":
      console.log(`❌ Session error: ${JSON.stringify(properties)}`);
      break;

    default:
      if (!["server.heartbeat", "session.created", "session.updated", "session.diff"].includes(type)) {
        console.log(`📨 Event: ${type}`);
      }
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("POC: Opencode HTTP API + SSE (Opus via github-copilot)");
  console.log("=".repeat(60));
  console.log(`Server: ${OPENCODE_URL}`);
  console.log(`Working dir: ${WORKING_DIR}`);
  console.log("");

  // Step 1: Check health
  const healthy = await checkHealth();
  if (!healthy) {
    process.exit(1);
  }

  // Step 2: Subscribe to events FIRST
  const eventController = await subscribeToEvents(handleEvent);
  await new Promise((r) => setTimeout(r, 500));

  // Step 3: Create session
  const session = await createSession();
  if (!session) {
    eventController.abort();
    process.exit(1);
  }

  // Step 4: Send prompt with github-copilot/opus
  const testPrompt = `Read the file package.json and tell me the project name and version. Be very brief, just respond with "name vX.Y.Z" format.`;
  await sendPrompt(session.id, testPrompt);

  // Step 5: Wait for completion
  console.log("\n⏳ Waiting for completion (60s timeout)...\n");

  let completed = false;
  const startTime = Date.now();

  while (!completed && Date.now() - startTime < 60000) {
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Give extra time for final events
  await new Promise((r) => setTimeout(r, 2000));

  eventController.abort();

  console.log("\n" + "=".repeat(60));
  console.log("POC completed - check events above for results");
  console.log("=".repeat(60));
}

main().catch(console.error);
