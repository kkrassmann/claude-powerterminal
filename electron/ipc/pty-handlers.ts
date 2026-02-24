/**
 * PTY IPC handlers for managing Claude CLI processes.
 *
 * Handles spawning, termination, and I/O operations for PTY processes.
 * Implements Windows-specific workarounds and environment sanitization.
 */

import * as pty from 'node-pty';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { killPtyProcess } from '../utils/process-cleanup';

/**
 * Map of session IDs to active PTY processes.
 * Used to track and manage PTY lifecycle across IPC calls.
 */
const ptyProcesses = new Map<string, pty.IPty>();

/**
 * Options for spawning a new PTY process.
 */
interface PTYSpawnOptions {
  sessionId: string;
  cwd: string;
  flags: string[];
}

/**
 * Options for writing data to a PTY process.
 */
interface PTYWriteOptions {
  sessionId: string;
  data: string;
}

/**
 * Register all PTY-related IPC handlers.
 * Call this once during app initialization in main.ts.
 */
export function registerPtyHandlers(): void {
  console.log('[PTY Handlers] Registering PTY IPC handlers');

  // Handler 1: PTY_SPAWN - Create a new PTY process
  ipcMain.handle(IPC_CHANNELS.PTY_SPAWN, async (event, options: PTYSpawnOptions) => {
    const { sessionId, cwd, flags } = options;

    console.log(`[PTY Handlers] Spawning PTY for session ${sessionId} in ${cwd} with flags:`, flags);

    try {
      // Environment sanitization: Remove CLAUDECODE vars to prevent nested session conflicts
      const env = { ...process.env };
      delete env.CLAUDECODE;
      delete env.CLAUDECODE_SESSION_ID;

      // Spawn PTY process with Windows ConPTY mode
      const ptyProcess = pty.spawn('claude', ['--session-id', sessionId, ...flags], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd,
        env,
        useConpty: true, // Windows ConPTY mode (auto-enabled on Win10 1809+)
      });

      // Store in map for later access
      ptyProcesses.set(sessionId, ptyProcess);

      console.log(`[PTY Handlers] PTY spawned for session ${sessionId} with PID ${ptyProcess.pid}`);

      // Setup output streaming to renderer
      ptyProcess.onData((data) => {
        event.sender.send(IPC_CHANNELS.PTY_DATA, { sessionId, data });
      });

      // Setup exit handling
      ptyProcess.onExit(({ exitCode, signal }) => {
        console.log(`[PTY Handlers] Session ${sessionId} exited with code ${exitCode}, signal ${signal}`);
        event.sender.send(IPC_CHANNELS.PTY_EXIT, { sessionId, exitCode, signal });
        ptyProcesses.delete(sessionId);
      });

      return { success: true, pid: ptyProcess.pid };
    } catch (error: any) {
      console.error(`[PTY Handlers] Failed to spawn PTY for session ${sessionId}:`, error);
      return { success: false, error: error.message };
    }
  });

  // Handler 2: PTY_KILL - Terminate a PTY process
  ipcMain.handle(IPC_CHANNELS.PTY_KILL, async (_event, sessionId: string) => {
    console.log(`[PTY Handlers] Killing PTY for session ${sessionId}`);

    const ptyProcess = ptyProcesses.get(sessionId);

    if (!ptyProcess) {
      console.warn(`[PTY Handlers] Session ${sessionId} not found for kill`);
      return { success: false, error: 'Session not found' };
    }

    try {
      // Use Windows-safe kill function with timeout
      await killPtyProcess(ptyProcess, 3000);
      ptyProcesses.delete(sessionId);

      console.log(`[PTY Handlers] Successfully killed session ${sessionId}`);
      return { success: true };
    } catch (error: any) {
      console.error(`[PTY Handlers] Failed to kill session ${sessionId}:`, error);
      return { success: false, error: error.message };
    }
  });

  // Handler 3: PTY_WRITE - Send input to a PTY process
  ipcMain.handle(IPC_CHANNELS.PTY_WRITE, async (_event, options: PTYWriteOptions) => {
    const { sessionId, data } = options;

    const ptyProcess = ptyProcesses.get(sessionId);

    if (!ptyProcess) {
      console.warn(`[PTY Handlers] Session ${sessionId} not found for write`);
      return { success: false, error: 'Session not found' };
    }

    try {
      ptyProcess.write(data);
      return { success: true };
    } catch (error: any) {
      console.error(`[PTY Handlers] Failed to write to session ${sessionId}:`, error);
      return { success: false, error: error.message };
    }
  });

  console.log('[PTY Handlers] All PTY IPC handlers registered successfully');
}
