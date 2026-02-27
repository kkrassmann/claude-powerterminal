/**
 * Git IPC handlers for retrieving repository context.
 *
 * Provides branch name, uncommitted change counts, and home directory path
 * for rendering git context in terminal tiles.
 */

import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { parseGitStatus } from '../utils/git-status-parser';

const execFileAsync = promisify(execFile);

/**
 * Git repository context (main process copy, duplicated from renderer model).
 * Main process can't import from Angular src, so we duplicate the interface.
 */
interface GitContext {
  readonly branch: string | null;
  readonly added: number;
  readonly modified: number;
  readonly deleted: number;
  readonly isGitRepo: boolean;
}

/**
 * Register all Git-related IPC handlers.
 * Call this once during app initialization in main.ts.
 */
export function registerGitHandlers(): void {
  console.log('[Git Handlers] Registering Git IPC handlers');

  // Handler 1: git:context - Get Git repository context for a directory
  ipcMain.handle(IPC_CHANNELS.GIT_CONTEXT, async (_event, cwd: string): Promise<GitContext> => {
    try {
      // Run git commands in parallel with 5-second timeout to prevent hangs
      const [branchResult, statusResult] = await Promise.all([
        execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd,
          timeout: 5000,
          windowsHide: true, // Don't flash console window on Windows
        }),
        execFileAsync('git', ['status', '--porcelain'], {
          cwd,
          timeout: 5000,
          windowsHide: true,
        }),
      ]);

      const branch = branchResult.stdout.trim();
      const { added, modified, deleted } = parseGitStatus(statusResult.stdout);

      return {
        branch: branch || null,
        added,
        modified,
        deleted,
        isGitRepo: true,
      };
    } catch (error: any) {
      // Not a git repo, git not installed, timeout, or other error
      // Return safe defaults instead of throwing
      console.debug(`[Git Handlers] Git context failed for ${cwd}: ${error.message}`);
      return {
        branch: null,
        added: 0,
        modified: 0,
        deleted: 0,
        isGitRepo: false,
      };
    }
  });

  // Handler 2: app:home-dir - Get home directory path
  // Renderer is sandboxed and can't read env vars, so main process provides this
  ipcMain.handle(IPC_CHANNELS.APP_HOME_DIR, async (): Promise<string> => {
    return process.env.HOME || process.env.USERPROFILE || '';
  });

  console.log('[Git Handlers] All Git IPC handlers registered successfully');
}
