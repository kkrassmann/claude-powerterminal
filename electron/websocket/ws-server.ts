/**
 * WebSocket server for PTY bridge communication.
 *
 * Provides real-time bidirectional communication between browser clients and PTY processes.
 * Manages scrollback buffer replay, heartbeat for dead connection detection, and PTY I/O forwarding.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { getPtyProcesses } from '../ipc/pty-handlers';
import { ScrollbackBuffer } from '../../src/src/app/services/scrollback-buffer.service';
import { WS_PORT, WS_CLOSE_CODES, ServerMessage, ClientMessage } from '../../src/shared/ws-protocol';

/**
 * Map of session IDs to scrollback buffers.
 * Buffers are created when PTY processes are spawned and persist across WebSocket connections.
 */
const scrollbackBuffers = new Map<string, ScrollbackBuffer>();

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
 * Start the WebSocket server.
 *
 * Sets up:
 * - WebSocket server on port 9800
 * - Heartbeat interval for dead connection detection
 * - Connection handler for PTY bridge and scrollback replay
 *
 * @returns WebSocketServer instance
 */
export function startWebSocketServer(): WebSocketServer {
  wss = new WebSocketServer({ port: WS_PORT });

  console.log(`[WebSocket] Server listening on port ${WS_PORT}`);

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

    // Scrollback buffer replay on connect
    const buffer = scrollbackBuffers.get(sessionId);

    if (buffer && buffer.getLineCount() > 0) {
      console.log(`[WebSocket] Replaying ${buffer.getLineCount()} lines of scrollback for session ${sessionId}`);

      // Send buffering signal
      const bufferingMsg: ServerMessage = { type: 'buffering', total: buffer.getLineCount() };
      ws.send(JSON.stringify(bufferingMsg));

      // Send all buffered lines
      const lines = buffer.getLines();
      for (const line of lines) {
        const outputMsg: ServerMessage = { type: 'output', data: line };
        ws.send(JSON.stringify(outputMsg));
      }

      // Send buffered signal
      const bufferedMsg: ServerMessage = { type: 'buffered' };
      ws.send(JSON.stringify(bufferedMsg));
    }

    // Forward PTY output to WebSocket
    // CRITICAL: Store handler reference for cleanup on ws close
    const dataDisposable = ptyProcess.onData((data) => {
      // Append to scrollback buffer
      if (buffer) {
        buffer.append(data);
      }

      // Forward to WebSocket if connection is open
      if (ws.readyState === WebSocket.OPEN) {
        const outputMsg: ServerMessage = { type: 'output', data };
        ws.send(JSON.stringify(outputMsg));
      }
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[WebSocket] PTY exited for session ${sessionId} with code ${exitCode}`);

      if (ws.readyState === WebSocket.OPEN) {
        const exitMsg: ServerMessage = { type: 'exit', exitCode };
        ws.send(JSON.stringify(exitMsg));
      }
    });

    // Handle incoming client messages
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;

        switch (msg.type) {
          case 'input':
            ptyProcess.write(msg.data);
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
