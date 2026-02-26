import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as pty from 'node-pty';
import { registerPtyHandlers, getPtyProcesses, setShuttingDown, isShuttingDown, isSessionRestarting } from './ipc/pty-handlers';
import { registerSessionHandlers } from './ipc/session-handlers';
import { registerGitHandlers } from './ipc/git-handlers';
import { startWebSocketServer, stopWebSocketServer, getScrollbackBuffers, getStatusDetectors, broadcastStatus } from './websocket/ws-server';
import { ScrollbackBuffer } from '../src/src/app/services/scrollback-buffer.service';
import { deleteSessionFromDisk } from './ipc/session-handlers';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';
import { killPtyProcess } from './utils/process-cleanup';
import { StatusDetector } from './status/status-detector';
import { startStaticServer } from './http/static-server';
import { getLocalNetworkAddress } from './utils/network-info';
import { sanitizeEnvForClaude } from './utils/env-sanitize';

let mainWindow: BrowserWindow | null = null;
let lanUrl: string | null = null;

// Prevent unhandled exceptions from crashing Electron (e.g. node-pty AttachConsole failures)
process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception]', error.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

/**
 * Create the main application window.
 */
function createWindow(): void {
  // Hide default menu bar
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for node-pty integration
    },
  });

  // Load Angular UI: prefer dev server in dev mode, fall back to built files
  const devServerUrl = 'http://localhost:4800';
  const builtFilePath = path.join(__dirname, '../../src/dist/claude-powerterminal-angular/browser/index.html');

  if (!app.isPackaged) {
    // Dev mode: wait for Angular dev server, then load it
    const waitForDevServer = async (url: string, maxRetries = 30, interval = 1000): Promise<boolean> => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const http = await import('http');
          await new Promise<void>((resolve, reject) => {
            http.get(url, (res) => { res.resume(); resolve(); }).on('error', reject);
          });
          return true;
        } catch { await new Promise(r => setTimeout(r, interval)); }
      }
      return false;
    };

    waitForDevServer(devServerUrl).then((ready) => {
      if (ready) {
        mainWindow!.loadURL(devServerUrl);
      } else if (fs.existsSync(builtFilePath)) {
        mainWindow!.loadFile(builtFilePath);
      }
    });
  } else if (fs.existsSync(builtFilePath)) {
    mainWindow.loadFile(builtFilePath);

    // Intercept navigation (e.g. Ctrl+R reload) to always serve index.html
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (url.startsWith('file://') && !url.endsWith('index.html')) {
        event.preventDefault();
        mainWindow!.loadFile(builtFilePath);
      }
    });
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Session metadata interface (matches src/app/models/session.model.ts)
 */
interface SessionMetadata {
  sessionId: string;
  workingDirectory: string;
  cliFlags: string[];
  createdAt: string;
}

/**
 * Get the path to sessions.json file in userData directory.
 */
function getSessionsFilePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'sessions.json');
}

/**
 * Load sessions from disk.
 * Returns empty array if file doesn't exist or is invalid.
 */
function loadSessionsFromDisk(): SessionMetadata[] {
  try {
    const filePath = getSessionsFilePath();
    if (!fs.existsSync(filePath)) {
      console.log('[Auto-Restore] No sessions file found');
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    const sessions = JSON.parse(data);
    return sessions;
  } catch (error: any) {
    console.error('[Auto-Restore] Error loading sessions:', error.message);
    return [];
  }
}

/**
 * Spawn a PTY process with --resume flag.
 * Returns Promise that resolves on successful spawn or rejects on failure.
 *
 * @param session - Session metadata for the session to resume
 * @returns Promise<IPty> - The spawned PTY process
 * @throws Error if resume fails (e.g., session not found by Claude CLI)
 */
async function spawnPtyWithResume(session: SessionMetadata): Promise<pty.IPty> {
  return new Promise((resolve, reject) => {
    console.log(`[Auto-Restore] Attempting --resume for session ${session.sessionId}`);

    const env = sanitizeEnvForClaude();

    // Spawn with --resume flag via cmd.exe for PATH resolution on Windows
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const args = process.platform === 'win32'
      ? ['/c', 'claude', '--resume', session.sessionId, ...session.cliFlags]
      : ['-c', `claude --resume ${session.sessionId} ${session.cliFlags.join(' ')}`];

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 30,
      cwd: session.workingDirectory,
      env,
      useConpty: true,
    });

    // Monitor for early exit (indicates resume failure)
    let hasResolved = false;
    const exitHandler = ({ exitCode }: { exitCode: number; signal?: number }) => {
      if (!hasResolved) {
        console.warn(`[Auto-Restore] Resume failed for ${session.sessionId} (exit code ${exitCode})`);
        reject(new Error(`Resume failed with exit code ${exitCode}`));
      }
    };

    ptyProcess.onExit(exitHandler);

    // If process still alive after 1.5s, consider resume successful
    setTimeout(() => {
      hasResolved = true;
      console.log(`[Auto-Restore] Resume successful for ${session.sessionId} (PID ${ptyProcess.pid})`);
      resolve(ptyProcess);
    }, 1500);
  });
}

/**
 * Spawn a fresh PTY process (fallback when --resume fails).
 *
 * @param session - Session metadata for the session to start fresh
 * @returns The spawned PTY process
 */
async function spawnPtyFresh(session: SessionMetadata): Promise<pty.IPty> {
  console.log(`[Auto-Restore] Starting fresh session for ${session.sessionId}`);

  const env = sanitizeEnvForClaude();

  // Spawn with --session-id flag (fresh session) via cmd.exe for PATH resolution on Windows
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  const args = process.platform === 'win32'
    ? ['/c', 'claude', '--session-id', session.sessionId, ...session.cliFlags]
    : ['-c', `claude --session-id ${session.sessionId} ${session.cliFlags.join(' ')}`];

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd: session.workingDirectory,
    env,
    useConpty: true,
  });

  console.log(`[Auto-Restore] Fresh session started for ${session.sessionId} (PID ${ptyProcess.pid})`);
  return ptyProcess;
}

/**
 * Setup PTY event handlers and register in process map.
 */
function registerRestoredPty(session: SessionMetadata, ptyProcess: pty.IPty): void {
  const ptyProcesses = getPtyProcesses();
  ptyProcesses.set(session.sessionId, ptyProcess);
  getScrollbackBuffers().set(session.sessionId, new ScrollbackBuffer(10000));

  // Create status detector for restored session
  const statusDetector = new StatusDetector(session.sessionId, (sid, status) => {
    broadcastStatus(sid, status);
  });
  getStatusDetectors().set(session.sessionId, statusDetector);

  ptyProcess.onData((data) => {
    const buffer = getScrollbackBuffers().get(session.sessionId);
    if (buffer) buffer.append(data);

    // Feed to status detector
    const detector = getStatusDetectors().get(session.sessionId);
    if (detector) detector.processOutput(data);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, { sessionId: session.sessionId, data });
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    if (isSessionRestarting(session.sessionId)) return;
    console.log(`[Auto-Restore] Session ${session.sessionId} exited with code ${exitCode}`);

    // Notify status detector of exit
    const detector = getStatusDetectors().get(session.sessionId);
    if (detector) {
      detector.processExit();
      detector.destroy();
      getStatusDetectors().delete(session.sessionId);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.PTY_EXIT, { sessionId: session.sessionId, exitCode, signal });
    }
    ptyProcesses.delete(session.sessionId);
    getScrollbackBuffers().delete(session.sessionId);
    if (!isShuttingDown()) {
      deleteSessionFromDisk(session.sessionId);
    }
  });
}

/**
 * Restore all saved sessions on app startup.
 * Sessions are spawned sequentially with delays to prevent concurrent writes
 * to Claude CLI's shared config file (~/.claude.json) which causes corruption.
 */
async function restoreAllSessions(): Promise<void> {
  console.log('[Auto-Restore] Starting session auto-restore');

  const sessions = loadSessionsFromDisk();

  if (sessions.length === 0) {
    console.log('[Auto-Restore] No sessions to restore');
    return;
  }

  console.log(`[Auto-Restore] Found ${sessions.length} sessions to restore`);

  // Deduplicate by working directory: only one session per cwd allowed
  // (multiple Claude CLI instances in the same dir corrupt .claude.json)
  const seenCwds = new Set<string>();
  const deduped: SessionMetadata[] = [];
  for (const session of sessions) {
    const normalizedCwd = path.resolve(session.workingDirectory);
    if (seenCwds.has(normalizedCwd)) {
      console.warn(`[Auto-Restore] Skipping duplicate cwd session ${session.sessionId} (${normalizedCwd})`);
      deleteSessionFromDisk(session.sessionId);
      continue;
    }
    seenCwds.add(normalizedCwd);
    deduped.push(session);
  }

  if (deduped.length < sessions.length) {
    console.log(`[Auto-Restore] Deduplicated: ${sessions.length} → ${deduped.length} sessions`);
  }

  // Spawn sessions sequentially with delay to prevent .claude.json write races
  for (const session of deduped) {
    try {
      let ptyProcess: pty.IPty;
      try {
        ptyProcess = await spawnPtyWithResume(session);
      } catch {
        console.warn(`[Auto-Restore] Resume failed for ${session.sessionId}, starting fresh`);
        ptyProcess = await spawnPtyFresh(session);
      }
      registerRestoredPty(session, ptyProcess);
      console.log(`[Auto-Restore] Session ${session.sessionId} restored`);

      // Wait for Claude CLI to finish initializing before starting next session
      if (sessions.indexOf(session) < sessions.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (error) {
      console.error(`[Auto-Restore] Failed to restore session ${session.sessionId}:`, error);
    }
  }

  console.log('[Auto-Restore] All sessions restored');

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_CHANNELS.SESSION_RESTORE_COMPLETE);
  }
}


/**
 * App lifecycle: ready
 */
app.whenReady().then(async () => {
  // Register all IPC handlers before creating window
  registerPtyHandlers();
  registerSessionHandlers();
  registerGitHandlers();

  // Start WebSocket server before creating window
  startWebSocketServer();

  // Start HTTP static server for LAN access
  startStaticServer(9801);

  // Discover LAN IP and log access URL
  const lanIp = getLocalNetworkAddress();
  if (lanIp) {
    lanUrl = `http://${lanIp}:9801`;
    console.log(`\n  LAN access: ${lanUrl}\n`);
  } else {
    console.log('\n  LAN access: not available\n');
  }

  // Register IPC handler for LAN URL
  ipcMain.handle('app:lan-url', () => lanUrl);

  createWindow();

  // Auto-restore saved sessions
  restoreAllSessions().catch((error) => {
    console.error('[Auto-Restore] Fatal error during session restore:', error);
  });

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * App lifecycle: all windows closed
 */
app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until user quits explicitly
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Handle cleanup on app quit.
 * Uses a flag to prevent recursive will-quit calls when app.quit() is called after cleanup.
 */
let isCleaningUp = false;

app.on('will-quit', async (event) => {
  if (isCleaningUp) return; // Prevent recursive will-quit

  const ptyProcesses = getPtyProcesses();

  if (ptyProcesses.size === 0) {
    console.log('[App Lifecycle] No active PTY processes to clean up');
    return;
  }

  console.log(`[App Lifecycle] Shutting down WebSocket server and killing ${ptyProcesses.size} active PTY processes`);
  isCleaningUp = true;
  setShuttingDown(true);
  event.preventDefault();

  // Stop WebSocket server first (closes all WebSocket connections)
  stopWebSocketServer();

  // Kill all active PTY processes using taskkill /T /F to kill entire process tree
  const killPromises = Array.from(ptyProcesses.entries()).map(async ([sessionId, ptyProcess]) => {
    console.log(`[App Lifecycle] Killing session ${sessionId} (PID ${ptyProcess.pid})`);
    try {
      await killPtyProcess(ptyProcess, 2000);
    } catch (error) {
      console.log(`[App Lifecycle] Kill signal sent for ${sessionId} (errors during shutdown are expected)`);
    }
  });

  Promise.all(killPromises).then(() => {
    ptyProcesses.clear();
    console.log('[App Lifecycle] All PTY processes cleaned up');
    app.quit();
  });
});
