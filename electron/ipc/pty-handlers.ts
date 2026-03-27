/**
 * PTY IPC handlers for managing Claude CLI processes.
 *
 * Handles spawning, termination, and I/O operations for PTY processes.
 * Implements Windows-specific workarounds and environment sanitization.
 */

import * as pty from 'node-pty';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ipcMain } from 'electron';

const execFileAsync = promisify(execFile);
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { killPtyProcess } from '../utils/process-cleanup';
import { getScrollbackBuffers, getStatusDetectors } from '../websocket/ws-server';
import { getSessionFromDisk } from './session-handlers';
import { sanitizeEnvForClaude } from '../utils/env-sanitize';
import { info, warn as logWarn, error as logError } from '../utils/log-service';
import { wirePtyHandlers } from '../utils/pty-wiring';

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

export function markSessionRestarting(sessionId: string): void {
  restartingSessions.add(sessionId);
}

export function clearSessionRestarting(sessionId: string): void {
  restartingSessions.delete(sessionId);
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
  info('PTY', 'Registering PTY IPC handlers');

  // Handler 1: PTY_SPAWN - Create a new PTY process
  ipcMain.handle(IPC_CHANNELS.PTY_SPAWN, async (event, options: PTYSpawnOptions) => {
    const { sessionId, cwd, flags, resume } = options;

    info('PTY', `Spawning PTY in ${cwd} (resume=${!!resume})`, sessionId, { flags });

    try {
      // Validate cwd exists
      const resolvedCwd = path.resolve(cwd);
      if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
        return { success: false, error: `Directory does not exist: ${resolvedCwd}` };
      }

      // Warn about duplicate sessions in the same directory (multiple sessions use
      // separate --session-id flags, so .claude.json corruption is not a concern)
      for (const [existingId] of ptyProcesses) {
        if (existingId !== sessionId) {
          const existingSession = getSessionFromDisk(existingId);
          if (existingSession && path.resolve(existingSession.workingDirectory) === resolvedCwd) {
            logWarn('PTY', `Directory ${resolvedCwd} already has active session ${existingId} — spawning anyway`, sessionId);
          }
        }
      }

      // Check 2: External Claude CLI processes (async, non-blocking)
      try {
        let externalCount = 0;
        if (process.platform === 'win32') {
          const { stdout } = await execFileAsync(
            'tasklist', ['/FI', 'IMAGENAME eq claude.exe', '/FO', 'CSV', '/NH'],
            { encoding: 'utf-8', timeout: 3000, windowsHide: true }
          );
          // Each CSV line represents one process; filter out "no tasks" messages
          externalCount = stdout.split('\n').filter(l => l.includes('"claude.exe"')).length;
        } else {
          const { stdout } = await execFileAsync(
            'ps', ['-eo', 'pid,command'],
            { encoding: 'utf-8', timeout: 3000 }
          );
          externalCount = stdout.split('\n').filter(l => /\bclaude\b/.test(l) && !l.includes('grep') && !l.includes('ps -eo')).length;
        }
        const ownCount = ptyProcesses.size;
        if (externalCount > ownCount) {
          logWarn('PTY', `${externalCount - ownCount} external Claude process(es) detected — may cause config corruption`, sessionId);
        }
      } catch { /* process listing not available or timeout — skip check */ }

      // Environment sanitization: remove Electron and Claude nesting vars
      const env = sanitizeEnvForClaude();

      // On Windows, spawn claude.exe directly with full path resolution
      const claudeExe = process.platform === 'win32' ? 'claude.exe' : 'claude';
      // Use --resume if explicitly requested OR if session already exists on disk
      const existsOnDisk = !!getSessionFromDisk(sessionId);
      const useResume = resume || existsOnDisk;
      const sessionFlag = useResume ? '--resume' : '--session-id';
      const claudeArgs = [sessionFlag, sessionId, ...flags];

      info('PTY', `resume=${resume}, existsOnDisk=${existsOnDisk}, using ${sessionFlag}`, sessionId);
      info('PTY', `Spawning: ${claudeExe} ${claudeArgs.join(' ')} in ${resolvedCwd}`, sessionId);

      // Spawn PTY process with Windows ConPTY mode
      const ptyProcess = pty.spawn(claudeExe, claudeArgs, {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: resolvedCwd,
        env,
        useConpty: true, // Windows ConPTY mode (auto-enabled on Win10 1809+)
      });

      info('PTY', `PTY spawned with PID ${ptyProcess.pid}`, sessionId);

      // Wire up scrollback, status detection, and event handlers
      wirePtyHandlers({
        sessionId,
        ptyProcess,
        loadSavedScrollback: useResume,
        onData: (_sid, data) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.PTY_DATA, { sessionId, data });
          }
        },
        onExit: (_sid, exitCode, signal) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(IPC_CHANNELS.PTY_EXIT, { sessionId, exitCode, signal });
          }
        },
      });

      return { success: true, pid: ptyProcess.pid };
    } catch (error: any) {
      logError('PTY', `Failed to spawn PTY`, sessionId, error);
      return { success: false, error: error.message };
    }
  });

  // Handler 2: PTY_KILL - Terminate a PTY process
  ipcMain.handle(IPC_CHANNELS.PTY_KILL, async (_event, sessionId: string) => {
    info('PTY', `Killing PTY`, sessionId);

    const ptyProcess = ptyProcesses.get(sessionId);

    if (!ptyProcess) {
      logWarn('PTY', `Session not found for kill`, sessionId);
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

      info('PTY', `Successfully killed`, sessionId);
      return { success: true };
    } catch (error: any) {
      logError('PTY', `Failed to kill`, sessionId, error);
      return { success: false, error: error.message };
    }
  });

  // Handler 3: PTY_WRITE - Send input to a PTY process
  ipcMain.handle(IPC_CHANNELS.PTY_WRITE, async (_event, options: PTYWriteOptions) => {
    const { sessionId, data } = options;

    const ptyProcess = ptyProcesses.get(sessionId);

    if (!ptyProcess) {
      logWarn('PTY', `Session not found for write`, sessionId);
      return { success: false, error: 'Session not found' };
    }

    try {
      ptyProcess.write(data);
      // Reset idle timer on user input
      const detector = getStatusDetectors().get(sessionId);
      if (detector) detector.notifyInput();
      return { success: true };
    } catch (error: any) {
      logError('PTY', `Failed to write`, sessionId, error);
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
    info('PTY', `Restarting session`, sessionId);

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

    // Graceful exit: send /exit to Claude CLI so it saves state properly
    // (allows Claude to pick up changed skills/agents on resume)
    try {
      oldPty.write('/exit\n');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 5000);
        oldPty.onExit(() => { clearTimeout(timeout); resolve(); });
      });
    } catch {}

    // Force-kill if still alive
    try {
      await killPtyProcess(oldPty, 2000);
    } catch {}
    ptyProcesses.delete(sessionId);

    // Spawn new PTY with --resume
    const env = sanitizeEnvForClaude();

    const claudeExe = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const newPty = pty.spawn(claudeExe, ['--resume', sessionId, ...metadata.cliFlags], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 30,
      cwd: metadata.workingDirectory,
      env,
      useConpty: true,
    });

    // Wire up scrollback, status detection, and event handlers
    wirePtyHandlers({
      sessionId,
      ptyProcess: newPty,
      loadSavedScrollback: true,
      onData: (_sid, data) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.PTY_DATA, { sessionId, data });
        }
      },
      onExit: (_sid, exitCode, signal) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(IPC_CHANNELS.PTY_EXIT, { sessionId, exitCode, signal });
        }
      },
    });

    // Keep guard active for 5s to absorb any delayed old-PTY onExit events (Windows async cleanup)
    setTimeout(() => restartingSessions.delete(sessionId), 5000);
    info('PTY', `Session restarted (PID ${newPty.pid})`, sessionId);
    return { success: true, pid: newPty.pid };
  });

  info('PTY', 'All PTY IPC handlers registered successfully');
}
