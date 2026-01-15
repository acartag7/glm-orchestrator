import { NextResponse } from 'next/server';
import { existsSync, mkdirSync } from 'fs';
import { getProject } from '@/lib/db';
import { getCodebaseContext, formatCodebaseContext } from '@/lib/codebase-analyzer';
import { ClaudeClient } from '@glm/mcp/client';
import type { GenerateQuestionsRequest, Question } from '@glm/shared';

// Ensure directory exists, create if needed
function ensureDirectory(dir: string): string {
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
      console.log('[studio] Created directory:', dir);
    } catch (err) {
      console.warn('[studio] Could not create directory:', dir, err);
      // Fallback to home directory
      return process.env.HOME || '/tmp';
    }
  }
  return dir;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

const QUESTIONS_SYSTEM_PROMPT = `You are a technical requirements analyst. Generate clarifying questions to create a complete specification. Return ONLY raw JSON - no markdown, no code blocks, no explanation.`;

const QUESTIONS_PROMPT_TEMPLATE = `Generate 3-6 clarifying questions for this project intent.

Project: {directory}
Intent: {intent}

{codebaseContext}

Return ONLY this JSON format (no markdown):
[{"id":"q1","question":"...","type":"choice","options":["Option A","Option B"],"required":true}]

Types: "choice" (radio), "multiselect" (checkboxes), "text" (textarea)
Rules: Generate unique IDs (q1,q2...), keep questions focused, add (recommended) to preferred options.
Consider the existing codebase when generating options - suggest patterns consistent with what already exists.

IMPORTANT: Output raw JSON only. No \`\`\`json blocks.`;

// Use Sonnet for studio operations (faster, cheaper)
const STUDIO_MODEL = 'claude-sonnet-4-5-20250929';

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

// POST /api/projects/[id]/studio/questions - Generate clarifying questions
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json() as GenerateQuestionsRequest;

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

    // Analyze codebase for context
    const codebaseCtx = getCodebaseContext(project.directory);
    const formattedContext = formatCodebaseContext(codebaseCtx);

    const prompt = QUESTIONS_PROMPT_TEMPLATE
      .replace('{directory}', project.directory)
      .replace('{intent}', body.intent)
      .replace('{codebaseContext}', formattedContext);

    // Ensure project directory exists
    const workingDir = ensureDirectory(project.directory);
    console.log('[studio/questions] Calling Claude with model:', STUDIO_MODEL, 'in dir:', workingDir);

    const client = new ClaudeClient({ model: STUDIO_MODEL });
    const result = await client.execute(prompt, {
      workingDirectory: workingDir,
      systemPrompt: QUESTIONS_SYSTEM_PROMPT,
      timeout: 60000,
    });

    console.log('[studio/questions] Claude result:', { success: result.success, outputLength: result.output?.length });

    if (!result.success) {
      console.error('[studio/questions] Claude failed:', result.output);
      return NextResponse.json(
        { error: `Failed to generate questions: ${result.output}` },
        { status: 500 }
      );
    }

    // Parse JSON from response
    let questions: Question[];
    try {
      const jsonStr = extractJSON(result.output);
      console.log('[studio/questions] Extracted JSON:', jsonStr.slice(0, 200));
      questions = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('[studio/questions] Failed to parse JSON:', result.output);
      return NextResponse.json(
        { error: 'Failed to parse AI response as JSON. Raw output: ' + result.output.slice(0, 200) },
        { status: 500 }
      );
    }

    return NextResponse.json({ questions });
  } catch (error) {
    console.error('[studio/questions] Error:', error);
    return NextResponse.json(
      { error: `Failed to generate questions: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
