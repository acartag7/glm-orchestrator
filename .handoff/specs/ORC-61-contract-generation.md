# ORC-61: Contract Generation System

## Overview

Implement a contract generation phase in Spec Studio that produces explicit, typed contracts from natural language specs before chunking. Contracts define exactly what will be created (types, files, functions, signatures) and how chunks depend on each other.

## Problem Statement

Current chunking is vague:
- Chunks have titles and descriptions but no explicit contracts
- No definition of what each chunk creates vs consumes
- No explicit dependencies between chunks
- GLM must guess what exists, leading to broken imports

## Solution

Add a **Contract Phase** between spec refinement and chunking:

```
Spec Writing → Spec Refinement → CONTRACT GENERATION → Chunking → Execution
                                        ↑
                                   NEW PHASE
```

Opus analyzes the refined spec and produces a typed contract that:
1. Defines all types/interfaces with exact definitions
2. Defines all files with paths and exports
3. Defines all function signatures
4. Breaks into chunks with explicit `creates[]`/`consumes[]`/`dependsOn[]`
5. Includes assertions for each chunk

## Data Model Changes

### New Types (packages/shared/src/types.ts)

```typescript
// Contract for a type/interface to be created
export interface ContractType {
  name: string;              // "HealthCheckResult"
  file: string;              // "packages/shared/src/types.ts"
  definition: string;        // Full TypeScript definition
  exportedFrom: string;      // "@specwright/shared"
}

// Contract for a file to be created/modified
export interface ContractFile {
  path: string;              // "packages/dashboard/src/lib/health-check.ts"
  action: 'create' | 'modify';
  purpose: string;           // Brief description
  exports: string[];         // ["checkHealth", "HealthChecker"]
  imports: {
    from: string;            // "@specwright/shared"
    items: string[];         // ["HealthCheckResult"]
  }[];
}

// Contract for a function signature
export interface ContractFunction {
  name: string;              // "checkHealth"
  file: string;              // File where it's defined
  signature: string;         // "(): Promise<HealthCheckResult>"
  description: string;       // What it does
}

// Assertion for a chunk
export interface ContractAssertion {
  type: 'assert' | 'suggest';
  condition: string;         // Human-readable condition
  check: {
    type: 'export_exists' | 'file_exists' | 'function_exists' | 'type_matches' | 'custom';
    target: string;          // What to check
    expected?: string;       // Expected value/shape
  };
  message: string;           // Error message if violated
}

// Contract for a single chunk
export interface ContractChunk {
  order: number;
  title: string;
  description: string;
  creates: string[];         // ["HealthCheckResult", "checkHealth()"]
  consumes: string[];        // ["Chunk", "Spec from @specwright/shared"]
  dependsOn: number[];       // [1, 2] - chunk orders this depends on
  assertions: ContractAssertion[];
}

// Full spec contract
export interface SpecContract {
  version: string;           // Contract schema version
  specId: string;
  generatedAt: string;       // ISO timestamp

  // What will be created
  types: ContractType[];
  files: ContractFile[];
  functions: ContractFunction[];

  // How work is divided
  chunks: ContractChunk[];

  // Global assertions (apply to all chunks)
  globalAssertions: ContractAssertion[];
}
```

### Database Changes

Add `contract` column to specs table:

```sql
ALTER TABLE specs ADD COLUMN contract TEXT;  -- JSON serialized SpecContract
```

Update Spec type:

```typescript
export interface Spec {
  // ... existing fields
  contract?: SpecContract;
  contractApprovedAt?: string;
}
```

Update Chunk type:

```typescript
export interface Chunk {
  // ... existing fields
  creates?: string[];
  consumes?: string[];
  dependsOn?: string[];      // Chunk IDs
  assertions?: ContractAssertion[];
}
```

## UI Changes

### Spec Studio: New Contract Step

Add step between "Refine Spec" and "Generate Chunks":

```
[1. Write Spec] → [2. Refine] → [3. REVIEW CONTRACT] → [4. Chunks] → [5. Execute]
                                        ↑
                                   NEW STEP
```

**Contract Review UI (`ContractReviewStep.tsx`):**

```
┌─────────────────────────────────────────────────────────────────┐
│  CONTRACT REVIEW                                    [Regenerate]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  TYPES (3)                                              [Expand]│
│  ┌─────────────────────────────────────────────────────────────┐
│  │ HealthCheckResult    @specwright/shared                     │
│  │ HealthCheckDependency @specwright/shared                    │
│  │ HealthStatus          @specwright/shared                    │
│  └─────────────────────────────────────────────────────────────┘
│                                                                 │
│  FILES (4)                                              [Expand]│
│  ┌─────────────────────────────────────────────────────────────┐
│  │ ● CREATE  packages/shared/src/types.ts                      │
│  │ ● CREATE  packages/dashboard/src/lib/health-check.ts        │
│  │ ● CREATE  packages/dashboard/src/components/HealthPanel.tsx │
│  │ ○ MODIFY  packages/dashboard/src/app/page.tsx               │
│  └─────────────────────────────────────────────────────────────┘
│                                                                 │
│  CHUNKS (4)                                                     │
│  ┌─────────────────────────────────────────────────────────────┐
│  │ 1. Create health check types                                │
│  │    Creates: HealthCheckResult, HealthCheckDependency        │
│  │    Consumes: (none)                                         │
│  │    Depends on: (none)                                       │
│  │                                                              │
│  │ 2. Implement health check logic         ←────────┐          │
│  │    Creates: checkHealth()                        │ depends  │
│  │    Consumes: HealthCheckResult                   │          │
│  │    Depends on: Chunk 1                  ─────────┘          │
│  │                                                              │
│  │ 3. Create HealthPanel component         ←────────┐          │
│  │    Creates: HealthPanel                          │ depends  │
│  │    Consumes: HealthCheckResult, checkHealth()    │          │
│  │    Depends on: Chunk 1, Chunk 2         ─────────┘          │
│  │                                                              │
│  │ 4. Integrate into main page             ←────────┐          │
│  │    Creates: (none - modification)                │ depends  │
│  │    Consumes: HealthPanel                         │          │
│  │    Depends on: Chunk 3                  ─────────┘          │
│  └─────────────────────────────────────────────────────────────┘
│                                                                 │
│  DEPENDENCY GRAPH                                               │
│  ┌─────────────────────────────────────────────────────────────┐
│  │     [1]                                                     │
│  │      ↓                                                      │
│  │     [2]                                                     │
│  │      ↓                                                      │
│  │     [3]                                                     │
│  │      ↓                                                      │
│  │     [4]                                                     │
│  └─────────────────────────────────────────────────────────────┘
│                                                                 │
│                              [Edit Contract] [Approve Contract] │
└─────────────────────────────────────────────────────────────────┘
```

**Expanded Type View:**

```
┌─────────────────────────────────────────────────────────────────┐
│  HealthCheckResult                              [Edit] [Remove] │
│  ─────────────────────────────────────────────────────────────  │
│  File: packages/shared/src/types.ts                             │
│  Export: @specwright/shared                                     │
│                                                                 │
│  interface HealthCheckResult {                                  │
│    healthy: boolean;                                            │
│    dependencies: HealthCheckDependency[];                       │
│    checkedAt: string;                                           │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

**Expanded Chunk View:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Chunk 2: Implement health check logic          [Edit] [Remove] │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Description:                                                   │
│  Create the checkHealth() function that validates git and gh   │
│  CLI are installed and accessible.                              │
│                                                                 │
│  Creates:                                                       │
│  • checkHealth(): Promise<HealthCheckResult>                    │
│                                                                 │
│  Consumes:                                                      │
│  • HealthCheckResult from @specwright/shared                    │
│  • HealthCheckDependency from @specwright/shared                │
│                                                                 │
│  Depends On:                                                    │
│  • Chunk 1: Create health check types                           │
│                                                                 │
│  Assertions:                                                    │
│  ✓ ASSERT: File packages/dashboard/src/lib/health-check.ts     │
│            must export checkHealth                              │
│  ○ SUGGEST: Follow existing patterns in lib/ folder            │
└─────────────────────────────────────────────────────────────────┘
```

### Contract Edit Modal

Allow users to modify the generated contract:

- Add/remove/edit types
- Add/remove/edit files
- Modify chunk creates/consumes
- Reorder chunks (respecting dependencies)
- Add/remove assertions

## API Changes

### New Endpoints

**POST /api/specs/[id]/contract/generate**

Generate contract from refined spec:

```typescript
// Request
{ }  // No body needed, uses existing spec content

// Response
{
  contract: SpecContract;
  warnings: string[];  // Non-blocking issues detected
}
```

**PUT /api/specs/[id]/contract**

Save/update contract:

```typescript
// Request
{
  contract: SpecContract;
}

// Response
{
  success: boolean;
  spec: Spec;
}
```

**POST /api/specs/[id]/contract/approve**

Approve contract and generate chunks:

```typescript
// Request
{ }

// Response
{
  success: boolean;
  spec: Spec;
  chunks: Chunk[];  // Generated from contract
}
```

**POST /api/specs/[id]/contract/validate**

Validate contract without saving:

```typescript
// Request
{
  contract: SpecContract;
}

// Response
{
  valid: boolean;
  errors: {
    path: string;      // "chunks[2].consumes[0]"
    message: string;   // "Consumes 'Foo' but no chunk creates it"
  }[];
  warnings: {
    path: string;
    message: string;
  }[];
}
```

## Prompt: Contract Generation

New prompt for Opus to generate contracts:

```typescript
// packages/dashboard/src/prompts/contract-generator.ts

export const CONTRACT_GENERATION_PROMPT = `
You are generating an implementation contract for a software specification.

SPEC CONTENT:
{spec_content}

PROJECT CONTEXT:
Working directory: {working_dir}
Existing exports from @specwright/shared: {existing_shared_exports}
Existing files in project: {existing_files_summary}

YOUR TASK:
Generate a detailed implementation contract that defines EXACTLY what will be created.

RULES:
1. Every type/interface must have a complete TypeScript definition
2. Every file must list its exports and imports
3. Every function must have a complete signature
4. Chunks must be ordered so dependencies come first
5. Each chunk's \`consumes\` must reference items from previous chunks' \`creates\`
6. Never have circular dependencies between chunks
7. Prefer modifying existing files over creating new ones where appropriate
8. Use existing project patterns (check existing files for conventions)

ASSERTIONS:
For each chunk, include:
- ASSERT: Hard requirements that MUST be met (build will fail otherwise)
- SUGGEST: Soft guidance that SHOULD be followed (style, patterns)

Examples of good assertions:
- ASSERT: "File must export HealthCheckResult interface"
- ASSERT: "Function checkHealth must return Promise<HealthCheckResult>"
- SUGGEST: "Follow existing error handling patterns in lib/"
- SUGGEST: "Use existing Button component from components/ui"

OUTPUT FORMAT:
Return a valid JSON object matching this schema:

{contract_schema}

IMPORTANT:
- Be specific with type definitions - include all fields
- Be specific with function signatures - include parameters and return types
- Order chunks so each chunk only consumes what previous chunks create
- Include enough assertions to verify the contract is fulfilled
`;
```

## Contract Validation Logic

```typescript
// packages/dashboard/src/lib/contract-validator.ts

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export function validateContract(contract: SpecContract): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. Check all consumes have a matching creates
  const allCreates = new Set<string>();
  for (const chunk of contract.chunks) {
    for (const item of chunk.creates) {
      allCreates.add(item);
    }
  }

  for (const chunk of contract.chunks) {
    for (const item of chunk.consumes) {
      // Check if it's created by a previous chunk or exists in project
      const createdBefore = contract.chunks
        .filter(c => c.order < chunk.order)
        .some(c => c.creates.includes(item));

      if (!createdBefore && !isExistingExport(item)) {
        errors.push({
          path: `chunks[${chunk.order}].consumes`,
          message: `Consumes "${item}" but no previous chunk creates it and it doesn't exist in project`
        });
      }
    }
  }

  // 2. Check dependency order is valid
  for (const chunk of contract.chunks) {
    for (const depOrder of chunk.dependsOn) {
      if (depOrder >= chunk.order) {
        errors.push({
          path: `chunks[${chunk.order}].dependsOn`,
          message: `Depends on chunk ${depOrder} which comes after or is same as this chunk`
        });
      }
    }
  }

  // 3. Check for circular dependencies
  const cycles = detectCycles(contract.chunks);
  for (const cycle of cycles) {
    errors.push({
      path: 'chunks',
      message: `Circular dependency detected: ${cycle.join(' → ')}`
    });
  }

  // 4. Check type definitions are complete
  for (const type of contract.types) {
    if (!type.definition.includes('interface') && !type.definition.includes('type')) {
      errors.push({
        path: `types[${type.name}]`,
        message: `Type definition must be a valid TypeScript interface or type`
      });
    }
  }

  // 5. Check all files have at least one export
  for (const file of contract.files) {
    if (file.action === 'create' && file.exports.length === 0) {
      warnings.push({
        path: `files[${file.path}]`,
        message: `New file has no exports - is this intentional?`
      });
    }
  }

  // 6. Check assertions reference valid targets
  for (const chunk of contract.chunks) {
    for (const assertion of chunk.assertions) {
      if (assertion.check.type === 'export_exists') {
        const targetFile = contract.files.find(f =>
          f.exports.includes(assertion.check.target)
        );
        if (!targetFile) {
          warnings.push({
            path: `chunks[${chunk.order}].assertions`,
            message: `Assertion targets "${assertion.check.target}" but no file exports it`
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
```

## Chunk Generation from Contract

When contract is approved, generate chunks with contract data:

```typescript
// packages/dashboard/src/lib/contract-to-chunks.ts

export function generateChunksFromContract(
  specId: string,
  contract: SpecContract
): CreateChunkRequest[] {
  return contract.chunks.map(contractChunk => ({
    specId,
    title: contractChunk.title,
    description: buildChunkDescription(contractChunk, contract),
    order: contractChunk.order,
    creates: contractChunk.creates,
    consumes: contractChunk.consumes,
    dependsOn: contractChunk.dependsOn.map(order =>
      // Map order to chunk ID (will be resolved after creation)
      `__order_${order}__`
    ),
    assertions: contractChunk.assertions
  }));
}

function buildChunkDescription(
  chunk: ContractChunk,
  contract: SpecContract
): string {
  const parts = [chunk.description];

  // Add type definitions this chunk must create
  const typesToCreate = contract.types.filter(t =>
    chunk.creates.includes(t.name)
  );
  if (typesToCreate.length > 0) {
    parts.push('\n\n## Types to Create\n');
    for (const type of typesToCreate) {
      parts.push(`\`\`\`typescript\n${type.definition}\n\`\`\`\n`);
    }
  }

  // Add function signatures this chunk must create
  const funcsToCreate = contract.functions.filter(f =>
    chunk.creates.some(c => c.includes(f.name))
  );
  if (funcsToCreate.length > 0) {
    parts.push('\n\n## Functions to Create\n');
    for (const func of funcsToCreate) {
      parts.push(`- \`${func.name}${func.signature}\` in \`${func.file}\`\n`);
      parts.push(`  ${func.description}\n`);
    }
  }

  // Add file information
  const filesToCreate = contract.files.filter(f =>
    chunk.creates.some(c => f.exports.includes(c)) ||
    chunk.creates.some(c => f.path.includes(c))
  );
  if (filesToCreate.length > 0) {
    parts.push('\n\n## Files\n');
    for (const file of filesToCreate) {
      parts.push(`- ${file.action.toUpperCase()}: \`${file.path}\`\n`);
      parts.push(`  Exports: ${file.exports.join(', ')}\n`);
    }
  }

  return parts.join('');
}
```

## Integration with Existing Spec Studio

Modify `SpecStudioWizard.tsx` to include contract step:

```typescript
const STEPS = [
  { id: 'write', title: 'Write Spec', icon: PencilIcon },
  { id: 'refine', title: 'Refine', icon: SparklesIcon },
  { id: 'contract', title: 'Contract', icon: DocumentCheckIcon },  // NEW
  { id: 'chunks', title: 'Chunks', icon: CubeIcon },
  { id: 'execute', title: 'Execute', icon: PlayIcon },
];
```

## Acceptance Criteria

- [ ] SpecContract type defined in shared package
- [ ] Database migration adds contract column to specs
- [ ] Contract generation endpoint calls Opus with project context
- [ ] Contract validation catches dependency errors
- [ ] Contract review UI shows types, files, chunks with dependencies
- [ ] Users can edit contract before approval
- [ ] Contract approval generates chunks with creates/consumes/dependsOn
- [ ] Chunk descriptions include type definitions and signatures from contract
- [ ] Dependency graph visualization shows chunk order
- [ ] Regenerate button allows re-generating contract from spec

## Future Enhancements

- Contract diffing (show what changed on regenerate)
- Contract templates for common patterns
- Import contract from previous similar specs
- Export contract as standalone document
- Contract versioning for iteration tracking
