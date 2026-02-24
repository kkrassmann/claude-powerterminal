/**
 * IPC channel constants for secure communication between Electron main and renderer processes.
 * Using constants prevents typos and enables type-safe IPC communication.
 */
export const IPC_CHANNELS = {
  // PTY lifecycle channels
  PTY_SPAWN: 'pty:spawn',
  PTY_WRITE: 'pty:write',
  PTY_KILL: 'pty:kill',
  PTY_DATA: 'pty:data',
  PTY_EXIT: 'pty:exit',
  PTY_RESIZE: 'pty:resize',

  // Session persistence channels
  SESSION_SAVE: 'session:save',
  SESSION_LOAD: 'session:load',
  SESSION_DELETE: 'session:delete',
  SESSION_GET: 'session:get',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
