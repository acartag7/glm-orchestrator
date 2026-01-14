/**
 * Spec and review file writing tools
 */

import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

export async function writeSpec(
  featureName: string,
  spec: string,
  workingDirectory: string
) {
  const handoffDir = join(workingDirectory, ".handoff");
  if (!existsSync(handoffDir)) {
    await mkdir(handoffDir, { recursive: true });
  }

  const specPath = join(handoffDir, `feature-${featureName}.md`);
  await writeFile(specPath, spec, "utf-8");

  return {
    content: [
      {
        type: "text" as const,
        text: `Spec written to: ${specPath}

**Next steps:**
1. Use \`delegate_to_opus\` with taskType="spec" to refine the spec if needed
2. Use \`delegate_chunks_to_glm\` with chunks for implementation
3. Use \`delegate_to_opus\` with taskType="review" after implementation`,
      },
    ],
  };
}

export async function writeReview(findings: string, workingDirectory: string) {
  const handoffDir = join(workingDirectory, ".handoff");
  if (!existsSync(handoffDir)) {
    await mkdir(handoffDir, { recursive: true });
  }

  const reviewPath = join(handoffDir, "review-findings.md");
  await writeFile(reviewPath, findings, "utf-8");

  return {
    content: [
      {
        type: "text" as const,
        text: `Review written to: ${reviewPath}`,
      },
    ],
  };
}
