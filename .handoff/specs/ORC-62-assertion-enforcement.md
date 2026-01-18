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

## Core Concepts

### Assert vs Suggest (DSPy Pattern)

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
    pattern: 'try\\s*\\{[\\s\\S]*catch\\s*\\([^)]*Error'
  }
}
```

### Retry with Context

On assertion failure:
1. Capture the specific violation
2. Feed back to GLM with error context
3. Retry execution (up to N times)
4. If still failing after N retries, fail chunk with detailed feedback

```typescript
interface RetryContext {
  attempt: number;
  maxAttempts: number;
  previousViolations: {
    assertion: ContractAssertion;
    actual: string;
    expected: string;
  }[];
}
```

## Data Model Changes

### New Types (packages/shared/src/types.ts)

```typescript
// Execution context passed between chunks
export interface ChunkExecutionContext {
  // What previous chunks have created
  availableExports: {
    name: string;           // "HealthCheckResult"
    from: string;           // "@specwright/shared"
    type: 'type' | 'interface' | 'function' | 'const' | 'class';
    createdByChunk: string; // Chunk ID that created this
  }[];

  // Files that exist (created or modified by previous chunks)
  availableFiles: {
    path: string;
    exports: string[];
    createdByChunk?: string;
  }[];

  // Accumulated git diff summary
  changesSoFar: {
    filesCreated: string[];
    filesModified: string[];
    totalAdditions: number;
    totalDeletions: number;
  };
}

// Result of assertion check
export interface AssertionResult {
  assertion: ContractAssertion;
  passed: boolean;
  actual?: string;          // What was found
  expected?: string;        // What was expected
  error?: string;           // Error message if check failed
}

// Result of all validations for a chunk
export interface ChunkValidationResult {
  passed: boolean;
  assertResults: AssertionResult[];   // Hard requirements
  suggestResults: AssertionResult[];  // Soft guidance
  buildPassed: boolean;
  buildOutput?: string;
  retryable: boolean;                  // Can we retry?
  retryContext?: RetryContext;
}
```

### Database Changes

Add execution context tracking:

```sql
-- Track accumulated context per spec execution
CREATE TABLE IF NOT EXISTS execution_contexts (
  id TEXT PRIMARY KEY,
  spec_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  context JSON NOT NULL,           -- ChunkExecutionContext
  validation_result JSON,          -- ChunkValidationResult
  attempt_number INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (spec_id) REFERENCES specs(id),
  FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);
```

## Layer 1: Pre-Execution Gate

Before a chunk executes, verify all preconditions:

```typescript
// packages/dashboard/src/lib/services/pre-execution-gate.ts

export interface PreExecutionResult {
  canExecute: boolean;
  blockedBy?: {
    type: 'missing_dependency' | 'failed_chunk' | 'missing_export';
    details: string;
  }[];
}

export async function checkPreExecutionGate(
  chunk: Chunk,
  context: ChunkExecutionContext,
  workingDir: string
): Promise<PreExecutionResult> {
  const blockers: PreExecutionResult['blockedBy'] = [];

  // 1. Check dependsOn chunks completed successfully
  if (chunk.dependsOn && chunk.dependsOn.length > 0) {
    for (const depId of chunk.dependsOn) {
      const depChunk = await getChunk(depId);
      if (!depChunk) {
        blockers.push({
          type: 'missing_dependency',
          details: `Dependency chunk ${depId} not found`
        });
      } else if (depChunk.status !== 'completed' || depChunk.reviewStatus !== 'pass') {
        blockers.push({
          type: 'failed_chunk',
          details: `Dependency chunk "${depChunk.title}" has status ${depChunk.status}/${depChunk.reviewStatus}`
        });
      }
    }
  }

  // 2. Check consumes are available
  if (chunk.consumes && chunk.consumes.length > 0) {
    for (const item of chunk.consumes) {
      const available = context.availableExports.some(e => e.name === item) ||
                       await checkExportExists(item, workingDir);
      if (!available) {
        blockers.push({
          type: 'missing_export',
          details: `Required export "${item}" not available`
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

Inject contract and available context into the execution prompt:

```typescript
// packages/dashboard/src/prompts/executor.ts

export function buildExecutorPrompt(
  chunk: Chunk,
  spec: Spec,
  context: ChunkExecutionContext,
  retryContext?: RetryContext
): string {
  const parts: string[] = [];

  // Base task description
  parts.push(`# Task: ${chunk.title}\n\n${chunk.description}`);

  // Contract assertions (what MUST be done)
  if (chunk.assertions && chunk.assertions.length > 0) {
    const asserts = chunk.assertions.filter(a => a.type === 'assert');
    const suggests = chunk.assertions.filter(a => a.type === 'suggest');

    if (asserts.length > 0) {
      parts.push(`\n\n## REQUIREMENTS (Must be met)\n`);
      for (const a of asserts) {
        parts.push(`- ✓ ${a.message}`);
      }
    }

    if (suggests.length > 0) {
      parts.push(`\n\n## GUIDANCE (Should follow)\n`);
      for (const s of suggests) {
        parts.push(`- ○ ${s.message}`);
      }
    }
  }

  // What this chunk must create
  if (chunk.creates && chunk.creates.length > 0) {
    parts.push(`\n\n## YOU MUST CREATE\n`);
    for (const item of chunk.creates) {
      parts.push(`- ${item}`);
    }
  }

  // Available imports (from previous chunks)
  if (context.availableExports.length > 0) {
    parts.push(`\n\n## AVAILABLE IMPORTS (verified to exist)\n`);
    const grouped = groupBy(context.availableExports, 'from');
    for (const [from, exports] of Object.entries(grouped)) {
      parts.push(`From "${from}":`);
      for (const exp of exports) {
        parts.push(`  - ${exp.name} (${exp.type})`);
      }
    }
  }

  // What NOT to import (doesn't exist yet)
  if (chunk.consumes) {
    const notYetAvailable = chunk.consumes.filter(item =>
      !context.availableExports.some(e => e.name === item)
    );
    if (notYetAvailable.length > 0) {
      parts.push(`\n\n## DO NOT IMPORT (not yet created)\n`);
      for (const item of notYetAvailable) {
        parts.push(`- ${item} - YOU must create this`);
      }
    }
  }

  // Retry context (if this is a retry attempt)
  if (retryContext && retryContext.attempt > 1) {
    parts.push(`\n\n## PREVIOUS ATTEMPT FAILED\n`);
    parts.push(`This is attempt ${retryContext.attempt} of ${retryContext.maxAttempts}.\n`);
    parts.push(`Previous violations:\n`);
    for (const v of retryContext.previousViolations) {
      parts.push(`- ${v.assertion.message}`);
      parts.push(`  Expected: ${v.expected}`);
      parts.push(`  Actual: ${v.actual}`);
    }
    parts.push(`\nFix these issues in this attempt.`);
  }

  // Files modified so far
  if (context.changesSoFar.filesCreated.length > 0 ||
      context.changesSoFar.filesModified.length > 0) {
    parts.push(`\n\n## CHANGES MADE BY PREVIOUS CHUNKS\n`);
    if (context.changesSoFar.filesCreated.length > 0) {
      parts.push(`Created: ${context.changesSoFar.filesCreated.join(', ')}`);
    }
    if (context.changesSoFar.filesModified.length > 0) {
      parts.push(`Modified: ${context.changesSoFar.filesModified.join(', ')}`);
    }
  }

  return parts.join('\n');
}
```

## Layer 3: Post-Execution Validation

After GLM completes, validate all assertions:

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

    // Validate each assertion
    for (const assertion of chunk.assertions || []) {
      const result = await this.checkAssertion(assertion);

      if (assertion.type === 'assert') {
        assertResults.push(result);
      } else {
        suggestResults.push(result);
      }
    }

    // All asserts must pass
    const assertsPassed = assertResults.every(r => r.passed);

    // Suggests are logged but don't fail
    const suggestsPassed = suggestResults.filter(r => !r.passed);
    if (suggestsPassed.length > 0) {
      console.log('[Validation] Suggestions not followed:', suggestsPassed);
    }

    return {
      passed: assertsPassed && buildResult.passed,
      assertResults,
      suggestResults,
      buildPassed: buildResult.passed,
      buildOutput: buildResult.output,
      retryable: !assertsPassed && assertResults.some(r => !r.passed),
      retryContext: !assertsPassed ? {
        attempt: 1,
        maxAttempts: 3,
        previousViolations: assertResults
          .filter(r => !r.passed)
          .map(r => ({
            assertion: r.assertion,
            actual: r.actual || 'not found',
            expected: r.expected || r.assertion.message
          }))
      } : undefined
    };
  }

  private async checkAssertion(assertion: ContractAssertion): Promise<AssertionResult> {
    try {
      switch (assertion.check.type) {
        case 'export_exists':
          return this.checkExportExists(assertion);

        case 'file_exists':
          return this.checkFileExists(assertion);

        case 'function_exists':
          return this.checkFunctionExists(assertion);

        case 'type_matches':
          return this.checkTypeMatches(assertion);

        case 'pattern_match':
          return this.checkPatternMatch(assertion);

        case 'custom':
          return this.checkCustom(assertion);

        default:
          return {
            assertion,
            passed: false,
            error: `Unknown check type: ${assertion.check.type}`
          };
      }
    } catch (error) {
      return {
        assertion,
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkExportExists(assertion: ContractAssertion): Promise<AssertionResult> {
    const { target, file } = assertion.check as { target: string; file?: string };

    // Use TypeScript compiler API to find export
    const exports = await this.findExportsInFile(
      file || this.findFileWithExport(target)
    );

    const found = exports.includes(target);

    return {
      assertion,
      passed: found,
      expected: `Export "${target}" in ${file}`,
      actual: found ? `Found "${target}"` : `Exports found: ${exports.join(', ') || 'none'}`
    };
  }

  private async checkFileExists(assertion: ContractAssertion): Promise<AssertionResult> {
    const { target } = assertion.check;
    const fullPath = path.join(this.workingDir, target);
    const exists = await fs.access(fullPath).then(() => true).catch(() => false);

    return {
      assertion,
      passed: exists,
      expected: `File ${target} exists`,
      actual: exists ? 'File exists' : 'File not found'
    };
  }

  private async checkFunctionExists(assertion: ContractAssertion): Promise<AssertionResult> {
    const { target, file, expected } = assertion.check as {
      target: string;
      file: string;
      expected?: string;  // Expected signature
    };

    const functions = await this.findFunctionsInFile(path.join(this.workingDir, file));
    const found = functions.find(f => f.name === target);

    if (!found) {
      return {
        assertion,
        passed: false,
        expected: `Function "${target}" in ${file}`,
        actual: `Functions found: ${functions.map(f => f.name).join(', ') || 'none'}`
      };
    }

    if (expected && found.signature !== expected) {
      return {
        assertion,
        passed: false,
        expected: `${target}${expected}`,
        actual: `${target}${found.signature}`
      };
    }

    return {
      assertion,
      passed: true,
      expected: `Function "${target}"`,
      actual: `Found ${target}${found.signature}`
    };
  }

  private async checkTypeMatches(assertion: ContractAssertion): Promise<AssertionResult> {
    const { target, file, expected } = assertion.check as {
      target: string;
      file: string;
      expected: string;  // Expected type definition
    };

    const types = await this.findTypesInFile(path.join(this.workingDir, file));
    const found = types.find(t => t.name === target);

    if (!found) {
      return {
        assertion,
        passed: false,
        expected: `Type "${target}" in ${file}`,
        actual: `Types found: ${types.map(t => t.name).join(', ') || 'none'}`
      };
    }

    // Normalize and compare type definitions
    const normalizedExpected = this.normalizeTypeDefinition(expected);
    const normalizedActual = this.normalizeTypeDefinition(found.definition);

    const matches = normalizedExpected === normalizedActual;

    return {
      assertion,
      passed: matches,
      expected: normalizedExpected,
      actual: normalizedActual
    };
  }

  private async checkPatternMatch(assertion: ContractAssertion): Promise<AssertionResult> {
    const { target, pattern } = assertion.check as {
      target: string;  // File path
      pattern: string; // Regex pattern
    };

    const content = await fs.readFile(
      path.join(this.workingDir, target),
      'utf-8'
    );

    const regex = new RegExp(pattern);
    const matches = regex.test(content);

    return {
      assertion,
      passed: matches,
      expected: `Pattern /${pattern}/ in ${target}`,
      actual: matches ? 'Pattern found' : 'Pattern not found'
    };
  }

  private async checkCustom(assertion: ContractAssertion): Promise<AssertionResult> {
    // Custom checks are evaluated by running a small script or function
    const { target } = assertion.check;

    // For now, custom checks always pass with a warning
    console.warn(`[Validation] Custom check not implemented: ${target}`);

    return {
      assertion,
      passed: true,
      expected: assertion.message,
      actual: 'Custom check skipped (not implemented)'
    };
  }

  // Helper methods for TypeScript analysis
  private async findExportsInFile(filePath: string): Promise<string[]> {
    // Use TypeScript compiler API
    const program = ts.createProgram([filePath], {});
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return [];

    const exports: string[] = [];

    ts.forEachChild(sourceFile, node => {
      if (ts.isExportDeclaration(node) || hasExportModifier(node)) {
        const name = getNodeName(node);
        if (name) exports.push(name);
      }
    });

    return exports;
  }

  private async findFunctionsInFile(filePath: string): Promise<{ name: string; signature: string }[]> {
    // Similar TypeScript analysis for functions
    // ... implementation
  }

  private async findTypesInFile(filePath: string): Promise<{ name: string; definition: string }[]> {
    // Similar TypeScript analysis for types
    // ... implementation
  }

  private normalizeTypeDefinition(def: string): string {
    // Remove whitespace, normalize formatting for comparison
    return def.replace(/\s+/g, ' ').trim();
  }
}
```

## Layer 4: Context Accumulation

After successful chunk execution, accumulate context:

```typescript
// packages/dashboard/src/lib/services/context-accumulator.ts

export class ContextAccumulator {
  constructor(private specId: string) {}

  async getContextForChunk(chunkOrder: number): Promise<ChunkExecutionContext> {
    // Get all completed chunks before this one
    const previousChunks = await this.getCompletedChunksBefore(chunkOrder);

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
      const chunkContext = await this.getChunkContext(chunk.id);
      if (chunkContext) {
        context.availableExports.push(...chunkContext.availableExports);
        context.availableFiles.push(...chunkContext.availableFiles);
        context.changesSoFar.filesCreated.push(...chunkContext.changesSoFar.filesCreated);
        context.changesSoFar.filesModified.push(...chunkContext.changesSoFar.filesModified);
        context.changesSoFar.totalAdditions += chunkContext.changesSoFar.totalAdditions;
        context.changesSoFar.totalDeletions += chunkContext.changesSoFar.totalDeletions;
      }
    }

    return context;
  }

  async recordChunkContext(
    chunkId: string,
    workingDir: string
  ): Promise<ChunkExecutionContext> {
    // Get git diff for this chunk
    const diff = await this.getGitDiffForChunk(workingDir);

    // Parse created/modified files
    const filesCreated = diff.files.filter(f => f.status === 'A').map(f => f.path);
    const filesModified = diff.files.filter(f => f.status === 'M').map(f => f.path);

    // Find exports in created/modified files
    const exports: ChunkExecutionContext['availableExports'] = [];

    for (const file of [...filesCreated, ...filesModified]) {
      const fileExports = await this.findExportsInFile(path.join(workingDir, file));
      for (const exp of fileExports) {
        exports.push({
          name: exp.name,
          from: this.getImportPath(file),
          type: exp.type,
          createdByChunk: chunkId
        });
      }
    }

    const context: ChunkExecutionContext = {
      availableExports: exports,
      availableFiles: [...filesCreated, ...filesModified].map(p => ({
        path: p,
        exports: exports.filter(e => this.getImportPath(p) === e.from).map(e => e.name),
        createdByChunk: chunkId
      })),
      changesSoFar: {
        filesCreated,
        filesModified,
        totalAdditions: diff.additions,
        totalDeletions: diff.deletions
      }
    };

    // Save to database
    await this.saveChunkContext(chunkId, context);

    return context;
  }

  private getImportPath(filePath: string): string {
    // Convert file path to import path
    // e.g., "packages/shared/src/types.ts" -> "@specwright/shared"
    if (filePath.startsWith('packages/shared/')) {
      return '@specwright/shared';
    }
    // ... other mappings
    return filePath;
  }
}
```

## Integration with Chunk Pipeline

Modify `chunk-pipeline.ts` to use the enforcement system:

```typescript
// packages/dashboard/src/lib/services/chunk-pipeline.ts

export async function executeChunkWithEnforcement(
  chunk: Chunk,
  spec: Spec,
  gitState: GitWorkflowState,
  events: ChunkPipelineEvents
): Promise<ChunkPipelineResult> {
  const accumulator = new ContextAccumulator(spec.id);
  const validator = new AssertionValidator(gitState.workingDir);

  // LAYER 1: Pre-execution gate
  const context = await accumulator.getContextForChunk(chunk.order);
  const gateResult = await checkPreExecutionGate(chunk, context, gitState.workingDir);

  if (!gateResult.canExecute) {
    events.onError?.(chunk.id, `Blocked: ${gateResult.blockedBy?.map(b => b.details).join(', ')}`);
    return {
      status: 'fail',
      error: `Preconditions not met: ${gateResult.blockedBy?.map(b => b.details).join(', ')}`
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
    const executionResult = await chunkExecutor.execute(chunk.id, prompt, gitState.workingDir);

    events.onExecutionComplete?.(chunk.id, executionResult);

    // Run build
    const buildResult = await runBuild(gitState.workingDir);

    // LAYER 3: Post-execution validation
    const validationResult = await validator.validateChunk(chunk, buildResult);

    if (validationResult.passed) {
      // LAYER 4: Context accumulation
      await accumulator.recordChunkContext(chunk.id, gitState.workingDir);

      // Commit changes
      if (gitState.enabled) {
        await gitService.commit(gitState, `chunk: ${chunk.title}`);
      }

      events.onValidationComplete?.(chunk.id, validationResult);

      return {
        status: 'pass',
        output: executionResult.output
      };
    }

    // Check if retryable
    if (!validationResult.retryable || attempt >= maxAttempts) {
      events.onValidationComplete?.(chunk.id, validationResult);

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

    // Prepare retry context
    retryContext = {
      attempt: attempt + 1,
      maxAttempts,
      previousViolations: validationResult.assertResults
        .filter(r => !r.passed)
        .map(r => ({
          assertion: r.assertion,
          actual: r.actual || 'not found',
          expected: r.expected || r.assertion.message
        }))
    };

    // Reset for retry
    if (gitState.enabled) {
      gitService.resetHard(gitState);
    }

    console.log(`[Pipeline] Assertion failed, retrying (${attempt + 1}/${maxAttempts})`);
    attempt++;
  }

  // Should not reach here
  return { status: 'fail', error: 'Max retries exceeded' };
}

function formatValidationErrors(result: ChunkValidationResult): string {
  const parts: string[] = [];

  if (!result.buildPassed) {
    parts.push('BUILD FAILED:');
    parts.push(result.buildOutput || 'Unknown build error');
  }

  const failedAsserts = result.assertResults.filter(r => !r.passed);
  if (failedAsserts.length > 0) {
    parts.push('\nASSERTION FAILURES:');
    for (const r of failedAsserts) {
      parts.push(`- ${r.assertion.message}`);
      parts.push(`  Expected: ${r.expected}`);
      parts.push(`  Actual: ${r.actual}`);
    }
  }

  const failedSuggests = result.suggestResults.filter(r => !r.passed);
  if (failedSuggests.length > 0) {
    parts.push('\nSUGGESTIONS NOT FOLLOWED (non-blocking):');
    for (const r of failedSuggests) {
      parts.push(`- ${r.assertion.message}`);
    }
  }

  return parts.join('\n');
}
```

## Impact Analysis Integration

Before modifying existing files, analyze impact:

```typescript
// packages/dashboard/src/lib/services/impact-analyzer.ts

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

  // Find files this chunk will modify (from contract)
  const filesToModify = getFilesToModify(chunk);

  for (const file of filesToModify) {
    // Find all imports of this file
    const importers = await findFilesThatImport(file, workingDir);
    impact.filesAffected.push(...importers);

    // Find exports that might be affected
    const exports = await findExportsInFile(path.join(workingDir, file));

    for (const exp of exports) {
      if (exp.type === 'function') {
        const callers = await findCallers(exp.name, workingDir);
        if (callers.length > 0) {
          impact.functionsAffected.push({
            name: exp.name,
            file,
            callers
          });
        }
      } else if (exp.type === 'type' || exp.type === 'interface') {
        const usages = await findTypeUsages(exp.name, workingDir);
        if (usages.length > 0) {
          impact.typesAffected.push({
            name: exp.name,
            file,
            usages
          });
        }
      }
    }
  }

  // Generate summary for prompt
  impact.summary = generateImpactSummary(impact);

  return impact;
}

function generateImpactSummary(impact: ImpactAnalysis): string {
  const parts: string[] = [];

  if (impact.functionsAffected.length > 0) {
    parts.push('FUNCTIONS YOU ARE MODIFYING:');
    for (const f of impact.functionsAffected) {
      parts.push(`- ${f.name} in ${f.file}`);
      parts.push(`  Called by: ${f.callers.map(c => `${c.file}:${c.line}`).join(', ')}`);
    }
  }

  if (impact.typesAffected.length > 0) {
    parts.push('\nTYPES YOU ARE MODIFYING:');
    for (const t of impact.typesAffected) {
      parts.push(`- ${t.name} in ${t.file}`);
      parts.push(`  Used in: ${t.usages.map(u => `${u.file}:${u.line}`).join(', ')}`);
    }
  }

  if (parts.length > 0) {
    parts.unshift('IMPACT ANALYSIS:');
    parts.push('\nVerify your changes don\'t break these usages.');
  }

  return parts.join('\n');
}
```

## UI: Validation Results Display

Show assertion results in the execution panel:

```typescript
// packages/dashboard/src/components/ValidationResultsPanel.tsx

interface Props {
  result: ChunkValidationResult;
}

export function ValidationResultsPanel({ result }: Props) {
  return (
    <div className="space-y-4">
      {/* Build Status */}
      <div className={`p-3 rounded-lg ${result.buildPassed ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
        <div className="flex items-center gap-2">
          {result.buildPassed ? (
            <CheckCircle className="w-5 h-5 text-green-400" />
          ) : (
            <XCircle className="w-5 h-5 text-red-400" />
          )}
          <span className="font-medium">
            Build {result.buildPassed ? 'Passed' : 'Failed'}
          </span>
        </div>
        {!result.buildPassed && result.buildOutput && (
          <pre className="mt-2 text-xs text-red-300 overflow-auto max-h-40">
            {result.buildOutput}
          </pre>
        )}
      </div>

      {/* Assertions */}
      {result.assertResults.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-neutral-300 mb-2">
            Requirements ({result.assertResults.filter(r => r.passed).length}/{result.assertResults.length})
          </h4>
          <div className="space-y-2">
            {result.assertResults.map((r, i) => (
              <div
                key={i}
                className={`p-2 rounded border ${
                  r.passed
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-red-500/30 bg-red-500/5'
                }`}
              >
                <div className="flex items-center gap-2">
                  {r.passed ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <X className="w-4 h-4 text-red-400" />
                  )}
                  <span className="text-sm">{r.assertion.message}</span>
                </div>
                {!r.passed && (
                  <div className="mt-1 text-xs text-neutral-400 pl-6">
                    <div>Expected: {r.expected}</div>
                    <div>Actual: {r.actual}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {result.suggestResults.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-neutral-300 mb-2">
            Suggestions ({result.suggestResults.filter(r => r.passed).length}/{result.suggestResults.length})
          </h4>
          <div className="space-y-2">
            {result.suggestResults.map((r, i) => (
              <div
                key={i}
                className={`p-2 rounded border ${
                  r.passed
                    ? 'border-blue-500/30 bg-blue-500/5'
                    : 'border-yellow-500/30 bg-yellow-500/5'
                }`}
              >
                <div className="flex items-center gap-2">
                  {r.passed ? (
                    <Check className="w-4 h-4 text-blue-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-yellow-400" />
                  )}
                  <span className="text-sm">{r.assertion.message}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Retry Info */}
      {result.retryContext && (
        <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-yellow-400" />
            <span className="text-sm">
              Retry {result.retryContext.attempt} of {result.retryContext.maxAttempts}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
```

## Acceptance Criteria

### Layer 1: Pre-Execution Gate
- [ ] Block execution if dependency chunks not completed
- [ ] Block execution if consumes items don't exist
- [ ] Clear error messages for blocked executions
- [ ] Gate check logged in execution panel

### Layer 2: Context Injection
- [ ] Prompt includes contract assertions as requirements
- [ ] Prompt includes available exports from previous chunks
- [ ] Prompt includes "do not import" list for non-existent items
- [ ] Retry context injected on subsequent attempts

### Layer 3: Post-Execution Validation
- [ ] Export existence checks using TypeScript compiler
- [ ] File existence checks
- [ ] Function signature checks
- [ ] Pattern matching for suggest assertions
- [ ] Automatic retry on assert failure (up to 3 times)
- [ ] Error context passed to retry attempts
- [ ] Validation results displayed in UI

### Layer 4: Context Accumulation
- [ ] Git diff parsed after successful chunk
- [ ] Exports extracted from created/modified files
- [ ] Context saved to database
- [ ] Context accumulated across chunks
- [ ] Context passed to subsequent chunks

### Impact Analysis
- [ ] Find callers of modified functions
- [ ] Find usages of modified types
- [ ] Impact summary included in prompt
- [ ] Impact logged for debugging

## Future Enhancements

- LLM-as-judge for semantic assertion checks
- Parallel chunk execution (respecting dependencies)
- Assertion templates for common patterns
- Custom assertion plugins
- Assertion analytics (which assertions fail most?)
- Auto-generate assertions from code patterns
