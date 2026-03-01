/**
 * StatusDetector - Heuristic state machine for Claude CLI terminal status.
 *
 * Claude Code v2.x uses a full-screen TUI that redraws constantly.
 * Simple pattern matching on output doesn't work because:
 * - The ❯ prompt doesn't exist in TUI mode
 * - Screen redraws send thousands of bytes even when idle
 * - Box-drawing characters and logos repeat on every redraw
 *
 * Detection strategy:
 * 1. Parse OSC window title: "✳ Claude Code" = idle indicator
 * 2. Track content CHANGES: ignore identical/decoration-only redraws
 * 3. Only "significant" new content (real text, not TUI chrome) resets idle
 * 4. Idle thresholds: 5s → THINKING, combined with title → WAITING
 */

import { stripAnsi, extractWindowTitle } from './ansi-strip';
import { info, debug as logDebug } from '../utils/log-service';

export type TerminalStatus = 'WORKING' | 'THINKING' | 'WAITING' | 'ERROR' | 'DONE';

export type StatusChangeCallback = (sessionId: string, status: TerminalStatus, previousStatus: TerminalStatus) => void;

// Box-drawing and block element characters used by Claude Code TUI
const TUI_CHROME_REGEX = /[╭╮╰╯│─═║╔╗╚╝╠╣╬┌┐└┘├┤┼▐▛▜▌▝▘█▀▄░▓▒■□●◆◇○◎☐☑✓✗✳★☆▶▷◀◁△▽♦♠♣♥▲▼◘◙►◄↕‼¶§▬↨↑↓→←∟↔▸▹◂◃╱╲╳]+/g;

// Known TUI static text that appears on every redraw
const TUI_STATIC_PATTERNS = [
  /Claude Code v[\d.]+/,
  /Opus [\d.]+ [·│] Claude Max/,
  /Recent activity/,
  /Welcome back/,
  /for more$/,
];

export class StatusDetector {
  private status: TerminalStatus = 'WORKING';
  private lastSignificantTime: number = Date.now();
  private lastContentHash: string = '';
  private windowTitle: string = '';
  private idleTimer: NodeJS.Timeout | null = null;
  private recentText: string = ''; // sliding window of significant text only

  private static readonly MAX_WINDOW = 500;
  private static readonly THINKING_THRESHOLD_MS = 5000;
  private static readonly WAITING_THRESHOLD_MS = 12000;

  // Patterns that indicate errors in actual content
  private static readonly ERROR_PATTERNS = [
    /\bError:\s/,
    /\bInterrupted\b/,
    /\bENOENT\b/,
    /\bEACCES\b/,
    /\bfailed with exit code\b/,
  ];

  // Patterns that indicate Claude is waiting for user input
  private static readonly INPUT_PATTERNS = [
    /❯/,                            // Claude CLI input prompt (confirmed in PTY output)
    /\(Y\/n\)/,
    /\(y\/N\)/,
    /Do you want to proceed/i,
    /\[Y\/n\]/,
    /Allow once/,
    /Allow always/,
    /bypass permissions/,
  ];

  constructor(
    private sessionId: string,
    private onStatusChange: StatusChangeCallback
  ) {
    this.startIdleTimer();
  }

  /**
   * Feed PTY output data to the detector.
   */
  processOutput(data: string): void {
    // 1. Extract window title from OSC before stripping
    const title = extractWindowTitle(data);
    if (title !== null) {
      this.windowTitle = title;
    }

    // 2. Strip all ANSI/OSC sequences
    const cleaned = stripAnsi(data);

    // 3. Check for duplicate redraws (same content hash)
    const hash = this.contentHash(cleaned);
    if (hash === this.lastContentHash && cleaned.length > 50) {
      // Identical redraw of a large chunk — TUI refresh, not new content
      return;
    }
    this.lastContentHash = hash;

    // 4. Extract "significant" text (remove TUI chrome)
    const significant = this.extractSignificantText(cleaned);

    // 5. If we got meaningful new text, classify it
    if (significant.length > 5) {
      this.lastSignificantTime = Date.now();
      this.appendToWindow(significant);

      // Check input prompts FIRST (higher priority than WORKING)
      if (this.matchesAny(significant, StatusDetector.INPUT_PATTERNS)) {
        const matched = StatusDetector.INPUT_PATTERNS.find(p => p.test(significant));
        this.transition('WAITING', `input pattern: ${matched}`);
        return;
      }

      // Check error patterns
      if (this.matchesAny(significant, StatusDetector.ERROR_PATTERNS)) {
        const matched = StatusDetector.ERROR_PATTERNS.find(p => p.test(significant));
        this.transition('ERROR', `error pattern: ${matched}`);
        return;
      }

      // Default: real output → WORKING
      this.transition('WORKING', `significant text (${significant.length} chars)`);
    }
    // Otherwise: small/empty chunk or TUI noise — don't change state, let idle timer handle it
  }

  processExit(): void {
    this.clearIdleTimer();
    this.transition('DONE');
  }

  destroy(): void {
    this.clearIdleTimer();
  }

  getStatus(): TerminalStatus {
    return this.status;
  }

  /**
   * Extract text that represents actual Claude output, not TUI decoration.
   */
  private extractSignificantText(text: string): string {
    // Remove box-drawing and block characters
    let result = text.replace(TUI_CHROME_REGEX, ' ');

    // Remove known static TUI patterns
    for (const pattern of TUI_STATIC_PATTERNS) {
      result = result.replace(pattern, '');
    }

    // Collapse whitespace and trim
    result = result.replace(/\s+/g, ' ').trim();

    // If what remains is very short, it's likely just fragments of TUI chrome
    return result;
  }

  /**
   * Simple content hash for detecting duplicate redraws.
   */
  private contentHash(text: string): string {
    // Use length + first 80 chars + last 80 chars as a fast fingerprint
    const len = text.length;
    return `${len}:${text.slice(0, 80)}:${text.slice(-80)}`;
  }

  private appendToWindow(text: string): void {
    this.recentText += text;
    if (this.recentText.length > StatusDetector.MAX_WINDOW) {
      this.recentText = this.recentText.slice(-StatusDetector.MAX_WINDOW);
    }
  }

  private transition(newStatus: TerminalStatus, reason?: string): void {
    if (newStatus !== this.status) {
      const prev = this.status;
      this.status = newStatus;
      info('StatusDetector', `${this.sessionId.slice(0, 8)} ${prev} → ${newStatus}${reason ? ` (${reason})` : ''}`, this.sessionId);
      this.onStatusChange(this.sessionId, newStatus, prev);

      if (newStatus === 'WORKING' && (prev === 'WAITING' || prev === 'ERROR')) {
        this.recentText = '';
      }
    }
  }

  private matchesAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some(p => p.test(text));
  }

  private startIdleTimer(): void {
    this.idleTimer = setInterval(() => {
      const idleMs = Date.now() - this.lastSignificantTime;
      const isClaudeIdle = this.windowTitle.includes('✳');

      if (this.status === 'DONE') return;

      // Log idle checks only when idle exceeds 3s to reduce noise
      if (idleMs > 3000) {
        logDebug('StatusDetector', `idle check: ${Math.round(idleMs / 1000)}s, title✳=${isClaudeIdle}, status=${this.status}`, this.sessionId);
      }

      // WAITING: idle for threshold OR shorter idle + Claude title indicates idle
      if (idleMs >= StatusDetector.WAITING_THRESHOLD_MS) {
        this.transition('WAITING', `idle ${Math.round(idleMs / 1000)}s >= ${StatusDetector.WAITING_THRESHOLD_MS / 1000}s threshold`);
      } else if (idleMs >= StatusDetector.THINKING_THRESHOLD_MS && isClaudeIdle) {
        this.transition('WAITING', `idle ${Math.round(idleMs / 1000)}s + window title ✳`);
      }
      // THINKING: moderate idle, Claude might still be processing
      else if (this.status === 'WORKING' && idleMs >= StatusDetector.THINKING_THRESHOLD_MS) {
        this.transition('THINKING', `idle ${Math.round(idleMs / 1000)}s`);
      }
    }, 1000);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
