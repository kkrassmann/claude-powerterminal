/**
 * IPC handlers for the local code review panel.
 *
 * Provides three operations:
 *  - review:diff        — fetch unified diff of all uncommitted changes (staged + unstaged)
 *  - review:reject-hunk — revert a specific hunk via `git apply --reverse`
 *  - review:reject-file — revert an entire file via `git checkout HEAD -- <file>`
 *
 * The reject-hunk handler uses `child_process.spawn` (not execFile) so that the
 * patch content can be written to stdin, which execFile does not support.
 */

import { ipcMain } from 'electron';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';

const execFileAsync = promisify(execFile);

/**
 * Register all code-review IPC handlers.
 * Call once during app initialization in main.ts.
 */
export function registerReviewHandlers(): void {
  console.log('[Review Handlers] Registering code review IPC handlers');

  // Handler 1: review:diff
  // Returns the full unified diff of all uncommitted changes against HEAD.
  // Uses a 10 MB buffer to handle large changesets.
  ipcMain.handle(IPC_CHANNELS.REVIEW_DIFF, async (_event, cwd: string): Promise<string> => {
    try {
      // `git diff HEAD` covers both staged and unstaged changes relative to HEAD
      const result = await execFileAsync(
        'git',
        ['diff', 'HEAD', '--unified=3'],
        {
          cwd,
          timeout: 15000,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024, // 10 MB
        }
      );

      if (result.stdout.trim()) {
        return result.stdout;
      }

      // Fallback: check staged-only changes (e.g. before first commit where HEAD doesn't exist)
      const cached = await execFileAsync(
        'git',
        ['diff', '--cached', '--unified=3'],
        {
          cwd,
          timeout: 15000,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        }
      );
      return cached.stdout;
    } catch (error: any) {
      console.warn(`[Review Handlers] review:diff failed for ${cwd}: ${error.message}`);
      return '';
    }
  });

  // Handler 2: review:reject-hunk
  // Applies the given patch content in reverse to undo a specific hunk.
  // MUST use spawn + stdin because execFile does not support stdin input.
  ipcMain.handle(
    IPC_CHANNELS.REVIEW_REJECT_HUNK,
    (_event, cwd: string, patchContent: string): Promise<{ success: boolean; error?: string }> => {
      return new Promise((resolve) => {
        const proc = spawn(
          'git',
          ['apply', '--reverse', '--unidiff-zero'],
          {
            cwd,
            windowsHide: true,
          }
        );

        let stderr = '';
        proc.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        proc.on('close', (code: number | null) => {
          if (code === 0) {
            resolve({ success: true });
          } else {
            console.warn(`[Review Handlers] review:reject-hunk failed (exit ${code}): ${stderr}`);
            resolve({ success: false, error: stderr.trim() || `Exit code ${code}` });
          }
        });

        proc.on('error', (err: Error) => {
          console.error('[Review Handlers] review:reject-hunk spawn error:', err.message);
          resolve({ success: false, error: err.message });
        });

        // Write patch to stdin and signal EOF
        proc.stdin.write(patchContent);
        proc.stdin.end();
      });
    }
  );

  // Handler 3: review:reject-file
  // Reverts all changes to a file by checking it out from HEAD.
  ipcMain.handle(
    IPC_CHANNELS.REVIEW_REJECT_FILE,
    async (_event, cwd: string, filePath: string): Promise<{ success: boolean; error?: string }> => {
      try {
        await execFileAsync(
          'git',
          ['checkout', 'HEAD', '--', filePath],
          {
            cwd,
            timeout: 5000,
            windowsHide: true,
          }
        );
        return { success: true };
      } catch (error: any) {
        console.warn(`[Review Handlers] review:reject-file failed for ${filePath}: ${error.message}`);
        return { success: false, error: error.message };
      }
    }
  );

  // Handler 4: review:apply-patch
  // Applies a patch directly (forward, not reverse) — used for undo operations.
  // MUST use spawn + stdin because execFile does not support stdin input.
  ipcMain.handle(
    IPC_CHANNELS.REVIEW_APPLY_PATCH,
    (_event, cwd: string, patchContent: string): Promise<{ success: boolean; error?: string }> => {
      return new Promise((resolve) => {
        const proc = spawn(
          'git',
          ['apply', '--unidiff-zero'],
          {
            cwd,
            windowsHide: true,
          }
        );

        let stderr = '';
        proc.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        proc.on('close', (code: number | null) => {
          if (code === 0) {
            resolve({ success: true });
          } else {
            console.warn(`[Review Handlers] review:apply-patch failed (exit ${code}): ${stderr}`);
            resolve({ success: false, error: stderr.trim() || `Exit code ${code}` });
          }
        });

        proc.on('error', (err: Error) => {
          console.error('[Review Handlers] review:apply-patch spawn error:', err.message);
          resolve({ success: false, error: err.message });
        });

        proc.stdin.write(patchContent);
        proc.stdin.end();
      });
    }
  );

  console.log('[Review Handlers] All code review IPC handlers registered successfully');
}
