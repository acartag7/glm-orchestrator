# ORC-62: DSPy-Style Assertion Enforcement System

## Overview

Implement a multi-layer enforcement system that validates chunk execution against contract assertions. Uses DSPy-inspired Assert/Suggest pattern with automatic retry, context accumulation, and layered validation.

## Problem Statement

Current execution has no enforcement:
- Prompts tell GLM what to do, but there's no verification
- Build validation catches type errors but not contract violations
- Chunks can create wrong exports (e.g., `HealthCheckStatus` instead of `HealthCheckResult`)
- No mechanism for retry with error context
- Integration issues not caught until manual testing

## Solution

Implement enforcement at four layers:

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: PRE-EXECUTION GATE                                    │
│  Block execution if dependencies not met                        │
└─────────────────────────────────┬───────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: CONTEXT INJECTION                                     │
│  Pass contract + available exports to GLM                       │
└─────────────────────────────────┬───────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: POST-EXECUTION VALIDATION                             │
│  Verify assertions, retry on failure                            │
└─────────────────────────────────┬───────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4: CONTEXT ACCUMULATION                                  │
│  Record what was created for next chunks                        │
└─────────────────────────────────────────────────────────────────┘
```

---

# MVP vs Roadmap

## MVP Scope

| Feature | Description | Priority |
|---------|-------------|----------|
| Context accumulation | Pass git diff + exports from previous chunks | P0 |
| Pre-execution gate | Block if dependsOn chunks not completed | P0 |
| Context injection | Add available exports to prompt | P0 |
| Additive tolerance | Extra exports OK, missing/wrong = fail | P0 |
| Regex-based validation | Grep for export existence (Tier 1) | P0 |
| Retry with context | Feed error back, retry up to 3 times | P0 |

## Roadmap (Post-MVP)

| Feature | Description | Priority |
|---------|-------------|----------|
| Impact analysis | Find callers before modifying code | P1 |
| Contract amendments | Propose contract changes on repeated failure | P1 |
| AST validation (Tier 3) | TypeScript compiler for signature matching | P2 |
| LLM-as-judge | Semantic validation for complex checks | P3 |
| Parallel execution | Run independent chunks concurrently | P3 |

---

# Core Concepts

## Assert vs Suggest (DSPy Pattern)

```typescript
// ASSERT: Hard requirement - must be met or chunk fails
{
  type: 'assert',
  condition: 'exports HealthCheckResult from @specwright/shared',
  message: 'Must export HealthCheckResult type',
  check: {
    type: 'export_exists',
    target: 'HealthCheckResult',
    file: 'packages/shared/src/types.ts'
  }
}

// SUGGEST: Soft guidance - logged but doesn't fail
{
  type: 'suggest',
  condition: 'follows existing error handling patterns',
  message: 'Should use try/catch with typed errors',
  check: {
    type: 'pattern_match',
    target: 'packages/dashboard/src/lib/health-check.ts',
    pattern: 'try\\s*\\{[\\s\\S]*catch'
  }
}
```

## Additive Tolerance

GLM may discover it needs helper types/functions not in the original contract. This is OK as long as required items are created:

```typescript
// Contract says: creates: ["HealthCheckResult", "checkHealth()"]

// PASS - all required + bonus
// GLM creates: HealthCheckResult, checkHealth(), HealthCheckError (bonus)

// FAIL - missing required
// GLM creates: HealthCheckResult, validateHealth() (wrong function name)

// FAIL - wrong name
// GLM creates: HealthStatus (wrong type name), checkHealth()
```

## Tiered Validation (Regex Before AST)

```typescript
// Tier 1: Regex/Grep (microseconds) - MVP
// Catches: "does export exist?"
const tier1Check = (file: string, name: string): boolean => {
  const content = fs.readFileSync(file, 'utf-8');
  const pattern = new RegExp(`export\\s+(const|function|interface|type|class)\\s+${name}\\b`);
  return pattern.test(content);
};

// Tier 2: Extended regex (milliseconds) - MVP
// Catches: re-exports, default exports
const tier2Check = (file: string, name: string): boolean => {
  const content = fs.readFileSync(file, 'utf-8');
  // Check: export { X } from './other'
  // Check: export default X
  // Check: export { X as Y }
  return /* regex patterns */;
};

// Tier 3: AST (heavy) - Roadmap
// Catches: "does signature match?"
const tier3Check = async (file: string, name: string, expected: string): Promise<boolean> => {
  const program = ts.createProgram([file], {});
  // Parse and compare signatures
  return /* AST comparison */;
};
```

---

# Data Model

## Types (packages/shared/src/types.ts)

```typescript
// ============================================
// EXECUTION CONTEXT TYPES
// ============================================

/**
 * What's available from previous chunks
 */
export interface AvailableExport {
  name: string;              // "HealthCheckResult"
  from: string;              // "@specwright/shared"
  type: 'type' | 'interface' | 'function' | 'const' | 'class';
  createdByChunk: string;    // Chunk ID that created this
  file: string;              // Actual file path
}

/**
 * Execution context passed between chunks
 */
export interface ChunkExecutionContext {
  // What previous chunks have created
  availableExports: AvailableExport[];

  // Files that exist (created or modified)
  availableFiles: {
    path: string;
    exports: string[];
    createdByChunk?: string;
    modifiedByChunk?: string;
  }[];

  // Git diff summary
  changesSoFar: {
    filesCreated: string[];
    filesModified: string[];
    totalAdditions: number;
    totalDeletions: number;
  };
}

/**
 * Result of a single assertion check
 */
export interface AssertionResult {
  assertion: ContractAssertion;
  passed: boolean;
  tier: 1 | 2 | 3;           // Which validation tier was used
  actual?: string;           // What was found
  expected?: string;         // What was expected
  error?: string;            // Error if check failed
}

/**
 * Retry context for failed chunks
 */
export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  previousViolations: {
    assertion: ContractAssertion;
    actual: string;
    expected: string;
  }[];
}

/**
 * Full validation result for a chunk
 */
export interface ChunkValidationResult {
  passed: boolean;
  assertResults: AssertionResult[];
  suggestResults: AssertionResult[];
  buildPassed: boolean;
  buildOutput?: string;
  retryable: boolean;
  retryContext?: RetryContext;
}

/**
 * Impact analysis result (Roadmap)
 */
export interface ImpactAnalysis {
  filesAffected: string[];
  functionsAffected: {
    name: string;
    file: string;
    callers: { file: string; line: number }[];
  }[];
  typesAffected: {
    name: string;
    file: string;
    usages: { file: string; line: number }[];
  }[];
  summary: string;
}

/**
 * Contract amendment proposal (Roadmap)
 */
export interface AmendmentProposal {
  chunkId: string;
  reason: string;
  proposedChanges: {
    path: string;           // "functions[0].signature"
    oldValue: string;
    newValue: string;
  }[];
  additionalTypes?: ContractType[];
  affectedChunks: number[];
}
```

## Database Changes

```sql
-- Track execution context per chunk
CREATE TABLE IF NOT EXISTS chunk_contexts (
  id TEXT PRIMARY KEY,
  spec_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  context JSON NOT NULL,           -- ChunkExecutionContext
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (spec_id) REFERENCES specs(id),
  FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

-- Track validation results
CREATE TABLE IF NOT EXISTS chunk_validations (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  result JSON NOT NULL,            -- ChunkValidationResult
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);

-- Roadmap: Amendment proposals
CREATE TABLE IF NOT EXISTS amendment_proposals (
  id TEXT PRIMARY KEY,
  spec_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  proposal JSON NOT NULL,          -- AmendmentProposal
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY (spec_id) REFERENCES specs(id),
  FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);
```

---

# MVP Implementation

## Layer 1: Pre-Execution Gate

```typescript
// packages/dashboard/src/lib/services/pre-execution-gate.ts

export interface GateResult {
  canExecute: boolean;
  blockedBy?: {
    type: 'missing_dependency' | 'failed_chunk' | 'missing_export';
    chunkId?: string;
    details: string;
  }[];
}

export async function checkPreExecutionGate(
  chunk: Chunk,
  context: ChunkExecutionContext
): Promise<GateResult> {
  const blockers: GateResult['blockedBy'] = [];

  // 1. Check dependsOn chunks completed successfully
  if (chunk.dependsOn && chunk.dependsOn.length > 0) {
    for (const depId of chunk.dependsOn) {
      const depChunk = getChunk(depId);
      if (!depChunk) {
        blockers.push({
          type: 'missing_dependency',
          chunkId: depId,
          details: `Dependency chunk not found`
        });
        continue;
      }

      if (depChunk.status !== 'completed') {
        blockers.push({
          type: 'failed_chunk',
          chunkId: depId,
          details: `Chunk "${depChunk.title}" has status: ${depChunk.status}`
        });
      }

      if (depChunk.reviewStatus && depChunk.reviewStatus !== 'pass') {
        blockers.push({
          type: 'failed_chunk',
          chunkId: depId,
          details: `Chunk "${depChunk.title}" review: ${depChunk.reviewStatus}`
        });
      }
    }
  }

  // 2. Check consumes are available in context
  if (chunk.consumes && chunk.consumes.length > 0) {
    for (const item of chunk.consumes) {
      const available = context.availableExports.some(e => e.name === item);
      if (!available) {
        blockers.push({
          type: 'missing_export',
          details: `Required export "${item}" not available from previous chunks`
        });
      }
    }
  }

  return {
    canExecute: blockers.length === 0,
    blockedBy: blockers.length > 0 ? blockers : undefined
  };
}
```

## Layer 2: Context Injection

```typescript
// packages/dashboard/src/prompts/executor.ts

export function buildExecutorPrompt(
  chunk: Chunk,
  spec: Spec,
  context: ChunkExecutionContext,
  retryContext?: RetryContext
): string {
  const sections: string[] = [];

  // 1. Task description
  sections.push(`# Task: ${chunk.title}\n\n${chunk.description}`);

  // 2. What this chunk MUST create (from contract)
  if (chunk.creates && chunk.creates.length > 0) {
    sections.push(`\n## YOU MUST CREATE\n`);
    chunk.creates.forEach(item => {
      sections.push(`- ${item}`);
    });
    sections.push(`\nThese are REQUIRED. The chunk will fail if any are missing.`);
  }

  // 3. Assertions as requirements
  if (chunk.assertions && chunk.assertions.length > 0) {
    const asserts = chunk.assertions.filter(a => a.type === 'assert');
    const suggests = chunk.assertions.filter(a => a.type === 'suggest');

    if (asserts.length > 0) {
      sections.push(`\n## REQUIREMENTS (Must Pass)\n`);
      asserts.forEach(a => sections.push(`- ✓ ${a.message}`));
    }

    if (suggests.length > 0) {
      sections.push(`\n## GUIDANCE (Should Follow)\n`);
      suggests.forEach(s => sections.push(`- ○ ${s.message}`));
    }
  }

  // 4. Available imports (from previous chunks)
  if (context.availableExports.length > 0) {
    sections.push(`\n## AVAILABLE IMPORTS (verified to exist)\n`);

    // Group by source
    const bySource = new Map<string, AvailableExport[]>();
    context.availableExports.forEach(exp => {
      const list = bySource.get(exp.from) || [];
      list.push(exp);
      bySource.set(exp.from, list);
    });

    bySource.forEach((exports, source) => {
      sections.push(`\nFrom "${source}":`);
      exports.forEach(exp => {
        sections.push(`  - ${exp.name} (${exp.type})`);
      });
    });
  }

  // 5. What NOT to import (in consumes but not yet available)
  const notYetAvailable = (chunk.consumes || []).filter(item =>
    !context.availableExports.some(e => e.name === item)
  );
  if (notYetAvailable.length > 0) {
    sections.push(`\n## DO NOT IMPORT (you must create these)\n`);
    notYetAvailable.forEach(item => {
      sections.push(`- ${item}`);
    });
  }

  // 6. Retry context (if applicable)
  if (retryContext && retryContext.attempt > 1) {
    sections.push(`\n## ⚠️ PREVIOUS ATTEMPT FAILED\n`);
    sections.push(`This is attempt ${retryContext.attempt} of ${retryContext.maxAttempts}.\n`);
    sections.push(`Fix these specific issues:\n`);

    retryContext.previousViolations.forEach(v => {
      sections.push(`\n**${v.assertion.message}**`);
      sections.push(`- Expected: ${v.expected}`);
      sections.push(`- Got: ${v.actual}`);
    });
  }

  // 7. Files changed so far
  if (context.changesSoFar.filesCreated.length > 0 ||
      context.changesSoFar.filesModified.length > 0) {
    sections.push(`\n## FILES CHANGED BY PREVIOUS CHUNKS\n`);
    if (context.changesSoFar.filesCreated.length > 0) {
      sections.push(`Created: ${context.changesSoFar.filesCreated.slice(0, 10).join(', ')}`);
    }
    if (context.changesSoFar.filesModified.length > 0) {
      sections.push(`Modified: ${context.changesSoFar.filesModified.slice(0, 10).join(', ')}`);
    }
  }

  return sections.join('\n');
}
```

## Layer 3: Post-Execution Validation (Tiered)

```typescript
// packages/dashboard/src/lib/services/assertion-validator.ts

export class AssertionValidator {
  constructor(private workingDir: string) {}

  async validateChunk(
    chunk: Chunk,
    buildResult: { passed: boolean; output: string }
  ): Promise<ChunkValidationResult> {
    const assertResults: AssertionResult[] = [];
    const suggestResults: AssertionResult[] = [];

    // Check each assertion
    for (const assertion of chunk.assertions || []) {
      const result = await this.checkAssertion(assertion);

      if (assertion.type === 'assert') {
        assertResults.push(result);
      } else {
        suggestResults.push(result);
      }
    }

    // Check creates[] items exist (additive tolerance)
    if (chunk.creates) {
      for (const item of chunk.creates) {
        const exists = await this.checkExportExists(item);
        if (!exists.found) {
          assertResults.push({
            assertion: {
              type: 'assert',
              condition: `creates ${item}`,
              message: `Must create ${item}`,
              check: { type: 'export_exists', target: item }
            },
            passed: false,
            tier: 1,
            expected: item,
            actual: 'not found'
          });
        }
      }
    }

    const assertsPassed = assertResults.every(r => r.passed);
    const failedAsserts = assertResults.filter(r => !r.passed);

    return {
      passed: assertsPassed && buildResult.passed,
      assertResults,
      suggestResults,
      buildPassed: buildResult.passed,
      buildOutput: buildResult.output,
      retryable: !assertsPassed && failedAsserts.length > 0,
      retryContext: failedAsserts.length > 0 ? {
        attempt: 1,
        maxAttempts: 3,
        previousViolations: failedAsserts.map(r => ({
          assertion: r.assertion,
          actual: r.actual || 'not found',
          expected: r.expected || r.assertion.message
        }))
      } : undefined
    };
  }

  private async checkAssertion(assertion: ContractAssertion): Promise<AssertionResult> {
    switch (assertion.check.type) {
      case 'export_exists':
        return this.checkExportExistsAssertion(assertion);
      case 'file_exists':
        return this.checkFileExistsAssertion(assertion);
      case 'pattern_match':
        return this.checkPatternMatchAssertion(assertion);
      default:
        return {
          assertion,
          passed: true,
          tier: 1,
          error: `Unknown check type: ${assertion.check.type}`
        };
    }
  }

  // Tier 1: Regex-based export check
  private async checkExportExists(name: string): Promise<{ found: boolean; file?: string }> {
    // Search all TypeScript files
    const pattern = `export\\s+(const|function|interface|type|class)\\s+${name}\\b`;

    const result = spawnSync('grep', [
      '-r', '-l', '-E', pattern,
      '--include=*.ts', '--include=*.tsx',
      '.'
    ], {
      cwd: this.workingDir,
      encoding: 'utf-8',
      shell: false
    });

    if (result.status === 0 && result.stdout.trim()) {
      return { found: true, file: result.stdout.trim().split('\n')[0] };
    }

    // Tier 2: Check re-exports
    const reexportPattern = `export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`;
    const reexportResult = spawnSync('grep', [
      '-r', '-l', '-E', reexportPattern,
      '--include=*.ts', '--include=*.tsx',
      '.'
    ], {
      cwd: this.workingDir,
      encoding: 'utf-8',
      shell: false
    });

    if (reexportResult.status === 0 && reexportResult.stdout.trim()) {
      return { found: true, file: reexportResult.stdout.trim().split('\n')[0] };
    }

    return { found: false };
  }

  private async checkExportExistsAssertion(assertion: ContractAssertion): Promise<AssertionResult> {
    const { target, file } = assertion.check;
    const result = await this.checkExportExists(target);

    return {
      assertion,
      passed: result.found,
      tier: 1,
      expected: `Export "${target}"`,
      actual: result.found ? `Found in ${result.file}` : 'Not found'
    };
  }

  private async checkFileExistsAssertion(assertion: ContractAssertion): Promise<AssertionResult> {
    const { target } = assertion.check;
    const fullPath = path.join(this.workingDir, target);

    try {
      await fs.access(fullPath);
      return {
        assertion,
        passed: true,
        tier: 1,
        expected: `File ${target}`,
        actual: 'File exists'
      };
    } catch {
      return {
        assertion,
        passed: false,
        tier: 1,
        expected: `File ${target}`,
        actual: 'File not found'
      };
    }
  }

  private async checkPatternMatchAssertion(assertion: ContractAssertion): Promise<AssertionResult> {
    const { target, pattern } = assertion.check as { target: string; pattern: string };
    const fullPath = path.join(this.workingDir, target);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const regex = new RegExp(pattern);
      const matches = regex.test(content);

      return {
        assertion,
        passed: matches,
        tier: 1,
        expected: `Pattern /${pattern}/`,
        actual: matches ? 'Pattern found' : 'Pattern not found'
      };
    } catch (error) {
      return {
        assertion,
        passed: false,
        tier: 1,
        error: `Could not read file: ${error}`
      };
    }
  }
}
```

## Layer 4: Context Accumulation

```typescript
// packages/dashboard/src/lib/services/context-accumulator.ts

export class ContextAccumulator {
  constructor(
    private specId: string,
    private workingDir: string
  ) {}

  /**
   * Get accumulated context for a chunk
   */
  async getContextForChunk(chunkOrder: number): Promise<ChunkExecutionContext> {
    // Get all completed chunks before this one
    const allChunks = getChunksBySpec(this.specId);
    const previousChunks = allChunks
      .filter(c => c.order < chunkOrder && c.status === 'completed')
      .sort((a, b) => a.order - b.order);

    const context: ChunkExecutionContext = {
      availableExports: [],
      availableFiles: [],
      changesSoFar: {
        filesCreated: [],
        filesModified: [],
        totalAdditions: 0,
        totalDeletions: 0
      }
    };

    // Accumulate from each previous chunk
    for (const chunk of previousChunks) {
      const chunkContext = await this.getStoredContext(chunk.id);
      if (chunkContext) {
        context.availableExports.push(...chunkContext.availableExports);
        context.availableFiles.push(...chunkContext.availableFiles);
        context.changesSoFar.filesCreated.push(...chunkContext.changesSoFar.filesCreated);
        context.changesSoFar.filesModified.push(...chunkContext.changesSoFar.filesModified);
        context.changesSoFar.totalAdditions += chunkContext.changesSoFar.totalAdditions;
        context.changesSoFar.totalDeletions += chunkContext.changesSoFar.totalDeletions;
      }
    }

    // Deduplicate
    context.availableExports = this.deduplicateExports(context.availableExports);

    return context;
  }

  /**
   * Record what a chunk created (called after successful execution)
   */
  async recordChunkContext(chunkId: string): Promise<ChunkExecutionContext> {
    // Get git diff for uncommitted changes
    const diff = await this.parseGitDiff();

    // Find exports in changed files
    const exports: AvailableExport[] = [];

    for (const file of [...diff.created, ...diff.modified]) {
      const fileExports = await this.findExportsInFile(file);
      exports.push(...fileExports.map(exp => ({
        ...exp,
        createdByChunk: chunkId,
        file
      })));
    }

    const context: ChunkExecutionContext = {
      availableExports: exports,
      availableFiles: [
        ...diff.created.map(p => ({ path: p, exports: [], createdByChunk: chunkId })),
        ...diff.modified.map(p => ({ path: p, exports: [], modifiedByChunk: chunkId }))
      ],
      changesSoFar: {
        filesCreated: diff.created,
        filesModified: diff.modified,
        totalAdditions: diff.additions,
        totalDeletions: diff.deletions
      }
    };

    // Store in database
    await this.storeContext(chunkId, context);

    return context;
  }

  private async parseGitDiff(): Promise<{
    created: string[];
    modified: string[];
    additions: number;
    deletions: number;
  }> {
    // Get file status
    const statusResult = spawnSync('git', ['status', '--porcelain'], {
      cwd: this.workingDir,
      encoding: 'utf-8',
      shell: false
    });

    const created: string[] = [];
    const modified: string[] = [];

    if (statusResult.status === 0) {
      const lines = statusResult.stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const status = line.slice(0, 2);
        const file = line.slice(3);

        if (status.includes('A') || status.includes('?')) {
          created.push(file);
        } else if (status.includes('M')) {
          modified.push(file);
        }
      }
    }

    // Get line counts
    const diffStatResult = spawnSync('git', ['diff', '--numstat'], {
      cwd: this.workingDir,
      encoding: 'utf-8',
      shell: false
    });

    let additions = 0;
    let deletions = 0;

    if (diffStatResult.status === 0) {
      const lines = diffStatResult.stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const [add, del] = line.split('\t');
        additions += parseInt(add, 10) || 0;
        deletions += parseInt(del, 10) || 0;
      }
    }

    return { created, modified, additions, deletions };
  }

  private async findExportsInFile(filePath: string): Promise<Omit<AvailableExport, 'createdByChunk' | 'file'>[]> {
    const fullPath = path.join(this.workingDir, filePath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const exports: Omit<AvailableExport, 'createdByChunk' | 'file'>[] = [];

      // Match: export const/function/interface/type/class Name
      const pattern = /export\s+(const|function|interface|type|class)\s+(\w+)/g;
      let match;

      while ((match = pattern.exec(content)) !== null) {
        exports.push({
          name: match[2],
          from: this.getImportPath(filePath),
          type: match[1] as AvailableExport['type']
        });
      }

      return exports;
    } catch {
      return [];
    }
  }

  private getImportPath(filePath: string): string {
    // Convert file path to import path
    if (filePath.startsWith('packages/shared/')) {
      return '@specwright/shared';
    }
    if (filePath.startsWith('packages/dashboard/')) {
      return filePath
        .replace('packages/dashboard/src/', '@/')
        .replace(/\.tsx?$/, '');
    }
    return filePath;
  }

  private deduplicateExports(exports: AvailableExport[]): AvailableExport[] {
    const seen = new Map<string, AvailableExport>();
    for (const exp of exports) {
      const key = `${exp.from}:${exp.name}`;
      if (!seen.has(key)) {
        seen.set(key, exp);
      }
    }
    return Array.from(seen.values());
  }

  private async getStoredContext(chunkId: string): Promise<ChunkExecutionContext | null> {
    // Retrieve from database
    const db = getDb();
    const row = db.prepare('SELECT context FROM chunk_contexts WHERE chunk_id = ?').get(chunkId);
    return row ? JSON.parse(row.context) : null;
  }

  private async storeContext(chunkId: string, context: ChunkExecutionContext): Promise<void> {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO chunk_contexts (id, spec_id, chunk_id, context)
      VALUES (?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      this.specId,
      chunkId,
      JSON.stringify(context)
    );
  }
}
```

## Integrated Chunk Pipeline

```typescript
// packages/dashboard/src/lib/services/chunk-pipeline.ts (updated)

export async function executeChunkWithEnforcement(
  chunk: Chunk,
  spec: Spec,
  gitState: GitWorkflowState,
  events: ChunkPipelineEvents
): Promise<ChunkPipelineResult> {
  const accumulator = new ContextAccumulator(spec.id, gitState.workingDir);
  const validator = new AssertionValidator(gitState.workingDir);

  // LAYER 1: Pre-execution gate
  const context = await accumulator.getContextForChunk(chunk.order);
  const gateResult = await checkPreExecutionGate(chunk, context);

  if (!gateResult.canExecute) {
    const reasons = gateResult.blockedBy?.map(b => b.details).join(', ');
    events.onError?.(chunk.id, `Blocked: ${reasons}`);

    return {
      status: 'fail',
      error: `Preconditions not met: ${reasons}`
    };
  }

  let attempt = 1;
  const maxAttempts = 3;
  let retryContext: RetryContext | undefined;

  while (attempt <= maxAttempts) {
    events.onExecutionStart?.(chunk.id);

    // LAYER 2: Context injection
    const prompt = buildExecutorPrompt(chunk, spec, context, retryContext);

    // Execute with GLM
    const executionResult = await chunkExecutor.execute(
      chunk.id,
      prompt,
      gitState.workingDir
    );

    events.onExecutionComplete?.(chunk.id, executionResult);

    // Run build
    const buildResult = await runBuild(gitState.workingDir);

    // LAYER 3: Post-execution validation
    const validationResult = await validator.validateChunk(chunk, buildResult);

    events.onValidationComplete?.(chunk.id, validationResult);

    if (validationResult.passed) {
      // LAYER 4: Context accumulation
      await accumulator.recordChunkContext(chunk.id);

      // Commit changes
      if (gitState.enabled) {
        await gitService.commit(gitState, `chunk: ${chunk.title}`);
      }

      return {
        status: 'pass',
        output: executionResult.output
      };
    }

    // Check if retryable
    if (!validationResult.retryable || attempt >= maxAttempts) {
      // Reset git state
      if (gitState.enabled) {
        gitService.resetHard(gitState);
      }

      return {
        status: 'fail',
        error: formatValidationErrors(validationResult),
        reviewFeedback: formatValidationErrors(validationResult)
      };
    }

    // Prepare retry
    retryContext = {
      ...validationResult.retryContext!,
      attempt: attempt + 1
    };

    // Reset for retry
    if (gitState.enabled) {
      gitService.resetHard(gitState);
    }

    console.log(`[Pipeline] Validation failed, retrying (${attempt + 1}/${maxAttempts})`);
    attempt++;
  }

  return { status: 'fail', error: 'Max retries exceeded' };
}

function formatValidationErrors(result: ChunkValidationResult): string {
  const parts: string[] = [];

  if (!result.buildPassed) {
    parts.push('BUILD FAILED:');
    parts.push(result.buildOutput?.slice(0, 500) || 'Unknown error');
  }

  const failedAsserts = result.assertResults.filter(r => !r.passed);
  if (failedAsserts.length > 0) {
    parts.push('\nASSERTION FAILURES:');
    for (const r of failedAsserts) {
      parts.push(`• ${r.assertion.message}`);
      parts.push(`  Expected: ${r.expected}`);
      parts.push(`  Actual: ${r.actual}`);
    }
  }

  return parts.join('\n');
}
```

---

# Roadmap Implementation

## Impact Analysis (P1)

Before modifying existing files, analyze what depends on them:

```typescript
// packages/dashboard/src/lib/services/impact-analyzer.ts

export async function analyzeImpact(
  chunk: Chunk,
  workingDir: string
): Promise<ImpactAnalysis> {
  const impact: ImpactAnalysis = {
    filesAffected: [],
    functionsAffected: [],
    typesAffected: [],
    summary: ''
  };

  // Find files this chunk will modify
  const filesToModify = getFilesToModify(chunk);

  for (const file of filesToModify) {
    // Find all files that import from this file
    const importers = await findImporters(file, workingDir);
    impact.filesAffected.push(...importers);

    // Find specific exports that are used elsewhere
    const exports = await findExportsInFile(file, workingDir);

    for (const exp of exports) {
      const usages = await findUsages(exp.name, workingDir);
      if (usages.length > 0) {
        if (exp.type === 'function') {
          impact.functionsAffected.push({
            name: exp.name,
            file,
            callers: usages
          });
        } else {
          impact.typesAffected.push({
            name: exp.name,
            file,
            usages
          });
        }
      }
    }
  }

  impact.summary = generateSummary(impact);
  return impact;
}

function generateSummary(impact: ImpactAnalysis): string {
  const parts: string[] = ['## IMPACT ANALYSIS\n'];

  if (impact.functionsAffected.length > 0) {
    parts.push('Functions you are modifying:');
    impact.functionsAffected.forEach(f => {
      parts.push(`• ${f.name} - called by ${f.callers.length} places`);
    });
  }

  if (impact.typesAffected.length > 0) {
    parts.push('\nTypes you are modifying:');
    impact.typesAffected.forEach(t => {
      parts.push(`• ${t.name} - used in ${t.usages.length} places`);
    });
  }

  if (parts.length > 1) {
    parts.push('\n⚠️ Verify your changes don\'t break these usages.');
  }

  return parts.join('\n');
}
```

## Contract Amendments (P1)

When chunks fail repeatedly with the same issue, propose a contract amendment:

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️ CONTRACT AMENDMENT PROPOSED                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Chunk 2 failed 3 times with the same issue:                    │
│  "checkHealth signature doesn't match contract"                 │
│                                                                 │
│  The chunk discovered it needs an options parameter.            │
│                                                                 │
│  PROPOSED CHANGE:                                               │
│  ┌─────────────────────────────────────────────────────────────┐
│  │ functions[0].signature                                      │
│  │                                                             │
│  │ - (): Promise<HealthCheckResult>                            │
│  │ + (options?: HealthCheckOptions): Promise<HealthCheckResult>│
│  └─────────────────────────────────────────────────────────────┘
│                                                                 │
│  NEW TYPE NEEDED:                                               │
│  ┌─────────────────────────────────────────────────────────────┐
│  │ interface HealthCheckOptions {                              │
│  │   timeout?: number;                                         │
│  │   skipGit?: boolean;                                        │
│  │ }                                                           │
│  └─────────────────────────────────────────────────────────────┘
│                                                                 │
│  DOWNSTREAM EFFECTS:                                            │
│  • Chunk 3: Will need to pass options when calling checkHealth │
│  • Chunk 4: Integration - signature change propagates          │
│                                                                 │
│  ┌────────────────────────┐  ┌───────────────────────────────┐ │
│  │  ✓ Accept & Continue   │  │  ✗ Reject & Fail Chunk        │ │
│  └────────────────────────┘  └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

```typescript
// packages/dashboard/src/lib/services/amendment-proposer.ts

export async function proposeAmendment(
  chunk: Chunk,
  failures: AssertionResult[],
  executionOutput: string
): Promise<AmendmentProposal | null> {
  // Analyze failures to see if they indicate a contract problem
  const signatureFailures = failures.filter(f =>
    f.assertion.check.type === 'function_exists' ||
    f.error?.includes('signature')
  );

  if (signatureFailures.length === 0) {
    return null; // Not a contract issue
  }

  // Use LLM to propose an amendment
  const proposal = await generateAmendmentProposal(chunk, failures, executionOutput);

  if (proposal) {
    // Find affected downstream chunks
    proposal.affectedChunks = findAffectedChunks(chunk, proposal);
  }

  return proposal;
}
```

## AST Validation (P2)

For signature matching when regex isn't enough:

```typescript
// packages/dashboard/src/lib/services/ast-validator.ts

import * as ts from 'typescript';

export async function checkSignatureMatch(
  file: string,
  functionName: string,
  expectedSignature: string
): Promise<AssertionResult> {
  const program = ts.createProgram([file], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext
  });

  const sourceFile = program.getSourceFile(file);
  if (!sourceFile) {
    return {
      assertion: { /* ... */ },
      passed: false,
      tier: 3,
      error: 'Could not parse file'
    };
  }

  const checker = program.getTypeChecker();

  // Find the function declaration
  let foundFunction: ts.FunctionDeclaration | ts.ArrowFunction | undefined;

  ts.forEachChild(sourceFile, node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      foundFunction = node;
    }
    // Also check variable declarations with arrow functions
    if (ts.isVariableStatement(node)) {
      // ...
    }
  });

  if (!foundFunction) {
    return {
      assertion: { /* ... */ },
      passed: false,
      tier: 3,
      expected: functionName,
      actual: 'Function not found'
    };
  }

  // Compare signatures
  const actualSignature = checker.signatureToString(
    checker.getSignatureFromDeclaration(foundFunction)!
  );

  const matches = normalizeSignature(actualSignature) === normalizeSignature(expectedSignature);

  return {
    assertion: { /* ... */ },
    passed: matches,
    tier: 3,
    expected: expectedSignature,
    actual: actualSignature
  };
}

function normalizeSignature(sig: string): string {
  // Remove whitespace differences, normalize optional markers, etc.
  return sig.replace(/\s+/g, ' ').trim();
}
```

---

# UI: Validation Results

```typescript
// packages/dashboard/src/components/ValidationResultsPanel.tsx

export function ValidationResultsPanel({ result }: { result: ChunkValidationResult }) {
  return (
    <div className="space-y-4 p-4 bg-neutral-900 rounded-lg">
      {/* Overall Status */}
      <div className={`flex items-center gap-2 p-3 rounded ${
        result.passed ? 'bg-emerald-500/10' : 'bg-red-500/10'
      }`}>
        {result.passed ? (
          <CheckCircle className="w-5 h-5 text-emerald-400" />
        ) : (
          <XCircle className="w-5 h-5 text-red-400" />
        )}
        <span className="font-medium">
          {result.passed ? 'All checks passed' : 'Validation failed'}
        </span>
      </div>

      {/* Build Status */}
      <div className={`p-3 rounded ${
        result.buildPassed ? 'bg-neutral-800' : 'bg-red-500/10'
      }`}>
        <div className="flex items-center gap-2">
          {result.buildPassed ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <X className="w-4 h-4 text-red-400" />
          )}
          <span className="text-sm">Build {result.buildPassed ? 'passed' : 'failed'}</span>
        </div>
        {!result.buildPassed && result.buildOutput && (
          <pre className="mt-2 text-xs text-red-300 overflow-auto max-h-32">
            {result.buildOutput}
          </pre>
        )}
      </div>

      {/* Assertions */}
      {result.assertResults.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-neutral-400 mb-2">
            Requirements ({result.assertResults.filter(r => r.passed).length}/{result.assertResults.length})
          </h4>
          <div className="space-y-2">
            {result.assertResults.map((r, i) => (
              <div key={i} className={`p-2 rounded text-sm ${
                r.passed ? 'bg-emerald-500/5' : 'bg-red-500/10'
              }`}>
                <div className="flex items-center gap-2">
                  {r.passed ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <X className="w-4 h-4 text-red-400" />
                  )}
                  <span>{r.assertion.message}</span>
                  <span className="text-xs text-neutral-500">Tier {r.tier}</span>
                </div>
                {!r.passed && (
                  <div className="mt-1 pl-6 text-xs text-neutral-400">
                    <div>Expected: {r.expected}</div>
                    <div>Actual: {r.actual}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Retry Info */}
      {result.retryContext && (
        <div className="p-3 bg-yellow-500/10 rounded">
          <div className="flex items-center gap-2 text-yellow-400">
            <RefreshCw className="w-4 h-4" />
            <span className="text-sm">
              Retry {result.retryContext.attempt}/{result.retryContext.maxAttempts}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

# Pluggable Validation Layer

This section extends the validation system to work with any resource type, not just code files. It defines a validator interface that enables custom validation logic for different protocols and resource types.

## 1. Validator Interface

Define the core interface all validators must implement:

```typescript
/**
 * Core validator interface.
 * All validators (built-in and custom) must implement this interface.
 */
export interface Validator {
  /** Unique identifier for this validator (e.g., "file-export", "json-schema") */
  type: string;

  /** Resource types this validator can check (e.g., ["file"], ["data", "artifact"]) */
  supportedResourceTypes: string[];

  /**
   * Check if this validator can handle a specific resource.
   * More granular than supportedResourceTypes - can check metadata, format, etc.
   */
  supports(resource: ContractResource): boolean;

  /**
   * Validate the resource exists and matches expectations.
   * @param resource - The resource to validate
   * @param assertion - The assertion defining what to check
   * @param context - Execution context with available resources and outputs
   * @returns Validation result with pass/fail and details
   */
  validate(
    resource: ContractResource,
    assertion: ContractAssertion,
    context: ValidationContext
  ): Promise<ValidationResult>;
}

/**
 * Context passed to validators during validation.
 * Provides access to execution state and other resources.
 */
export interface ValidationContext {
  /** Working directory for file operations */
  workingDir?: string;

  /** All resources defined in the contract */
  availableResources: ContractResource[];

  /** Outputs from completed steps, keyed by step ID */
  stepOutputs: Map<string, unknown>;

  /** Protocol being used (affects resource interpretation) */
  protocol: string;

  /** Additional protocol-specific context */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a single validation check.
 */
export interface ValidationResult {
  /** Whether the validation passed */
  passed: boolean;

  /** Which validator performed this check */
  validator: string;

  /** The resource that was validated */
  resource: ContractResource;

  /** The assertion that was checked */
  assertion: ContractAssertion;

  /** What was actually found (for error messages) */
  actual?: unknown;

  /** What was expected (for error messages) */
  expected?: unknown;

  /** Error message if validation failed */
  error?: string;

  /** How long validation took (ms) */
  duration: number;

  /** Validation tier (1=fast regex, 2=extended, 3=AST/heavy) */
  tier?: 1 | 2 | 3;
}
```

## 2. Built-in Validators

These validators ship with the framework:

### FileExportValidator (Current Tier 1/2 Implementation)

Validates that exports exist in TypeScript/JavaScript files using regex.

```typescript
/**
 * Validates file exports exist using regex patterns (fast).
 * This is the existing Tier 1/2 validation from ORC-62.
 */
export const FileExportValidator: Validator = {
  type: 'file-export',
  supportedResourceTypes: ['file'],

  supports(resource) {
    return resource.type === 'file' &&
           (resource.format === 'typescript' ||
            resource.format === 'javascript' ||
            resource.location?.match(/\.(ts|tsx|js|jsx)$/));
  },

  async validate(resource, assertion, context) {
    const startTime = Date.now();
    const filePath = path.join(context.workingDir || '.', resource.location!);

    // Tier 1: Direct export check
    const exportName = assertion.check.target;
    const pattern = new RegExp(
      `export\\s+(const|function|interface|type|class)\\s+${exportName}\\b`
    );

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      if (pattern.test(content)) {
        return {
          passed: true,
          validator: 'file-export',
          resource,
          assertion,
          actual: `Found export "${exportName}"`,
          duration: Date.now() - startTime,
          tier: 1
        };
      }

      // Tier 2: Check re-exports
      const reexportPattern = new RegExp(`export\\s*\\{[^}]*\\b${exportName}\\b[^}]*\\}`);
      if (reexportPattern.test(content)) {
        return {
          passed: true,
          validator: 'file-export',
          resource,
          assertion,
          actual: `Found re-export "${exportName}"`,
          duration: Date.now() - startTime,
          tier: 2
        };
      }

      return {
        passed: false,
        validator: 'file-export',
        resource,
        assertion,
        expected: `Export "${exportName}"`,
        actual: 'Not found',
        error: `Export "${exportName}" not found in ${resource.location}`,
        duration: Date.now() - startTime,
        tier: 2
      };
    } catch (err) {
      return {
        passed: false,
        validator: 'file-export',
        resource,
        assertion,
        error: `Could not read file: ${err}`,
        duration: Date.now() - startTime
      };
    }
  }
};
```

### FileASTValidator (Current Tier 3)

Validates TypeScript signatures using the compiler API.

```typescript
/**
 * Validates TypeScript signatures using AST parsing (heavy).
 * Use when regex-based validation is insufficient.
 */
export const FileASTValidator: Validator = {
  type: 'file-ast',
  supportedResourceTypes: ['file'],

  supports(resource) {
    return resource.type === 'file' &&
           (resource.format === 'typescript' ||
            resource.location?.match(/\.tsx?$/));
  },

  async validate(resource, assertion, context) {
    const startTime = Date.now();

    // Only use AST for signature matching
    if (assertion.check.type !== 'signature_match') {
      return {
        passed: false,
        validator: 'file-ast',
        resource,
        assertion,
        error: 'AST validator only handles signature_match assertions',
        duration: Date.now() - startTime
      };
    }

    const filePath = path.join(context.workingDir || '.', resource.location!);
    const expectedSignature = assertion.check.expected;

    // Use TypeScript compiler API (implementation in ORC-62 Roadmap)
    const result = await checkSignatureMatch(filePath, assertion.check.target, expectedSignature);

    return {
      ...result,
      validator: 'file-ast',
      resource,
      duration: Date.now() - startTime,
      tier: 3
    };
  }
};
```

### JSONSchemaValidator (New)

Validates data resources against JSON Schema.

```typescript
import Ajv from 'ajv';

/**
 * Validates data resources against JSON Schema.
 * Useful for validating API responses, config files, structured outputs.
 */
export const JSONSchemaValidator: Validator = {
  type: 'json-schema',
  supportedResourceTypes: ['data', 'message', 'artifact'],

  supports(resource) {
    return ['data', 'message', 'artifact'].includes(resource.type) &&
           (resource.schema !== undefined || resource.format === 'json');
  },

  async validate(resource, assertion, context) {
    const startTime = Date.now();
    const ajv = new Ajv({ allErrors: true });

    // Get schema from assertion or resource
    const schema = assertion.check.schema || resource.schema;
    if (!schema) {
      return {
        passed: false,
        validator: 'json-schema',
        resource,
        assertion,
        error: 'No schema defined for validation',
        duration: Date.now() - startTime
      };
    }

    // Get data to validate
    let data: unknown;
    if (resource.location) {
      // Read from file
      const filePath = path.join(context.workingDir || '.', resource.location);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        data = JSON.parse(content);
      } catch (err) {
        return {
          passed: false,
          validator: 'json-schema',
          resource,
          assertion,
          error: `Could not read/parse resource: ${err}`,
          duration: Date.now() - startTime
        };
      }
    } else {
      // Get from step outputs
      data = context.stepOutputs.get(resource.id);
    }

    // Validate
    const validate = ajv.compile(schema);
    const valid = validate(data);

    return {
      passed: valid,
      validator: 'json-schema',
      resource,
      assertion,
      expected: 'Matches schema',
      actual: valid ? 'Valid' : ajv.errorsText(validate.errors),
      error: valid ? undefined : ajv.errorsText(validate.errors),
      duration: Date.now() - startTime
    };
  }
};
```

### HTTPValidator (New)

Validates HTTP endpoints exist and return expected shapes.

```typescript
/**
 * Validates HTTP endpoints exist and return expected responses.
 * Useful for agent workflows involving APIs.
 */
export const HTTPValidator: Validator = {
  type: 'http',
  supportedResourceTypes: ['api', 'endpoint'],

  supports(resource) {
    return ['api', 'endpoint'].includes(resource.type) ||
           resource.location?.startsWith('http');
  },

  async validate(resource, assertion, context) {
    const startTime = Date.now();
    const url = resource.location;

    if (!url) {
      return {
        passed: false,
        validator: 'http',
        resource,
        assertion,
        error: 'No URL specified for HTTP resource',
        duration: Date.now() - startTime
      };
    }

    try {
      const response = await fetch(url, {
        method: assertion.check.method || 'GET',
        headers: assertion.check.headers as Record<string, string>
      });

      // Check status if expected
      if (assertion.check.expectedStatus) {
        const statusMatch = response.status === assertion.check.expectedStatus;
        if (!statusMatch) {
          return {
            passed: false,
            validator: 'http',
            resource,
            assertion,
            expected: `Status ${assertion.check.expectedStatus}`,
            actual: `Status ${response.status}`,
            error: `Expected status ${assertion.check.expectedStatus}, got ${response.status}`,
            duration: Date.now() - startTime
          };
        }
      }

      // Check response schema if provided
      if (assertion.check.schema) {
        const data = await response.json();
        const ajv = new Ajv();
        const validate = ajv.compile(assertion.check.schema);
        const valid = validate(data);

        return {
          passed: valid,
          validator: 'http',
          resource,
          assertion,
          expected: 'Response matches schema',
          actual: valid ? 'Valid' : ajv.errorsText(validate.errors),
          duration: Date.now() - startTime
        };
      }

      return {
        passed: true,
        validator: 'http',
        resource,
        assertion,
        actual: `Endpoint accessible (${response.status})`,
        duration: Date.now() - startTime
      };
    } catch (err) {
      return {
        passed: false,
        validator: 'http',
        resource,
        assertion,
        error: `HTTP request failed: ${err}`,
        duration: Date.now() - startTime
      };
    }
  }
};
```

### ExistsValidator (Simple Baseline)

Validates that a resource location is accessible.

```typescript
/**
 * Simple existence check - validates resource location is accessible.
 * Runs first as a fast-fail baseline before more specific validators.
 */
export const ExistsValidator: Validator = {
  type: 'exists',
  supportedResourceTypes: ['*'],  // Supports all types

  supports(resource) {
    return resource.location !== undefined;
  },

  async validate(resource, assertion, context) {
    const startTime = Date.now();
    const location = resource.location!;

    // File-based resource
    if (!location.startsWith('http')) {
      const filePath = path.join(context.workingDir || '.', location);
      try {
        await fs.access(filePath);
        return {
          passed: true,
          validator: 'exists',
          resource,
          assertion,
          actual: 'Resource exists',
          duration: Date.now() - startTime
        };
      } catch {
        return {
          passed: false,
          validator: 'exists',
          resource,
          assertion,
          expected: `Resource at ${location}`,
          actual: 'Not found',
          error: `Resource not found: ${location}`,
          duration: Date.now() - startTime
        };
      }
    }

    // URL-based resource
    try {
      const response = await fetch(location, { method: 'HEAD' });
      return {
        passed: response.ok,
        validator: 'exists',
        resource,
        assertion,
        actual: response.ok ? 'Resource accessible' : `HTTP ${response.status}`,
        duration: Date.now() - startTime
      };
    } catch (err) {
      return {
        passed: false,
        validator: 'exists',
        resource,
        assertion,
        error: `Could not access resource: ${err}`,
        duration: Date.now() - startTime
      };
    }
  }
};
```

## 3. Validator Registry

```typescript
/**
 * Registry for managing validators.
 * Allows registration of custom validators and automatic selection.
 */
export interface ValidatorRegistry {
  /**
   * Register a custom validator.
   * Overwrites existing validator with same type.
   */
  register(validator: Validator): void;

  /**
   * Get validator by type.
   */
  get(type: string): Validator | undefined;

  /**
   * Find all validators that support a given resource.
   * Returns validators in priority order.
   */
  findFor(resource: ContractResource): Validator[];

  /**
   * Validate a resource using automatic validator selection.
   * Tries validators in order until one handles the assertion.
   */
  validate(
    resource: ContractResource,
    assertion: ContractAssertion,
    context: ValidationContext
  ): Promise<ValidationResult>;
}

/**
 * Create a validator registry with built-in validators.
 */
export function createValidatorRegistry(): ValidatorRegistry {
  const validators = new Map<string, Validator>();

  // Register built-in validators
  validators.set('exists', ExistsValidator);
  validators.set('file-export', FileExportValidator);
  validators.set('file-ast', FileASTValidator);
  validators.set('json-schema', JSONSchemaValidator);
  validators.set('http', HTTPValidator);

  return {
    register(validator) {
      validators.set(validator.type, validator);
    },

    get(type) {
      return validators.get(type);
    },

    findFor(resource) {
      return Array.from(validators.values())
        .filter(v =>
          (v.supportedResourceTypes.includes('*') ||
           v.supportedResourceTypes.includes(resource.type)) &&
          v.supports(resource)
        );
    },

    async validate(resource, assertion, context) {
      // If assertion specifies a validator, use it
      if (assertion.check.validator) {
        const validator = validators.get(assertion.check.validator);
        if (!validator) {
          return {
            passed: false,
            validator: 'unknown',
            resource,
            assertion,
            error: `Unknown validator: ${assertion.check.validator}`,
            duration: 0
          };
        }
        return validator.validate(resource, assertion, context);
      }

      // Auto-select based on resource type and assertion
      const candidates = this.findFor(resource);
      if (candidates.length === 0) {
        return {
          passed: false,
          validator: 'none',
          resource,
          assertion,
          error: `No validator found for resource type: ${resource.type}`,
          duration: 0
        };
      }

      // Use first matching validator
      return candidates[0].validate(resource, assertion, context);
    }
  };
}
```

## 4. Validation Chain

The validation strategy runs multiple validators in sequence:

```
┌─────────────────────────────────────────────────────────────────┐
│  VALIDATION CHAIN                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. ExistsValidator (runs first - fast fail)                    │
│     └─ Does the resource location exist?                        │
│        └─ FAIL → Stop immediately, return error                 │
│        └─ PASS → Continue to next validator                     │
│                                                                 │
│  2. Type-Specific Validator (based on resource type)            │
│     └─ file → FileExportValidator (Tier 1/2)                   │
│     └─ data/message → JSONSchemaValidator                       │
│     └─ api/endpoint → HTTPValidator                             │
│        └─ FAIL → Stop, return error                             │
│        └─ PASS → Continue to custom validators                  │
│                                                                 │
│  3. Custom Validators (user-defined, run last)                  │
│     └─ Protocol-specific checks                                 │
│     └─ Domain-specific validation                               │
│        └─ All must pass for assertion to pass                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```typescript
/**
 * Run validation chain for a resource.
 * All validators in the chain must pass.
 */
export async function runValidationChain(
  resource: ContractResource,
  assertion: ContractAssertion,
  context: ValidationContext,
  registry: ValidatorRegistry
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];

  // 1. Always run exists check first (fast fail)
  if (assertion.check.type !== 'exists' && resource.location) {
    const existsValidator = registry.get('exists')!;
    const existsResult = await existsValidator.validate(resource, {
      ...assertion,
      check: { type: 'exists', target: resource.id }
    }, context);

    results.push(existsResult);

    if (!existsResult.passed) {
      return results;  // Fast fail
    }
  }

  // 2. Run the main assertion validator
  const mainResult = await registry.validate(resource, assertion, context);
  results.push(mainResult);

  return results;
}
```

## 5. Custom Validator Example

Show how users would implement a custom validator:

```typescript
/**
 * Example: Custom validator for Slack messages.
 * Validates that a message was posted to the correct channel.
 */
const SlackMessageValidator: Validator = {
  type: 'slack-message',
  supportedResourceTypes: ['message'],

  supports(resource) {
    return resource.type === 'message' &&
           resource.metadata?.platform === 'slack';
  },

  async validate(resource, assertion, context) {
    const startTime = Date.now();
    const channelId = resource.metadata?.channelId as string;
    const messageId = resource.metadata?.messageId as string;

    if (!channelId || !messageId) {
      return {
        passed: false,
        validator: 'slack-message',
        resource,
        assertion,
        error: 'Missing channelId or messageId in resource metadata',
        duration: Date.now() - startTime
      };
    }

    try {
      // Check Slack API for message existence
      const slackToken = process.env.SLACK_TOKEN;
      const response = await fetch(
        `https://slack.com/api/conversations.history?channel=${channelId}&latest=${messageId}&limit=1`,
        { headers: { Authorization: `Bearer ${slackToken}` } }
      );

      const data = await response.json();
      const messageExists = data.ok && data.messages?.length > 0;

      // Optionally validate message content against schema
      if (messageExists && assertion.check.schema) {
        const ajv = new Ajv();
        const validate = ajv.compile(assertion.check.schema);
        const valid = validate(data.messages[0]);

        return {
          passed: valid,
          validator: 'slack-message',
          resource,
          assertion,
          expected: 'Message matches schema',
          actual: valid ? 'Valid' : ajv.errorsText(validate.errors),
          duration: Date.now() - startTime
        };
      }

      return {
        passed: messageExists,
        validator: 'slack-message',
        resource,
        assertion,
        actual: messageExists ? 'Message found' : 'Message not found',
        duration: Date.now() - startTime
      };
    } catch (err) {
      return {
        passed: false,
        validator: 'slack-message',
        resource,
        assertion,
        error: `Slack API error: ${err}`,
        duration: Date.now() - startTime
      };
    }
  }
};

// Register the custom validator
const registry = createValidatorRegistry();
registry.register(SlackMessageValidator);
```

## 6. Assertion Extensions

Extend `ContractAssertion` to support the generic resource model:

```typescript
/**
 * Extended ContractAssertion for generic resources.
 * Backward compatible with existing file-based assertions.
 */
export interface ContractAssertion {
  type: 'assert' | 'suggest';
  condition: string;                   // Human-readable condition
  message: string;                     // Error message if violated

  check: {
    type: AssertionCheckType;
    target: string;                    // Resource ID (or export name for files)

    // Optional: Specify which validator to use
    validator?: string;                // e.g., "json-schema", "slack-message"

    // For schema validation
    schema?: JSONSchema;

    // For pattern matching
    pattern?: string;

    // For equality checks
    expected?: unknown;

    // For HTTP validation
    method?: string;
    headers?: Record<string, string>;
    expectedStatus?: number;

    // Legacy: File path (for backward compatibility)
    file?: string;
  };
}

/**
 * Extended check types for generic resources.
 * Includes all original types plus new generic ones.
 */
export type AssertionCheckType =
  // Existing (file-based)
  | 'export_exists'        // File export exists (current)
  | 'file_exists'          // File exists (current)
  | 'pattern_match'        // Regex pattern (current)
  | 'signature_match'      // Function signature (current)
  | 'function_exists'      // Function exists (current)
  | 'type_matches'         // Type shape (roadmap)

  // New (generic)
  | 'exists'               // Resource exists (any type)
  | 'schema_match'         // Matches JSON schema
  | 'http_status'          // HTTP endpoint returns status
  | 'contains'             // Resource contains value
  | 'equals'               // Resource equals value
  | 'custom';              // Custom validator
```

## 7. Backward Compatibility

This pluggable validation layer is **additive** and maintains full backward compatibility:

| Aspect | Status |
|--------|--------|
| Current file-based validators | **Unchanged** - FileExportValidator and FileASTValidator work exactly as before |
| Current assertion types | **Valid** - All existing assertion types continue to work |
| Specwright execution | **Uses file validators by default** - No changes to current code paths |
| Generic validators | **Opt-in** - Only used when resource type is non-file or validator is specified |
| Custom validators | **Opt-in** - Register via ValidatorRegistry for custom protocols |

### Default Validator Selection

When no validator is explicitly specified:

| Resource Type | Default Validator |
|--------------|-------------------|
| `file` | FileExportValidator |
| `data` | JSONSchemaValidator |
| `message` | JSONSchemaValidator |
| `artifact` | ExistsValidator |
| `api` / `endpoint` | HTTPValidator |
| Other | ExistsValidator |

### Protocol Adapter Integration

Protocol adapters (from ORC-61) can register their own validators:

```typescript
class SpecwrightAdapter implements ProtocolAdapter {
  // ... other methods ...

  registerValidators(registry: ValidatorRegistry): void {
    // Specwright uses file-based validators (already registered)
    // Could add custom validators for specific Specwright checks
  }
}

class SlackAdapter implements ProtocolAdapter {
  // ... other methods ...

  registerValidators(registry: ValidatorRegistry): void {
    registry.register(SlackMessageValidator);
    registry.register(SlackChannelValidator);
  }
}
```

---

# Acceptance Criteria

## MVP

- [ ] Pre-execution gate blocks if dependencies not completed
- [ ] Pre-execution gate blocks if consumes not available
- [ ] Context accumulated from previous chunks (git diff + exports)
- [ ] Prompt includes available exports section
- [ ] Prompt includes retry context on failures
- [ ] Regex-based export existence check (Tier 1)
- [ ] Additive tolerance: extra exports OK, missing = fail
- [ ] Automatic retry up to 3 times with error context
- [ ] Validation results displayed in UI
- [ ] Context stored in database per chunk

## Roadmap

- [ ] Impact analysis before modifying existing code
- [ ] Impact summary included in prompt
- [ ] Contract amendment proposal on repeated failures
- [ ] Amendment UI with accept/reject
- [ ] AST-based signature validation (Tier 3)
- [ ] LLM-as-judge for semantic checks
- [ ] Parallel chunk execution for independent chunks
