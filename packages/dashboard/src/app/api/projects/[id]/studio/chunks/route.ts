import { NextResponse } from 'next/server';
import { existsSync, mkdirSync } from 'fs';
import { getProject } from '@/lib/db';
import { getCodebaseContext, formatCodebaseContext } from '@/lib/codebase-analyzer';
import { ClaudeClient } from '@glm/mcp/client';
import type { GenerateChunksRequest, ChunkSuggestion } from '@glm/shared';

// Ensure directory exists, create if needed
function ensureDirectory(dir: string): string {
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      return process.env.HOME || '/tmp';
    }
  }
  return dir;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Extract JSON from response (handles markdown code blocks)
function extractJSON(text: string): string {
  let str = text.trim();

  // Try to find JSON array in the text
  const jsonMatch = str.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  // Remove markdown code blocks
  str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  return str.trim();
}

const CHUNKS_SYSTEM_PROMPT = `You are a senior software architect breaking down specifications into implementation tasks for an AI coding assistant (GLM).

CRITICAL: GLM needs EXTREMELY DETAILED, STEP-BY-STEP instructions. It cannot infer context or make assumptions. Every task must be self-contained with exact file paths, function signatures, and expected outputs.

Return ONLY a valid JSON array. No markdown, no code blocks, no explanation.`;

type ChunkDetailLevel = 'minimal' | 'standard' | 'detailed';

const CHUNK_COUNT_MAP: Record<ChunkDetailLevel, string> = {
  minimal: '3-5',
  standard: '6-10',
  detailed: '10-15',
};

const CHUNKS_PROMPT_TEMPLATE = `Break down this specification into implementation chunks for GLM (an AI coding assistant).

{codebaseContext}

## Specification
{spec}

## Requirements
Generate approximately {chunkCount} chunks with EXPLICIT DEPENDENCIES.

## Output Format
Return a JSON array:
[
  {
    "id": "chunk_1",
    "title": "Initialize Next.js project with TypeScript and Tailwind",
    "description": "DETAILED STEP-BY-STEP INSTRUCTIONS - see example below",
    "dependencies": [],
    "selected": true,
    "order": 1,
    "files": ["package.json", "tsconfig.json", "tailwind.config.ts"],
    "outputs": ["Next.js 14 project initialized", "TypeScript configured", "Tailwind CSS working"]
  },
  {
    "id": "chunk_2",
    "title": "Create User type definitions",
    "description": "DETAILED STEP-BY-STEP INSTRUCTIONS",
    "dependencies": ["chunk_1"],
    "selected": true,
    "order": 2,
    "files": ["src/types/user.ts"],
    "outputs": ["User interface exported", "UserProfile type exported"]
  }
]

## CRITICAL: Description Format
Each description MUST follow this exact structure:

"""
## Goal
[One sentence: what this chunk accomplishes]

## Prerequisites
[What must exist before this runs - reference specific files/functions from dependencies]

## Steps
1. [Exact action with file path]
   - Create file at: src/types/user.ts
   - Add interface User with fields: id (string), email (string), name (string)

2. [Next action]
   - Modify file: src/lib/api.ts
   - Add function: fetchUser(id: string): Promise<User>
   - Import User from '../types/user'

## Expected Output
- File created: src/types/user.ts with User interface
- Function added: fetchUser in src/lib/api.ts
- Exports available: User, fetchUser

## Verification
[How to verify this chunk worked - e.g., "Import User from src/types/user should resolve"]
"""

## Dependency Rules
- dependencies: [] means can run first (no prerequisites)
- dependencies: ["chunk_1"] means chunk_1 must complete first
- Multiple deps: ["chunk_1", "chunk_2"] means BOTH must complete
- NEVER create circular dependencies
- Foundation chunks (setup, types, config) should have NO dependencies
- Feature chunks depend on their foundation chunks

## Chunk Sizing Rules
- Each chunk: ONE focused task (not multiple features)
- 5-15 minutes of AI coding work
- Clear input → output boundary
- Can be verified independently

## Anti-Patterns to Avoid
- ❌ "Create the authentication system" (too vague)
- ❌ "Set up everything" (not specific)
- ❌ "Implement user features" (multiple tasks bundled)
- ✅ "Create POST /api/auth/login endpoint that accepts {email, password} and returns {token, user}"
- ✅ "Add bcrypt password hashing to User model with hashPassword() and verifyPassword() methods"

## Existing Codebase Integration
- Reference actual file paths from the codebase analysis above
- Use existing types/interfaces - don't recreate them
- Extend existing components rather than creating duplicates
- Follow the patterns already established in the project

Return ONLY valid JSON, no markdown code blocks.`;

// POST /api/projects/[id]/studio/chunks - Generate chunk suggestions
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json() as GenerateChunksRequest;

    const project = getProject(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    if (!body.spec?.trim()) {
      return NextResponse.json(
        { error: 'Spec is required' },
        { status: 400 }
      );
    }

    // Get chunk count preference (default to standard)
    const chunkPreference = (body as { chunkPreference?: ChunkDetailLevel }).chunkPreference || 'standard';
    const chunkCount = CHUNK_COUNT_MAP[chunkPreference];

    // Analyze codebase for context
    const codebaseCtx = getCodebaseContext(project.directory);
    const formattedContext = formatCodebaseContext(codebaseCtx);

    const prompt = CHUNKS_PROMPT_TEMPLATE
      .replace('{codebaseContext}', formattedContext)
      .replace('{spec}', body.spec)
      .replace(/{chunkCount}/g, chunkCount);

    // Use Sonnet for studio operations (faster, cheaper)
    const workingDir = ensureDirectory(project.directory);
    const client = new ClaudeClient({ model: 'claude-sonnet-4-5-20250929' });
    const result = await client.execute(prompt, {
      workingDirectory: workingDir,
      systemPrompt: CHUNKS_SYSTEM_PROMPT,
      timeout: 180000, // 3 minutes for complex chunk generation
    });

    if (!result.success) {
      return NextResponse.json(
        { error: `Failed to generate chunks: ${result.output}` },
        { status: 500 }
      );
    }

    // Parse JSON from response
    let chunks: ChunkSuggestion[];
    try {
      // Extract JSON array from response (handles markdown code blocks)
      const jsonStr = extractJSON(result.output);
      console.log('[studio/chunks] Extracted JSON:', jsonStr.slice(0, 200));
      chunks = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('[studio/chunks] Failed to parse JSON:', result.output);
      return NextResponse.json(
        { error: 'Failed to parse AI response as JSON. Raw: ' + result.output.slice(0, 200) },
        { status: 500 }
      );
    }

    return NextResponse.json({ chunks });
  } catch (error) {
    console.error('Error generating chunks:', error);
    return NextResponse.json(
      { error: `Failed to generate chunks: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
