/**
 * PTY (Pseudo-Terminal) configuration model for IPC communication.
 *
 * Used to pass spawn options from renderer process to main process
 * when creating new PTY instances with node-pty.
 */

/**
 * Options for spawning a new PTY process.
 * Maps to node-pty spawn options with session context.
 */
export interface PTYSpawnOptions {
  /**
   * Session identifier to associate with this PTY instance.
   */
  readonly sessionId: string;

  /**
   * Current working directory for the spawned process.
   */
  readonly cwd: string;

  /**
   * Command-line flags to pass to the Claude CLI.
   * Example: ['--verbose', '--model=opus']
   */
  readonly flags: string[];
}

/**
 * PTY resize event options.
 * Used to resize the terminal when window dimensions change.
 */
export interface PTYResizeOptions {
  /**
   * Session identifier for the PTY to resize.
   */
  readonly sessionId: string;

  /**
   * Number of columns (width in characters).
   */
  readonly cols: number;

  /**
   * Number of rows (height in lines).
   */
  readonly rows: number;
}
