/**
 * Session persistence IPC handlers.
 *
 * Handles saving, loading, and deleting session metadata to/from JSON file.
 * Uses synchronous file I/O for immediate persistence (durability).
 */

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';

/**
 * SessionMetadata interface (matches src/app/models/session.model.ts)
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
      console.log('[Session Handlers] No sessions file found, returning empty array');
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    const sessions = JSON.parse(data);
    console.log(`[Session Handlers] Loaded ${sessions.length} sessions from disk`);
    return sessions;
  } catch (error: any) {
    console.error('[Session Handlers] Error loading sessions:', error.message);
    return [];
  }
}

/**
 * Save sessions to disk (synchronous for durability).
 */
function saveSessionsToDisk(sessions: SessionMetadata[]): void {
  try {
    const filePath = getSessionsFilePath();
    const dirPath = path.dirname(filePath);

    // Ensure directory exists
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const data = JSON.stringify(sessions, null, 2);
    fs.writeFileSync(filePath, data, 'utf-8');
    console.log(`[Session Handlers] Saved ${sessions.length} sessions to disk`);
  } catch (error: any) {
    console.error('[Session Handlers] Error saving sessions:', error.message);
    throw error;
  }
}

/**
 * Get a session's metadata from disk by ID.
 */
export function getSessionFromDisk(sessionId: string): SessionMetadata | undefined {
  const sessions = loadSessionsFromDisk();
  return sessions.find((s) => s.sessionId === sessionId);
}

/**
 * Delete a session from disk by ID.
 * Called by pty-handlers when a PTY process exits.
 */
export function deleteSessionFromDisk(sessionId: string): void {
  try {
    const sessions = loadSessionsFromDisk();
    const filtered = sessions.filter((s) => s.sessionId !== sessionId);
    if (filtered.length < sessions.length) {
      saveSessionsToDisk(filtered);
      console.log(`[Session Handlers] Removed exited session ${sessionId} from disk`);
    }
  } catch (error: any) {
    console.error(`[Session Handlers] Failed to remove session ${sessionId} from disk:`, error.message);
  }
}

/**
 * Register all session persistence IPC handlers.
 * Call this once during app initialization in main.ts.
 */
export function registerSessionHandlers(): void {
  console.log('[Session Handlers] Registering session IPC handlers');

  // Handler 1: SESSION_SAVE - Save a new session
  ipcMain.handle(IPC_CHANNELS.SESSION_SAVE, async (_event, session: SessionMetadata) => {
    console.log(`[Session Handlers] Saving session ${session.sessionId}`);

    try {
      const sessions = loadSessionsFromDisk();
      sessions.push(session);
      saveSessionsToDisk(sessions);

      return { success: true };
    } catch (error: any) {
      console.error(`[Session Handlers] Failed to save session ${session.sessionId}:`, error);
      return { success: false, error: error.message };
    }
  });

  // Handler 2: SESSION_LOAD - Load all sessions
  ipcMain.handle(IPC_CHANNELS.SESSION_LOAD, async () => {
    console.log('[Session Handlers] Loading all sessions');

    try {
      const sessions = loadSessionsFromDisk();
      return { success: true, sessions };
    } catch (error: any) {
      console.error('[Session Handlers] Failed to load sessions:', error);
      return { success: false, error: error.message, sessions: [] };
    }
  });

  // Handler 3: SESSION_DELETE - Delete a session by ID
  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, async (_event, sessionId: string) => {
    console.log(`[Session Handlers] Deleting session ${sessionId}`);

    try {
      const sessions = loadSessionsFromDisk();
      const filtered = sessions.filter((s) => s.sessionId !== sessionId);
      saveSessionsToDisk(filtered);

      return { success: true };
    } catch (error: any) {
      console.error(`[Session Handlers] Failed to delete session ${sessionId}:`, error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Session Handlers] All session IPC handlers registered successfully');
}
