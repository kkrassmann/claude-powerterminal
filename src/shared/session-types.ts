/**
 * Canonical SessionMetadata interface.
 * Single source of truth — imported by Electron main, IPC handlers, HTTP server, and Angular renderer.
 */
export interface SessionMetadata {
  /** Unique identifier for this session (UUID). */
  readonly sessionId: string;

  /** Working directory where the Claude CLI was launched. */
  readonly workingDirectory: string;

  /** CLI flags passed to the Claude CLI instance. */
  readonly cliFlags: string[];

  /** ISO 8601 timestamp when the session was created. */
  readonly createdAt: string;

  /** Group name this session belongs to (e.g., "Frontend", "Backend"). */
  group?: string;

  /** Hex color for the group (e.g., "#89b4fa"). */
  groupColor?: string;
}
