import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { registerPtyHandlers } from './ipc/pty-handlers';
import { registerSessionHandlers } from './ipc/session-handlers';

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
 * App lifecycle: ready
 */
app.whenReady().then(() => {
  // Register all IPC handlers before creating window
  registerPtyHandlers();
  registerSessionHandlers();

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
