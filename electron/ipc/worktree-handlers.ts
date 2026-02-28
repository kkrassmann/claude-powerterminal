/**
 * Git Worktree IPC handlers for listing, creating, and deleting worktrees.
 *
 * Parses `git worktree list --porcelain` output and cross-references with
 * active PTY processes to determine which worktrees have active sessions.
 */

import { ipcMain } from 'electron';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { WorktreeInfo, WorktreeCreateOptions } from '../../src/shared/worktree-types';
import { getPtyProcesses } from './pty-handlers';
import { getSessionFromDisk } from './session-handlers';

/**
 * Parse `git worktree list --porcelain` output into WorktreeInfo[].
 *
 * Porcelain format example:
 *   worktree /abs/path/to/main
 *   HEAD abc1234def5678
 *   branch refs/heads/main
 *   <blank line>
 *   worktree /abs/path/to/.worktrees/feature-x
 *   HEAD def5678abc1234
 *   branch refs/heads/feature-x
 *   <blank line>
 */
function parseWorktreeList(output: string, activeCwds: Set<string>): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  const blocks = output.trim().split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;

    const lines = block.trim().split('\n');
    let worktreePath = '';
    let commit = '';
    let branch = '';
    let isMain = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        worktreePath = line.substring('worktree '.length).trim();
      } else if (line.startsWith('HEAD ')) {
        commit = line.substring('HEAD '.length).trim().substring(0, 7);
      } else if (line.startsWith('branch ')) {
        const fullRef = line.substring('branch '.length).trim();
        // Strip refs/heads/ prefix
        branch = fullRef.replace('refs/heads/', '');
      } else if (line.trim() === 'detached') {
        branch = '(detached)';
      }
    }

    if (!worktreePath) continue;

    // First worktree in the list is always the main worktree
    if (worktrees.length === 0) {
      isMain = true;
    }

    // Normalize path for comparison
    const normalizedPath = path.resolve(worktreePath);
    const hasSession = activeCwds.has(normalizedPath);

    worktrees.push({
      path: normalizedPath,
      branch: branch || '(unknown)',
      commit,
      isMain,
      hasSession,
    });
  }

  return worktrees;
}

/**
 * Get the set of normalized working directories for all active PTY sessions.
 */
function getActiveSessionCwds(): Set<string> {
  const cwds = new Set<string>();
  const ptyProcesses = getPtyProcesses();

  for (const [sessionId] of ptyProcesses) {
    const session = getSessionFromDisk(sessionId);
    if (session) {
      cwds.add(path.resolve(session.workingDirectory));
    }
  }

  return cwds;
}

/**
 * Register all worktree-related IPC handlers.
 * Call this once during app initialization in main.ts.
 */
export function registerWorktreeHandlers(): void {
  console.log('[Worktree Handlers] Registering Worktree IPC handlers');

  // Handler 1: worktree:list - List all worktrees for a repository
  ipcMain.handle(IPC_CHANNELS.WORKTREE_LIST, async (_event, repoPath: string): Promise<WorktreeInfo[]> => {
    try {
      const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: repoPath,
        timeout: 5000,
        windowsHide: true,
        encoding: 'utf-8',
      });

      const activeCwds = getActiveSessionCwds();
      return parseWorktreeList(output, activeCwds);
    } catch (error: any) {
      console.error(`[Worktree Handlers] Failed to list worktrees for ${repoPath}:`, error.message);
      return [];
    }
  });

  // Handler 2: worktree:create - Create a new worktree with a new branch
  ipcMain.handle(IPC_CHANNELS.WORKTREE_CREATE, async (_event, options: WorktreeCreateOptions): Promise<WorktreeInfo | null> => {
    try {
      const { repoPath, branchName, baseBranch } = options;

      // Find the main worktree root to place .worktrees/ there
      const mainRoot = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: repoPath,
        timeout: 5000,
        windowsHide: true,
        encoding: 'utf-8',
      }).split('\n')[0].replace('worktree ', '').trim();

      const worktreeDir = path.join(mainRoot, '.worktrees');

      // Ensure .worktrees/ directory exists
      if (!fs.existsSync(worktreeDir)) {
        fs.mkdirSync(worktreeDir, { recursive: true });
      }

      const worktreePath = path.join(worktreeDir, branchName);

      // Build git worktree add command
      const args = ['worktree', 'add', '-b', branchName, worktreePath];
      if (baseBranch) {
        args.push(baseBranch);
      }

      execFileSync('git', args, {
        cwd: repoPath,
        timeout: 10000,
        windowsHide: true,
        encoding: 'utf-8',
      });

      // Get the commit hash of the new worktree
      const commitHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: worktreePath,
        timeout: 5000,
        windowsHide: true,
        encoding: 'utf-8',
      }).trim();

      console.log(`[Worktree Handlers] Created worktree: ${branchName} at ${worktreePath}`);

      return {
        path: path.resolve(worktreePath),
        branch: branchName,
        commit: commitHash,
        isMain: false,
        hasSession: false,
      };
    } catch (error: any) {
      console.error(`[Worktree Handlers] Failed to create worktree:`, error.message);
      throw new Error(error.message || 'Failed to create worktree');
    }
  });

  // Handler 3: worktree:delete - Remove a worktree
  ipcMain.handle(IPC_CHANNELS.WORKTREE_DELETE, async (_event, worktreePath: string): Promise<boolean> => {
    try {
      execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], {
        timeout: 10000,
        windowsHide: true,
        encoding: 'utf-8',
      });

      console.log(`[Worktree Handlers] Deleted worktree: ${worktreePath}`);
      return true;
    } catch (error: any) {
      console.error(`[Worktree Handlers] Failed to delete worktree ${worktreePath}:`, error.message);
      throw new Error(error.message || 'Failed to delete worktree');
    }
  });

  console.log('[Worktree Handlers] All Worktree IPC handlers registered successfully');
}
