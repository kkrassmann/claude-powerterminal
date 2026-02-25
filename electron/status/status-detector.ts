/**
 * StatusDetector - Pattern matching state machine for Claude CLI terminal status.
 *
 * Analyzes PTY output to detect state transitions between:
 * - WORKING: Actively streaming output
 * - THINKING: No output for 5+ seconds (Claude processing)
 * - WAITING: User input prompt detected
 * - ERROR: Error pattern detected
 * - DONE: PTY process exited
 */

import { stripAnsi } from './ansi-strip';

export type TerminalStatus = 'WORKING' | 'THINKING' | 'WAITING' | 'ERROR' | 'DONE';

export type StatusChangeCallback = (sessionId: string, status: TerminalStatus, previousStatus: TerminalStatus) => void;

export class StatusDetector {
  private status: TerminalStatus = 'WORKING';
  private lastOutputTime: number = Date.now();
  private idleTimer: NodeJS.Timeout | null = null;
  private recentOutput: string = '';  // sliding window

  private static readonly MAX_WINDOW = 500;
  private static readonly IDLE_THRESHOLD_MS = 5000;

  /**
   * Claude CLI prompt patterns (hardcoded, empirically observed).
   * NOTE: These patterns are not formally documented by Anthropic and may change with CLI updates.
   */
  private static readonly WAITING_PATTERNS = [
    /❯\s*$/,                       // Claude prompt character at end of output
    /\? .+\(Y\/n\)/,               // Yes/No confirmation (default Yes)
    /\? .+\(y\/N\)/,               // Yes/No confirmation (default No)
    /Do you want to proceed/i,     // Permission prompt
    /\[Y\/n\]/,                    // Bracket-style confirmation
  ];

  private static readonly WORKING_PATTERNS = [
    /● /,                          // Tool call indicator
  ];

  private static readonly ERROR_PATTERNS = [
    /Error:/,                      // Generic error
    /Interrupted/,                 // Ctrl+C interrupt
    /ENOENT/,                      // File not found
    /EACCES/,                      // Permission denied
  ];

  constructor(
    private sessionId: string,
    private onStatusChange: StatusChangeCallback
  ) {
    this.startIdleTimer();
  }

  /**
   * Feed PTY output data to the detector.
   * Called from ptyProcess.onData() handler.
   */
  processOutput(data: string): void {
    this.lastOutputTime = Date.now();

    // Append to sliding window, trim to max size
    const cleanData = stripAnsi(data);
    this.recentOutput += cleanData;
    if (this.recentOutput.length > StatusDetector.MAX_WINDOW) {
      this.recentOutput = this.recentOutput.slice(-StatusDetector.MAX_WINDOW);
    }

    // Check patterns in priority order: ERROR > WAITING > WORKING
    if (this.matchesAny(StatusDetector.ERROR_PATTERNS)) {
      this.transition('ERROR');
    } else if (this.matchesAny(StatusDetector.WAITING_PATTERNS)) {
      this.transition('WAITING');
      // Clear recent output buffer when transitioning to WAITING to prevent stale pattern matches
      // after user provides input and we transition back to WORKING
    } else {
      // Any new output = WORKING (resets THINKING state)
      this.transition('WORKING');
    }
  }

  /**
   * Handle PTY process exit.
   */
  processExit(): void {
    this.clearIdleTimer();
    this.transition('DONE');
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.clearIdleTimer();
  }

  /**
   * Get current status.
   */
  getStatus(): TerminalStatus {
    return this.status;
  }

  private transition(newStatus: TerminalStatus): void {
    if (newStatus !== this.status) {
      const prev = this.status;
      this.status = newStatus;
      this.onStatusChange(this.sessionId, newStatus, prev);

      // Clear recent output buffer when transitioning to WORKING from WAITING/ERROR
      // to prevent stale pattern matches
      if (newStatus === 'WORKING' && (prev === 'WAITING' || prev === 'ERROR')) {
        this.recentOutput = '';
      }
    }
  }

  private matchesAny(patterns: RegExp[]): boolean {
    return patterns.some(p => p.test(this.recentOutput));
  }

  private startIdleTimer(): void {
    this.idleTimer = setInterval(() => {
      if (this.status === 'WORKING' &&
          Date.now() - this.lastOutputTime >= StatusDetector.IDLE_THRESHOLD_MS) {
        this.transition('THINKING');
      }
    }, 1000); // Check every second
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
