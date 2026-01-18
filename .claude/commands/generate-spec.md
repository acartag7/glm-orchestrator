# Generate Implementation Spec

You are generating a detailed implementation specification for Specwright following the established format from ORC-51.

## Input Required

The user will provide:
1. **Ticket IDs** - Linear tickets to address (e.g., ORC-43, ORC-17, ORC-12)
2. **Brief description** - What the feature/fix should accomplish

## Spec Structure

Generate a comprehensive spec with these sections:

### 1. Overview
- Brief summary of what this spec addresses
- List of tickets being consolidated (if multiple)
- Key behaviors (bullet points)
- Architecture approach (independent services, etc.)

### 2. Current State Analysis
For each problem:
- Code snippet showing the issue
- Current flow (numbered steps)
- Where it fails and why

### 3. Target Architecture
- ASCII diagram showing component relationships
- Show frontend → API → services flow
- Identify new vs modified components

### 4. File Structure
```
packages/dashboard/src/
├── lib/
│   └── services/
│       └── new-service.ts       # NEW/MODIFY annotation
```

### 5. Requirements
For each service/component:
- TypeScript interface definitions
- Method signatures with JSDoc
- Implementation details in code blocks
- Follow existing patterns from the codebase

### 6. Unit Tests
- Test file locations
- Test case descriptions (it blocks)
- Mocking strategy

### 7. Chunked Implementation
12 self-contained chunks, each with:
- **Chunk N: Title**
- **Files:** List of files to create/modify
- **Tests:** Test files
- **Prompt:** Exact prompt to give to executor

### 8. Acceptance Criteria
Checkbox list organized by ticket:
- [ ] Specific, testable criteria
- [ ] Each ticket gets its own section

### 9. Dependencies
- What existing code this uses
- What new dependencies needed (prefer none)

### 10. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Description | How to handle |

## Code Style Requirements

1. **TypeScript interfaces** - Full type definitions, not `any`
2. **JSDoc comments** - Document public methods
3. **Singleton pattern** - For services like managers
4. **Event emitters** - For async state changes
5. **Error handling** - Always return `{ success, error? }` objects
6. **Logging** - Use `console.log('[ServiceName] message')` format

## Service Architecture Pattern

```typescript
export interface ServiceConfig {
  // Configuration options with defaults
}

export class ServiceName {
  private config: ServiceConfig;

  constructor(config?: Partial<ServiceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async methodName(): Promise<{ success: boolean; error?: string }> {
    // Implementation
  }
}

// Singleton export
export const serviceName = new ServiceName();
```

## API Route Pattern

```typescript
import { NextResponse } from 'next/server';
import { serviceName } from '@/lib/services/service-name';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  // Validation
  // Call service
  // Return response
}
```

## React Component Pattern

```typescript
'use client';

interface Props {
  // Props with JSDoc
}

export function ComponentName({ prop }: Props) {
  // Hooks at top
  // Handlers
  // Return JSX
}
```

## Output Location

Save the spec to: `.handoff/specs/ORC-{number}-{slug}.md`

Use the primary ticket number, or create a new consolidated number if combining multiple tickets.

## Example References

- ORC-51: `.handoff/specs/ORC-51-haiku-review-strategy.md` (service refactor)
- ORC-56: `.handoff/specs/ORC-56-dogfood-blockers.md` (multi-ticket consolidation)

## Begin

Ask the user for:
1. Which tickets to address
2. Any specific requirements or constraints

Then generate the full spec following this format.
