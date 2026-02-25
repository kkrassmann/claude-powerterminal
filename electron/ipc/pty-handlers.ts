/**
 * PTY IPC handlers for managing Claude CLI processes.
 *
 * Handles spawning, termination, and I/O operations for PTY processes.
 * Implements Windows-specific workarounds and environment sanitization.
 */

import * as pty from 'node-pty';
import * as fs from 'fs';
import * as path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { killPtyProcess } from '../utils/process-cleanup';
import { getScrollbackBuffers, getStatusDetectors, broadcastStatus } from '../websocket/ws-server';
import { ScrollbackBuffer } from '../../src/src/app/services/scrollback-buffer.service';
import { deleteSessionFromDisk, getSessionFromDisk } from './session-handlers';
import { StatusDetector } from '../status/status-detector';

/**
 * Map of session IDs to active PTY processes.
 * Used to track and manage PTY lifecycle across IPC calls.
 */
const ptyProcesses = new Map<string, pty.IPty>();

/**
 * Shutdown flag to prevent session deletion during app quit.
 * When true, onExit handlers skip deleteSessionFromDisk so sessions persist for next restart.
 */
let shuttingDown = false;

/**
 * Sessions currently being restarted. onExit handlers skip cleanup for these.
 */
const restartingSessions = new Set<string>();

export function setShuttingDown(value: boolean): void {
  shuttingDown = value;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function isSessionRestarting(sessionId: string): boolean {
  return restartingSessions.has(sessionId);
}

/**
 * Options for spawning a new PTY process.
 */
interface PTYSpawnOptions {
  sessionId: string;
  cwd: string;
  flags: string[];
  resume?: boolean;
}

/**
 * Options for writing data to a PTY process.
 */
interface PTYWriteOptions {
  sessionId: string;
  data: string;
}

/**
 * Get the map of active PTY processes.
 * Used by main.ts for session restore and cleanup.
 */
export function getPtyProcesses(): Map<string, pty.IPty> {
  return ptyProcesses;
}

/**
 * Register all PTY-related IPC handlers.
 * Call this once during app initialization in main.ts.
 */
export function registerPtyHandlers(): void {
  console.log('[PTY Handlers] Registering PTY IPC handlers');

  // Handler 1: PTY_SPAWN - Create a new PTY process
  ipcMain.handle(IPC_CHANNELS.PTY_SPAWN, async (event, options: PTYSpawnOptions) => {
    const { sessionId, cwd, flags, resume } = options;

    console.log(`[PTY Handlers] Spawning PTY for session ${sessionId} in ${cwd} (resume=${!!resume}) with flags:`, flags);

    try {
      // Validate cwd exists
      const resolvedCwd = path.resolve(cwd);
      if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
        return { success: false, error: `Directory does not exist: ${resolvedCwd}` };
      }

      // Environment sanitization: Remove CLAUDECODE vars to prevent nested session conflicts
      const env = { ...process.env };
      delete env.CLAUDECODE;
      delete env.CLAUDECODE_SESSION_ID;

      // On Windows, spawn claude.exe directly with full path resolution
      const claudeExe = process.platform === 'win32' ? 'claude.exe' : 'claude';
      // Use --resume if explicitly requested OR if session already exists on disk
      const existsOnDisk = !!getSessionFromDisk(sessionId);
      const useResume = resume || existsOnDisk;
      const sessionFlag = useResume ? '--resume' : '--session-id';
      const claudeArgs = [sessionFlag, sessionId, ...flags];

      console.log(`[PTY Handlers] resume flag=${resume}, existsOnDisk=${existsOnDisk}, using ${sessionFlag}`);

      console.log(`[PTY Handlers] Spawning: ${claudeExe} ${claudeArgs.join(' ')} in ${resolvedCwd}`);

      // Spawn PTY process with Windows ConPTY mode
      const ptyProcess = pty.spawn(claudeExe, claudeArgs, {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: resolvedCwd,
        env,
        useConpty: true, // Windows ConPTY mode (auto-enabled on Win10 1809+)
      });

      // Store in map for later access
      ptyProcesses.set(sessionId, ptyProcess);

      // Create scrollback buffer for WebSocket replay
      getScrollbackBuffers().set(sessionId, new ScrollbackBuffer(10000));

      // Create status detector
      const statusDetector = new StatusDetector(sessionId, (sid, status, prev) => {
        broadcastStatus(sid, status);
      });
      getStatusDetectors().set(sessionId, statusDetector);

      console.log(`[PTY Handlers] PTY spawned for session ${sessionId} with PID ${ptyProcess.pid}`);

      // Setup output streaming to renderer (guard against destroyed window during quit)
      ptyProcess.onData((data) => {
        // Append to scrollback buffer for WebSocket replay
        const buffer = getScrollbackBuffers().get(sessionId);
        if (buffer) {
          buffer.append(data);
        }

        // Feed output to status detector
        const detector = getStatusDetectors().get(sessionId);
        if (detector) {
          detector.processOutput(data);
        }

        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.PTY_DATA, { sessionId, data });
        }
      });

      // Setup exit handling
      ptyProcess.onExit(({ exitCode, signal }) => {
        if (restartingSessions.has(sessionId)) return;
        console.log(`[PTY Handlers] Session ${sessionId} exited with code ${exitCode}, signal ${signal}`);

        // Notify status detector of exit
        const detector = getStatusDetectors().get(sessionId);
        if (detector) {
          detector.processExit();
          detector.destroy();
          getStatusDetectors().delete(sessionId);
        }

        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.PTY_EXIT, { sessionId, exitCode, signal });
        }
        ptyProcesses.delete(sessionId);
        getScrollbackBuffers().delete(sessionId);

        // Only remove from disk if CLI exited normally (not during app shutdown)
        if (!shuttingDown) {
          deleteSessionFromDisk(sessionId);
        }
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
      // Destroy status detector
      const detector = getStatusDetectors().get(sessionId);
      if (detector) {
        detector.destroy();
        getStatusDetectors().delete(sessionId);
      }

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

  // Handler 4: PTY_LIST - List active PTY sessions with PIDs
  ipcMain.handle(IPC_CHANNELS.PTY_LIST, async () => {
    const activeSessions: { sessionId: string; pid: number }[] = [];
    ptyProcesses.forEach((ptyProcess, sessionId) => {
      activeSessions.push({ sessionId, pid: ptyProcess.pid });
    });
    return activeSessions;
  });

  // Handler 5: PTY_RESTART - Kill and re-spawn PTY with --resume
  ipcMain.handle(IPC_CHANNELS.PTY_RESTART, async (event, sessionId: string, cols?: number, rows?: number) => {
    console.log(`[PTY Handlers] Restarting session ${sessionId}`);

    const oldPty = ptyProcesses.get(sessionId);
    if (!oldPty) {
      return { success: false, error: 'Session not found' };
    }

    const metadata = getSessionFromDisk(sessionId);
    if (!metadata) {
      return { success: false, error: 'Session metadata not found' };
    }

    // Mark as restarting so onExit skips cleanup
    restartingSessions.add(sessionId);

    // Destroy old status detector
    const oldDetector = getStatusDetectors().get(sessionId);
    if (oldDetector) {
      oldDetector.destroy();
      getStatusDetectors().delete(sessionId);
    }

    // Kill entire process tree (taskkill /T /F on Windows)
    try {
      await killPtyProcess(oldPty, 3000);
    } catch {}
    ptyProcesses.delete(sessionId);

    // Spawn new PTY with --resume
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDECODE_SESSION_ID;

    const claudeExe = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const newPty = pty.spawn(claudeExe, ['--resume', sessionId, ...metadata.cliFlags], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 30,
      cwd: metadata.workingDirectory,
      env,
      useConpty: true,
    });

    // Replace in map and reset scrollback
    ptyProcesses.set(sessionId, newPty);
    getScrollbackBuffers().set(sessionId, new ScrollbackBuffer(10000));

    // Create new status detector
    const newDetector = new StatusDetector(sessionId, (sid, status, prev) => {
      broadcastStatus(sid, status);
    });
    getStatusDetectors().set(sessionId, newDetector);

    // Wire up new event handlers
    newPty.onData((data) => {
      const buffer = getScrollbackBuffers().get(sessionId);
      if (buffer) buffer.append(data);

      // Feed to status detector
      const detector = getStatusDetectors().get(sessionId);
      if (detector) {
        detector.processOutput(data);
      }

      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.PTY_DATA, { sessionId, data });
      }
    });

    newPty.onExit(({ exitCode, signal }) => {
      if (restartingSessions.has(sessionId)) return;
      console.log(`[PTY Handlers] Session ${sessionId} exited with code ${exitCode}, signal ${signal}`);

      // Notify status detector of exit
      const detector = getStatusDetectors().get(sessionId);
      if (detector) {
        detector.processExit();
        detector.destroy();
        getStatusDetectors().delete(sessionId);
      }

      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.PTY_EXIT, { sessionId, exitCode, signal });
      }
      ptyProcesses.delete(sessionId);
      getScrollbackBuffers().delete(sessionId);
      if (!shuttingDown) {
        deleteSessionFromDisk(sessionId);
      }
    });

    restartingSessions.delete(sessionId);
    console.log(`[PTY Handlers] Session ${sessionId} restarted (PID ${newPty.pid})`);
    return { success: true, pid: newPty.pid };
  });

  console.log('[PTY Handlers] All PTY IPC handlers registered successfully');
}
