/**
 * IPC handlers for internal log export.
 *
 * Exposes the LogService ring buffer to the renderer process
 * so users can download structured logs as JSONL files.
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { exportAsJsonl } from '../utils/log-service';

/**
 * Register log-related IPC handlers.
 * Call this once during app initialization in main.ts.
 */
export function registerLogHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.LOGS_EXPORT, async () => {
    return exportAsJsonl();
  });
}
