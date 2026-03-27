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
import { SessionMetadata } from '../../src/shared/session-types';
import { info, warn as logWarn, error as logError } from '../utils/log-service';

/**
 * Get the path to sessions.json file in userData directory.
 */
export function getSessionsFilePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'sessions.json');
}

/**
 * Load sessions from disk.
 * Returns empty array if file doesn't exist or is invalid.
 */
export function loadSessionsFromDisk(): SessionMetadata[] {
  try {
    const filePath = getSessionsFilePath();
    if (!fs.existsSync(filePath)) {
      info('Session', 'No sessions file found, returning empty array');
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    const sessions = JSON.parse(data);
    info('Session', `Loaded ${sessions.length} sessions from disk`);
    return sessions;
  } catch (error: any) {
    logError('Session', 'Error loading sessions', undefined, error.message);
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
    info('Session', `Saved ${sessions.length} sessions to disk`);
  } catch (error: any) {
    logError('Session', 'Error saving sessions', undefined, error.message);
    throw error;
  }
}

/**
 * Save a single session to disk (append to sessions.json).
 * Used by the HTTP server to persist new sessions created via REST API.
 */
export function saveSessionToDisk(session: SessionMetadata): void {
  const sessions = loadSessionsFromDisk();
  sessions.push(session);
  saveSessionsToDisk(sessions);
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
      info('Session', `Removed exited session from disk`, sessionId);
    }
  } catch (error: any) {
    logError('Session', `Failed to remove session from disk`, sessionId, error.message);
  }
}

/**
 * Register all session persistence IPC handlers.
 * Call this once during app initialization in main.ts.
 */
export function registerSessionHandlers(): void {
  info('Session', 'Registering session IPC handlers');

  // Handler 1: SESSION_SAVE - Save a new session
  ipcMain.handle(IPC_CHANNELS.SESSION_SAVE, async (_event, session: SessionMetadata) => {
    info('Session', `Saving session`, session.sessionId);

    try {
      const sessions = loadSessionsFromDisk();
      sessions.push(session);
      saveSessionsToDisk(sessions);

      return { success: true };
    } catch (error: any) {
      logError('Session', `Failed to save session`, session.sessionId, error);
      return { success: false, error: error.message };
    }
  });

  // Handler 2: SESSION_LOAD - Load all sessions
  ipcMain.handle(IPC_CHANNELS.SESSION_LOAD, async () => {
    info('Session', 'Loading all sessions');

    try {
      const sessions = loadSessionsFromDisk();
      return { success: true, sessions };
    } catch (error: any) {
      logError('Session', 'Failed to load sessions', undefined, error);
      return { success: false, error: error.message, sessions: [] };
    }
  });

  // Handler 3: SESSION_DELETE - Delete a session by ID
  ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, async (_event, sessionId: string) => {
    info('Session', `Deleting session`, sessionId);

    try {
      const sessions = loadSessionsFromDisk();
      const filtered = sessions.filter((s) => s.sessionId !== sessionId);
      saveSessionsToDisk(filtered);

      return { success: true };
    } catch (error: any) {
      logError('Session', `Failed to delete session`, sessionId, error);
      return { success: false, error: error.message };
    }
  });

  // Handler 4: SESSION_GET - Get a single session by ID
  ipcMain.handle(IPC_CHANNELS.SESSION_GET, async (_event, sessionId: string) => {
    info('Session', `Getting session`, sessionId);

    try {
      const session = getSessionFromDisk(sessionId);
      return session || null;
    } catch (error: any) {
      logError('Session', `Failed to get session`, sessionId, error);
      return null;
    }
  });

  info('Session', 'All session IPC handlers registered successfully');
}
