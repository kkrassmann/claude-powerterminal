/**
 * Shared PTY event wiring — creates ScrollbackBuffer, StatusDetector,
 * and connects onData/onExit handlers.  Called from:
 *   - pty-handlers.ts  (PTY_SPAWN + PTY_RESTART)
 *   - main.ts          (registerRestoredPty)
 *   - static-server.ts (POST /api/sessions + POST /api/pty/restart)
 */

import * as pty from 'node-pty';
import { ScrollbackBuffer } from '../../src/shared/scrollback-buffer';
import { SCROLLBACK_BUFFER_SIZE } from '../../src/shared/constants';
import { StatusDetector } from '../status/status-detector';
import { getScrollbackBuffers, getStatusDetectors, broadcastStatus } from '../websocket/ws-server';
import { getPtyProcesses, isShuttingDown, isSessionRestarting } from '../ipc/pty-handlers';
import { deleteSessionFromDisk } from '../ipc/session-handlers';
import { appendSessionLog, loadSessionLog, deleteSessionLog } from './session-log';
import { info } from './log-service';

export interface WirePtyOptions {
  sessionId: string;
  ptyProcess: pty.IPty;
  /** If true, load saved scrollback from disk into the buffer */
  loadSavedScrollback?: boolean;
  /** Called on every data chunk (e.g. to forward via IPC or notify renderer) */
  onData?: (sessionId: string, data: string) => void;
  /** Called when PTY exits (e.g. to notify renderer) */
  onExit?: (sessionId: string, exitCode: number, signal?: number) => void;
}

/**
 * Wire up a PTY process with scrollback buffer, status detector, and event handlers.
 * Returns a cleanup function (not normally needed — onExit handles it).
 */
export function wirePtyHandlers(opts: WirePtyOptions): void {
  const { sessionId, ptyProcess, loadSavedScrollback, onData, onExit } = opts;

  // Register in PTY map
  getPtyProcesses().set(sessionId, ptyProcess);

  // Create scrollback buffer
  getScrollbackBuffers().set(sessionId, new ScrollbackBuffer(SCROLLBACK_BUFFER_SIZE));

  // Optionally load persisted scrollback
  if (loadSavedScrollback) {
    const savedData = loadSessionLog(sessionId);
    if (savedData) {
      getScrollbackBuffers().get(sessionId)!.append(savedData);
      info('PTY-Wire', `Loaded ${savedData.length} chars of saved scrollback`, sessionId);
    }
  }

  // Create status detector
  const statusDetector = new StatusDetector(sessionId, (sid, status) => {
    broadcastStatus(sid, status);
  });
  getStatusDetectors().set(sessionId, statusDetector);

  // Wire onData
  ptyProcess.onData((data) => {
    const buffer = getScrollbackBuffers().get(sessionId);
    if (buffer) buffer.append(data);
    appendSessionLog(sessionId, data);

    const detector = getStatusDetectors().get(sessionId);
    if (detector) detector.processOutput(data);

    if (onData) onData(sessionId, data);
  });

  // Wire onExit
  ptyProcess.onExit(({ exitCode, signal }) => {
    if (isSessionRestarting(sessionId)) return;
    info('PTY-Wire', `Session exited (code ${exitCode})`, sessionId);

    const detector = getStatusDetectors().get(sessionId);
    if (detector) {
      detector.processExit();
      detector.destroy();
      getStatusDetectors().delete(sessionId);
    }

    getPtyProcesses().delete(sessionId);
    getScrollbackBuffers().delete(sessionId);

    if (!isShuttingDown()) {
      deleteSessionFromDisk(sessionId);
      deleteSessionLog(sessionId);
    }

    if (onExit) onExit(sessionId, exitCode, signal);
  });
}
