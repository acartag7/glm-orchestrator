import { NextResponse } from 'next/server';
import { existsSync, mkdirSync } from 'fs';
import { getProject } from '@/lib/db';
import { ClaudeClient } from '@specwright/mcp/client';
import type { RefineSpecRequest } from '@specwright/shared';

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

const REFINE_SYSTEM_PROMPT = `You are a technical spec writer. Your job is to refine and improve software specifications based on feedback.

Output ONLY the refined spec in markdown format. Do not include any preamble or explanation.`;

const REFINE_PROMPT_TEMPLATE = `Refine this specification based on the feedback provided.

Current specification:
{spec}

Feedback:
{feedback}

Update the specification to address the feedback while maintaining the existing structure and level of detail. Return the complete updated specification in Markdown format.`;

// POST /api/projects/[id]/studio/refine - Refine spec based on feedback
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json() as RefineSpecRequest;

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

    if (!body.feedback?.trim()) {
      return NextResponse.json(
        { error: 'Feedback is required' },
        { status: 400 }
      );
    }

    const prompt = REFINE_PROMPT_TEMPLATE
      .replace('{spec}', body.spec)
      .replace('{feedback}', body.feedback);

    // Use Sonnet for studio operations (faster, cheaper)
    const workingDir = ensureDirectory(project.directory);
    const client = new ClaudeClient({ model: 'claude-sonnet-4-5-20250929' });
    const result = await client.execute(prompt, {
      workingDirectory: workingDir,
      systemPrompt: REFINE_SYSTEM_PROMPT,
      timeout: 120000,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: `Failed to refine spec: ${result.output}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ spec: result.output.trim() });
  } catch (error) {
    console.error('Error refining spec:', error);
    return NextResponse.json(
      { error: `Failed to refine spec: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
