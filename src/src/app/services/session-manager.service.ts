import { Injectable } from '@angular/core';
import { SessionMetadata } from '../models/session.model';
import { getHttpBaseUrl } from '../../../shared/ws-protocol';

/**
 * Service for managing Claude CLI session persistence.
 *
 * All operations use the HTTP API on the Electron static server.
 * Session data is stored in sessions.json in the app's userData directory.
 */
@Injectable({
  providedIn: 'root'
})
export class SessionManagerService {
  constructor() {}

  /**
   * Save a new session to persistent storage.
   * In HTTP-only mode, the POST /api/sessions endpoint already saves on spawn,
   * so this is a no-op. Kept for API compatibility.
   *
   * @param session - The session metadata to save
   */
  async saveSession(_session: SessionMetadata): Promise<void> {
    // HTTP POST /api/sessions already saves on spawn — no separate save needed
  }

  /**
   * Delete a session from persistent storage.
   *
   * @param sessionId - Unique identifier of the session to delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      await fetch(`${getHttpBaseUrl()}/api/sessions?id=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
    } catch (error) {
      console.error('[SessionManager] Failed to delete session:', error);
    }
  }

  /**
   * Load all sessions from persistent storage.
   *
   * @returns Promise that resolves with array of all saved sessions
   * @returns Empty array if no sessions exist or if fetch fails
   */
  async loadSessions(): Promise<SessionMetadata[]> {
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
      console.error('[SessionManager] Failed to load sessions:', error);
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
      console.error('[SessionManager] Failed to get session:', error);
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
