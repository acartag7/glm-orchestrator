# ORC-25: Auto-chunk Specs with AI

## Overview

AI analyzes spec content and automatically suggests chunks with dependencies.

## Context

Manual chunk creation is tedious. AI can identify logical task boundaries and infer dependencies from context.

## Flow

1. User writes spec
2. Click "Auto-chunk" button
3. AI analyzes spec and suggests chunks
4. User reviews and adjusts
5. Chunks created with dependencies

## Implementation

### 1. Create Auto-chunk Prompt

Add to `packages/dashboard/src/lib/prompts.ts`:

```typescript
export function buildAutoChunkPrompt(specContent: string): string {
  return `Analyze this spec and break it into executable chunks.

SPEC:
${specContent}

For each chunk, provide:
1. Title (short, action-oriented)
2. Description (detailed task for an AI to execute)
3. Dependencies (which chunks must complete first)

Output JSON array:
[
  {
    "title": "Chunk title",
    "description": "Detailed description...",
    "dependencies": [] // indices of dependency chunks (0-based)
  }
]

Guidelines:
- Each chunk should be a single, atomic task
- Order chunks by logical execution order
- First chunk has no dependencies
- Later chunks may depend on earlier ones
- Be specific about what files to modify`;
}
```

### 2. Create API Route

Create `packages/dashboard/src/app/api/specs/[id]/auto-chunk/route.ts`:

```typescript
import { getSpec, insertChunk } from '@/lib/db';
import { buildAutoChunkPrompt } from '@/lib/prompts';
import { ClaudeClient } from '@specwright/mcp/client';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: specId } = await context.params;

  const spec = getSpec(specId);
  if (!spec || !spec.content) {
    return Response.json({ error: 'Spec not found or empty' }, { status: 404 });
  }

  const prompt = buildAutoChunkPrompt(spec.content);
  const client = new ClaudeClient({ model: 'sonnet' }); // Use Sonnet for this

  const result = await client.execute(prompt, { timeout: 60000 });
  if (!result.success) {
    return Response.json({ error: 'Failed to generate chunks' }, { status: 500 });
  }

  // Parse JSON from output
  const jsonMatch = result.output.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return Response.json({ error: 'Invalid response format' }, { status: 500 });
  }

  const chunks = JSON.parse(jsonMatch[0]);
  const createdChunks = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const dependencies = chunk.dependencies
      .map((idx: number) => createdChunks[idx]?.id)
      .filter(Boolean);

    const created = insertChunk({
      specId,
      title: chunk.title,
      description: chunk.description,
      dependencies,
    });
    createdChunks.push(created);
  }

  return Response.json({ chunks: createdChunks });
}
```

### 3. Add Button to Spec Editor

Add "Auto-chunk" button to spec edit page that calls the API and displays results.

## Files to Modify

- MODIFY: `packages/dashboard/src/lib/prompts.ts`
- CREATE: `packages/dashboard/src/app/api/specs/[id]/auto-chunk/route.ts`
- MODIFY: `packages/dashboard/src/app/project/[id]/spec/[specId]/edit/page.tsx`

## Acceptance Criteria

- [ ] "Auto-chunk" button on spec editor
- [ ] AI generates chunk list with descriptions
- [ ] Dependencies set automatically
- [ ] User can edit/delete before confirming
