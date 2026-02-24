/**
 * Session metadata model for persisting terminal session state.
 *
 * Used to save and restore Claude CLI sessions across app restarts,
 * enabling crash recovery and session management.
 */

/**
 * Represents metadata for a single Claude CLI terminal session.
 */
export interface SessionMetadata {
  /**
   * Unique identifier for this session (UUID recommended).
   */
  readonly sessionId: string;

  /**
   * Working directory where the Claude CLI was launched.
   * Used to restore session context on reload.
   */
  readonly workingDirectory: string;

  /**
   * CLI flags passed to the Claude CLI instance.
   * Example: ['--verbose', '--model=opus']
   */
  readonly cliFlags: string[];

  /**
   * ISO 8601 timestamp when the session was created.
   * Format: YYYY-MM-DDTHH:mm:ss.sssZ
   */
  readonly createdAt: string;
}
