# Codebase Analysis for Spec Generation

## Problem

When creating a new spec for an **ongoing project**, Opus generates specs "blind" without knowing:
- What files/components already exist
- What patterns the project uses
- What types/interfaces are defined
- What dependencies are installed

This leads to specs that might:
- Suggest recreating existing utilities
- Miss integration points with existing code
- Use different patterns than the rest of the codebase
- Not leverage existing types/components

## Solution

Before generating a spec, analyze the project's codebase and include that context in the prompt.

## Implementation

### 1. Create Codebase Analyzer

Create `packages/dashboard/src/lib/codebase-analyzer.ts`:

```typescript
interface CodebaseContext {
  summary: string;           // "Next.js 14 with TypeScript, Tailwind, Prisma"
  framework: string | null;  // "Next.js", "React", "Express", etc.
  hasTypeScript: boolean;
  packageManager: string;    // "pnpm", "npm", "yarn"
  structure: string;         // Directory tree (limited depth)
  keyFiles: KeyFile[];       // Important config files
  existingTypes: string[];   // Type/interface names found
  existingComponents: string[]; // Component names found
  dependencies: string[];    // From package.json
}

interface KeyFile {
  path: string;
  description: string;
  snippet?: string;          // Brief content preview
}

export function analyzeCodebase(directory: string): CodebaseContext;
export function formatCodebaseContext(context: CodebaseContext): string;
```

### 2. What to Analyze

**Project Detection:**
- Read `package.json` for dependencies
- Detect framework (Next.js, React, Vue, Express, etc.)
- Detect TypeScript (`tsconfig.json`)
- Detect package manager (pnpm-lock.yaml, yarn.lock, package-lock.json)

**Structure (max 3 levels deep):**
```
src/
├── app/
│   ├── page.tsx
│   ├── layout.tsx
│   └── api/
├── components/
│   ├── Header.tsx
│   └── Footer.tsx
├── lib/
│   └── utils.ts
└── types/
    └── user.ts
```

**Key Files to Identify:**
- `package.json` - dependencies
- `tsconfig.json` - TypeScript config
- `next.config.*` - Next.js config
- `tailwind.config.*` - Tailwind config
- `prisma/schema.prisma` - Database schema
- `.env.example` - Environment variables

**Existing Code:**
- Scan `src/types/` for type/interface names
- Scan `src/components/` for component names
- Scan `src/lib/` for utility function names

### 3. Directories to Ignore

```typescript
const IGNORE = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.turbo',
  'coverage',
];
```

### 4. Update Spec Generation Prompt

Modify `packages/dashboard/src/app/api/projects/[id]/studio/spec/route.ts`:

```typescript
import { analyzeCodebase, formatCodebaseContext } from '@/lib/codebase-analyzer';

// In the POST handler:
const codebaseContext = analyzeCodebase(project.directory);
const formattedContext = formatCodebaseContext(codebaseContext);

const prompt = SPEC_PROMPT_TEMPLATE
  .replace('{codebaseContext}', formattedContext)
  .replace('{intent}', body.intent)
  // ...
```

### 5. New Spec Prompt Template

```
Create a detailed software specification based on the developer's intent.

## Project Context
{codebaseContext}

## Developer's Intent
{intent}

## Answers to Clarifying Questions
{formattedAnswers}

## Instructions

Write a specification that:
1. **Builds on existing code** - Reference existing types, components, utilities
2. **Follows existing patterns** - Match the project's architecture style
3. **Doesn't recreate** - If something exists, use it or extend it
4. **Integrates properly** - Show how new code connects to existing code

Include:
- Overview (what this adds to the existing project)
- Requirements (specific, numbered)
- Integration points (which existing files to modify)
- New files to create
- Acceptance criteria

Be specific about file paths based on the existing structure.
```

### 6. Update Chunk Generation Too

The chunk generation should also receive codebase context:

```typescript
// In /api/projects/[id]/studio/chunks/route.ts
const codebaseContext = analyzeCodebase(project.directory);

const prompt = CHUNKS_PROMPT_TEMPLATE
  .replace('{codebaseContext}', formatCodebaseContext(codebaseContext))
  .replace('{spec}', body.spec)
  // ...
```

Update chunk prompt to include:
```
## Existing Codebase
{codebaseContext}

## Important
- Reference existing types from src/types/
- Extend existing components rather than creating new ones
- Use existing utilities from src/lib/
- Follow the patterns already established in the codebase
```

## Output Format Example

```markdown
## Existing Codebase Analysis

**Summary:** Next.js 14 project with TypeScript, Tailwind CSS, Prisma ORM

### Project Structure
```
src/
├── app/
│   ├── page.tsx
│   ├── layout.tsx
│   └── api/
│       └── users/
├── components/
│   ├── Header.tsx
│   ├── Button.tsx
│   └── Card.tsx
├── lib/
│   ├── prisma.ts
│   └── utils.ts
└── types/
    └── user.ts
```

### Key Files
- **package.json**: Next.js 14, React 19, Prisma, Tailwind
- **prisma/schema.prisma**: User, Post, Comment models
- **tailwind.config.ts**: Custom theme with brand colors

### Existing Types
User, Post, Comment, ApiResponse, PaginatedResult

### Existing Components
Header, Footer, Button, Card, Modal, Input, Select

### Key Dependencies
next, react, prisma, @prisma/client, tailwindcss, zod, react-hook-form
```

## Performance Considerations

- **Cache analysis** - Don't re-analyze if project hasn't changed
- **Limit depth** - Max 3 levels for directory tree
- **Limit files** - Max 20 entries per directory
- **Limit types/components** - Max 30 each
- **Skip large files** - Don't read files > 50KB

## Acceptance Criteria

- [ ] Analyzer detects framework (Next.js, React, Express, etc.)
- [ ] Analyzer identifies TypeScript projects
- [ ] Analyzer extracts directory structure (3 levels)
- [ ] Analyzer finds existing types/interfaces
- [ ] Analyzer finds existing components
- [ ] Analyzer reads key config files
- [ ] Context included in spec generation prompt
- [ ] Context included in chunk generation prompt
- [ ] Specs reference existing code appropriately
- [ ] Chunks don't recreate existing utilities

## Files to Create/Modify

```
packages/dashboard/src/
├── lib/
│   └── codebase-analyzer.ts     # NEW - analyzer logic
└── app/api/projects/[id]/studio/
    ├── spec/route.ts            # UPDATE - add context
    └── chunks/route.ts          # UPDATE - add context
```
