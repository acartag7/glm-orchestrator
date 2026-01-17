import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { getProject } from '@/lib/db';
import { ClaudeClient } from '@specwright/mcp/client';
import { createCommit, checkGitRepo } from '@/lib/git';

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
    if (!checkGitRepo(project.directory)) {
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

    // Use safe createCommit function (stages and commits with shell: false)
    const result = await createCommit(project.directory, commitMessage);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create commit' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      commitHash: result.commitHash,
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
