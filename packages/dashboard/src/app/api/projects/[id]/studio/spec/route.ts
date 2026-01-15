import { NextResponse } from 'next/server';
import { existsSync, mkdirSync } from 'fs';
import { getProject } from '@/lib/db';
import { getCodebaseContext, formatCodebaseContext } from '@/lib/codebase-analyzer';
import { ClaudeClient } from '@glm/mcp/client';
import type { GenerateSpecRequest } from '@glm/shared';

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

const SPEC_SYSTEM_PROMPT = `You are a technical specification writer. Your job is to create clear, actionable software specifications from user requirements.

Write specifications that another developer or AI could implement without ambiguity. Use markdown formatting.`;

const SPEC_PROMPT_TEMPLATE = `Create a detailed software specification based on the developer's intent and their answers to clarifying questions.

Project directory: {directory}

{codebaseContext}

Intent:
{intent}

Answers to clarifying questions:
{formattedAnswers}

Write a clear, actionable specification in Markdown format. Include:
- Overview (1-2 paragraphs)
- Requirements (specific, numbered list)
- Acceptance criteria (testable conditions)
- Technical constraints (if any were mentioned)

Be specific enough that another developer or AI could implement this without ambiguity.
Reference existing patterns, components, and types from the codebase analysis when relevant.
Avoid recreating utilities or components that already exist - extend or use them instead.`;

// POST /api/projects/[id]/studio/spec - Generate spec from intent + answers
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json() as GenerateSpecRequest;

    const project = getProject(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    if (!body.intent?.trim()) {
      return NextResponse.json(
        { error: 'Intent is required' },
        { status: 400 }
      );
    }

    // Format answers for the prompt
    const formattedAnswers = Object.entries(body.answers || {})
      .map(([key, value]) => {
        const displayValue = Array.isArray(value) ? value.join(', ') : value;
        return `- ${key}: ${displayValue}`;
      })
      .join('\n') || 'No additional answers provided.';

    // Analyze codebase for context
    const codebaseCtx = getCodebaseContext(project.directory);
    const formattedContext = formatCodebaseContext(codebaseCtx);

    const prompt = SPEC_PROMPT_TEMPLATE
      .replace('{directory}', project.directory)
      .replace('{codebaseContext}', formattedContext)
      .replace('{intent}', body.intent)
      .replace('{formattedAnswers}', formattedAnswers);

    // Use Sonnet for studio operations (faster, cheaper)
    const workingDir = ensureDirectory(project.directory);
    const client = new ClaudeClient({ model: 'claude-sonnet-4-5-20250929' });
    const result = await client.execute(prompt, {
      workingDirectory: workingDir,
      systemPrompt: SPEC_SYSTEM_PROMPT,
      timeout: 120000,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: `Failed to generate spec: ${result.output}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ spec: result.output.trim() });
  } catch (error) {
    console.error('Error generating spec:', error);
    return NextResponse.json(
      { error: `Failed to generate spec: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
