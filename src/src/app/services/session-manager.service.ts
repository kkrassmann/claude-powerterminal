import { Injectable } from '@angular/core';
import { SessionMetadata } from '../models/session.model';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';

/**
 * Declares the window.electronAPI interface for TypeScript type checking.
 * This API is exposed via the Electron preload script.
 */
declare global {
  interface Window {
    electronAPI: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      on: (channel: string, callback: (...args: any[]) => void) => void;
      removeListener: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}

/**
 * Service for managing Claude CLI session persistence.
 *
 * Handles saving, loading, and deleting session metadata via IPC communication
 * with the Electron main process. Session data is stored in sessions.json in
 * the app's userData directory.
 *
 * Architecture: This service runs in the Angular renderer process and uses IPC
 * to communicate with the main process, which handles actual file I/O operations.
 */
@Injectable({
  providedIn: 'root'
})
export class SessionManagerService {
  constructor() {}

  /**
   * Save a new session to persistent storage.
   *
   * @param session - The session metadata to save
   * @returns Promise that resolves when the session is saved
   * @throws Error if IPC communication fails or file write fails
   */
  async saveSession(session: SessionMetadata): Promise<void> {
    try {
      await window.electronAPI.invoke(IPC_CHANNELS.SESSION_SAVE, session);
    } catch (error) {
      console.error('Failed to save session:', error);
      throw new Error(`Failed to save session ${session.sessionId}: ${error}`);
    }
  }

  /**
   * Delete a session from persistent storage.
   *
   * @param sessionId - Unique identifier of the session to delete
   * @returns Promise that resolves when the session is deleted
   * @throws Error if IPC communication fails
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      await window.electronAPI.invoke(IPC_CHANNELS.SESSION_DELETE, sessionId);
    } catch (error) {
      console.error('Failed to delete session:', error);
      throw new Error(`Failed to delete session ${sessionId}: ${error}`);
    }
  }

  /**
   * Load all sessions from persistent storage.
   *
   * @returns Promise that resolves with array of all saved sessions
   * @returns Empty array if no sessions exist or if file read fails
   */
  async loadSessions(): Promise<SessionMetadata[]> {
    try {
      const sessions = await window.electronAPI.invoke(IPC_CHANNELS.SESSION_LOAD);
      return sessions || [];
    } catch (error) {
      console.error('Failed to load sessions:', error);
      return []; // Graceful degradation - return empty array on error
    }
  }

  /**
   * Get a specific session by its ID.
   *
   * @param sessionId - Unique identifier of the session to retrieve
   * @returns Promise that resolves with the session or undefined if not found
   */
  async getSession(sessionId: string): Promise<SessionMetadata | undefined> {
    try {
      const session = await window.electronAPI.invoke(IPC_CHANNELS.SESSION_GET, sessionId);
      return session;
    } catch (error) {
      console.error('Failed to get session:', error);
      return undefined; // Graceful degradation
    }
  }

  /**
   * Check if a session exists.
   *
   * @param sessionId - Unique identifier to check
   * @returns Promise that resolves with true if session exists, false otherwise
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    return session !== undefined;
  }
}
