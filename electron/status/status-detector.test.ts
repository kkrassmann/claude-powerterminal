import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StatusDetector, TerminalStatus, StatusChangeCallback } from './status-detector';

// Silence log-service calls so test output stays clean
vi.mock('../utils/log-service', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_ID = 'test-session-1234';

function makeDetector(): {
  detector: StatusDetector;
  callback: ReturnType<typeof vi.fn>;
} {
  const callback = vi.fn<Parameters<StatusChangeCallback>, void>();
  const detector = new StatusDetector(SESSION_ID, callback);
  return { detector, callback };
}

/** Build a string that is long enough and free of TUI noise to be "significant". */
function significantText(text: string): string {
  // Pad to exceed the 5-char significance threshold and to avoid TUI-chrome filters.
  return text.padEnd(20, ' x');
}

/** ANSI OSC sequence for setting the window title. */
function oscTitle(title: string): string {
  return `\x1b]0;${title}\x07`;
}

/** Simple ANSI CSI colour code around some text. */
function withColor(text: string): string {
  return `\x1b[32m${text}\x1b[0m`;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('StatusDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  it('starts in WORKING state', () => {
    const { detector } = makeDetector();
    expect(detector.getStatus()).toBe('WORKING');
    detector.destroy();
  });

  it('does not fire the callback on construction', () => {
    const { callback, detector } = makeDetector();
    expect(callback).not.toHaveBeenCalled();
    detector.destroy();
  });

  // ── WORKING state via significant output ──────────────────────────────────

  it('stays WORKING when real text is received', () => {
    const { detector, callback } = makeDetector();
    detector.processOutput(significantText('Building project files'));
    // Already WORKING → no transition emitted
    expect(callback).not.toHaveBeenCalled();
    expect(detector.getStatus()).toBe('WORKING');
    detector.destroy();
  });

  it('transitions back to WORKING from WAITING on significant text', () => {
    const { detector, callback } = makeDetector();

    // Drive into WAITING via prompt pattern
    detector.processOutput(significantText('❯ '));
    expect(detector.getStatus()).toBe('WAITING');

    // New real output should bring it back to WORKING
    detector.processOutput(significantText('Running test suite now'));
    expect(detector.getStatus()).toBe('WORKING');

    const calls = callback.mock.calls;
    const backToWorking = calls.find(([, next]) => next === 'WORKING');
    expect(backToWorking).toBeDefined();
    expect(backToWorking![2]).toBe('WAITING');
    detector.destroy();
  });

  it('transitions back to WORKING from ERROR on significant non-error text', () => {
    const { detector, callback } = makeDetector();

    // Trigger an error
    detector.processOutput(significantText('Error: something failed badly'));
    expect(detector.getStatus()).toBe('ERROR');

    // Real output → WORKING
    detector.processOutput(significantText('Retrying the operation now'));
    expect(detector.getStatus()).toBe('WORKING');

    const calls = callback.mock.calls;
    const toWorking = calls.find(([, next]) => next === 'WORKING');
    expect(toWorking![2]).toBe('ERROR');
    detector.destroy();
  });

  // ── WAITING via INPUT_PATTERNS ────────────────────────────────────────────

  it('transitions to WAITING when ❯ prompt is detected', () => {
    const { detector, callback } = makeDetector();
    detector.processOutput('❯ some prompt text here');
    expect(detector.getStatus()).toBe('WAITING');
    expect(callback).toHaveBeenCalledWith(SESSION_ID, 'WAITING', 'WORKING');
    detector.destroy();
  });

  it('transitions to WAITING on (Y/n) confirmation prompt', () => {
    const { detector, callback } = makeDetector();
    detector.processOutput(significantText('Delete file? (Y/n)'));
    expect(detector.getStatus()).toBe('WAITING');
    expect(callback).toHaveBeenCalledWith(SESSION_ID, 'WAITING', 'WORKING');
    detector.destroy();
  });

  it('transitions to WAITING on (y/N) confirmation prompt', () => {
    const { detector } = makeDetector();
    detector.processOutput(significantText('Overwrite? (y/N)'));
    expect(detector.getStatus()).toBe('WAITING');
    detector.destroy();
  });

  it('transitions to WAITING on [Y/n] prompt', () => {
    const { detector } = makeDetector();
    detector.processOutput(significantText('Continue [Y/n] with this?'));
    expect(detector.getStatus()).toBe('WAITING');
    detector.destroy();
  });

  it('transitions to WAITING on "Do you want to proceed" prompt', () => {
    const { detector } = makeDetector();
    detector.processOutput(significantText('Do you want to proceed with the changes?'));
    expect(detector.getStatus()).toBe('WAITING');
    detector.destroy();
  });

  it('transitions to WAITING on "Allow once" permission prompt', () => {
    const { detector } = makeDetector();
    detector.processOutput(significantText('Allow once for this file?'));
    expect(detector.getStatus()).toBe('WAITING');
    detector.destroy();
  });

  it('transitions to WAITING on "Allow always" permission prompt', () => {
    const { detector } = makeDetector();
    detector.processOutput(significantText('Allow always for this tool'));
    expect(detector.getStatus()).toBe('WAITING');
    detector.destroy();
  });

  it('transitions to WAITING on "bypass permissions" text', () => {
    const { detector } = makeDetector();
    detector.processOutput(significantText('You can bypass permissions if needed'));
    expect(detector.getStatus()).toBe('WAITING');
    detector.destroy();
  });

  // ── ERROR patterns ────────────────────────────────────────────────────────

  it('transitions to ERROR when "Error: " is in output', () => {
    const { detector, callback } = makeDetector();
    detector.processOutput(significantText('Error: cannot read file'));
    expect(detector.getStatus()).toBe('ERROR');
    expect(callback).toHaveBeenCalledWith(SESSION_ID, 'ERROR', 'WORKING');
    detector.destroy();
  });

  it('transitions to ERROR on "Interrupted"', () => {
    const { detector } = makeDetector();
    detector.processOutput(significantText('Process Interrupted by signal'));
    expect(detector.getStatus()).toBe('ERROR');
    detector.destroy();
  });

  it('transitions to ERROR on "ENOENT"', () => {
    const { detector } = makeDetector();
    detector.processOutput(significantText('ENOENT no such file or dir'));
    expect(detector.getStatus()).toBe('ERROR');
    detector.destroy();
  });

  it('transitions to ERROR on "EACCES"', () => {
    const { detector } = makeDetector();
    detector.processOutput(significantText('EACCES permission denied for path'));
    expect(detector.getStatus()).toBe('ERROR');
    detector.destroy();
  });

  it('transitions to ERROR on "failed with exit code"', () => {
    const { detector } = makeDetector();
    detector.processOutput(significantText('Command failed with exit code 1'));
    expect(detector.getStatus()).toBe('ERROR');
    detector.destroy();
  });

  // ── DONE via processExit ──────────────────────────────────────────────────

  it('transitions to DONE when processExit is called', () => {
    const { detector, callback } = makeDetector();
    detector.processExit();
    expect(detector.getStatus()).toBe('DONE');
    expect(callback).toHaveBeenCalledWith(SESSION_ID, 'DONE', 'WORKING');
    detector.destroy();
  });

  it('transitions to DONE from any state when processExit is called', () => {
    const { detector, callback } = makeDetector();
    // Put it in WAITING first
    detector.processOutput('❯ prompt');
    expect(detector.getStatus()).toBe('WAITING');

    detector.processExit();
    expect(detector.getStatus()).toBe('DONE');
    const lastCall = callback.mock.calls.at(-1)!;
    expect(lastCall[1]).toBe('DONE');
    expect(lastCall[2]).toBe('WAITING');
    detector.destroy();
  });

  // ── Idle timer → THINKING ─────────────────────────────────────────────────

  it('transitions WORKING → THINKING after 5 s idle', () => {
    const { detector, callback } = makeDetector();
    // Ensure we're in WORKING with a known lastSignificantTime
    detector.processOutput(significantText('Starting task execution now'));

    // Advance just past THINKING_THRESHOLD_MS (5000) but under WAITING (12000)
    vi.advanceTimersByTime(6000);

    expect(detector.getStatus()).toBe('THINKING');
    expect(callback).toHaveBeenCalledWith(SESSION_ID, 'THINKING', 'WORKING');
    detector.destroy();
  });

  it('does NOT transition to THINKING if significant output resets the timer', () => {
    const { detector, callback } = makeDetector();
    detector.processOutput(significantText('Initial output received now'));

    // Advance only 3 s — still below threshold
    vi.advanceTimersByTime(3000);

    // Send more output (resets timer)
    detector.processOutput(significantText('More output keeps resetting idle'));

    // Advance another 3 s (6 s since construction but only 3 s since last output)
    vi.advanceTimersByTime(3000);

    expect(detector.getStatus()).toBe('WORKING');
    expect(callback).not.toHaveBeenCalledWith(SESSION_ID, 'THINKING', expect.anything());
    detector.destroy();
  });

  // ── Idle timer → WAITING (12 s threshold) ────────────────────────────────

  it('transitions to WAITING after 12 s of idle regardless of window title', () => {
    const { detector, callback } = makeDetector();
    detector.processOutput(significantText('Starting long running work'));

    vi.advanceTimersByTime(13000);

    expect(detector.getStatus()).toBe('WAITING');
    const calls = callback.mock.calls;
    const toWaiting = calls.find(([, next]) => next === 'WAITING');
    expect(toWaiting).toBeDefined();
    detector.destroy();
  });

  // ── Idle timer → WAITING (5 s + ✳ title) ────────────────────────────────

  it('transitions THINKING → WAITING at 5 s when window title contains ✳', () => {
    const { detector, callback } = makeDetector();

    // Set the ✳ window title
    detector.processOutput(oscTitle('✳ Claude Code'));
    // Send significant text to reset the idle clock after title injection
    detector.processOutput(significantText('Running analysis task now'));

    // Advance 6 s — past THINKING (5 s), combined with ✳ title → WAITING
    vi.advanceTimersByTime(6000);

    expect(detector.getStatus()).toBe('WAITING');
    const toWaiting = callback.mock.calls.find(([, next]) => next === 'WAITING');
    expect(toWaiting).toBeDefined();
    detector.destroy();
  });

  it('does NOT transition to WAITING at 5 s without ✳ title', () => {
    const { detector } = makeDetector();
    detector.processOutput(oscTitle('Claude Code'));  // no ✳
    detector.processOutput(significantText('Running analysis task now'));

    vi.advanceTimersByTime(6000);

    // Should be THINKING but not yet WAITING
    expect(detector.getStatus()).toBe('THINKING');
    detector.destroy();
  });

  // ── Idle timer stops when DONE ─────────────────────────────────────────────

  it('does not change state after DONE even with idle timer firing', () => {
    const { detector, callback } = makeDetector();
    detector.processExit();
    expect(detector.getStatus()).toBe('DONE');

    const callsBefore = callback.mock.calls.length;
    vi.advanceTimersByTime(20000);

    expect(detector.getStatus()).toBe('DONE');
    expect(callback.mock.calls.length).toBe(callsBefore);
    detector.destroy();
  });

  // ── Window title extraction ───────────────────────────────────────────────

  it('extracts window title from OSC sequence', () => {
    const { detector } = makeDetector();
    // Provide just the OSC title and nothing else meaningful
    detector.processOutput(oscTitle('✳ Claude Code'));
    // The title should be stored internally; trigger idle check to see effect
    detector.processOutput(significantText('some real content here'));
    vi.advanceTimersByTime(6000);
    // With ✳ title + 6 s idle → WAITING
    expect(detector.getStatus()).toBe('WAITING');
    detector.destroy();
  });

  // ── Content hash / duplicate detection ───────────────────────────────────

  it('ignores duplicate large chunks (same content hash)', () => {
    const { detector, callback } = makeDetector();
    // A long string that exceeds the 50-char threshold for hash deduplication
    const bigChunk = 'A'.repeat(100);

    detector.processOutput(bigChunk);
    const callsAfterFirst = callback.mock.calls.length;

    // Second identical chunk — should be ignored
    detector.processOutput(bigChunk);
    expect(callback.mock.calls.length).toBe(callsAfterFirst);
    detector.destroy();
  });

  it('does not suppress small duplicate chunks (< 50 chars) — both are processed', () => {
    const { detector, callback } = makeDetector();
    // A short but significant prompt string (under 50 chars → not hash-deduplicated).
    // Must be > 5 chars after chrome-stripping to register as significant.
    const smallChunk = '❯ confirm step here'; // 19 chars, well under 50-char dedup threshold
    detector.processOutput(smallChunk);
    expect(detector.getStatus()).toBe('WAITING');

    // Reset to WORKING so we can observe the second chunk being processed
    detector.processOutput(significantText('real output resumes working'));
    expect(detector.getStatus()).toBe('WORKING');

    // Second identical small chunk — not deduplicated (< 50 chars), should trigger again
    detector.processOutput(smallChunk);
    expect(detector.getStatus()).toBe('WAITING');

    // Verify callback was called at least twice for WAITING
    const waitingCalls = callback.mock.calls.filter(([, next]) => next === 'WAITING');
    expect(waitingCalls.length).toBeGreaterThanOrEqual(2);
    detector.destroy();
  });

  // ── ANSI escape sequence handling ─────────────────────────────────────────

  it('correctly classifies output wrapped in ANSI colour codes', () => {
    const { detector } = makeDetector();
    // Wrap an error pattern in colour codes — stripping should reveal it
    detector.processOutput(withColor('Error: disk quota exceeded now'));
    expect(detector.getStatus()).toBe('ERROR');
    detector.destroy();
  });

  it('correctly classifies prompt wrapped in ANSI codes', () => {
    const { detector } = makeDetector();
    detector.processOutput(`\x1b[36m❯\x1b[0m type your answer here`);
    expect(detector.getStatus()).toBe('WAITING');
    detector.destroy();
  });

  // ── TUI chrome filtering ──────────────────────────────────────────────────

  it('ignores output consisting only of box-drawing characters', () => {
    const { detector, callback } = makeDetector();
    // A long chunk of only box-drawing chars — extractSignificantText should reduce to nothing
    const tuiFrame = '╭' + '─'.repeat(80) + '╮' + '│' + ' '.repeat(80) + '│' + '╰' + '─'.repeat(80) + '╯';
    detector.processOutput(tuiFrame);
    // No significant text → no state change from WORKING
    expect(callback).not.toHaveBeenCalled();
    detector.destroy();
  });

  it('ignores "Claude Code v..." TUI static text', () => {
    const { detector, callback } = makeDetector();
    detector.processOutput('Claude Code v2.1.0');
    expect(callback).not.toHaveBeenCalled();
    detector.destroy();
  });

  // ── Empty / trivial input ─────────────────────────────────────────────────

  it('handles empty string without crashing', () => {
    const { detector } = makeDetector();
    expect(() => detector.processOutput('')).not.toThrow();
    expect(detector.getStatus()).toBe('WORKING');
    detector.destroy();
  });

  it('handles single newline without crashing', () => {
    const { detector } = makeDetector();
    expect(() => detector.processOutput('\n')).not.toThrow();
    detector.destroy();
  });

  it('handles whitespace-only input without crashing', () => {
    const { detector } = makeDetector();
    expect(() => detector.processOutput('   \t   \r\n')).not.toThrow();
    detector.destroy();
  });

  // ── notifyInput ───────────────────────────────────────────────────────────

  it('notifyInput resets the idle clock, preventing THINKING transition', () => {
    const { detector } = makeDetector();
    detector.processOutput(significantText('Initial output for testing'));

    vi.advanceTimersByTime(4000);
    // 4 s idle — still under 5 s threshold
    detector.notifyInput(); // reset clock

    vi.advanceTimersByTime(4000);
    // 4 s since last reset — still under threshold
    expect(detector.getStatus()).toBe('WORKING');
    detector.destroy();
  });

  // ── destroy / clearIdleTimer ──────────────────────────────────────────────

  it('destroy stops the idle timer — no further transitions after destroy', () => {
    const { detector, callback } = makeDetector();
    detector.destroy();

    const callsBefore = callback.mock.calls.length;
    vi.advanceTimersByTime(30000);

    expect(callback.mock.calls.length).toBe(callsBefore);
  });

  // ── Callback arguments ────────────────────────────────────────────────────

  it('callback receives correct sessionId, new status, and previous status', () => {
    const { detector, callback } = makeDetector();
    detector.processOutput('❯ input prompt here');
    expect(callback).toHaveBeenCalledWith(SESSION_ID, 'WAITING', 'WORKING');
    detector.destroy();
  });

  it('callback is not fired when status does not change', () => {
    const { detector, callback } = makeDetector();

    // First prompt → WAITING (1 call)
    detector.processOutput('❯ first prompt');
    const callsAfterFirst = callback.mock.calls.length;

    // Another WAITING trigger while already WAITING
    detector.processOutput('❯ second prompt');
    expect(callback.mock.calls.length).toBe(callsAfterFirst);
    detector.destroy();
  });

  // ── Priority: INPUT_PATTERNS before ERROR_PATTERNS ───────────────────────

  it('INPUT_PATTERNS take priority over ERROR_PATTERNS in same chunk', () => {
    const { detector } = makeDetector();
    // Contains both an error keyword and an input prompt
    detector.processOutput(significantText('Error: needs input ❯ confirm action'));
    // Input patterns are checked first → WAITING, not ERROR
    expect(detector.getStatus()).toBe('WAITING');
    detector.destroy();
  });

  // ── Rapid state changes ───────────────────────────────────────────────────

  it('handles rapid alternating output → prompt → output transitions', () => {
    const { detector } = makeDetector();

    for (let i = 0; i < 5; i++) {
      detector.processOutput(significantText(`task output iteration ${i}`));
      expect(detector.getStatus()).toBe('WORKING');
      detector.processOutput('❯ confirm step?');
      expect(detector.getStatus()).toBe('WAITING');
    }
    detector.destroy();
  });
});
