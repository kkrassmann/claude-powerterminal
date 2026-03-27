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
  GIT_BRANCHES: 'git:branches',

  // Group persistence channels
  GROUPS_LOAD: 'groups:load',
  GROUPS_SAVE: 'groups:save',

  // App info channels
  APP_HOME_DIR: 'app:home-dir',
  APP_LAN_URL: 'app:lan-url',
  APP_GIT_BRANCH: 'app:git-branch',
  APP_WS_PORT: 'app:ws-port',

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

  // Template channels
  TEMPLATE_LIST: 'template:list',
  TEMPLATE_SAVE: 'template:save',
  TEMPLATE_DELETE: 'template:delete',

  // Deep audit channels (LLM-based content analysis)
  DEEP_AUDIT_RUN: 'deep-audit:run',
  DEEP_AUDIT_PROGRESS: 'deep-audit:progress',
  DEEP_AUDIT_CANCEL: 'deep-audit:cancel',

  // Git worktree channels
  WORKTREE_LIST: 'worktree:list',
  WORKTREE_CREATE: 'worktree:create',
  WORKTREE_DELETE: 'worktree:delete',

  // Code review channels
  REVIEW_DIFF: 'review:diff',
  REVIEW_REJECT_HUNK: 'review:reject-hunk',
  REVIEW_REJECT_FILE: 'review:reject-file',
  REVIEW_APPLY_PATCH: 'review:apply-patch',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];
