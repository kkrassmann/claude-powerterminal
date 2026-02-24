import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';

let mainWindow: BrowserWindow | null = null;

/**
 * Create the main application window.
 */
function createWindow(): void {
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

  // In development, load from Angular dev server
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:4200');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built Angular files
    mainWindow.loadFile(path.join(__dirname, '../src/dist/browser/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
function loadSessionsFromDisk(): any[] {
  try {
    const filePath = getSessionsFilePath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading sessions:', error);
    return [];
  }
}

/**
 * Save sessions to disk (synchronous for durability).
 */
function saveSessionsToDisk(sessions: any[]): void {
  try {
    const filePath = getSessionsFilePath();
    const data = JSON.stringify(sessions, null, 2);
    fs.writeFileSync(filePath, data, 'utf-8');
  } catch (error) {
    console.error('Error saving sessions:', error);
    throw error;
  }
}

/**
 * Set up IPC handlers for session persistence.
 */
function setupIPCHandlers(): void {
  // Save a new session
  ipcMain.handle(IPC_CHANNELS.SESSION_SAVE, async (_event, session: any) => {
    const sessions = loadSessionsFromDisk();
    sessions.push(session);
    saveSessionsToDisk(sessions);
  });

  // Load all sessions
  ipcMain.handle(IPC_CHANNELS.SESSION_LOAD, async () => {
    return loadSessionsFromDisk();
  });

  // Delete a session by ID
  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, async (_event, sessionId: string) => {
    const sessions = loadSessionsFromDisk();
    const filtered = sessions.filter((s: any) => s.sessionId !== sessionId);
    saveSessionsToDisk(filtered);
  });

  // Get a specific session by ID
  ipcMain.handle(IPC_CHANNELS.SESSION_GET, async (_event, sessionId: string) => {
    const sessions = loadSessionsFromDisk();
    return sessions.find((s: any) => s.sessionId === sessionId);
  });
}

/**
 * App lifecycle: ready
 */
app.whenReady().then(() => {
  setupIPCHandlers();
  createWindow();

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
 * Handle cleanup on app quit
 */
app.on('will-quit', () => {
  // TODO: Clean up any active PTY processes
  console.log('App is quitting...');
});
