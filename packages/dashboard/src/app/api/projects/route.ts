import { NextResponse } from 'next/server';
import { getAllProjects, createProject } from '@/lib/db';
import type { CreateProjectRequest } from '@specwright/shared';

// GET /api/projects - List all projects
export async function GET() {
  try {
    const projects = getAllProjects();
    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

// POST /api/projects - Create a new project
export async function POST(request: Request) {
  try {
    const body = await request.json() as CreateProjectRequest;

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    if (!body.directory || typeof body.directory !== 'string') {
      return NextResponse.json(
        { error: 'Directory is required' },
        { status: 400 }
      );
    }

    const project = createProject({
      name: body.name.trim(),
      directory: body.directory.trim(),
      description: body.description?.trim(),
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    );
  }
}
