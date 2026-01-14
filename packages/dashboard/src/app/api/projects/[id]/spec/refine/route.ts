import { NextResponse } from 'next/server';
import { getProject, getSpecByProject, updateSpec } from '@/lib/db';
import { ClaudeClient } from '@glm/mcp/client';
import type { RefineSpecRequest } from '@glm/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const REFINE_SYSTEM_PROMPT = `You are a technical spec writer. Your job is to refine and improve software specifications.

When given a spec:
1. Clarify ambiguous requirements
2. Add missing details needed for implementation
3. Improve structure and formatting
4. Suggest acceptance criteria where missing
5. Keep the spec concise but complete

Output ONLY the refined spec in markdown format. Do not include any preamble or explanation.`;

// POST /api/projects/[id]/spec/refine - Ask Opus to refine spec
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json() as RefineSpecRequest;

    // Get project and spec
    const project = getProject(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const spec = getSpecByProject(projectId);
    if (!spec) {
      return NextResponse.json(
        { error: 'Spec not found' },
        { status: 404 }
      );
    }

    if (!spec.content.trim()) {
      return NextResponse.json(
        { error: 'Spec content is empty. Write a spec first before refining.' },
        { status: 400 }
      );
    }

    // Build the prompt
    let prompt = `Please refine this software specification:\n\n${spec.content}`;

    if (body.instructions) {
      prompt += `\n\nAdditional instructions: ${body.instructions}`;
    }

    // Call Claude to refine
    const client = new ClaudeClient({ model: 'claude-opus-4-5-20250514' });
    const result = await client.execute(prompt, {
      workingDirectory: project.directory,
      systemPrompt: REFINE_SYSTEM_PROMPT,
      timeout: 120000, // 2 minutes
    });

    if (!result.success) {
      return NextResponse.json(
        { error: `Failed to refine spec: ${result.output}` },
        { status: 500 }
      );
    }

    // Update spec with refined content
    const updatedSpec = updateSpec(spec.id, {
      content: result.output.trim(),
    });

    return NextResponse.json({
      spec: updatedSpec,
      cost: result.cost,
      tokens: result.tokens,
    });
  } catch (error) {
    console.error('Error refining spec:', error);
    return NextResponse.json(
      { error: `Failed to refine spec: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
