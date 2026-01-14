export interface ChunkResult {
  chunk: string;
  status: "success" | "error" | "timeout";
  output: string;
  duration: number;
}

export function buildContext(
  previousResults: ChunkResult[],
  filesCreated: string[],
  specContent?: string
): string {
  let context = "";

  if (specContent) {
    context += `## Feature Specification (reference)
The full spec is available. Key points to remember from it.

`;
  }

  if (filesCreated.length > 0) {
    context += `## Files Already Created
These files exist from previous chunks - you can import from them:
${filesCreated.map((f) => `- ${f}`).join("\n")}

`;
  }

  if (previousResults.length > 0) {
    const successful = previousResults.filter((r) => r.status === "success");
    if (successful.length > 0) {
      context += `## What Was Done in Previous Chunks
${successful.map((r, i) => `- Chunk ${i + 1}: ${r.chunk}`).join("\n")}

`;
    }
  }

  return context;
}
