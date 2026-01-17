import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { getProject } from '@/lib/db';
import { ClaudeClient } from '@specwright/mcp/client';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const PR_DESCRIPTION_PROMPT = `Generate a pull request description for the following changes. Include:
- A brief summary (2-3 sentences)
- Key changes as bullet points
- Any breaking changes or migration notes if applicable

Recent commits:
{commits}

Diff summary:
{diffStat}

Return the PR description in markdown format. Keep it concise but informative.`;

// POST /api/projects/[id]/git/pr - Create a pull request
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;
    const body = await request.json() as { title?: string; body?: string; base?: string };

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

    // Check if gh CLI is available
    try {
      execSync('gh --version', { stdio: 'pipe' });
    } catch {
      return NextResponse.json(
        { error: 'GitHub CLI (gh) is not installed' },
        { status: 400 }
      );
    }

    // Check if authenticated
    try {
      execSync('gh auth status', {
        cwd: project.directory,
        stdio: 'pipe',
      });
    } catch {
      return NextResponse.json(
        { error: 'Not authenticated with GitHub. Run: gh auth login' },
        { status: 401 }
      );
    }

    // Get current branch
    const currentBranch = execSync('git branch --show-current', {
      cwd: project.directory,
      encoding: 'utf-8',
    }).trim();

    if (!currentBranch) {
      return NextResponse.json(
        { error: 'Not on a branch (detached HEAD)' },
        { status: 400 }
      );
    }

    const baseBranch = body.base || 'main';

    if (currentBranch === baseBranch) {
      return NextResponse.json(
        { error: `Already on ${baseBranch} branch. Create a feature branch first.` },
        { status: 400 }
      );
    }

    // Push branch to remote
    try {
      execSync(`git push -u origin ${currentBranch}`, {
        cwd: project.directory,
        stdio: 'pipe',
      });
    } catch (e) {
      // May already be pushed, continue
      console.log('Push warning:', e);
    }

    // Generate PR title and description if not provided
    let prTitle = body.title;
    let prBody = body.body;

    if (!prTitle || !prBody) {
      // Get commit log
      const commits = execSync(`git log ${baseBranch}..HEAD --oneline`, {
        cwd: project.directory,
        encoding: 'utf-8',
      }).trim();

      // Get diff stat
      const diffStat = execSync(`git diff ${baseBranch}...HEAD --stat`, {
        cwd: project.directory,
        encoding: 'utf-8',
      }).trim();

      if (!prTitle) {
        // Use first commit message as title base
        const firstCommit = commits.split('\n')[0]?.replace(/^[a-f0-9]+\s+/, '') || currentBranch;
        prTitle = firstCommit.length > 72 ? firstCommit.slice(0, 69) + '...' : firstCommit;
      }

      if (!prBody) {
        const prompt = PR_DESCRIPTION_PROMPT
          .replace('{commits}', commits || 'No commits')
          .replace('{diffStat}', diffStat || 'No changes');

        const client = new ClaudeClient({ model: 'claude-haiku-4-5-20251001' });
        const result = await client.execute(prompt, {
          workingDirectory: project.directory,
          timeout: 30000,
        });

        prBody = result.success ? result.output.trim() : 'Automated PR from Spec Studio';
      }
    }

    // Create PR using gh CLI
    const prUrl = execSync(
      `gh pr create --title "${prTitle.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"')}" --base ${baseBranch}`,
      {
        cwd: project.directory,
        encoding: 'utf-8',
      }
    ).trim();

    return NextResponse.json({
      success: true,
      url: prUrl,
      title: prTitle,
      branch: currentBranch,
      base: baseBranch,
    });
  } catch (error) {
    console.error('Error creating PR:', error);
    return NextResponse.json(
      { error: `Failed to create PR: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
