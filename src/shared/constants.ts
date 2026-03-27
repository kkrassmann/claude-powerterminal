/**
 * Application-wide constants.
 * Collected from magic numbers scattered across the codebase.
 */

/** Default scrollback buffer capacity (lines) */
export const SCROLLBACK_BUFFER_SIZE = 10000;

/** Interval for WebSocket heartbeat ping/pong (ms) */
export const WS_HEARTBEAT_INTERVAL_MS = 30000;

/** Delay between sequential session restores to avoid .claude.json write races (ms) */
export const SESSION_RESTORE_DELAY_MS = 3000;

/** Time to wait before considering a --resume spawn successful (ms) */
export const RESUME_SUCCESS_TIMEOUT_MS = 1500;

/** Time to keep restart guard active to absorb delayed old-PTY onExit events (ms) */
export const RESTART_GUARD_TIMEOUT_MS = 5000;

/** Graceful exit timeout: how long to wait for /exit to take effect (ms) */
export const GRACEFUL_EXIT_TIMEOUT_MS = 5000;

/** Group polling interval for cross-client sync (ms) */
export const GROUP_POLL_INTERVAL_MS = 5000;

/** Session polling interval for UI sync (ms) */
export const SESSION_POLL_INTERVAL_MS = 5000;

/** Git context polling interval (ms) */
export const GIT_POLL_INTERVAL_MS = 30000;

/** Score refresh interval in dashboard (ms) */
export const SCORE_REFRESH_INTERVAL_MS = 60000;

/** Session detail cache TTL (ms) */
export const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;

/** Max entries in session detail cache */
export const MAX_DETAIL_CACHE_SIZE = 50;

/** Max entries in internal log ring buffer */
export const MAX_LOG_ENTRIES = 2000;

/** Session log file max size before trimming (bytes) */
export const SESSION_LOG_MAX_BYTES = 1_048_576;

/** Session log trim target (bytes) */
export const SESSION_LOG_TRIM_TARGET = 921_600;
