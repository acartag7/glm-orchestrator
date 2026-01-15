/**
 * Codebase Analyzer
 *
 * Analyzes a project directory to provide context for spec and chunk generation.
 * Detects framework, TypeScript, package manager, directory structure, types, and components.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import path from 'path';
import type {
  CodebaseContext,
  AnalyzeCodebaseOptions,
  Framework,
  PackageManager,
  DirectoryEntry,
  KeyFile,
  TypeDefinition,
  ComponentInfo,
} from '@glm/shared';

// Directories to skip when building structure
const DEFAULT_SKIP_DIRS = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.turbo',
  'coverage',
  '.cache',
  '__pycache__',
  '.svelte-kit',
  '.nuxt',
  '.output',
  '.vercel',
  '.netlify',
];

// Default limits
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_ENTRIES_PER_DIR = 20;
const DEFAULT_MAX_FILE_SIZE = 51200; // 50KB

// In-memory cache with TTL
const contextCache = new Map<string, { context: CodebaseContext; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Detect the framework used in the project by checking package.json dependencies
 */
function detectFramework(projectDir: string): Framework {
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return 'unknown';
  }

  try {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    // Check in priority order (more specific first)
    if (deps['next']) return 'nextjs';
    if (deps['@nestjs/core']) return 'nestjs';
    if (deps['fastify']) return 'fastify';
    if (deps['express']) return 'express';
    if (deps['vue']) return 'vue';
    if (deps['@angular/core']) return 'angular';
    if (deps['react']) return 'react';

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Detect the package manager by checking for lock files
 */
function detectPackageManager(projectDir: string): PackageManager {
  if (existsSync(path.join(projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(projectDir, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(projectDir, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

/**
 * Build directory structure recursively with depth and entry limits
 */
function buildDirectoryStructure(
  dir: string,
  skipDirs: string[],
  maxDepth: number,
  maxEntries: number,
  currentDepth = 0
): DirectoryEntry[] {
  if (currentDepth >= maxDepth) {
    return [];
  }

  try {
    const entries = readdirSync(dir);
    const result: DirectoryEntry[] = [];

    // Sort entries: directories first, then files
    const sorted = entries
      .filter((name) => !name.startsWith('.') || name === '.env.example')
      .filter((name) => !skipDirs.includes(name))
      .slice(0, maxEntries);

    for (const name of sorted) {
      const fullPath = path.join(dir, name);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          result.push({
            name,
            type: 'directory',
            children: buildDirectoryStructure(
              fullPath,
              skipDirs,
              maxDepth,
              maxEntries,
              currentDepth + 1
            ),
          });
        } else {
          result.push({ name, type: 'file' });
        }
      } catch {
        // Skip files we can't stat
      }
    }

    // Sort: directories first, then alphabetically
    return result.sort((a, b) => {
      if (a.type === 'directory' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
}

/**
 * Find and read key configuration files
 */
function findKeyFiles(projectDir: string, maxFileSize: number): KeyFile[] {
  const keyFilePaths = [
    'package.json',
    'tsconfig.json',
    'prisma/schema.prisma',
    '.env.example',
    'tailwind.config.ts',
    'tailwind.config.js',
    'next.config.mjs',
    'next.config.js',
    'next.config.ts',
    'vite.config.ts',
    'vite.config.js',
  ];

  const result: KeyFile[] = [];

  for (const relativePath of keyFilePaths) {
    const fullPath = path.join(projectDir, relativePath);
    if (!existsSync(fullPath)) continue;

    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;

      const keyFile: KeyFile = { path: relativePath };

      if (stat.size <= maxFileSize) {
        keyFile.content = readFileSync(fullPath, 'utf-8');
      } else {
        // Truncate large files
        const content = readFileSync(fullPath, 'utf-8').slice(0, maxFileSize);
        keyFile.content = content + '\n... (truncated)';
        keyFile.truncated = true;
      }

      result.push(keyFile);
    } catch {
      // Skip files we can't read
    }
  }

  return result;
}

/**
 * Find type definitions in common type directories
 */
function findTypeDefinitions(projectDir: string): TypeDefinition[] {
  const typeDirs = ['src/types', 'types', 'src/interfaces', 'lib/types'];
  const typePattern = /export\s+(?:interface|type)\s+(\w+)/g;
  const result: TypeDefinition[] = [];
  const maxTypes = 30;

  for (const typeDir of typeDirs) {
    const fullDir = path.join(projectDir, typeDir);
    if (!existsSync(fullDir)) continue;

    try {
      const files = readdirSync(fullDir);
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        if (result.length >= maxTypes) break;

        const fullPath = path.join(fullDir, file);
        try {
          const content = readFileSync(fullPath, 'utf-8');
          let match;
          while ((match = typePattern.exec(content)) !== null) {
            if (result.length >= maxTypes) break;
            result.push({
              name: match[1],
              file: path.join(typeDir, file),
            });
          }
        } catch {
          // Skip files we can't read
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return result;
}

/**
 * Find React components in common component directories
 */
function findComponents(projectDir: string): ComponentInfo[] {
  const componentDirs = ['src/components', 'components', 'app/components', 'src/app/components'];
  const result: ComponentInfo[] = [];
  const maxComponents = 30;

  for (const compDir of componentDirs) {
    const fullDir = path.join(projectDir, compDir);
    if (!existsSync(fullDir)) continue;

    try {
      scanComponentDir(fullDir, compDir, result, maxComponents);
    } catch {
      // Skip directories we can't read
    }
  }

  return result;
}

/**
 * Recursively scan a directory for components
 */
function scanComponentDir(
  fullDir: string,
  relativeDir: string,
  result: ComponentInfo[],
  maxComponents: number,
  depth = 0
): void {
  if (depth > 2 || result.length >= maxComponents) return;

  try {
    const entries = readdirSync(fullDir);
    for (const entry of entries) {
      if (result.length >= maxComponents) break;

      const fullPath = path.join(fullDir, entry);
      const relativePath = path.join(relativeDir, entry);

      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          // Recurse into subdirectories
          scanComponentDir(fullPath, relativePath, result, maxComponents, depth + 1);
        } else if (entry.endsWith('.tsx') || entry.endsWith('.jsx')) {
          // Extract component name from file
          const name = entry.replace(/\.(tsx|jsx)$/, '');
          // Skip index files and lowercase files (likely utilities)
          if (name !== 'index' && name[0] === name[0].toUpperCase()) {
            result.push({ name, file: relativePath });
          }
        }
      } catch {
        // Skip entries we can't stat
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

/**
 * Analyze a project directory and return structured context
 */
export function analyzeCodebase(
  projectDirectory: string,
  options: AnalyzeCodebaseOptions = {}
): CodebaseContext {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxEntriesPerDir = options.maxEntriesPerDir ?? DEFAULT_MAX_ENTRIES_PER_DIR;
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  const framework = detectFramework(projectDirectory);
  const typescript = existsSync(path.join(projectDirectory, 'tsconfig.json'));
  const packageManager = detectPackageManager(projectDirectory);
  const structure = buildDirectoryStructure(
    projectDirectory,
    DEFAULT_SKIP_DIRS,
    maxDepth,
    maxEntriesPerDir
  );
  const keyFiles = findKeyFiles(projectDirectory, maxFileSize);
  const types = findTypeDefinitions(projectDirectory);
  const components = findComponents(projectDirectory);

  return {
    framework,
    typescript,
    packageManager,
    structure,
    keyFiles,
    types,
    components,
    analyzedAt: Date.now(),
    projectDirectory,
  };
}

/**
 * Get codebase context with caching
 */
export function getCodebaseContext(
  projectDirectory: string,
  options?: AnalyzeCodebaseOptions,
  forceRefresh = false
): CodebaseContext {
  const cacheKey = projectDirectory;
  const cached = contextCache.get(cacheKey);

  if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
    return cached.context;
  }

  const context = analyzeCodebase(projectDirectory, options);
  contextCache.set(cacheKey, {
    context,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return context;
}

/**
 * Clear the context cache
 */
export function clearCodebaseCache(projectDirectory?: string): void {
  if (projectDirectory) {
    contextCache.delete(projectDirectory);
  } else {
    contextCache.clear();
  }
}

/**
 * Format directory tree as ASCII art
 */
function formatDirectoryTree(entries: DirectoryEntry[], prefix = ''): string {
  let result = '';
  const lastIndex = entries.length - 1;

  entries.forEach((entry, index) => {
    const isLast = index === lastIndex;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    result += prefix + connector + entry.name + (entry.type === 'directory' ? '/' : '') + '\n';

    if (entry.type === 'directory' && entry.children && entry.children.length > 0) {
      result += formatDirectoryTree(entry.children, childPrefix);
    }
  });

  return result;
}

/**
 * Get file extension for syntax highlighting
 */
function getFileExtension(filePath: string): string {
  const ext = path.extname(filePath).slice(1);
  const extMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    json: 'json',
    prisma: 'prisma',
    mjs: 'javascript',
  };
  return extMap[ext] || ext;
}

/**
 * Format CodebaseContext as markdown string for prompts
 */
export function formatCodebaseContext(context: CodebaseContext): string {
  const sections: string[] = [];

  // Header with detection results
  sections.push('## Existing Codebase Analysis');
  sections.push('');
  sections.push(`**Summary:** ${formatFrameworkSummary(context)}`);
  sections.push('');

  // Directory structure
  if (context.structure.length > 0) {
    sections.push('### Project Structure');
    sections.push('```');
    sections.push(formatDirectoryTree(context.structure).trimEnd());
    sections.push('```');
    sections.push('');
  }

  // Key files (excluding package.json content to save tokens)
  const importantFiles = context.keyFiles.filter(
    (f) => f.path !== 'package.json' && f.content
  );
  if (importantFiles.length > 0) {
    sections.push('### Key Configuration');
    for (const file of importantFiles.slice(0, 3)) {
      sections.push(`**${file.path}:**`);
      sections.push('```' + getFileExtension(file.path));
      sections.push(file.content!.slice(0, 2000)); // Limit each file
      sections.push('```');
      sections.push('');
    }
  }

  // Dependencies from package.json
  const pkgJson = context.keyFiles.find((f) => f.path === 'package.json');
  if (pkgJson?.content) {
    try {
      const pkg = JSON.parse(pkgJson.content);
      const deps = Object.keys(pkg.dependencies || {}).slice(0, 15);
      if (deps.length > 0) {
        sections.push('### Key Dependencies');
        sections.push(deps.join(', '));
        sections.push('');
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Existing types
  if (context.types.length > 0) {
    sections.push('### Existing Types/Interfaces');
    const groupedByFile = new Map<string, string[]>();
    for (const t of context.types) {
      const existing = groupedByFile.get(t.file) || [];
      existing.push(t.name);
      groupedByFile.set(t.file, existing);
    }
    for (const [file, typeNames] of groupedByFile) {
      sections.push(`- ${file}: ${typeNames.join(', ')}`);
    }
    sections.push('');
  }

  // Existing components
  if (context.components.length > 0) {
    sections.push('### Existing Components');
    for (const comp of context.components.slice(0, 15)) {
      sections.push(`- ${comp.name} (${comp.file})`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Format a human-readable summary of the framework detection
 */
function formatFrameworkSummary(context: CodebaseContext): string {
  const parts: string[] = [];

  // Framework
  const frameworkNames: Record<Framework, string> = {
    nextjs: 'Next.js',
    react: 'React',
    express: 'Express',
    nestjs: 'NestJS',
    fastify: 'Fastify',
    vue: 'Vue',
    angular: 'Angular',
    unknown: 'Unknown framework',
  };
  parts.push(frameworkNames[context.framework]);

  // TypeScript
  if (context.typescript) {
    parts.push('TypeScript');
  }

  // Package manager
  if (context.packageManager !== 'unknown') {
    parts.push(context.packageManager);
  }

  return parts.join(' project with ');
}
