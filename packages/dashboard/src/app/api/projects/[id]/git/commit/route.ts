import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { getProject } from '@/lib/db';
import { ClaudeClient } from '@specwright/mcp/client';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const COMMIT_MESSAGE_PROMPT = `Generate a concise git commit message for the following changes. The message should:
- Start with a type prefix (feat:, fix:, refactor:, docs:, style:, test:, chore:)
- Be no longer than 72 characters for the first line
- Optionally include a brief body explaining the why (not the what)

Changes summary:
{changes}

Return ONLY the commit message, nothing else. No quotes or formatting.`;

// POST /api/projects/[id]/git/commit - Create a git commit
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json() as { message?: string };

    const project = getProject(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    if (!existsSync(project.directory)) {
      return NextResponse.json(
        { error: 'Project directory does not exist' },
        { status: 400 }
      );
    }

    // Check if git repo exists
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: project.directory,
        stdio: 'pipe',
      });
    } catch {
      return NextResponse.json(
        { error: 'Not a git repository' },
        { status: 400 }
      );
    }

    // Get git status
    const status = execSync('git status --porcelain', {
      cwd: project.directory,
      encoding: 'utf-8',
    }).trim();

    if (!status) {
      return NextResponse.json(
        { error: 'No changes to commit' },
        { status: 400 }
      );
    }

    // Generate commit message if not provided
    let commitMessage = body.message;
    if (!commitMessage) {
      // Get diff summary
      const diffStat = execSync('git diff --stat', {
        cwd: project.directory,
        encoding: 'utf-8',
      }).trim();

      const prompt = COMMIT_MESSAGE_PROMPT.replace('{changes}', diffStat || status);

      const client = new ClaudeClient({ model: 'claude-haiku-4-5-20251001' });
      const result = await client.execute(prompt, {
        workingDirectory: project.directory,
        timeout: 30000,
      });

      commitMessage = result.success ? result.output.trim() : 'chore: update project files';
    }

    // Stage all changes
    execSync('git add -A', {
      cwd: project.directory,
      stdio: 'pipe',
    });

    // Create commit
    execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
      cwd: project.directory,
      stdio: 'pipe',
    });

    // Get commit hash
    const commitHash = execSync('git rev-parse HEAD', {
      cwd: project.directory,
      encoding: 'utf-8',
    }).trim();

    return NextResponse.json({
      success: true,
      commitHash,
      message: commitMessage,
    });
  } catch (error) {
    console.error('Error creating commit:', error);
    return NextResponse.json(
      { error: `Failed to create commit: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
