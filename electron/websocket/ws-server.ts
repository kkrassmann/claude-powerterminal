/**
 * WebSocket server for PTY bridge communication.
 *
 * Provides real-time bidirectional communication between browser clients and PTY processes.
 * Manages scrollback buffer replay, heartbeat for dead connection detection, and PTY I/O forwarding.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { getPtyProcesses } from '../ipc/pty-handlers';
import { ScrollbackBuffer } from '../../src/shared/scrollback-buffer';
import { WS_PORT, WS_CLOSE_CODES, ServerMessage, ClientMessage, TerminalStatus } from '../../src/shared/ws-protocol';
import { StatusDetector } from '../status/status-detector';

/**
 * Map of session IDs to scrollback buffers.
 * Buffers are created when PTY processes are spawned and persist across WebSocket connections.
 */
const scrollbackBuffers = new Map<string, ScrollbackBuffer>();

/**
 * Map of session IDs to status detectors.
 * Created when PTY processes are spawned, accessed by pty-handlers for status updates.
 */
const statusDetectors = new Map<string, StatusDetector>();

/**
 * WebSocket server instance.
 */
let wss: WebSocketServer | null = null;

/**
 * Heartbeat interval timer.
 */
let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * Get the scrollback buffers map.
 * Used by pty-handlers.ts to create and populate buffers when PTY processes are spawned.
 */
export function getScrollbackBuffers(): Map<string, ScrollbackBuffer> {
  return scrollbackBuffers;
}

/**
 * Get the status detectors map.
 * Used by pty-handlers.ts to create detectors and by ws connection handler for initial status.
 */
export function getStatusDetectors(): Map<string, StatusDetector> {
  return statusDetectors;
}

/**
 * Broadcast status change to all WebSocket clients connected to a session.
 * Called by StatusDetector callback when status transitions occur.
 */
export function broadcastStatus(sessionId: string, status: TerminalStatus): void {
  if (!wss) return;

  wss.clients.forEach((ws) => {
    const client = ws as any;
    if (client.sessionId === sessionId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'status', status }));
    }
  });
}

/**
 * Start the WebSocket server.
 *
 * Sets up:
 * - WebSocket server on port 9800
 * - Heartbeat interval for dead connection detection
 * - Connection handler for PTY bridge and scrollback replay
 *
 * @returns WebSocketServer instance
 */
export function startWebSocketServer(port: number = WS_PORT): WebSocketServer {
  wss = new WebSocketServer({ host: '0.0.0.0', port });

  console.log(`[WebSocket] Server listening on 0.0.0.0:${port}`);

  // Heartbeat: Detect dead connections every 30 seconds
  heartbeatInterval = setInterval(() => {
    if (!wss) return;

    wss.clients.forEach((ws) => {
      const client = ws as any;

      if (client.isAlive === false) {
        console.log(`[WebSocket] Terminating dead connection for session ${client.sessionId || 'unknown'}`);
        return ws.terminate();
      }

      client.isAlive = false;
      ws.ping();
    });
  }, 30000);

  // Connection handler
  wss.on('connection', (ws: WebSocket, req) => {
    // Extract sessionId from URL path: /terminal/{sessionId}
    const urlParts = req.url?.split('/').filter(Boolean);
    const sessionId = urlParts?.[1]; // ['terminal', 'sessionId']

    if (!sessionId) {
      console.warn('[WebSocket] Connection rejected: missing sessionId');
      ws.close(WS_CLOSE_CODES.MISSING_SESSION_ID, 'Missing sessionId');
      return;
    }

    // Look up PTY process
    const ptyProcess = getPtyProcesses().get(sessionId);

    if (!ptyProcess) {
      console.warn(`[WebSocket] Connection rejected: session ${sessionId} not found`);
      ws.close(WS_CLOSE_CODES.SESSION_NOT_FOUND, 'Session not found');
      return;
    }

    console.log(`[WebSocket] Client connected to session ${sessionId}`);

    // Setup heartbeat
    (ws as any).isAlive = true;
    (ws as any).sessionId = sessionId;

    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });

    // Safe send helper — prevents errors from crashing the connection
    const safeSend = (msg: ServerMessage) => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      } catch (err) {
        console.warn(`[WebSocket] Send failed for session ${sessionId}:`, err);
      }
    };

    // Scrollback buffer replay on connect
    const buffer = scrollbackBuffers.get(sessionId);

    if (buffer && buffer.getLineCount() > 0) {
      console.log(`[WebSocket] Replaying ${buffer.getLineCount()} lines of scrollback for session ${sessionId}`);

      // Send buffering signal
      safeSend({ type: 'buffering', total: buffer.getLineCount() });

      // Send all buffered lines
      const lines = buffer.getLines();
      for (const line of lines) {
        safeSend({ type: 'output', data: line });
      }

      // Send buffered signal
      safeSend({ type: 'buffered' });
    }

    // Send initial status after scrollback replay (or immediately if no buffer)
    const detector = statusDetectors.get(sessionId);
    if (detector) {
      safeSend({ type: 'status', status: detector.getStatus() });
    }

    // Forward PTY output to WebSocket
    // NOTE: Scrollback buffer is populated by pty-handlers.ts / main.ts — NOT here
    // CRITICAL: Store handler reference for cleanup on ws close
    const dataDisposable = ptyProcess.onData((data) => {
      safeSend({ type: 'output', data });
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[WebSocket] PTY exited for session ${sessionId} with code ${exitCode}`);
      safeSend({ type: 'exit', exitCode });
    });

    // Handle incoming client messages
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;

        switch (msg.type) {
          case 'buffer-replay':
            // Client requested full buffer replay (for self-correction after desync)
            const bufferForReplay = scrollbackBuffers.get(sessionId);

            if (bufferForReplay && bufferForReplay.getLineCount() > 0) {
              console.log(`[WebSocket] Buffer replay requested for session ${sessionId}`);

              // Clear terminal first
              safeSend({ type: 'buffer-clear' });

              // Send full scrollback buffer
              const lines = bufferForReplay.getLines();
              safeSend({ type: 'buffer-replay', data: lines.join('') });
            }
            break;

          case 'input':
            ptyProcess.write(msg.data);
            // Reset idle timer on user input
            const inputDetector = statusDetectors.get(sessionId);
            if (inputDetector) inputDetector.notifyInput();
            break;

          case 'resize':
            // Wrap in try/catch: resize on exited PTY crashes on Windows (RESEARCH.md pitfall)
            try {
              ptyProcess.resize(msg.cols, msg.rows);
            } catch (error: any) {
              console.warn(`[WebSocket] Resize failed for session ${sessionId}:`, error.message);
            }
            break;

          default:
            console.warn(`[WebSocket] Unknown message type:`, msg);
        }
      } catch (error) {
        console.error(`[WebSocket] Failed to parse client message:`, error);
      }
    });

    // Handle WebSocket close
    ws.on('close', () => {
      console.log(`[WebSocket] Client disconnected from session ${sessionId}`);

      // Clean up onData handler to prevent memory leaks
      dataDisposable.dispose();

      // Do NOT dispose PTY or buffer — session persists, only WebSocket connection closes
    });

    // Handle WebSocket error
    ws.on('error', (error) => {
      console.error(`[WebSocket] Error for session ${sessionId}:`, error);
    });
  });

  return wss;
}

/**
 * Stop the WebSocket server.
 *
 * Closes all client connections and cleans up the server instance.
 * Call this during app shutdown (will-quit handler).
 */
export function stopWebSocketServer(): void {
  if (!wss) {
    console.log('[WebSocket] Server not running');
    return;
  }

  console.log('[WebSocket] Stopping server');

  // Close all client connections with shutdown code
  wss.clients.forEach((ws) => {
    ws.close(WS_CLOSE_CODES.SERVER_SHUTDOWN, 'Server shutting down');
  });

  // Clear heartbeat interval
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  // Close server
  wss.close(() => {
    console.log('[WebSocket] Server stopped');
  });

  wss = null;
}
