import { Injectable } from '@angular/core';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import { PTYSpawnOptions } from '../models/pty-config.model';

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
 * Service for managing PTY (Pseudo-Terminal) processes via IPC communication.
 *
 * This service provides a wrapper around IPC calls to the Electron main process,
 * which handles the actual node-pty operations. All PTY lifecycle operations
 * (spawn, kill, write, data streaming) go through this service.
 *
 * Architecture: Runs in the Angular renderer process, communicates with main
 * process via Electron's IPC bridge for secure PTY management.
 */
@Injectable({
  providedIn: 'root'
})
export class PtyManagerService {
  constructor() {}

  /**
   * Spawn a new PTY process for a Claude CLI session.
   *
   * Routes to IPC (Electron mode) or HTTP API (remote browser mode) automatically.
   *
   * @param options - PTY spawn options (sessionId, cwd, flags)
   * @returns Promise resolving to spawn result with success status and PID
   * @throws Error if IPC communication fails or spawn fails
   *
   * @example
   * const result = await ptyManager.spawnSession({
   *   sessionId: '123e4567-e89b-12d3-a456-426614174000',
   *   cwd: 'C:\\Users\\username\\projects\\my-app',
   *   flags: ['--verbose', '--dangerously-skip-permissions']
   * });
   * if (result.success) {
   *   console.log('PTY spawned with PID:', result.pid);
   * }
   */
  async spawnSession(options: PTYSpawnOptions): Promise<{ success: boolean; pid?: number; error?: string }> {
    // Electron mode: use IPC
    if (window.electronAPI) {
      try {
        const result = await window.electronAPI.invoke(IPC_CHANNELS.PTY_SPAWN, options);
        return result;
      } catch (error) {
        console.error('Failed to spawn PTY session:', error);
        return { success: false, error: String(error) };
      }
    }

    // Remote browser mode: use HTTP API
    try {
      const response = await fetch(`http://${window.location.hostname}:9801/api/sessions`, {
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
      console.error('Failed to spawn PTY via HTTP:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Kill an active PTY process by session ID.
   *
   * Uses graceful-then-force kill pattern on Windows to prevent orphaned
   * conhost.exe processes. See electron/utils/process-cleanup.ts for details.
   *
   * @param sessionId - Unique identifier of the session to kill
   * @returns Promise resolving to kill result with success status
   * @throws Error if IPC communication fails
   *
   * @example
   * const result = await ptyManager.killSession('123e4567-e89b-12d3-a456-426614174000');
   * if (result.success) {
   *   console.log('PTY process terminated');
   * }
   */
  async killSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    if (!window.electronAPI) {
      return { success: false, error: 'Not available in remote browser' };
    }
    try {
      const result = await window.electronAPI.invoke(IPC_CHANNELS.PTY_KILL, sessionId);
      return result;
    } catch (error) {
      console.error('Failed to kill PTY session:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Write data to an active PTY process (simulates user input).
   *
   * @param sessionId - Unique identifier of the target session
   * @param data - Data to write to PTY stdin (e.g., command + newline)
   * @returns Promise resolving to write result with success status
   * @throws Error if IPC communication fails or session not found
   *
   * @example
   * const result = await ptyManager.writeToSession(
   *   '123e4567-e89b-12d3-a456-426614174000',
   *   'ls -la\n'
   * );
   */
  async writeToSession(sessionId: string, data: string): Promise<{ success: boolean; error?: string }> {
    if (!window.electronAPI) {
      return { success: false, error: 'Not available in remote browser' };
    }
    try {
      const result = await window.electronAPI.invoke(IPC_CHANNELS.PTY_WRITE, { sessionId, data });
      return result;
    } catch (error) {
      console.error('Failed to write to PTY session:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Register a callback to receive PTY output data.
   *
   * The callback will be invoked whenever the main process sends PTY output
   * via the PTY_DATA IPC channel. Typically used to stream terminal output
   * to the UI.
   *
   * @param callback - Function to handle PTY output data
   *
   * @example
   * ptyManager.listenForOutput((data) => {
   *   console.log(`Session ${data.sessionId} output:`, data.data);
   *   // Append to terminal UI component
   * });
   */
  listenForOutput(callback: (data: { sessionId: string; data: string }) => void): void {
    if (!window.electronAPI) return;
    window.electronAPI.on(IPC_CHANNELS.PTY_DATA, callback);
  }

  /**
   * Register a callback to receive PTY exit events.
   *
   * The callback will be invoked when a PTY process terminates, either
   * gracefully or due to an error. Use this to clean up UI state and
   * session data.
   *
   * @param callback - Function to handle PTY exit events
   *
   * @example
   * ptyManager.listenForExit((data) => {
   *   console.log(`Session ${data.sessionId} exited with code ${data.exitCode}`);
   *   // Remove session from UI, clean up state
   * });
   */
  listenForExit(callback: (data: { sessionId: string; exitCode: number; signal?: number }) => void): void {
    if (!window.electronAPI) return;
    window.electronAPI.on(IPC_CHANNELS.PTY_EXIT, callback);
  }

  /**
   * Remove a previously registered output listener.
   *
   * @param callback - The callback function to remove
   */
  removeOutputListener(callback: (data: { sessionId: string; data: string }) => void): void {
    if (!window.electronAPI) return;
    window.electronAPI.removeListener(IPC_CHANNELS.PTY_DATA, callback);
  }

  /**
   * Remove a previously registered exit listener.
   *
   * @param callback - The callback function to remove
   */
  removeExitListener(callback: (data: { sessionId: string; exitCode: number; signal?: number }) => void): void {
    if (!window.electronAPI) return;
    window.electronAPI.removeListener(IPC_CHANNELS.PTY_EXIT, callback);
  }
}
