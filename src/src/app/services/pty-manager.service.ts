import { Injectable } from '@angular/core';
import { getHttpBaseUrl } from '../../../shared/ws-protocol';
import { PTYSpawnOptions } from '../models/pty-config.model';

/**
 * Service for managing PTY (Pseudo-Terminal) processes via HTTP API.
 *
 * All PTY lifecycle operations (spawn, kill, write) go through the HTTP server.
 * Real-time PTY I/O (data streaming, exit events) is handled by WebSocket
 * in terminal.component.ts — no IPC listeners needed here.
 */
@Injectable({
  providedIn: 'root'
})
export class PtyManagerService {
  constructor() {}

  /**
   * Spawn a new PTY process for a Claude CLI session.
   *
   * @param options - PTY spawn options (sessionId, cwd, flags)
   * @returns Promise resolving to spawn result with success status and PID
   */
  async spawnSession(options: PTYSpawnOptions): Promise<{ success: boolean; pid?: number; error?: string }> {
    try {
      const response = await fetch(`${getHttpBaseUrl()}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: options.sessionId,
          cwd: options.cwd,
          flags: options.flags,
          resume: options.resume
        })
      });

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.error || `HTTP ${response.status}` };
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('[PtyManager] Failed to spawn session:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Kill an active PTY process by session ID.
   *
   * @param sessionId - Unique identifier of the session to kill
   * @returns Promise resolving to kill result with success status
   */
  async killSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const resp = await fetch(`${getHttpBaseUrl()}/api/sessions?id=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      return await resp.json();
    } catch (error) {
      console.error('[PtyManager] Failed to kill session:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Write data to an active PTY process (simulates user input).
   *
   * @param sessionId - Unique identifier of the target session
   * @param data - Data to write to PTY stdin (e.g., command + newline)
   * @returns Promise resolving to write result with success status
   */
  async writeToSession(sessionId: string, data: string): Promise<{ success: boolean; error?: string }> {
    try {
      const resp = await fetch(`${getHttpBaseUrl()}/api/pty/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, data }),
      });
      return await resp.json();
    } catch (error) {
      console.error('[PtyManager] Failed to write to session:', error);
      return { success: false, error: String(error) };
    }
  }
}
