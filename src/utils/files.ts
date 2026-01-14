import { readFileSync, readdirSync, statSync } from "fs";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "coverage",
  ".handoff",
  "__pycache__",
  ".venv",
  "venv",
]);

const IGNORED_EXTENSIONS = new Set([
  ".lock",
  ".log",
  ".map",
  ".min.js",
  ".min.css",
]);

export async function getProjectFiles(
  dir: string,
  maxDepth: number = 10,
  maxFiles: number = 1000
): Promise<string[]> {
  const files: string[] = [];

  function walkDirectory(currentPath: string, currentDepth: number) {
    if (currentDepth > maxDepth || files.length >= maxFiles) return;

    try {
      const entries = readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = `${currentPath}/${entry.name}`;

        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          walkDirectory(fullPath, currentDepth + 1);
        } else if (entry.isFile()) {
          const ext = entry.name.includes(".") ? `.${entry.name.split(".").pop()}` : "";
          if (IGNORED_EXTENSIONS.has(ext)) continue;
          if (
            entry.name.endsWith(".ts") ||
            entry.name.endsWith(".tsx") ||
            entry.name.endsWith(".json")
          ) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      return;
    }
  }

  walkDirectory(dir, 0);

  return files.slice(0, maxFiles);
}
