import { NextResponse } from 'next/server';
import { getProjectConfig, saveProjectConfig, validateConfig, validateExecutor, validatePlanner, validateReviewer, ConfigValidationError } from '@/lib/config-loader';
import { getProject, getDb } from '@/lib/db';
import { ProjectConfig } from '@specwright/shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const project = getProject(id);

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const config = await getProjectConfig(id);
    const { searchParams } = new URL(request.url);
    const validate = searchParams.get('validate') === 'true';

    if (validate) {
      const [executor, planner, reviewer] = await Promise.all([
        validateExecutor(config.executor),
        validatePlanner(config.planner),
        validateReviewer(config.reviewer),
      ]);

      return NextResponse.json({
        config,
        validation: {
          executor,
          planner,
          reviewer,
        },
      });
    }

    return NextResponse.json({ config });
  } catch (error) {
    console.error('Error fetching project config:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project config' },
      { status: 500 }
    );
  }
}

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

    const config = await request.json() as ProjectConfig;

    try {
      validateConfig(config);
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        return NextResponse.json(
          { error: error.message, field: error.field },
          { status: 400 }
        );
      }
      throw error;
    }

    const { searchParams } = new URL(request.url);
    const validate = searchParams.get('validate') === 'true';

    let validationResults: { executor: any; planner: any; reviewer: any } | undefined;

    if (validate) {
      const [executor, planner, reviewer] = await Promise.all([
        validateExecutor(config.executor),
        validatePlanner(config.planner),
        validateReviewer(config.reviewer),
      ]);
      validationResults = { executor, planner, reviewer };

      if (!executor.accessible || !planner.accessible || !reviewer.accessible) {
        const service = !executor.accessible ? 'executor' : !planner.accessible ? 'planner' : 'reviewer';
        const error = !executor.accessible ? executor.error : !planner.accessible ? planner.error : reviewer.error;

        return NextResponse.json(
          { error: error || 'Service not accessible', service },
          { status: 503 }
        );
      }
    }

    await saveProjectConfig(id, config);

    const db = getDb();
    db.prepare('UPDATE projects SET config_json = ? WHERE id = ?').run(JSON.stringify(config), id);

    if (validate && validationResults) {
      return NextResponse.json({
        success: true,
        config,
        validation: {
          executor: validationResults.executor,
          planner: validationResults.planner,
          reviewer: validationResults.reviewer,
        },
      });
    }

    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error('Error updating project config:', error);
    return NextResponse.json(
      { error: 'Failed to update project config' },
      { status: 500 }
    );
  }
}
