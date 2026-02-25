# Phase 4: Status Detection & Alerts - Research

**Researched:** 2026-02-25
**Domain:** Terminal output pattern matching, state machines, Web Audio API, Electron IPC messaging
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- 5 distinct states: WORKING, THINKING, WAITING, ERROR, DONE
- WORKING = actively streaming output (text, tool calls)
- THINKING = no output for 5+ seconds but no prompt detected (Claude processing)
- WAITING = Claude prompt pattern detected (needs user input)
- ERROR = error pattern detected or process crashed/hung
- DONE = PTY process exited (process lifecycle only, not Claude exit messages)
- Claude CLI-specific patterns, hardcoded (not configurable)
- WAITING patterns: `❯` prompt, `? ... (Y/n)` questions, `Do you want...` permission prompts
- WORKING patterns: `● ` tool call indicator, any new output streaming
- ERROR patterns: `Error:` messages, `Interrupted` (Ctrl+C)
- DONE: PTY process exit event only (shell still alive = still WAITING, not DONE)
- Pattern matching runs in Electron main process, close to PTY output stream
- Status sent to frontend as metadata alongside terminal data via WebSocket
- No duplicate parsing in frontend — main process is the single source of truth
- Combined approach: status dot in tile header for all states + box-shadow glow for high-priority states
- Urgency-based color mapping (Catppuccin Mocha palette):
  - WORKING: Green (#a6e3a1) — dot only
  - THINKING: Teal (#94e2d5) — dot only
  - WAITING: Peach (#fab387) — dot + static box-shadow glow
  - ERROR: Red (#f38ba8) — dot + pulsing box-shadow glow (2s cycle)
  - DONE: Lavender (#b4befe) — dot only
- Box-shadow glow style (not solid border): soft aura using multiple box-shadow layers
- Audio triggers on 3 transitions: -> WAITING, -> ERROR, -> DONE
- No sound on -> WORKING transition (user just typed, they know)
- Different sounds per transition type (Web Audio API generated tones):
  - WAITING: Gentle 2-note rising chime
  - ERROR: Low buzzy alert tone
  - DONE: Soft 3-note descending completion sound
- Multi-alert debounce: transitions within 2s window coalesce to single sound
  - Priority: ERROR > WAITING > DONE (highest priority sound wins)
- 5-second no-output threshold for WORKING -> THINKING transition
- THINKING -> WAITING transition is pattern-only (no timeout fallback)
- No timeout-based WAITING detection — only real prompt patterns trigger WAITING
- Global mute toggle only (no per-terminal mute)
- Single button in toolbar: mute/unmute all terminal audio

### Claude's Discretion
- Exact Web Audio API frequencies and waveforms for each sound
- Glow intensity and shadow spread values
- Debounce implementation details
- Status dot size and positioning within tile header

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STAT-01 | App detects terminal status (working/waiting for input/done) via PTY output pattern matching | StatusDetector class in main process intercepts PTY onData, strips ANSI, matches patterns. See Architecture Pattern 1 |
| STAT-02 | App uses idle-timeout heuristic as fallback when pattern matching is inconclusive | 5-second idle timer in StatusDetector transitions WORKING -> THINKING. See Architecture Pattern 2 |
| STAT-03 | Each terminal tile displays a color-coded visual indicator reflecting its current status | Status dot in TileHeader + box-shadow glow on .tile element via CSS classes. See Architecture Pattern 3 |
| STAT-04 | App plays an audio notification when a terminal transitions to "waiting for input" or "done" | AudioAlertService using Web Audio API OscillatorNode. See Architecture Pattern 4 and Code Examples |
| STAT-05 | User can mute/unmute audio notifications globally | Mute toggle in app toolbar, state stored in AudioAlertService, persisted to localStorage. See Architecture Pattern 5 |
</phase_requirements>

## Summary

This phase adds status detection for Claude CLI terminal sessions by analyzing PTY output in the Electron main process and forwarding status metadata to the Angular frontend via the existing WebSocket protocol. The core challenge is ANSI escape sequence stripping and reliable pattern matching against Claude CLI's output format — patterns like the `❯` prompt character, `● ` tool indicators, and error messages.

The architecture places all pattern matching in the main process (close to PTY output) and sends status updates to the frontend as a new WebSocket message type. The frontend displays status via colored dots in tile headers and optional box-shadow glow on tiles, with audio notifications generated programmatically via the Web Audio API's OscillatorNode (no audio files needed).

**Primary recommendation:** Build a `StatusDetector` class in the main process that hooks into each PTY's `onData` stream, strips ANSI codes with an inline regex (avoid `strip-ansi` — ESM-only, incompatible with this project's CommonJS setup), runs pattern matching against clean text, manages state transitions with a simple state machine, and broadcasts status changes over WebSocket.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Web Audio API | Browser built-in | Programmatic sound generation | Zero dependencies, available in all Electron renderer contexts, perfect for simple notification tones |
| No external deps | N/A | ANSI stripping, pattern matching, state machine | All implementable with <50 lines each using well-known patterns. No library needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| N/A | — | — | This phase requires no additional npm packages |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline ANSI regex | `strip-ansi` npm | ESM-only since v7, incompatible with project's CommonJS. Inline regex is 1 line |
| Web Audio API tones | Audio file playback (`<audio>` or Howler.js) | Files add asset management burden, Web Audio API is lighter and more flexible for simple tones |
| Claude Code Hooks API | PTY output parsing | Hooks run inside Claude Code's process, not accessible from external monitoring app. Cannot use |
| Custom state machine | `xstate` | Overkill for 5 states with simple transitions. Hand-rolled is clearer and has zero bundle cost |

**Installation:**
```bash
# No new packages required. All features use built-in APIs.
```

## Architecture Patterns

### Recommended Project Structure
```
electron/
├── status/
│   ├── status-detector.ts      # Pattern matching + state machine per session
│   └── ansi-strip.ts           # ANSI escape code stripping utility
├── websocket/
│   └── ws-server.ts            # Extended with 'status' message type
└── ipc/
    └── pty-handlers.ts         # Wire StatusDetector into PTY onData

src/src/app/
├── models/
│   └── terminal-status.model.ts  # TerminalStatus enum + StatusUpdate type
├── services/
│   └── audio-alert.service.ts    # Web Audio API tone generation + mute state
└── components/
    ├── tile-header/
    │   ├── tile-header.component.ts   # Status dot input binding
    │   ├── tile-header.component.html # Status dot element
    │   └── tile-header.component.css  # Status dot + glow styles
    └── dashboard/
        ├── dashboard.component.ts   # Track per-session status, wire audio alerts
        ├── dashboard.component.html # Status CSS classes on .tile elements
        └── dashboard.component.css  # Box-shadow glow animations

src/shared/
└── ws-protocol.ts             # Add 'status' ServerMessage type
```

### Pattern 1: StatusDetector in Main Process (STAT-01)
**What:** A class instantiated per session that receives raw PTY output chunks, strips ANSI codes, and runs pattern matching to detect state transitions.
**When to use:** For every active PTY session.
**Key design decisions:**
- StatusDetector receives the raw `data` string from `ptyProcess.onData()`
- Strips ANSI escape codes before pattern matching
- Maintains current state and last-output timestamp per session
- Emits state changes via callback (not events — simpler, no EventEmitter overhead)
- Pattern matching operates on a sliding window of the last ~500 characters (not full buffer) to avoid matching stale prompts in scrollback

**Example:**
```typescript
// electron/status/status-detector.ts

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

  // Claude CLI prompt patterns (hardcoded, not configurable)
  private static readonly WAITING_PATTERNS = [
    /❯\s*$/,                       // Claude prompt character at end of output
    /\? .+\(Y\/n\)/,               // Yes/No confirmation
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
    this.resetIdleTimer();

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

  destroy(): void {
    this.clearIdleTimer();
  }

  private transition(newStatus: TerminalStatus): void {
    if (newStatus !== this.status) {
      const prev = this.status;
      this.status = newStatus;
      this.onStatusChange(this.sessionId, newStatus, prev);
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

  private resetIdleTimer(): void {
    // No need to reset interval — just update lastOutputTime (already done in processOutput)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
```

### Pattern 2: ANSI Stripping Without Dependencies (STAT-02 support)
**What:** Inline regex to remove ANSI escape sequences from PTY output before pattern matching.
**Why not strip-ansi:** The `strip-ansi` package is ESM-only since v7. This project uses CommonJS (`"type": "commonjs"` in package.json). The well-known ANSI regex is trivial to inline.

**Example:**
```typescript
// electron/status/ansi-strip.ts

/**
 * Strip ANSI escape codes from a string.
 * Regex covers: CSI sequences, OSC sequences, and single-character escapes.
 * Source: https://github.com/chalk/ansi-regex (MIT licensed regex pattern)
 */
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}
```

### Pattern 3: WebSocket Status Message Extension
**What:** Extend the existing WebSocket protocol with a new `status` message type so the frontend receives status updates alongside terminal data.
**When to use:** Every status transition triggers a WebSocket broadcast.

**Example:**
```typescript
// Addition to src/shared/ws-protocol.ts
// Add to ServerMessage union type:
//   | { type: 'status'; status: TerminalStatus }

// In ws-server.ts, broadcast to connected clients for a session:
function broadcastStatus(sessionId: string, status: TerminalStatus): void {
  if (!wss) return;
  wss.clients.forEach((ws) => {
    const client = ws as any;
    if (client.sessionId === sessionId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'status', status }));
    }
  });
}
```

### Pattern 4: Web Audio API Notification Tones (STAT-04)
**What:** Generate notification sounds programmatically using OscillatorNode and GainNode. No audio files needed.
**When to use:** When a terminal transitions to WAITING, ERROR, or DONE.

**Key implementation details:**
- AudioContext must be created after user interaction (browser autoplay policy). Create lazily on first audio trigger or use Electron's `--autoplay-policy=no-user-gesture-required` flag
- In Electron with `contextIsolation: true`, AudioContext works normally in the renderer
- Use GainNode for volume control and smooth fade-out (prevents click artifacts)
- Each sound is a sequence of OscillatorNode start/stop calls with different frequencies
- Oscillators are one-shot (create, start, stop, garbage collect)

**Example:**
```typescript
// src/src/app/services/audio-alert.service.ts

@Injectable({ providedIn: 'root' })
export class AudioAlertService {
  private audioCtx: AudioContext | null = null;
  private muted = false;
  private debounceTimer: any = null;
  private pendingAlert: { status: TerminalStatus; priority: number } | null = null;

  private static readonly PRIORITY: Record<string, number> = {
    'ERROR': 3,
    'WAITING': 2,
    'DONE': 1,
  };

  private getContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    return this.audioCtx;
  }

  get isMuted(): boolean { return this.muted; }

  toggleMute(): void {
    this.muted = !this.muted;
    localStorage.setItem('audio-muted', String(this.muted));
  }

  /**
   * Trigger an alert sound for a status transition.
   * Debounces multiple transitions within 2s window.
   */
  alert(status: TerminalStatus): void {
    if (this.muted) return;
    const priority = AudioAlertService.PRIORITY[status] || 0;
    if (priority === 0) return;

    // Debounce: keep highest priority in 2s window
    if (this.pendingAlert && this.pendingAlert.priority >= priority) return;
    this.pendingAlert = { status, priority };

    if (!this.debounceTimer) {
      this.debounceTimer = setTimeout(() => {
        this.playSound(this.pendingAlert!.status);
        this.pendingAlert = null;
        this.debounceTimer = null;
      }, 100); // Short initial delay, then 2s window
    }
  }

  private playSound(status: TerminalStatus): void {
    const ctx = this.getContext();
    switch (status) {
      case 'WAITING': this.playWaitingChime(ctx); break;
      case 'ERROR': this.playErrorTone(ctx); break;
      case 'DONE': this.playDoneChime(ctx); break;
    }
  }

  private playWaitingChime(ctx: AudioContext): void {
    // 2-note rising chime (C5 -> E5)
    this.playNote(ctx, 523.25, 0.15, 0, 'sine');    // C5
    this.playNote(ctx, 659.25, 0.2, 0.15, 'sine');  // E5
  }

  private playErrorTone(ctx: AudioContext): void {
    // Low buzzy alert (A3 sawtooth, short)
    this.playNote(ctx, 220, 0.3, 0, 'sawtooth');
  }

  private playDoneChime(ctx: AudioContext): void {
    // 3-note descending (G5 -> E5 -> C5)
    this.playNote(ctx, 783.99, 0.12, 0, 'sine');    // G5
    this.playNote(ctx, 659.25, 0.12, 0.12, 'sine'); // E5
    this.playNote(ctx, 523.25, 0.2, 0.24, 'sine');  // C5
  }

  private playNote(ctx: AudioContext, freq: number, duration: number, delay: number, type: OscillatorType): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration + 0.05);
  }
}
```

### Pattern 5: Status Flow Through Existing Architecture
**What:** End-to-end data flow from PTY output to visual display.
**Flow:**
1. `pty-handlers.ts`: PTY onData fires -> feeds raw data to StatusDetector AND existing scrollback/IPC
2. `status-detector.ts`: Strips ANSI, matches patterns, detects transitions
3. `ws-server.ts`: On status change callback, broadcasts `{ type: 'status', status }` to WebSocket clients
4. `terminal.component.ts`: Receives `status` message, emits to parent via @Output
5. `dashboard.component.ts`: Tracks per-session status map, passes to tile-header, triggers audio
6. `tile-header.component.ts`: Displays status dot with appropriate color
7. `dashboard.component.css`: Applies box-shadow glow CSS class on `.tile` based on status

### Anti-Patterns to Avoid
- **Parsing in both main and renderer:** Parsing PTY output in the Angular frontend duplicates work and adds latency. Decision: main process is single source of truth (per CONTEXT.md)
- **Matching against full scrollback buffer:** Would match stale prompts from history. Use a sliding window of recent output (~500 chars)
- **Using EventEmitter for status:** Unnecessary complexity for simple callback pattern between StatusDetector and the PTY handler wiring
- **Creating AudioContext on service init:** Browser autoplay policy requires user interaction first. Create lazily or use Electron flag
- **Storing status in SessionStateService:** Status changes rapidly. Use a separate lightweight reactive signal or BehaviorSubject to avoid triggering heavy session map re-emissions

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio tone generation | MP3/WAV asset pipeline | Web Audio API OscillatorNode | Built-in, zero dependencies, <50 lines for all three sounds |
| ANSI escape stripping | Custom parser | Well-known regex from ansi-regex project | One-line regex covers all standard ANSI sequences. Don't use the npm package (ESM-only) |
| State machine | Full xstate integration | Simple switch/if with 5 states | 5 states, <10 transitions. xstate adds bundle weight and complexity for no benefit |
| Glow animation | JavaScript animation loop | CSS @keyframes + box-shadow | GPU-accelerated, zero JS overhead, trivial to implement |

**Key insight:** This phase is surprisingly library-free. All components (pattern matching, state machine, audio, visual indicators) are well-served by platform APIs and simple code. Adding libraries would increase complexity without benefit.

## Common Pitfalls

### Pitfall 1: ANSI Sequences in Pattern Matching
**What goes wrong:** Pattern matching fails because PTY output contains ANSI escape codes (colors, cursor movements) interleaved with text. `❯` might be wrapped in color codes like `\u001b[38;5;208m❯\u001b[0m`.
**Why it happens:** Claude CLI uses rich terminal formatting. Raw PTY output is not plain text.
**How to avoid:** Always strip ANSI codes before pattern matching. Use the well-known regex from ansi-regex project.
**Warning signs:** Patterns that work on visual output but fail on raw PTY data.

### Pitfall 2: Stale Pattern Matches in Scrollback
**What goes wrong:** Detector sees an old `❯` prompt from scrollback history and thinks the terminal is WAITING when it's actually WORKING.
**Why it happens:** If matching against the full buffer, old prompts persist.
**How to avoid:** Use a sliding window of the last ~500 characters. Clear the window on relevant transitions (e.g., when user sends input, reset to WORKING).
**Warning signs:** Status flickers between WAITING and WORKING frequently.

### Pitfall 3: Browser AudioContext Autoplay Policy
**What goes wrong:** Audio doesn't play because AudioContext was created before user interaction.
**Why it happens:** Chromium (which Electron uses) suspends AudioContext until user gesture.
**How to avoid:** Either create AudioContext lazily on first user interaction, or set Electron's `--autoplay-policy=no-user-gesture-required` flag in app.commandLine (this is common for Electron apps that generate their own audio).
**Warning signs:** AudioContext state is "suspended" and sounds never play.

### Pitfall 4: Oscillator Click Artifacts
**What goes wrong:** Notification sounds have audible clicks at start/end.
**Why it happens:** Abrupt amplitude changes from 0 to full volume (or vice versa) cause digital artifacts.
**How to avoid:** Use GainNode with `exponentialRampToValueAtTime()` for smooth fade-in/fade-out. Never stop an oscillator at full volume.
**Warning signs:** Harsh clicking sounds on every notification.

### Pitfall 5: Status Change Flooding
**What goes wrong:** Frontend receives dozens of status updates per second during active output, causing excessive re-renders.
**Why it happens:** Every PTY output chunk triggers processOutput() which may call transition().
**How to avoid:** Only emit status changes (not "same status" confirmations). The StatusDetector already guards against this with `if (newStatus !== this.status)`. On the frontend side, use `ChangeDetectionStrategy.OnPush` and only update when status actually changes.
**Warning signs:** High CPU usage in renderer during active terminal output.

### Pitfall 6: Pattern Matching False Positives from User Echo
**What goes wrong:** User types "Error:" as input, and the detector thinks it's a real error.
**Why it happens:** PTY echoes user input, so typed text appears in the output stream.
**How to avoid:** Consider only matching patterns after a newline or at start of a new output chunk. The sliding window approach also helps because user input is quickly pushed out by Claude's response. For the `❯` prompt specifically, it should only match at the end of the recent output (end-of-line position).
**Warning signs:** Typing certain words triggers false status changes.

### Pitfall 7: ESM-Only strip-ansi in CommonJS Project
**What goes wrong:** `require('strip-ansi')` throws ERR_REQUIRE_ESM.
**Why it happens:** `strip-ansi` v7+ is ESM-only. This project uses `"type": "commonjs"`.
**How to avoid:** Don't use strip-ansi. Inline the ANSI regex (it's one line). The regex pattern from ansi-regex is MIT licensed.
**Warning signs:** Build/runtime error about ESM modules.

## Code Examples

Verified patterns from official sources:

### Web Audio API: Multi-Note Chime
```typescript
// Source: MDN OscillatorNode documentation
// https://developer.mozilla.org/en-US/docs/Web/API/OscillatorNode
const ctx = new AudioContext();

function playNote(freq: number, duration: number, delay: number, type: OscillatorType = 'sine'): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);

  // Smooth volume envelope to prevent click artifacts
  gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + delay);
  osc.stop(ctx.currentTime + delay + duration + 0.05);
}

// Rising 2-note chime
playNote(523.25, 0.15, 0);      // C5
playNote(659.25, 0.2, 0.15);    // E5
```

### ANSI Escape Code Stripping (Inline Regex)
```typescript
// Source: ansi-regex project pattern (MIT)
// https://github.com/chalk/ansi-regex
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

// Usage:
const raw = '\u001b[38;5;208m❯\u001b[0m ';
console.log(stripAnsi(raw)); // '❯ '
```

### CSS Box-Shadow Glow Animation
```css
/* Static glow for WAITING state */
.tile.status-waiting {
  box-shadow:
    0 0 8px rgba(250, 179, 135, 0.4),
    0 0 20px rgba(250, 179, 135, 0.2);
}

/* Pulsing glow for ERROR state */
.tile.status-error {
  animation: error-pulse 2s ease-in-out infinite;
}

@keyframes error-pulse {
  0%, 100% {
    box-shadow:
      0 0 8px rgba(243, 139, 168, 0.3),
      0 0 20px rgba(243, 139, 168, 0.1);
  }
  50% {
    box-shadow:
      0 0 12px rgba(243, 139, 168, 0.6),
      0 0 30px rgba(243, 139, 168, 0.3);
  }
}
```

### WebSocket Protocol Extension
```typescript
// Addition to existing ServerMessage type in ws-protocol.ts
type TerminalStatus = 'WORKING' | 'THINKING' | 'WAITING' | 'ERROR' | 'DONE';

export type ServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'buffering'; total: number }
  | { type: 'buffered' }
  | { type: 'status'; status: TerminalStatus }  // NEW
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Audio file playback (mp3/wav) | Web Audio API OscillatorNode | Stable since 2020 | No asset files needed, programmatic tone generation |
| strip-ansi v6 (CJS) | strip-ansi v7+ (ESM-only) | v7.0.0 (2021) | CJS projects must use inline regex instead |
| N/A | Claude Code Hooks API | 2025-2026 | Hooks run inside Claude Code process; cannot be used by external monitoring apps. Only relevant if spawning Claude with hooks configured |

**Deprecated/outdated:**
- `BaseAudioContext.createOscillator()` factory method: Still works, but `new OscillatorNode(ctx, options)` constructor is preferred
- `strip-ansi` v6 (last CJS version): Still works but no longer maintained. Use inline regex for new code

**Important context on Claude Code Hooks:**
Claude Code v2.1.55 (Feb 2026) has a hooks system with `Notification`, `Stop`, `PermissionRequest` lifecycle events. These hooks fire *inside* Claude Code's process and run shell commands. They are NOT accessible from an external app watching PTY output. However, understanding these events confirms the patterns we need to detect:
- `Notification` fires on `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`
- `Stop` fires when Claude finishes responding
- These map directly to our WAITING and DONE states, validating our pattern matching approach

## Open Questions

1. **Exact Claude CLI prompt patterns may change**
   - What we know: `❯` is the current Claude CLI prompt. `● ` indicates tool calls. Error patterns include `Error:` prefix.
   - What's unclear: These patterns are not formally documented by Anthropic. Claude CLI updates could change them.
   - Recommendation: Centralize all patterns in a single array at the top of StatusDetector. Add comments noting they are empirically observed. Design for easy updates. The sliding-window approach reduces false positive risk from format changes.

2. **Electron autoplay policy for AudioContext**
   - What we know: Chromium suspends AudioContext until user gesture. Electron has `--autoplay-policy=no-user-gesture-required` flag.
   - What's unclear: Whether this flag is already set or whether we need to add it.
   - Recommendation: Check `main.ts` for existing `app.commandLine.appendSwitch` calls. If none, add the autoplay policy flag. Alternatively, create AudioContext lazily on first user interaction (creating a session counts as interaction).

3. **Pattern matching across chunked PTY output**
   - What we know: PTY onData delivers output in arbitrary chunks. A prompt pattern like `❯` could be split across two chunks.
   - What's unclear: How often Claude CLI output gets split mid-pattern in practice on Windows with ConPTY.
   - Recommendation: The sliding window approach (appending to recent output buffer) naturally handles this. Each chunk appends to the window, and patterns match against the combined recent text.

## Sources

### Primary (HIGH confidence)
- MDN OscillatorNode documentation: https://developer.mozilla.org/en-US/docs/Web/API/OscillatorNode — Web Audio API reference, constructor, properties, methods
- MDN Web Audio API documentation: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API — AudioContext, GainNode, scheduling
- Claude Code Hooks reference: https://code.claude.com/docs/en/hooks — Hook lifecycle events, Notification/Stop event schemas, matcher patterns

### Secondary (MEDIUM confidence)
- ansi-regex GitHub: https://github.com/chalk/ansi-regex — MIT-licensed regex pattern for ANSI escape codes, verified by 10K+ dependents
- strip-ansi npm: https://www.npmjs.com/package/strip-ansi — Confirmed ESM-only since v7, CJS incompatible
- Codebase analysis of existing PTY data flow, WebSocket protocol, and component architecture — direct source code inspection

### Tertiary (LOW confidence)
- Claude CLI prompt patterns (`❯`, `● `, error formats): Based on observed behavior, not formally documented by Anthropic. May change with CLI updates.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All built-in APIs (Web Audio, regex), no external dependencies needed
- Architecture: HIGH - Follows existing codebase patterns (main process detection, WebSocket messaging, Angular services). All integration points (pty-handlers, ws-server, ws-protocol, tile-header, dashboard) are well-understood from code review
- Pitfalls: HIGH - ANSI stripping, AudioContext autoplay, oscillator artifacts are well-documented issues with proven solutions
- Pattern matching accuracy: MEDIUM - Claude CLI patterns are empirically observed, not formally documented. Patterns may change.

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (30 days — stable domain, but Claude CLI patterns may change sooner)
