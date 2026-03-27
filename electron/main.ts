// === Crash logger — must be first, uses only Node built-ins ===
import * as path from 'path';
import * as fs from 'fs';

function writeCrashLog(label: string, err: unknown): void {
  try {
    const logDir = path.join(
      process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
      'claude-powerterminal'
    );
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'crash.log');
    const timestamp = new Date().toISOString();
    const message = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    const entry = `[${timestamp}] ${label}: ${message}\n`;
    fs.appendFileSync(logFile, entry);
  } catch { /* last resort — nothing we can do */ }
}

process.on('uncaughtException', (err) => {
  writeCrashLog('UncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  writeCrashLog('UnhandledRejection', reason);
});
// === End crash logger ===

import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import * as pty from 'node-pty';
import { registerPtyHandlers, getPtyProcesses, setShuttingDown, isShuttingDown, isSessionRestarting } from './ipc/pty-handlers';
import { registerSessionHandlers } from './ipc/session-handlers';
import { registerGitHandlers } from './ipc/git-handlers';
import { registerAnalysisHandlers } from './ipc/analysis-handlers';
import { registerLogHandlers } from './ipc/log-handlers';
import { registerGroupHandlers } from './ipc/group-handlers';
import { registerTemplateHandlers } from './ipc/template-handlers';
import { registerWorktreeHandlers } from './ipc/worktree-handlers';
import { registerReviewHandlers } from './ipc/review-handlers';
import { startWebSocketServer, stopWebSocketServer, getScrollbackBuffers, getStatusDetectors, broadcastStatus } from './websocket/ws-server';
import { ScrollbackBuffer } from '../src/shared/scrollback-buffer';
import { deleteSessionFromDisk } from './ipc/session-handlers';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';
import { killPtyProcess } from './utils/process-cleanup';
import { StatusDetector } from './status/status-detector';
import { startStaticServer } from './http/static-server';
import { WS_PORT, HTTP_PORT } from '../src/shared/ws-protocol';
import { killAllDeepAuditProcesses } from './analysis/deep-audit-engine';
import { getLocalNetworkAddress } from './utils/network-info';
import { sanitizeEnvForClaude } from './utils/env-sanitize';
import { getAngularBuildDir } from './utils/paths';
import { info, warn as logWarn, error as logError } from './utils/log-service';
import { initSessionLogDir, appendSessionLog, loadSessionLog, deleteSessionLog, cleanupOrphanedLogs } from './utils/session-log';

import { setMainWindow } from './utils/window-ref';

// Scope userData by mode: dev uses separate directory to avoid conflicts with release builds
const userDataName = app.isPackaged ? 'claude-powerterminal' : 'claude-powerterminal-dev';
app.setPath('userData', path.join(app.getPath('appData'), userDataName));

let mainWindow: BrowserWindow | null = null;
let lanUrl: string | null = null;

/**
 * Create the main application window.
 */
function createWindow(): void {
  // Hide default menu bar
  Menu.setApplicationMenu(null);

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for node-pty integration
      additionalArguments: app.isPackaged ? [] : ['--cpt-dev-mode'],
    },
  });

  setMainWindow(mainWindow);

  // Load Angular UI: prefer dev server in dev mode, fall back to built files
  const devServerUrl = 'http://localhost:4500';
  const builtFilePath = path.join(getAngularBuildDir(), 'index.html');

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
    setMainWindow(null);
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
      info('Auto-Restore', 'No sessions file found');
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    const sessions = JSON.parse(data);
    return sessions;
  } catch (error: any) {
    logError('Auto-Restore', 'Error loading sessions', undefined, error.message);
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
    info('Auto-Restore', `Attempting --resume`, session.sessionId);

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
        logWarn('Auto-Restore', `Resume failed (exit code ${exitCode})`, session.sessionId);
        reject(new Error(`Resume failed with exit code ${exitCode}`));
      }
    };

    ptyProcess.onExit(exitHandler);

    // If process still alive after 1.5s, consider resume successful
    setTimeout(() => {
      hasResolved = true;
      info('Auto-Restore', `Resume successful (PID ${ptyProcess.pid})`, session.sessionId);
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
  info('Auto-Restore', `Starting fresh session`, session.sessionId);

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

  info('Auto-Restore', `Fresh session started (PID ${ptyProcess.pid})`, session.sessionId);
  return ptyProcess;
}

/**
 * Setup PTY event handlers and register in process map.
 */
function registerRestoredPty(session: SessionMetadata, ptyProcess: pty.IPty): void {
  const ptyProcesses = getPtyProcesses();
  ptyProcesses.set(session.sessionId, ptyProcess);
  getScrollbackBuffers().set(session.sessionId, new ScrollbackBuffer(10000));

  // Load saved scrollback from disk (persisted from previous run)
  const savedData = loadSessionLog(session.sessionId);
  if (savedData) {
    getScrollbackBuffers().get(session.sessionId)!.append(savedData);
    info('Auto-Restore', `Loaded ${savedData.length} chars of saved scrollback`, session.sessionId);
  }

  // Create status detector for restored session
  const statusDetector = new StatusDetector(session.sessionId, (sid, status) => {
    broadcastStatus(sid, status);
  });
  getStatusDetectors().set(session.sessionId, statusDetector);

  ptyProcess.onData((data) => {
    const buffer = getScrollbackBuffers().get(session.sessionId);
    if (buffer) buffer.append(data);
    appendSessionLog(session.sessionId, data);

    // Feed to status detector
    const detector = getStatusDetectors().get(session.sessionId);
    if (detector) detector.processOutput(data);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.PTY_DATA, { sessionId: session.sessionId, data });
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    if (isSessionRestarting(session.sessionId)) return;
    info('Auto-Restore', `Session exited with code ${exitCode}`, session.sessionId);

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
      deleteSessionLog(session.sessionId);
    }
  });
}

/**
 * Restore all saved sessions on app startup.
 * Sessions are spawned sequentially with delays to prevent concurrent writes
 * to Claude CLI's shared config file (~/.claude.json) which causes corruption.
 */
async function restoreAllSessions(): Promise<void> {
  info('Auto-Restore', 'Starting session auto-restore');

  const sessions = loadSessionsFromDisk();

  if (sessions.length === 0) {
    info('Auto-Restore', 'No sessions to restore');
    return;
  }

  info('Auto-Restore', `Found ${sessions.length} sessions to restore`);

  // Deduplicate by working directory: only one session per cwd allowed
  // (multiple Claude CLI instances in the same dir corrupt .claude.json)
  const seenCwds = new Set<string>();
  const deduped: SessionMetadata[] = [];
  for (const session of sessions) {
    const normalizedCwd = path.resolve(session.workingDirectory);
    if (seenCwds.has(normalizedCwd)) {
      logWarn('Auto-Restore', `Skipping duplicate cwd session (${normalizedCwd})`, session.sessionId);
      deleteSessionFromDisk(session.sessionId);
      continue;
    }
    seenCwds.add(normalizedCwd);
    deduped.push(session);
  }

  if (deduped.length < sessions.length) {
    info('Auto-Restore', `Deduplicated: ${sessions.length} → ${deduped.length} sessions`);
  }

  // Spawn sessions sequentially with delay to prevent .claude.json write races
  for (const session of deduped) {
    try {
      let ptyProcess: pty.IPty;
      try {
        ptyProcess = await spawnPtyWithResume(session);
      } catch {
        logWarn('Auto-Restore', `Resume failed, starting fresh`, session.sessionId);
        ptyProcess = await spawnPtyFresh(session);
      }
      registerRestoredPty(session, ptyProcess);
      info('Auto-Restore', `Session restored`, session.sessionId);

      // Wait for Claude CLI to finish initializing before starting next session
      if (sessions.indexOf(session) < sessions.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (error) {
      logError('Auto-Restore', `Failed to restore session`, session.sessionId, error);
    }
  }

  info('Auto-Restore', 'All sessions restored');

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
  registerAnalysisHandlers();
  registerLogHandlers();
  registerGroupHandlers();
  registerTemplateHandlers();
  registerWorktreeHandlers();
  registerReviewHandlers();

  // Dev mode uses +10 port offset to avoid conflicts with running release
  const portOffset = app.isPackaged ? 0 : 10;
  const wsPort = WS_PORT + portOffset;
  const httpPort = HTTP_PORT + portOffset;

  // Start WebSocket server before creating window
  startWebSocketServer(wsPort);

  // Start HTTP static server for LAN access
  startStaticServer(httpPort);

  // Discover LAN IP and log access URL
  const lanIp = getLocalNetworkAddress();
  if (lanIp) {
    lanUrl = `http://${lanIp}:${httpPort}`;
    info('App', `LAN access: ${lanUrl}`);
  } else {
    info('App', 'LAN access: not available');
  }

  // Register IPC handler for LAN URL and WS port
  ipcMain.handle(IPC_CHANNELS.APP_LAN_URL, () => lanUrl);
  ipcMain.handle(IPC_CHANNELS.APP_WS_PORT, () => wsPort);

  // Init scrollback persistence directory before restoring sessions
  initSessionLogDir(path.join(app.getPath('userData'), 'scrollback'));

  createWindow();

  // Auto-restore saved sessions, then clean up orphaned log files
  restoreAllSessions().then(() => {
    const activeIds = new Set(loadSessionsFromDisk().map(s => s.sessionId));
    cleanupOrphanedLogs(activeIds);
  }).catch((error) => {
    logError('Auto-Restore', 'Fatal error during session restore', undefined, error);
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
    info('App', 'No active PTY processes to clean up');
    return;
  }

  info('App', `Shutting down WebSocket server and killing ${ptyProcesses.size} active PTY processes`);
  isCleaningUp = true;
  setShuttingDown(true);
  event.preventDefault();

  // Kill any active deep audit claude processes
  killAllDeepAuditProcesses();

  // Stop WebSocket server first (closes all WebSocket connections)
  stopWebSocketServer();

  // Kill all active PTY processes using taskkill /T /F to kill entire process tree
  const killPromises = Array.from(ptyProcesses.entries()).map(async ([sessionId, ptyProcess]) => {
    info('App', `Killing session (PID ${ptyProcess.pid})`, sessionId);
    try {
      await killPtyProcess(ptyProcess, 2000);
    } catch (error) {
      info('App', `Kill signal sent (errors during shutdown are expected)`, sessionId);
    }
  });

  Promise.all(killPromises).then(() => {
    ptyProcesses.clear();
    info('App', 'All PTY processes cleaned up');
    app.quit();
  });
});
