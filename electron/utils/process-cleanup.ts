/**
 * Windows-specific PTY process cleanup utility.
 *
 * Implements graceful-then-force kill pattern to ensure clean termination
 * of PTY processes and their child processes (especially conhost.exe on Windows).
 */

import { IPty } from 'node-pty';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Kill a PTY process with graceful-then-force pattern.
 *
 * 1. Attempts graceful termination via ptyProcess.kill()
 * 2. Waits for process exit with timeout
 * 3. If timeout expires and process still running, force-kills on Windows using taskkill
 *
 * @param ptyProcess - The PTY process to terminate
 * @param timeoutMs - Timeout in milliseconds before force-kill (default: 3000)
 *
 * @example
 * ```typescript
 * const ptyProcess = pty.spawn('claude', ['--session-id', sessionId]);
 * // ... later ...
 * await killPtyProcess(ptyProcess, 3000);
 * ```
 */
export async function killPtyProcess(ptyProcess: IPty, timeoutMs = 3000): Promise<void> {
  const pid = ptyProcess.pid;

  console.log(`[Process Cleanup] Attempting graceful kill for PID ${pid}`);

  // Step 1: Attempt graceful kill (SIGHUP on Unix, unconditional termination on Windows)
  ptyProcess.kill();

  // Step 2: Wait for process to exit with timeout
  const exitPromise = new Promise<void>((resolve) => {
    ptyProcess.onExit(() => {
      console.log(`[Process Cleanup] PID ${pid} exited gracefully`);
      resolve();
    });
  });

  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      console.warn(`[Process Cleanup] PID ${pid} did not exit within ${timeoutMs}ms, attempting force-kill`);
      resolve();
    }, timeoutMs);
  });

  await Promise.race([exitPromise, timeoutPromise]);

  // Step 3: Force-kill if still running (Windows-specific)
  if (process.platform === 'win32') {
    try {
      // /F = force termination
      // /T = terminate process tree (kills all child processes including conhost.exe)
      // /PID = target process ID
      await execAsync(`taskkill /PID ${pid} /T /F`);
      console.log(`[Process Cleanup] Force-killed process tree for PID ${pid}`);
    } catch (error: any) {
      // Process already terminated or doesn't exist - this is expected if graceful kill worked
      if (error.message && (error.message.includes('not found') || error.message.includes('no tasks'))) {
        console.log(`[Process Cleanup] PID ${pid} already terminated (taskkill not needed)`);
      } else {
        console.warn(`[Process Cleanup] Force-kill failed for PID ${pid}:`, error.message);
      }
    }
  } else {
    console.log(`[Process Cleanup] Non-Windows platform, graceful kill completed for PID ${pid}`);
  }
}
