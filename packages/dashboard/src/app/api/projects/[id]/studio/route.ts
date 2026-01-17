import { NextResponse } from 'next/server';
import { getProject, getStudioState, createStudioState, updateStudioState } from '@/lib/db';
import type { UpdateStudioStateRequest } from '@specwright/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/projects/[id]/studio - Get studio state (creates if not exists)
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const project = getProject(id);

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Get existing state or create new one
    let state = getStudioState(id);
    if (!state) {
      state = createStudioState(id);
    }

    return NextResponse.json(state);
  } catch (error) {
    console.error('Error fetching studio state:', error);
    return NextResponse.json(
      { error: 'Failed to fetch studio state' },
      { status: 500 }
    );
  }
}

// PUT /api/projects/[id]/studio - Update studio state
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const project = getProject(id);

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const body = await request.json() as UpdateStudioStateRequest;

    // Ensure state exists
    let state = getStudioState(id);
    if (!state) {
      state = createStudioState(id);
    }

    // Update state
    const updatedState = updateStudioState(id, {
      step: body.step,
      intent: body.intent,
      questions: body.questions,
      answers: body.answers,
      generatedSpec: body.generatedSpec,
      suggestedChunks: body.suggestedChunks,
    });

    if (!updatedState) {
      return NextResponse.json(
        { error: 'Failed to update studio state' },
        { status: 500 }
      );
    }

    return NextResponse.json(updatedState);
  } catch (error) {
    console.error('Error updating studio state:', error);
    return NextResponse.json(
      { error: 'Failed to update studio state' },
      { status: 500 }
    );
  }
}
