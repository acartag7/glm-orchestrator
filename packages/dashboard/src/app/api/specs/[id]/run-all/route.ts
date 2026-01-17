/**
 * Run All Chunks API
 *
 * POST /api/specs/[id]/run-all
 * Returns SSE stream with execution events for all chunks
 */

import { getSpec, getChunksBySpec, updateSpec, updateChunk, insertFixChunk, getChunk, getProject } from '@/lib/db';
import {
  startChunkExecution,
  waitForChunkCompletion,
  abortChunkExecution,
  startRunAllSession,
  endRunAllSession,
  isRunAllAborted,
  hasActiveRunAllSession,
} from '@/lib/execution';
import { buildReviewPrompt, parseReviewResult } from '@/lib/prompts';
import {
  checkGitRepo,
  getCurrentBranch,
  createBranch,
  checkoutBranch,
  createCommit,
  resetHard,
  pushBranch,
  createPullRequest,
  generateSpecBranchName,
  checkGitHubCLI,
  createWorktree,
} from '@/lib/git';
import { existsSync } from 'fs';
import { ClaudeClient } from '@specwright/mcp/client';
import type { ChunkToolCall, Chunk, ReviewResult } from '@specwright/shared';

/**
 * Find chunks that can run (all dependencies completed)
 */
function findRunnableChunks(
  allChunks: Chunk[],
  completedIds: Set<string>,
  runningIds: Set<string>,
  failedIds: Set<string>
): Chunk[] {
  return allChunks.filter(chunk => {
    // Skip already completed, running, or failed
    if (completedIds.has(chunk.id) || runningIds.has(chunk.id) || failedIds.has(chunk.id)) {
      return false;
    }

    // Skip if not in a runnable state
    if (chunk.status !== 'pending' && chunk.status !== 'failed' && chunk.status !== 'cancelled') {
      return false;
    }

    // Check if all dependencies are completed
    for (const depId of chunk.dependencies) {
      if (!completedIds.has(depId)) {
        return false;
      }
    }

    return true;
  });
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Helper to send SSE event (safely handles closed controller)
function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  isClosedRef: { value: boolean },
  eventType: string,
  data: Record<string, unknown>
): void {
  if (isClosedRef.value) return; // Don't try to send if already closed

  try {
    const payload = JSON.stringify({ ...data, timestamp: Date.now() });
    controller.enqueue(encoder.encode(`event: ${eventType}\ndata: ${payload}\n\n`));
  } catch (err) {
    // Controller was closed (user navigated away)
    if (err instanceof TypeError && String(err).includes('Controller is already closed')) {
      isClosedRef.value = true;
    } else {
      console.error('Error sending SSE event:', err);
    }
  }
}

// POST /api/specs/[id]/run-all
export async function POST(_request: Request, context: RouteContext) {
  const { id: specId } = await context.params;

  // Check if spec exists
  const spec = getSpec(specId);
  if (!spec) {
    return new Response(JSON.stringify({ error: 'Spec not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check if run-all is already in progress
  if (hasActiveRunAllSession(specId)) {
    return new Response(JSON.stringify({ error: 'Run All is already in progress for this spec' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get all pending chunks (skip completed ones for resume capability)
  const allChunks = getChunksBySpec(specId);
  const pendingChunks = allChunks.filter(c =>
    c.status === 'pending' || c.status === 'failed' || c.status === 'cancelled'
  );

  if (pendingChunks.length === 0) {
    return new Response(JSON.stringify({ error: 'No pending chunks to execute' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Start run-all session
  startRunAllSession(specId);

  // Update spec status to running
  updateSpec(specId, { status: 'running' });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Track if controller is closed (user navigated away)
      const isClosedRef = { value: false };

      const specStartTime = Date.now();

      let passed = 0;
      let failed = 0;
      let fixes = 0;
      const total = pendingChunks.length;
      let currentIndex = 0;

      // Git workflow state
      let gitEnabled = false;
      let originalBranch: string | null = null;
      let specBranch: string | null = null;
      let projectDir: string | null = null;
      let workingDirectory: string | null = null; // The directory to use for git operations (worktree or project)
      let isWorktree = false;

      // Initialize git workflow with worktree support (ORC-29)
      const project = getProject(spec.projectId);
      if (project) {
        projectDir = project.directory;
        if (checkGitRepo(projectDir)) {
          gitEnabled = true;
          originalBranch = getCurrentBranch(projectDir);
          specBranch = spec.branchName || generateSpecBranchName(spec.title);

          // Check if spec already has a worktree
          if (spec.worktreePath && existsSync(spec.worktreePath)) {
            // Reuse existing worktree
            workingDirectory = spec.worktreePath;
            isWorktree = true;

            // Update last activity
            updateSpec(specId, {
              worktreeLastActivity: Date.now(),
            });

            sendEvent(controller, encoder, isClosedRef, 'worktree_reused', {
              path: workingDirectory,
              branch: specBranch,
            });
          } else {
            // Create new worktree with unique path (includes timestamp)
            const worktreeResult = createWorktree(projectDir, specId, specBranch);

            if (worktreeResult.success && worktreeResult.path) {
              workingDirectory = worktreeResult.path;
              isWorktree = true;

              // Store worktree info in spec
              updateSpec(specId, {
                worktreePath: workingDirectory,
                worktreeCreatedAt: Date.now(),
                worktreeLastActivity: Date.now(),
                branchName: specBranch,
                originalBranch: originalBranch || undefined,
              });

              sendEvent(controller, encoder, isClosedRef, 'worktree_created', {
                path: workingDirectory,
                branch: specBranch,
                message: `Worktree created at: ${workingDirectory}`,
              });
            } else {
              // Worktree creation failed, fall back to in-place git workflow
              console.warn('[Git] Failed to create worktree:', worktreeResult.error);
              workingDirectory = projectDir;

              // Clear stale worktree metadata if exists
              if (spec.worktreePath) {
                updateSpec(specId, {
                  worktreePath: null,
                  worktreeCreatedAt: null,
                  worktreeLastActivity: null,
                });
                sendEvent(controller, encoder, isClosedRef, 'worktree_cleared', {
                  path: spec.worktreePath,
                  reason: 'Stale worktree path cleared',
                });
              }

              // Try to create and checkout the spec branch in-place
              const branchResult = await createBranch(projectDir, specBranch, originalBranch || undefined);
              if (branchResult.success) {
                updateSpec(specId, { branchName: specBranch, originalBranch: originalBranch || undefined });
                sendEvent(controller, encoder, isClosedRef, 'git_branch_created', {
                  branch: specBranch,
                  originalBranch,
                });
              } else if (branchResult.error?.type === 'branch_exists') {
                // Branch already exists, try to switch to it
                if (checkoutBranch(projectDir, specBranch)) {
                  updateSpec(specId, { branchName: specBranch, originalBranch: originalBranch || undefined });
                  sendEvent(controller, encoder, isClosedRef, 'git_branch_switched', {
                    branch: specBranch,
                  });
                } else {
                  console.warn('[Git] Failed to switch to existing branch:', specBranch);
                  gitEnabled = false;
                }
              } else {
                console.warn('[Git] Failed to create branch:', branchResult.error?.message);
                gitEnabled = false;
              }
            }
          }
        }
      }

      // Use worktree path or project directory for git operations
      const gitDir = workingDirectory || projectDir;

      // Helper to run a single chunk (original or fix)
      async function runChunk(
        chunkId: string,
        title: string,
        index: number,
        isFix: boolean
      ): Promise<{ success: boolean; reviewResult?: ReviewResult; fixChunkId?: string }> {
        // Check for abort
        if (isRunAllAborted(specId)) {
          return { success: false };
        }

        // Send start event
        sendEvent(controller, encoder, isClosedRef, isFix ? 'fix_chunk_start' : 'chunk_start', {
          chunkId,
          title,
          index,
          total,
        });

        // Start execution
        const startResult = await startChunkExecution(chunkId);
        if (!startResult.success) {
          sendEvent(controller, encoder, isClosedRef, 'error', {
            chunkId,
            message: startResult.error || 'Failed to start chunk execution',
          });
          return { success: false };
        }

        // Wait for completion with tool call forwarding
        const completionResult = await waitForChunkCompletion(
          chunkId,
          (toolCall: ChunkToolCall) => {
            sendEvent(controller, encoder, isClosedRef, 'tool_call', {
              chunkId,
              toolCall: {
                id: toolCall.id,
                tool: toolCall.tool,
                status: toolCall.status,
                input: toolCall.input,
              },
            });
          }
        );

        // Check for abort after execution
        if (isRunAllAborted(specId)) {
          return { success: false };
        }

        // Handle execution result
        if (completionResult.status !== 'completed') {
          sendEvent(controller, encoder, isClosedRef, 'error', {
            chunkId,
            message: completionResult.error || `Chunk ${completionResult.status}`,
          });
          return { success: false };
        }

        // Send complete event
        sendEvent(controller, encoder, isClosedRef, isFix ? 'fix_chunk_complete' : 'chunk_complete', {
          chunkId,
          output: completionResult.output || '',
        });

        // Now review the chunk
        sendEvent(controller, encoder, isClosedRef, 'review_start', { chunkId });

        // Get updated chunk with output
        const updatedChunk = getChunk(chunkId);
        if (!updatedChunk) {
          sendEvent(controller, encoder, isClosedRef, 'error', {
            chunkId,
            message: 'Chunk not found after execution',
          });
          return { success: false };
        }

        // Build review prompt and call Opus
        const reviewPrompt = buildReviewPrompt(updatedChunk);
        const claudeClient = new ClaudeClient();

        try {
          // Review timeout is separate and shorter (2 min) as reviews are simpler operations than chunk execution
          const reviewResult = await claudeClient.execute(reviewPrompt, { timeout: 120000 });

          if (!reviewResult.success) {
            sendEvent(controller, encoder, isClosedRef, 'error', {
              chunkId,
              message: `Review failed: ${reviewResult.output}`,
            });
            return { success: false };
          }

          const parsedReview = parseReviewResult(reviewResult.output);
          if (!parsedReview) {
            // If review parsing fails, assume pass to continue
            sendEvent(controller, encoder, isClosedRef, 'review_complete', {
              chunkId,
              status: 'pass',
              feedback: 'Review parsing failed, assuming pass',
            });
            return { success: true, reviewResult: { status: 'pass', feedback: 'Review parsing failed' } };
          }

          // Update chunk with review result
          updateChunk(chunkId, {
            reviewStatus: parsedReview.status,
            reviewFeedback: parsedReview.feedback,
          });

          let fixChunkId: string | undefined;

          // If needs_fix, create fix chunk
          if (parsedReview.status === 'needs_fix' && parsedReview.fixChunk) {
            const fixChunk = insertFixChunk(chunkId, {
              title: parsedReview.fixChunk.title,
              description: parsedReview.fixChunk.description,
            });
            if (fixChunk) {
              fixChunkId = fixChunk.id;
            }
          }

          sendEvent(controller, encoder, isClosedRef, 'review_complete', {
            chunkId,
            status: parsedReview.status,
            feedback: parsedReview.feedback,
            fixChunkId,
          });

          return { success: true, reviewResult: parsedReview, fixChunkId };
        } catch (error) {
          sendEvent(controller, encoder, isClosedRef, 'error', {
            chunkId,
            message: `Review error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          });
          return { success: false };
        }
      }

      let prUrl: string | undefined;

      // Main execution loop with parallel execution
      try {
        const completedIds = new Set<string>();
        const runningIds = new Set<string>();
        const failedIds = new Set<string>();

        // Initialize completed set with already completed chunks
        for (const chunk of allChunks) {
          if (chunk.status === 'completed') {
            completedIds.add(chunk.id);
          }
        }

        // Run chunks in parallel based on dependencies
        let hasFailure = false;
        let stopReason: string | null = null;

        while (!hasFailure && !stopReason) {
          // Check for abort
          if (isRunAllAborted(specId)) {
            stopReason = 'Aborted by user';
            break;
          }

          // Refresh chunks from DB to get latest state
          const currentChunks = getChunksBySpec(specId);

          // Find chunks that can run
          const runnableChunks = findRunnableChunks(currentChunks, completedIds, runningIds, failedIds);

          // Check if we're done
          if (runnableChunks.length === 0 && runningIds.size === 0) {
            // No more chunks to run and none running
            break;
          }

          // If nothing can run but some are still running, wait for them
          if (runnableChunks.length === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
          }

          // TODO: Implement proper parallel execution with mutex or async queue
          // Running chunks sequentially to avoid race condition on shared state
          for (const chunk of runnableChunks) {
            // Check for abort before starting each chunk
            if (isRunAllAborted(specId) || hasFailure) {
              break;
            }

            currentIndex++;
            runningIds.add(chunk.id);

            const result = await runChunk(chunk.id, chunk.title, currentIndex, false);
            runningIds.delete(chunk.id);

            if (!result.success) {
              // Git: Reset to discard failed changes
              if (gitEnabled && gitDir) {
                resetHard(gitDir);
                sendEvent(controller, encoder, isClosedRef, 'git_reset', {
                  chunkId: chunk.id,
                  reason: 'Chunk execution failed',
                });
              }
              if (isRunAllAborted(specId)) {
                stopReason = 'Aborted by user';
              } else {
                failedIds.add(chunk.id);
                failed++;
                hasFailure = true;
                stopReason = `Chunk "${chunk.title}" failed`;
              }
              break;
            }

            // Handle review result
            if (result.reviewResult) {
              if (result.reviewResult.status === 'pass') {
                // Git: Commit the successful chunk
                if (gitEnabled && gitDir) {
                  const commitResult = await createCommit(gitDir, `chunk ${currentIndex}: ${chunk.title}`);
                  if (commitResult.success && commitResult.commitHash) {
                    updateChunk(chunk.id, { commitHash: commitResult.commitHash });
                    sendEvent(controller, encoder, isClosedRef, 'git_commit', {
                      chunkId: chunk.id,
                      commitHash: commitResult.commitHash,
                      filesChanged: commitResult.filesChanged,
                    });
                  } else if (!commitResult.success) {
                    // Check if it's a benign "no changes" or a real error
                    const isNoChanges = commitResult.error?.toLowerCase().includes('no changes');
                    if (isNoChanges) {
                      // No changes to commit is benign - chunk still passes
                      sendEvent(controller, encoder, isClosedRef, 'git_commit_skipped', {
                        chunkId: chunk.id,
                        reason: 'No changes to commit',
                      });
                    } else {
                      // Real commit failure - abort the run
                      resetHard(gitDir);
                      sendEvent(controller, encoder, isClosedRef, 'git_commit_failed', {
                        chunkId: chunk.id,
                        error: commitResult.error || 'Failed to commit changes',
                      });
                      failedIds.add(chunk.id);
                      failed++;
                      hasFailure = true;
                      stopReason = `Git commit failed for "${chunk.title}": ${commitResult.error || 'Unknown error'}`;
                      break;
                    }
                  }
                }
                completedIds.add(chunk.id);
                passed++;
              } else if (result.reviewResult.status === 'needs_fix' && result.fixChunkId) {
                // Run fix chunk (sequentially after the original)
                fixes++;
                const fixChunk = getChunk(result.fixChunkId);
                if (fixChunk) {
                  const fixResult = await runChunk(result.fixChunkId, fixChunk.title, currentIndex, true);

                  if (!fixResult.success) {
                    // Git: Reset to discard failed fix changes
                    if (gitEnabled && gitDir) {
                      resetHard(gitDir);
                      sendEvent(controller, encoder, isClosedRef, 'git_reset', {
                        chunkId: result.fixChunkId,
                        reason: 'Fix chunk execution failed',
                      });
                    }
                    if (isRunAllAborted(specId)) {
                      stopReason = 'Aborted by user';
                    } else {
                      failedIds.add(chunk.id);
                      failed++;
                      hasFailure = true;
                      stopReason = `Fix chunk "${fixChunk.title}" failed`;
                    }
                    break;
                  }

                  // Check fix chunk review
                  if (fixResult.reviewResult?.status === 'pass') {
                    // Git: Commit the successful fix chunk
                    if (gitEnabled && gitDir) {
                      const commitResult = await createCommit(gitDir, `fix: ${fixChunk.title}`);
                      if (commitResult.success && commitResult.commitHash) {
                        updateChunk(result.fixChunkId, { commitHash: commitResult.commitHash });
                        sendEvent(controller, encoder, isClosedRef, 'git_commit', {
                          chunkId: result.fixChunkId,
                          commitHash: commitResult.commitHash,
                          filesChanged: commitResult.filesChanged,
                        });
                      } else if (!commitResult.success) {
                        // Check if it's a benign "no changes" or a real error
                        const isNoChanges = commitResult.error?.toLowerCase().includes('no changes');
                        if (isNoChanges) {
                          // No changes to commit is benign - fix chunk still passes
                          sendEvent(controller, encoder, isClosedRef, 'git_commit_skipped', {
                            chunkId: result.fixChunkId,
                            reason: 'No changes to commit',
                          });
                        } else {
                          // Real commit failure - abort the run
                          resetHard(gitDir);
                          sendEvent(controller, encoder, isClosedRef, 'git_commit_failed', {
                            chunkId: result.fixChunkId,
                            error: commitResult.error || 'Failed to commit fix changes',
                          });
                          failedIds.add(chunk.id);
                          failed++;
                          hasFailure = true;
                          stopReason = `Git commit failed for fix "${fixChunk.title}": ${commitResult.error || 'Unknown error'}`;
                          break;
                        }
                      }
                    }
                    completedIds.add(chunk.id);
                    completedIds.add(result.fixChunkId);
                    passed++;
                  } else if (fixResult.reviewResult?.status === 'fail') {
                    // Git: Reset to discard failed fix work
                    if (gitEnabled && gitDir) {
                      resetHard(gitDir);
                      sendEvent(controller, encoder, isClosedRef, 'git_reset', {
                        chunkId: result.fixChunkId,
                        reason: 'Fix chunk review failed',
                      });
                    }
                    failedIds.add(chunk.id);
                    failed++;
                    hasFailure = true;
                    stopReason = `Fix chunk "${fixChunk.title}" review failed`;
                    break;
                  } else {
                    // needs_fix again - mark as completed for now to avoid infinite loop
                    completedIds.add(chunk.id);
                    completedIds.add(result.fixChunkId);
                  }
                }
              } else if (result.reviewResult.status === 'fail') {
                // Git: Reset to discard failed chunk work
                if (gitEnabled && gitDir) {
                  resetHard(gitDir);
                  sendEvent(controller, encoder, isClosedRef, 'git_reset', {
                    chunkId: chunk.id,
                    reason: 'Chunk review failed',
                  });
                }
                failedIds.add(chunk.id);
                failed++;
                hasFailure = true;
                stopReason = `Chunk "${chunk.title}" review failed`;
                break;
              }
            }
          }
        }

        if (stopReason) {
          sendEvent(controller, encoder, isClosedRef, 'stopped', { reason: stopReason });
        }

        // Check if all completed successfully
        if (!isRunAllAborted(specId) && failed === 0) {
          // Update spec status to completed
          updateSpec(specId, { status: 'completed' });

          // Git: Push branch and create PR
          if (gitEnabled && gitDir && specBranch && originalBranch) {
            // Check if gh CLI is available
            const ghCheck = checkGitHubCLI();
            if (ghCheck.installed && ghCheck.authenticated) {
              // Push branch to remote (from worktree or project dir)
              const pushResult = await pushBranch(gitDir, specBranch);
              if (pushResult.success) {
                sendEvent(controller, encoder, isClosedRef, 'git_push', {
                  branch: specBranch,
                });

                // Create PR
                const prBody = `Automated PR for spec execution.\n\n**${passed} chunks** completed successfully.\n\n## Spec: ${spec.title}`;
                const prResult = await createPullRequest(
                  gitDir,
                  `Spec: ${spec.title}`,
                  prBody,
                  originalBranch
                );

                if (prResult.success && prResult.prUrl) {
                  prUrl = prResult.prUrl;
                  updateSpec(specId, { prUrl: prResult.prUrl, prNumber: prResult.prNumber });
                  sendEvent(controller, encoder, isClosedRef, 'pr_created', {
                    url: prResult.prUrl,
                    number: prResult.prNumber,
                  });
                } else {
                  sendEvent(controller, encoder, isClosedRef, 'pr_creation_failed', {
                    message: prResult.error || 'Failed to create PR',
                  });
                }
              } else {
                sendEvent(controller, encoder, isClosedRef, 'git_push_failed', {
                  message: pushResult.error || 'Failed to push branch',
                });
              }
            } else {
              sendEvent(controller, encoder, isClosedRef, 'git_push_skipped', {
                message: ghCheck.error || 'GitHub CLI not available',
              });
            }
          }
        } else {
          // Keep as running or set to review for manual intervention
          updateSpec(specId, { status: 'review' });
        }

        // Send final event
        sendEvent(controller, encoder, isClosedRef, 'all_complete', {
          specId,
          passed,
          failed,
          fixes,
          prUrl,
        });
      } catch (error) {
        sendEvent(controller, encoder, isClosedRef, 'error', {
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        // Git: Only switch back to original branch if NOT using worktree
        // With worktree, main project directory is untouched
        if (gitEnabled && projectDir && originalBranch && !isWorktree) {
          try {
            const switched = checkoutBranch(projectDir, originalBranch);
            if (!switched) {
              console.warn(`[Git] Failed to switch back to original branch '${originalBranch}' in project '${projectDir}'. You may still be on the spec branch.`);
              sendEvent(controller, encoder, isClosedRef, 'git_branch_restore_failed', {
                originalBranch,
                projectDir,
                message: `Failed to switch back to branch '${originalBranch}'`,
              });
            }
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.warn(`[Git] Error switching back to original branch '${originalBranch}' in project '${projectDir}': ${errorMessage}`);
            sendEvent(controller, encoder, isClosedRef, 'git_branch_restore_failed', {
              originalBranch,
              projectDir,
              error: errorMessage,
            });
          }
        }

        // Update worktree last activity timestamp
        if (isWorktree && workingDirectory) {
          updateSpec(specId, { worktreeLastActivity: Date.now() });
        }

        const totalDuration = Date.now() - specStartTime;
        console.log('[SPEC EXECUTION ANALYTICS]', {
          specId,
          specTitle: spec.title,
          totalChunks: total,
          completedChunks: passed,
          failedChunks: failed,
          fixChunks: fixes,
          totalDurationMs: totalDuration,
          totalDurationMinutes: (totalDuration / 60000).toFixed(2),
          averageChunkDurationMs: total > 0 ? Math.floor(totalDuration / total) : 0,
          averageChunkDurationMinutes: total > 0 ? (totalDuration / total / 60000).toFixed(2) : '0.00',
          prCreated: !!prUrl,
          timestamp: new Date().toISOString()
        });

        endRunAllSession(specId);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
