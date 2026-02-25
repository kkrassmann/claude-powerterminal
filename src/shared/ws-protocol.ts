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

export const WS_PORT = 9800;
