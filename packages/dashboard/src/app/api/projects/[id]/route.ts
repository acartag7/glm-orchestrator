import { NextResponse } from 'next/server';
import { getProject, updateProject, deleteProject, getSpecByProject } from '@/lib/db';
import { validateAndNormalizePath, PathValidationError } from '@/lib/path-validation';
import type { UpdateProjectRequest } from '@specwright/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/projects/[id] - Get a single project
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

    // Also fetch the spec for this project
    const spec = getSpecByProject(id);

    return NextResponse.json({ project, spec });
  } catch (error) {
    console.error('Error fetching project:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project' },
      { status: 500 }
    );
  }
}

// PUT /api/projects/[id] - Update a project
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json() as UpdateProjectRequest;

    // Validate and normalize the directory path if provided
    let normalizedDirectory: string | undefined;
    if (body.directory) {
      try {
        normalizedDirectory = validateAndNormalizePath(body.directory.trim());
      } catch (error) {
        if (error instanceof PathValidationError) {
          return NextResponse.json(
            { error: error.message },
            { status: 400 }
          );
        }
        throw error;
      }
    }

    const project = updateProject(id, {
      name: body.name?.trim(),
      directory: normalizedDirectory,
      description: body.description?.trim(),
    });

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    return NextResponse.json(
      { error: 'Failed to update project' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/[id] - Delete a project
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const deleted = deleteProject(id);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json(
      { error: 'Failed to delete project' },
      { status: 500 }
    );
  }
}
