import { Injectable } from '@angular/core';
import { SessionMetadata } from '../models/session.model';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import { getHttpBaseUrl } from '../../../shared/ws-protocol';

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
    if (!window.electronAPI) return; // HTTP POST /api/sessions already saves on server side
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
    if (window.electronAPI) {
      try {
        await window.electronAPI.invoke(IPC_CHANNELS.SESSION_DELETE, sessionId);
      } catch (error) {
        console.error('Failed to delete session:', error);
        throw new Error(`Failed to delete session ${sessionId}: ${error}`);
      }
      return;
    }

    // HTTP fallback for remote browser
    try {
      await fetch(`${getHttpBaseUrl()}/api/sessions?id=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error('Failed to delete session via HTTP:', error);
    }
  }

  /**
   * Load all sessions from persistent storage.
   *
   * @returns Promise that resolves with array of all saved sessions
   * @returns Empty array if no sessions exist or if file read fails
   */
  async loadSessions(): Promise<SessionMetadata[]> {
    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.invoke(IPC_CHANNELS.SESSION_LOAD);
        return result?.sessions || [];
      } catch (error) {
        console.error('Failed to load sessions:', error);
        return [];
      }
    }

    // HTTP fallback for remote browser
    try {
      const resp = await fetch(`${getHttpBaseUrl()}/api/sessions`);
      const sessions: any[] = await resp.json();
      return sessions.map(s => ({
        sessionId: s.sessionId,
        workingDirectory: s.workingDirectory || '',
        cliFlags: s.cliFlags || [],
        createdAt: s.createdAt || new Date().toISOString(),
      }));
    } catch (error) {
      console.error('Failed to load sessions via HTTP:', error);
      return [];
    }
  }

  /**
   * Get a specific session by its ID.
   *
   * @param sessionId - Unique identifier of the session to retrieve
   * @returns Promise that resolves with the session or undefined if not found
   */
  async getSession(sessionId: string): Promise<SessionMetadata | undefined> {
    if (window.electronAPI) {
      try {
        const session = await window.electronAPI.invoke(IPC_CHANNELS.SESSION_GET, sessionId);
        return session;
      } catch (error) {
        console.error('Failed to get session:', error);
        return undefined;
      }
    }

    // HTTP fallback — GET /api/sessions returns all, filter client-side
    try {
      const resp = await fetch(`${getHttpBaseUrl()}/api/sessions`);
      const sessions: any[] = await resp.json();
      const found = sessions.find(s => s.sessionId === sessionId);
      return found ? {
        sessionId: found.sessionId,
        workingDirectory: found.workingDirectory || '',
        cliFlags: found.cliFlags || [],
        createdAt: found.createdAt || new Date().toISOString(),
      } : undefined;
    } catch (error) {
      console.error('Failed to get session via HTTP:', error);
      return undefined;
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
