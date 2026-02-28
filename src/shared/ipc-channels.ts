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
  PTY_LIST: 'pty:list',
  PTY_RESTART: 'pty:restart',
  SESSION_RESTORE_COMPLETE: 'session:restore-complete',

  // Session persistence channels
  SESSION_SAVE: 'session:save',
  SESSION_LOAD: 'session:load',
  SESSION_DELETE: 'session:delete',
  SESSION_GET: 'session:get',

  // Git context channels
  GIT_CONTEXT: 'git:context',

  // App info channels
  APP_HOME_DIR: 'app:home-dir',

  // Log analysis channels
  LOG_ANALYSIS: 'analysis:logs',
  LOG_SESSION_SCORE: 'analysis:session-score',
  LOG_SESSION_DETAIL: 'analysis:session-detail',
  LOG_SCORE_TRENDS: 'analysis:score-trends',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
