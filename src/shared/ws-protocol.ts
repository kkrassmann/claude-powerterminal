/**
 * WebSocket protocol types for PTY bridge communication.
 *
 * Shared between Electron main (WebSocket server) and Angular renderer (WebSocket client).
 * Defines message types for bidirectional terminal communication.
 */

// Terminal status enum
export type TerminalStatus = 'WORKING' | 'THINKING' | 'WAITING' | 'ERROR' | 'DONE';

// Server -> Client messages
export type ServerMessage =
  | { type: 'output'; data: string }      // PTY output chunk
  | { type: 'exit'; exitCode: number }     // PTY process exited
  | { type: 'buffering'; total: number }   // Buffer replay starting (line count)
  | { type: 'buffered' }                   // Buffer replay complete
  | { type: 'status'; status: TerminalStatus }  // Terminal status update
  | { type: 'buffer-clear' }               // Clear terminal before buffer replay
  | { type: 'buffer-replay'; data: string } // Full scrollback buffer replay

// Client -> Server messages
export type ClientMessage =
  | { type: 'input'; data: string }                   // User keyboard input
  | { type: 'resize'; cols: number; rows: number }    // Terminal resize
  | { type: 'buffer-replay' }                         // Request full buffer replay

// WebSocket close codes (custom range 4000-4999)
export const WS_CLOSE_CODES = {
  MISSING_SESSION_ID: 4000,
  SESSION_NOT_FOUND: 4004,
  SERVER_SHUTDOWN: 4001,
} as const;

// Production ports; dev mode adds +10 offset to avoid conflicts with running release
export const WS_PORT = 9820;
export const HTTP_PORT = 9821;

/* eslint-disable no-restricted-globals */
declare const window: any; // Safe for shared code compiled by both Electron (no DOM) and Angular

/**
 * Get the base URL for HTTP API calls.
 * In remote browser mode, uses the same origin the page was loaded from.
 * This avoids hardcoded port numbers and works regardless of port config.
 */
export function getHttpBaseUrl(): string {
  if (typeof window !== 'undefined' && !(window.electronAPI)) {
    return `http://${window.location.hostname}:${window.location.port || HTTP_PORT}`;
  }
  return `http://localhost:${HTTP_PORT}`;
}

// Dev mode port offset (must match main.ts)
const DEV_PORT_OFFSET = 10;

/**
 * Get the WebSocket port for terminal connections.
 * - Electron: base port + dev offset if in dev mode
 * - Remote browser: derives from the HTTP port (WS = HTTP - 1)
 * - Fallback: default WS_PORT constant
 */
export function getWsPort(): number {
  if (typeof window === 'undefined') return WS_PORT;

  // Electron mode: apply dev offset if flagged by preload
  if (window.electronAPI) {
    return WS_PORT + (window.electronAPI.isDev ? DEV_PORT_OFFSET : 0);
  }

  // Remote browser: WS port = HTTP port - 1
  if (window.location.port) {
    return parseInt(window.location.port, 10) - 1;
  }

  return WS_PORT;
}
