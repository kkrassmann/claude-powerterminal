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

  // Group persistence channels
  GROUPS_LOAD: 'groups:load',
  GROUPS_SAVE: 'groups:save',

  // App info channels
  APP_HOME_DIR: 'app:home-dir',
  APP_LAN_URL: 'app:lan-url',

  // Log analysis channels
  LOG_ANALYSIS: 'analysis:logs',
  LOG_SESSION_SCORE: 'analysis:session-score',
  LOG_SESSION_DETAIL: 'analysis:session-detail',
  LOG_SCORE_TRENDS: 'analysis:score-trends',

  // Project audit channels
  AUDIT_PROJECTS: 'audit:projects',
  AUDIT_RUN: 'audit:run',

  // Internal logging channels
  LOGS_EXPORT: 'logs:export',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
