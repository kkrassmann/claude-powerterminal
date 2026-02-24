# Pitfalls Research

**Domain:** Web-based terminal management dashboard
**Researched:** 2026-02-24
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Windows ConoutConnection Worker Thread Doesn't Terminate Cleanly

**What goes wrong:**
On Windows, calling `ptyProcess.kill()` alone doesn't terminate the ConoutConnection worker thread spawned by node-pty. The process appears killed but the worker thread continues running, causing resource leaks and preventing the Node.js process from exiting cleanly. This manifests as orphaned conhost.exe processes in Task Manager.

**Why it happens:**
Windows uses a named pipe (conout) for PTY output. When the socket draining and closing occur on the same thread, a deadlock can occur which locks up the UI. To fix this, node-pty moved conout handling to a Worker thread (PR #415), but this worker doesn't terminate when the PTY is killed normally.

**How to avoid:**
Implement forceful kill with timeout:
```typescript
async kill(): Promise<void> {
  return new Promise<void>((resolve) => {
    let exited = false;

    this.ptyProcess.onExit(() => {
      exited = true;
      resolve();
    });

    // Attempt graceful kill
    this.ptyProcess.kill();

    // Forceful SIGKILL timeout (3 seconds)
    setTimeout(() => {
      if (!exited) {
        try {
          process.kill(this.ptyProcess.pid, 'SIGKILL');
        } catch (e) {
          // Process may already be dead - ignore error
        }
        resolve();
      }
    }, 3000);
  });
}
```

**Warning signs:**
- PTY processes don't terminate when expected
- Orphaned conhost.exe processes accumulate in Task Manager
- Node.js process hangs on shutdown
- Memory usage grows over time as "killed" processes leak

**Phase to address:**
Phase 1 (Terminal Spawning) - Implement forceful kill pattern from the start

---

### Pitfall 2: Resizing Exited PTY Crashes the Process

**What goes wrong:**
Calling `ptyProcess.resize(cols, rows)` on a PTY that has already exited crashes the Node.js process with an unhandled exception. This happens when a WebSocket reconnection triggers resize events for terminals that died while the client was disconnected.

**Why it happens:**
The node-pty library doesn't gracefully handle resize calls on exited processes. When a PTY exits, the underlying native resources are freed, and attempting to resize accesses freed memory.

**How to avoid:**
Track exit state and check before resizing:
```typescript
private isExited = false;

constructor() {
  this.ptyProcess.onExit(() => {
    this.isExited = true;
  });
}

resize(cols: number, rows: number): void {
  // CRITICAL: Check exit state before resize
  if (!this.isExited) {
    this.ptyProcess.resize(cols, rows);
  }
}
```

**Warning signs:**
- Crashes during WebSocket reconnection
- Crashes when resizing browser window with inactive terminals
- Exception traces mentioning resize operations
- Crashes when multiple clients connect to same terminal session

**Phase to address:**
Phase 1 (Terminal Spawning) - Add exit state tracking immediately

---

### Pitfall 3: Scrollback Buffer Memory Explosion

**What goes wrong:**
Long-running terminal sessions (days/weeks) accumulate massive scrollback buffers consuming gigabytes of memory. A single terminal with 100,000 lines can consume 200MB+. With 6-10 terminals, this becomes unsustainable. Claude Code's verbose output accelerates this problem.

**Why it happens:**
Unbounded scrollback arrays grow indefinitely. Each line consumes ~200 bytes (content + metadata + ANSI codes). Claude Code's multi-codepoint grapheme outputs and detailed status messages generate significant scrollback quickly. The recent Ghostty memory leak (2026) was triggered specifically by Claude Code's output patterns - non-standard page reuse during scrollback pruning caused severe leaks.

**How to avoid:**
Implement circular buffer with sensible limits:
```typescript
private scrollback: string[] = [];
private static readonly MAX_SCROLLBACK = 10000; // ~2MB per terminal

this.ptyProcess.onData((data: string) => {
  this.scrollback.push(data);
  if (this.scrollback.length > MAX_SCROLLBACK) {
    // Remove oldest entries to maintain limit
    this.scrollback.splice(0, this.scrollback.length - MAX_SCROLLBACK);
  }
});
```

**Recommended limits:**
- Development/MVP: 10,000 lines (optimal balance)
- Power users with abundant RAM: 20,000 lines maximum
- **Never exceed 50,000 lines** - diminishing returns, severe performance impact

**Warning signs:**
- Node.js process memory grows steadily over time (monitor with `process.memoryUsage()`)
- Memory doesn't decrease after closing terminals
- System becomes sluggish after several hours
- Garbage collection pauses increase in frequency/duration

**Phase to address:**
Phase 1 (Terminal Spawning) - Implement from the start, not retrofitted

---

### Pitfall 4: xterm.js Performance Degradation with Multiple Instances

**What goes wrong:**
Running 6-10 xterm.js instances on a single page causes severe performance degradation. Each instance tries to saturate the main thread, terminals slow each other down, and the browser UI becomes unresponsive. A single 160x24 terminal with 5000 scrollback can consume 34MB of memory.

**Why it happens:**
xterm.js performs expensive DOM manipulations and layout calculations on the main thread. Each terminal instance competes for CPU time. The default DOM-based renderer is 5-45x slower than canvas rendering. With multiple terminals, rendering time easily exceeds 16.6ms per frame, breaking 60 FPS.

**How to avoid:**
1. **Use canvas renderer (required):**
```typescript
import { Terminal } from '@xterm/xterm';
import { CanvasAddon } from '@xterm/addon-canvas';

const terminal = new Terminal();
const canvasAddon = new CanvasAddon();
terminal.loadAddon(canvasAddon); // 5-45x faster rendering
```

2. **Share texture atlas between instances:**
xterm.js automatically shares a global atlas generator between terminals with the same configuration, reducing duplicated construction for multiple instances.

3. **Limit scrollback per terminal:**
Set reasonable `scrollback` option (10,000 max, preferably 5,000 for multiple terminals).

4. **Use virtual scrolling for grid:**
Don't render terminals that are off-screen. Use `IntersectionObserver` to detect visibility and pause/resume rendering.

**Warning signs:**
- Browser DevTools Performance tab shows frames >16.6ms
- Terminal input lag (typing appears delayed)
- Scrolling is janky/stutters
- High CPU usage in browser process
- Memory usage >500MB for the tab

**Phase to address:**
Phase 2 (Grid Layout & Display) - Canvas renderer is non-negotiable for multi-terminal use case

---

### Pitfall 5: WebSocket Backpressure Causes Output Loss

**What goes wrong:**
When PTY output arrives faster than the WebSocket can transmit (slow network, client processing lag), the WebSocket buffer fills up and messages are dropped silently. Users see incomplete terminal output, especially during high-volume operations like `npm install` or Claude Code's verbose responses.

**Why it happens:**
WebSocket has a send buffer (`socket.bufferedAmount`). When this buffer fills, `socket.send()` either blocks (Node.js) or drops messages (browser). PTY output continues regardless of WebSocket capacity. Without backpressure handling, fast producers overwhelm slow consumers.

**How to avoid:**
Monitor `bufferedAmount` and apply backpressure:
```typescript
private sendToWebSocket(ws: WebSocket, data: string): void {
  const BUFFER_THRESHOLD = 64 * 1024; // 64KB

  // Check backpressure
  if (ws.bufferedAmount > BUFFER_THRESHOLD) {
    // Option 1: Pause PTY (if node-pty supports it)
    // Option 2: Buffer locally with limit
    // Option 3: Drop with warning logged
    console.warn('WebSocket backpressure detected, bufferedAmount:', ws.bufferedAmount);
    return;
  }

  ws.send(data);
}
```

Better solution - use flow control:
```typescript
// Pause PTY when WebSocket is congested
if (ws.bufferedAmount > BUFFER_THRESHOLD) {
  this.ptyProcess.pause(); // If supported by node-pty
}

ws.on('drain', () => {
  this.ptyProcess.resume();
});
```

**Note:** node-pty doesn't currently expose pause/resume for backpressure. Alternative: implement bounded local buffer, drop oldest data when full.

**Warning signs:**
- Missing chunks in terminal output
- Output appears "jumpy" or incomplete
- WebSocket close events with code 1009 (message too big)
- Slow network conditions correlate with output issues

**Phase to address:**
Phase 3 (WebSocket Communication) - Critical for reliability with Claude Code's verbose output

---

### Pitfall 6: Browser Autoplay Policy Blocks Audio Notifications

**What goes wrong:**
Audio notifications for "terminal needs input" fail silently on page load. Chrome/Firefox autoplay policies block `audio.play()` until the user interacts with the page. Users receive no alerts for terminal status changes.

**Why it happens:**
Since Chrome 124 (March 2026), autoplay enforcement intensified - now blocking audio/video by default across nearly all sites. Autoplay is only allowed after user gesture (click, touch, keypress). This is a security feature to prevent annoying auto-playing ads.

**How to avoid:**
1. **Unlock audio on first user interaction:**
```typescript
class AudioManager {
  private unlocked = false;
  private audio: HTMLAudioElement;

  constructor() {
    this.audio = new Audio('/notification.mp3');

    // Unlock on ANY user interaction
    const unlock = () => {
      if (!this.unlocked) {
        this.audio.play().then(() => {
          this.audio.pause();
          this.audio.currentTime = 0;
          this.unlocked = true;
        }).catch(() => {
          // Still locked, try again on next interaction
        });
      }
    };

    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  }

  notify(): void {
    if (this.unlocked) {
      this.audio.play();
    } else {
      console.warn('Audio not unlocked - user must interact first');
    }
  }
}
```

2. **Show visual warning if audio is locked:**
Display banner: "Click anywhere to enable audio notifications" until `unlocked = true`.

3. **Never use command-line workarounds in production:**
`--autoplay-policy=no-user-gesture-required` flag is for testing only, doesn't persist.

**Warning signs:**
- `audio.play()` returns rejected promise
- Console errors: "play() failed because the user didn't interact with the document first"
- Audio works after clicking, but not on page load
- Users report missing notifications

**Phase to address:**
Phase 4 (Status Detection & Alerts) - Implement unlock pattern before audio feature

---

### Pitfall 7: PTY Output Parsing Fragility

**What goes wrong:**
Detecting terminal status (working/waiting/done) by parsing PTY output for prompt patterns breaks constantly. ANSI escape codes corrupt pattern matching, prompt customization breaks assumptions, shell changes invalidate patterns, and false positives trigger incorrect status.

**Why it happens:**
PTY output is raw bytes including ANSI escape codes for colors, cursor movement, and terminal control. Prompt patterns vary by shell (bash vs. PowerShell vs. fish), user customization (PS1 variable), and context (git branch, virtualenv). Regex patterns like `/\$\s/` or `/>\s/` are too naive. Claude Code's TUI screen refresh generates complex escape sequences that confuse parsers.

**How to avoid:**
**Never rely solely on output parsing.** Use hybrid approach:

1. **OSC escape sequence shell integration (preferred):**
```bash
# Configure shell to emit OSC 633 sequences (VS Code protocol)
# PowerShell: Add to profile
$PSVersionTable.PSVersion.Major -ge 7 && {
  $env:TERM_PROGRAM = "claude-powerterminal"
  function Prompt {
    Write-Host "$([char]27)]633;A$([char]27)\" -NoNewline
    # ... prompt content ...
    Write-Host "$([char]27)]633;B$([char]27)\" -NoNewline
  }
}
```

Parse OSC 633 sequences:
- `OSC 633;A` - Prompt started
- `OSC 633;B` - Prompt ended
- `OSC 633;C` - Command execution started
- `OSC 633;D` - Command finished

2. **Idle timeout heuristic (fallback):**
If no output for 2 seconds → assume waiting for input.
If continuous output → assume working.

3. **Combined confidence scoring:**
```typescript
enum TerminalStatus {
  WORKING = 'working',
  WAITING = 'waiting',
  DONE = 'done'
}

class StatusDetector {
  private lastOutputTime = Date.now();
  private sawPromptMarker = false;

  onData(data: string): TerminalStatus {
    this.lastOutputTime = Date.now();

    // Check for OSC 633 markers (HIGH confidence)
    if (data.includes('\x1b]633;B\x1b\\')) {
      this.sawPromptMarker = true;
      return TerminalStatus.WAITING;
    }

    if (data.includes('\x1b]633;C\x1b\\')) {
      this.sawPromptMarker = false;
      return TerminalStatus.WORKING;
    }

    // Fallback: idle timeout (MEDIUM confidence)
    return this.getIdleStatus();
  }

  private getIdleStatus(): TerminalStatus {
    const idleMs = Date.now() - this.lastOutputTime;
    if (idleMs > 2000 && this.sawPromptMarker) {
      return TerminalStatus.WAITING;
    }
    return TerminalStatus.WORKING;
  }
}
```

**Warning signs:**
- Status flickers between working/waiting rapidly
- False "waiting" status during long-running commands
- "Done" detected mid-execution
- Status detection breaks when user changes shell theme
- Works in PowerShell but fails in bash (or vice versa)

**Phase to address:**
Phase 4 (Status Detection & Alerts) - Plan for hybrid approach, don't assume output parsing will work

---

### Pitfall 8: Session Persistence Fails with Uninitialized Terminals

**What goes wrong:**
Attempting to persist/restore terminal sessions crashes with "buffer not initialized" errors. Sessions saved correctly but fail to restore on app restart, leaving users with broken terminals or complete data loss.

**Why it happens:**
Terminal state isn't fully initialized until the first data arrives. Saving state of a terminal that was never activated (user opened it but never used it) captures uninitialized buffers. On restore, accessing these buffers crashes. Microsoft Terminal issue #16995 documents this exact problem.

**How to avoid:**
1. **Only persist fully-initialized sessions:**
```typescript
class TerminalSession {
  private fullyInitialized = false;

  constructor() {
    this.ptyProcess.onData((data) => {
      if (!this.fullyInitialized && data.length > 0) {
        this.fullyInitialized = true;
      }
      // ... handle data ...
    });
  }

  canPersist(): boolean {
    return this.fullyInitialized && !this.isExited;
  }
}
```

2. **Validate state before serialization:**
```typescript
async saveSession(session: TerminalSession): Promise<void> {
  if (!session.canPersist()) {
    console.warn('Skipping uninitialized session:', session.id);
    return;
  }

  const state = {
    claudeSessionId: session.claudeSessionId,
    workingDirectory: session.workingDirectory,
    createdAt: session.createdAt,
    // DON'T persist: scrollback, PTY state, buffers
  };

  await fs.writeFile(`.sessions/${session.id}.json`, JSON.stringify(state));
}
```

3. **Handle restore failures gracefully:**
```typescript
async restoreSession(sessionFile: string): Promise<TerminalSession | null> {
  try {
    const state = JSON.parse(await fs.readFile(sessionFile, 'utf-8'));

    // Validate required fields
    if (!state.claudeSessionId || !state.workingDirectory) {
      throw new Error('Invalid session state');
    }

    // Create new terminal with --resume
    return new TerminalSession({
      resuming: true,
      claudeSessionId: state.claudeSessionId,
      workingDirectory: state.workingDirectory,
    });
  } catch (err) {
    console.error('Failed to restore session:', sessionFile, err);
    return null; // Don't crash, just skip this session
  }
}
```

**What NOT to persist:**
- PTY scrollback buffer (too large, stale on restore)
- Terminal dimensions (client-specific)
- WebSocket connection state
- Internal PTY process state

**What TO persist:**
- Claude session ID (for `--resume`)
- Working directory
- Session creation timestamp
- User-provided metadata (name, tags)

**Warning signs:**
- "Cannot read property of undefined" during restore
- Restored terminals show blank screen
- Crashes only happen on app restart, not during runtime
- Some sessions restore fine, others crash

**Phase to address:**
Phase 5 (Session Persistence) - Design persistence from the start, not bolted on later

---

### Pitfall 9: Working Directory Detection is Unreliable

**What goes wrong:**
The terminal header displays stale or incorrect working directory. User `cd`s to a different folder, but header still shows initial directory. Makes navigation confusing and breaks multi-project workflows.

**Why it happens:**
PTY spawn directory ≠ current shell working directory. Once the shell starts, it can `cd` anywhere - the PTY process doesn't track this. On Linux, you can read `/proc/<pid>/cwd`, but this shows the PTY process directory, not the shell's directory (which is a child process). On Windows, there's no reliable equivalent.

**How to avoid:**
**Option 1: OSC 7 shell integration (preferred):**

Configure shell to report directory changes:
```powershell
# PowerShell profile
function Prompt {
  $loc = Get-Location
  $esc = [char]27
  Write-Host "$esc]7;file://$env:COMPUTERNAME/$($loc.Path.Replace('\', '/'))$esc\" -NoNewline
  # ... rest of prompt ...
}
```

Parse OSC 7 in terminal output:
```typescript
// OSC 7 format: \x1b]7;file://hostname/path\x1b\\
const OSC7_PATTERN = /\x1b\]7;file:\/\/[^\/]+(.+?)\x1b\\/;

onData(data: string): void {
  const match = data.match(OSC7_PATTERN);
  if (match) {
    const path = decodeURIComponent(match[1]);
    this.currentDirectory = path;
  }
}
```

**Option 2: Prompt injection (fragile fallback):**

Periodically send `pwd` command and parse output:
```typescript
// FRAGILE: Works only if terminal is idle, breaks if user is typing
async detectDirectory(): Promise<string> {
  return new Promise((resolve) => {
    let output = '';
    const timeout = setTimeout(() => resolve(this.workingDirectory), 1000);

    const listener = (data: string) => {
      output += data;
      if (output.includes('\n')) {
        clearTimeout(timeout);
        this.ptyProcess.removeListener('data', listener);
        resolve(output.trim());
      }
    };

    this.ptyProcess.on('data', listener);
    this.ptyProcess.write('pwd\r');
  });
}
```

**Don't do this** - interrupts user input, breaks TUI applications.

**Option 3: Accept limitations:**

Show spawn directory only, document that it doesn't update. Simple and honest.

**Recommendation for this project:**
- Phase 1: Show spawn directory only (simple, always correct)
- Phase 4+: Add OSC 7 integration if needed (requires user shell configuration)

**Warning signs:**
- Directory shows initial value forever
- Directory changes randomly/incorrectly
- `pwd` injection breaks Claude Code's TUI
- Users report confusion about "which directory am I in?"

**Phase to address:**
Phase 1 (Terminal Spawning) - Document limitation, defer dynamic detection to later phase

---

### Pitfall 10: Git Branch Detection Requires Shell Integration

**What goes wrong:**
Terminal header shows Git branch, but it's stale or wrong. User switches branches, header doesn't update. Or worse: header shows branch for wrong repository after `cd`ing between projects.

**Why it happens:**
Git branch is not PTY state - it's file system state (`.git/HEAD`). Detecting it requires:
1. Knowing current working directory (see Pitfall 9)
2. Traversing up to find `.git` folder
3. Parsing `.git/HEAD` for branch name
4. Watching for changes (checkout, commit, etc.)

This is complex and error-prone. File watching across multiple directories is expensive. Race conditions between `cd` and branch detection cause mismatches.

**How to avoid:**
**Option 1: OSC escape sequences with Git-aware prompt (preferred):**

```powershell
# PowerShell with posh-git or starship
# These prompts emit OSC sequences including Git info
Import-Module posh-git

# Custom prompt that emits branch info
function Prompt {
  $gitBranch = git rev-parse --abbrev-ref HEAD 2>$null
  if ($gitBranch) {
    $esc = [char]27
    # Custom OSC sequence for Git branch
    Write-Host "$esc]1337;SetUserVar=gitBranch=$([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($gitBranch)))$esc\" -NoNewline
  }
  # ... rest of prompt ...
}
```

Parse custom OSC sequence:
```typescript
// iTerm2 SetUserVar format: \x1b]1337;SetUserVar=key=base64value\x1b\\
const GIT_BRANCH_PATTERN = /\x1b\]1337;SetUserVar=gitBranch=([^\x1b]+)\x1b\\/;

onData(data: string): void {
  const match = data.match(GIT_BRANCH_PATTERN);
  if (match) {
    const base64 = match[1];
    this.gitBranch = Buffer.from(base64, 'base64').toString('utf-8');
  }
}
```

**Option 2: File watching (complex, unreliable):**

Watch `.git/HEAD` in current working directory. Problems:
- Requires knowing current directory (Pitfall 9)
- Must re-attach watcher on every `cd`
- Performance impact with many terminals
- Doesn't work for worktrees, submodules
- Race conditions between `cd` and watcher setup

**Option 3: Periodic polling (wasteful):**

```typescript
// Poll `git rev-parse --abbrev-ref HEAD` every 5 seconds
// Problems: Expensive, interrupts terminal, stale data between polls
```

**Don't do this** - wastes resources, still has stale data.

**Option 4: Defer to later phase:**

Show Git branch only for terminals spawned in Git repos, based on spawn directory. Accept that it doesn't update. Document limitation.

**Recommendation for this project:**
- Phase 1: Show branch only at spawn time (if `.git` exists in spawn directory)
- Phase 2: Update branch display based on spawn directory Git state (refresh on focus)
- Phase 4+: OSC integration for real-time updates (requires user shell configuration)

**Warning signs:**
- Branch shows "main" after switching to "feature-branch"
- Branch from previous project shown after `cd`ing
- Performance degradation with many terminals
- Race conditions: sometimes correct, sometimes stale

**Phase to address:**
Phase 2 (Grid Layout & Display) - Show static branch at spawn time, document limitation

---

### Pitfall 11: WebSocket Reconnection Causes Duplicate Output

**What goes wrong:**
After WebSocket disconnection/reconnection, terminal shows duplicate output - scrollback is replayed, but then new output appends, creating confusion. Or worse: user input during disconnection is lost entirely.

**Why it happens:**
On reconnection, server replays scrollback buffer to restore terminal state. If the terminal generated output during disconnection, that output was already added to scrollback. When client reconnects:
1. Server sends full scrollback (includes recent output)
2. PTY continues generating output
3. New output appends to scrollback
4. Client sees old output twice

For input: WebSocket buffers messages during disconnection, but if connection drops permanently, buffered input is lost.

**How to avoid:**
**1. Replay scrollback correctly:**

```typescript
class TerminalSession {
  private scrollback: string[] = [];

  attachWebSocket(ws: WebSocket): void {
    // Send full scrollback on new connection
    const historicalData = this.scrollback.join('');
    ws.send(JSON.stringify({
      type: 'replay',
      data: historicalData,
    }));

    // Subscribe to new output only
    const unsubscribe = this.onData((data: string) => {
      ws.send(JSON.stringify({
        type: 'data',
        data,
      }));
    });

    ws.on('close', unsubscribe);
  }
}
```

**Client distinguishes replay vs. live:**
```typescript
// xterm.js client
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'replay') {
    // Clear terminal and write full history
    terminal.reset();
    terminal.write(msg.data);
  } else if (msg.type === 'data') {
    // Append new data only
    terminal.write(msg.data);
  }
};
```

**2. Handle input during disconnection:**

```typescript
// Client queues input during disconnection
class TerminalWebSocket {
  private inputQueue: string[] = [];
  private connected = false;

  write(data: string): void {
    if (this.connected) {
      this.ws.send(JSON.stringify({ type: 'input', data }));
    } else {
      // Queue input during disconnection
      this.inputQueue.push(data);
      console.warn('Queuing input - WebSocket disconnected');
    }
  }

  onReconnect(): void {
    this.connected = true;

    // Flush queued input
    while (this.inputQueue.length > 0) {
      const data = this.inputQueue.shift()!;
      this.ws.send(JSON.stringify({ type: 'input', data }));
    }
  }
}
```

**3. Implement exponential backoff reconnection:**

```typescript
class ReconnectingWebSocket {
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000; // 30 seconds

  reconnect(): void {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 1000;

    setTimeout(() => {
      this.connect();
      this.reconnectAttempts++;
    }, delay + jitter);
  }

  onOpen(): void {
    this.reconnectAttempts = 0; // Reset on successful connection
  }
}
```

**Warning signs:**
- Users report seeing the same output twice
- Scrollback grows unexpectedly after reconnection
- Input typed during disconnection never executes
- Terminal "jumps" or resets on reconnection
- Duplicate commands in bash history

**Phase to address:**
Phase 3 (WebSocket Communication) - Implement replay protocol and input queueing from the start

---

### Pitfall 12: Zombie PTY Processes Accumulate

**What goes wrong:**
After killing terminal sessions, PTY processes remain running as zombies (status `Z` in Task Manager). Memory and CPU aren't reclaimed. Over days, hundreds of zombie processes accumulate, eventually exhausting process table.

**Why it happens:**
Zombie processes are processes that finished execution but haven't been reaped by their parent (via `wait()`). The parent process (your Node.js server) isn't properly calling `wait()` to clean up child processes. Additionally, if the parent terminates without waiting, children become orphaned and are reassigned to `init`/`systemd`, which should reap them - but on Windows, orphaned conhost.exe processes may not be cleaned up properly.

**How to avoid:**
**1. Always await kill() completion:**

```typescript
// BAD: Fire-and-forget kill
terminalSession.kill();
delete this.sessions[sessionId];

// GOOD: Await kill completion
await terminalSession.kill();
delete this.sessions[sessionId];
```

**2. Implement proper shutdown handler:**

```typescript
class TerminalManager {
  async shutdown(): Promise<void> {
    console.log('Shutting down - killing all terminals...');

    const killPromises = Array.from(this.sessions.values()).map(
      session => session.kill()
    );

    await Promise.all(killPromises);
    this.sessions.clear();

    console.log('All terminals killed');
  }
}

// Hook into process shutdown
process.on('SIGTERM', async () => {
  await terminalManager.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await terminalManager.shutdown();
  process.exit(0);
});
```

**3. Monitor for zombie processes:**

```typescript
// Periodic zombie check (development/debugging only)
setInterval(() => {
  const zombies = Array.from(this.sessions.values()).filter(s => s.isExited);
  if (zombies.length > 0) {
    console.warn(`Found ${zombies.length} zombie sessions - cleaning up`);
    zombies.forEach(s => {
      this.sessions.delete(s.id);
    });
  }
}, 60000); // Every minute
```

**4. Graceful session cleanup on exit:**

```typescript
class TerminalSession {
  constructor() {
    this.ptyProcess.onExit(() => {
      this.isExited = true;

      // Notify manager to clean up
      this.exitHandlers.forEach(h => h());
    });
  }
}

class TerminalManager {
  createSession(options: TerminalOptions): TerminalSession {
    const session = new TerminalSession(options);
    this.sessions.set(session.id, session);

    // Auto-cleanup on exit
    session.onExit(() => {
      console.log('Session exited, cleaning up:', session.id);
      this.sessions.delete(session.id);
    });

    return session;
  }
}
```

**Warning signs:**
- `ps aux | grep defunct` shows zombie processes (Linux)
- Task Manager shows many exited PTY processes (Windows)
- Memory usage grows despite killing terminals
- Process count increases over time
- Node.js process doesn't exit cleanly

**Phase to address:**
Phase 1 (Terminal Spawning) - Implement proper cleanup from the start

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store full scrollback in memory | Simple implementation, fast replay | Memory explosion with long-running terminals | Never - use bounded buffer from start |
| Parse prompt with simple regex | Works for one shell/theme | Breaks with customization, ANSI codes | Only for MVP demo, plan migration to OSC |
| Skip WebSocket backpressure | Simpler WebSocket code | Silent data loss, unreliable output | Never - critical for reliability |
| Use DOM-based xterm.js renderer | Default behavior, less code | Unusable with 6+ terminals | Never - canvas is required for this use case |
| Store PTY state in persistence | Seems like "full restore" | Crashes on restore, stale data | Never - persist metadata only |
| Fire-and-forget PTY kill | Simpler async code | Zombie processes, resource leaks | Never - always await kill completion |
| Skip exit state check before resize | Simpler code, one less check | Random crashes on reconnection | Never - check costs nothing, crash costs everything |
| Hardcode Windows spawn directory workaround | Solves immediate directory locking | May not be needed with current node-pty | Acceptable - revisit if node-pty evolves |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| node-pty on Windows | Assuming Unix behavior (graceful kill, `/proc` filesystem) | Use Windows-specific patterns: SIGKILL timeout, no `/proc/cwd` |
| xterm.js multiple instances | Loading DOM renderer for all terminals | Load CanvasAddon for every terminal instance |
| WebSocket with PTY | Treating WebSocket as unlimited buffer | Monitor `bufferedAmount`, implement backpressure |
| Claude CLI sessions | Assuming sessions persist automatically | Must explicitly use `--session-id` and `--resume` |
| Browser audio | Calling `audio.play()` on page load | Unlock audio on first user interaction |
| Git branch detection | Reading `.git/HEAD` directly | Use shell integration (OSC sequences) or accept limitations |
| Shell working directory | Assuming PTY spawn directory = current directory | Use OSC 7 shell integration or show spawn directory only |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded scrollback array | Steadily increasing memory, GC pauses | Bounded circular buffer (10k-20k max) | After hours/days of runtime |
| DOM-based terminal rendering | Janky scrolling, high CPU | Use xterm.js CanvasAddon | 3+ terminals on one page |
| Rendering off-screen terminals | Wasted CPU/GPU, low FPS | Use IntersectionObserver, pause off-screen terminals | 6+ terminals in grid |
| Synchronous PTY kill | UI freezes during terminal shutdown | Use async kill with timeout | Multiple terminals killed simultaneously |
| Replaying full scrollback on every WS message | Increasing latency, duplicated data | Replay once on connect, stream delta only | Scrollback > 5k lines |
| File watching for Git branch | CPU usage, file descriptor exhaustion | OSC shell integration or static display | 10+ terminals watching different repos |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing PTY input over unauthenticated WebSocket | Remote code execution - attacker can run arbitrary commands | Require authentication, bind to localhost only (0.0.0.0 only on trusted network) |
| Storing session files with predictable names | Session hijacking - attacker can resume user's Claude session | Use UUIDs for session IDs, store in user-specific directory |
| Allowing client to specify working directory for new PTY | Directory traversal, access to sensitive paths | Validate directory against whitelist, reject paths outside user's home |
| Sending PTY output with user credentials in prompts | Credentials leak via scrollback, WebSocket sniffing | Warn users to avoid secrets in prompts, consider filtering patterns |
| No rate limiting on terminal creation | DoS via PTY process exhaustion | Limit max terminals per client (e.g., 20), rate limit creation |
| Trusting client-provided terminal dimensions | Memory exhaustion via huge terminal size (9999x9999) | Validate cols/rows, cap at reasonable limits (500x200) |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No indication that audio is locked | Users think notifications are broken, miss alerts | Show banner "Click to enable audio" until unlocked |
| Terminal status flickers rapidly | Visual distraction, unreliable information | Debounce status changes (require stable state for 500ms) |
| Losing input during WebSocket reconnection | User types commands that vanish, confusion | Queue input, show "Reconnecting..." indicator, flush on reconnect |
| Stale Git branch/directory in header | Misleading information, wrong context | Either keep it updated (OSC) or label "initial directory" to set expectations |
| No visual indication which terminal is active | Click in terminal A, start typing, text goes to B | Highlight active terminal border, show focus indicator |
| Scrollback replay causes "screen jump" | Disorienting, user loses context | Mark replay boundary, scroll to bottom after replay |
| Silent failure when PTY spawn fails | Black screen, no error, user doesn't know what happened | Show error message in terminal tile: "Failed to spawn PTY: [reason]" |
| All terminals look identical | Hard to identify which is which | Show working directory, Git branch, custom labels in header |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Terminal creation:** Works in tests, but fails to check for Windows directory locking (spawn workaround needed)
- [ ] **PTY kill:** Appears to work, but leaves zombie processes (missing await, SIGKILL timeout)
- [ ] **Resize handling:** Works most of the time, but crashes on exited PTYs (missing exit state check)
- [ ] **Scrollback buffer:** Works for short sessions, but explodes memory (missing bounded buffer)
- [ ] **WebSocket output:** Works on localhost, but drops data on slow network (missing backpressure)
- [ ] **Audio notifications:** Works for developer, but fails for users (missing autoplay unlock)
- [ ] **Status detection:** Works with default prompt, but breaks with custom themes (missing OSC integration or hybrid approach)
- [ ] **Session persistence:** Saves sessions successfully, but crashes on restore (missing initialization check)
- [ ] **Multiple terminals:** One terminal is smooth, six terminals are janky (missing canvas renderer)
- [ ] **WebSocket reconnection:** Reconnects successfully, but shows duplicate output (missing replay protocol)
- [ ] **Working directory display:** Shows directory at spawn, but never updates (missing OSC 7 or documented limitation)
- [ ] **Git branch display:** Shows branch at spawn, but stale after checkout (missing OSC or documented limitation)

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Unbounded scrollback memory leak | MEDIUM | Restart server, implement bounded buffer, redeploy |
| Zombie process accumulation | LOW | Kill zombies manually (`pkill -9 conhost`), add await to kill(), redeploy |
| WebSocket backpressure data loss | HIGH | No recovery - data lost, implement backpressure, educate users |
| Audio autoplay blocked | LOW | Show UI prompt for user to click, unlock audio |
| Status detection broken by custom prompt | MEDIUM | Disable status feature, implement OSC integration, ask user to configure shell |
| Session restore crash | LOW | Delete corrupted session files, add validation, redeploy |
| xterm.js performance degradation | MEDIUM | Reload page, reduce terminal count, implement canvas renderer |
| PTY resize crash | MEDIUM | Restart server, add exit check, redeploy |
| Duplicate output on reconnection | LOW | Reload page (clears terminal), implement replay protocol, redeploy |
| Stale Git branch display | LOW | Refresh page, implement OSC integration or accept limitation |
| WebSocket reconnection loses input | HIGH | Input lost forever, queue input on client, redeploy |
| Working directory detection broken | MEDIUM | Restart terminals, implement OSC 7, or accept limitation |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| ConoutConnection worker thread leak | Phase 1 (Terminal Spawning) | Kill terminal, verify conhost.exe terminates within 3s |
| Resize exited PTY crash | Phase 1 (Terminal Spawning) | Kill terminal, disconnect/reconnect WebSocket, resize - no crash |
| Scrollback memory explosion | Phase 1 (Terminal Spawning) | Run terminal for 1 hour with verbose output, verify memory < 50MB |
| xterm.js performance degradation | Phase 2 (Grid Layout) | Run 10 terminals, verify 60 FPS scrolling, CPU < 30% |
| WebSocket backpressure | Phase 3 (WebSocket) | Throttle network to 100kbps, verify no data loss |
| Browser autoplay blocked | Phase 4 (Alerts) | Load page, verify audio unlock prompt, click, verify notification plays |
| PTY output parsing fragility | Phase 4 (Status Detection) | Test with bash/PowerShell/fish, custom prompts, verify hybrid approach |
| Session persistence crash | Phase 5 (Persistence) | Save uninitialized terminal, restart server, verify graceful skip |
| WebSocket reconnection duplicates | Phase 3 (WebSocket) | Disconnect/reconnect, verify output not duplicated |
| Zombie process accumulation | Phase 1 (Terminal Spawning) | Kill 10 terminals, verify all PTY processes terminated |
| Working directory detection | Phase 1 → Phase 4+ | Phase 1: Static spawn dir. Phase 4+: OSC 7 integration |
| Git branch detection | Phase 2 → Phase 4+ | Phase 2: Static spawn branch. Phase 4+: OSC integration |

---

## Sources

### Critical Pitfalls - node-pty Windows Issues
- [Unable to kill pty process on Windows · Issue #437](https://github.com/microsoft/node-pty/issues/437)
- [Host conout socket in a worker · Pull Request #415](https://github.com/microsoft/node-pty/pull/415)
- [node-pty - npm](https://www.npmjs.com/package/node-pty)

### Critical Pitfalls - xterm.js Performance
- [Buffer performance improvements · Issue #791](https://github.com/xtermjs/xterm.js/issues/791)
- [Prevent memory leaks when Terminal.dispose is called · Issue #1518](https://github.com/xtermjs/xterm.js/issues/1518)
- [Poor performance when terminal+canvas renderer is on a very wide container · Issue #4175](https://github.com/xtermjs/xterm.js/issues/4175)
- [Integrated Terminal Performance Improvements](https://code.visualstudio.com/blogs/2017/10/03/terminal-renderer)
- [How Is New Terminal In VS Code So Fast?](https://weihanglo.tw/posts/2017/how-is-new-terminal-in-vs-code-so-fast/)

### Critical Pitfalls - WebSocket Backpressure
- [How to Implement Reconnection Logic for WebSockets](https://oneuptime.com/blog/post/2026-01-27-websocket-reconnection-logic/view)
- [Backpressure in WebSocket Streams – What Nobody Talks About](https://skylinecodes.substack.com/p/backpressure-in-websocket-streams)
- [Node.js + WebSockets Backpressure: Flow-Control Patterns](https://medium.com/@hadiyolworld007/node-js-websockets-backpressure-flow-control-patterns-for-stable-real-time-apps-27ab522a9e69)

### Critical Pitfalls - PTY Output Parsing
- [Inexplicable ANSI escape sequences in output of jobs with pty on win32 · Issue #11726](https://github.com/neovim/neovim/issues/11726)
- [Some ANSI sequences are treated strangely on Windows · Issue #475](https://github.com/microsoft/node-pty/issues/475)
- [VT100.net: A parser for DEC's ANSI-compatible video terminals](https://vt100.net/emu/dec_ansi_parser)

### Critical Pitfalls - Session Persistence
- [Session persistence will crash the Terminal if you've got uninitialized panes · Issue #16995](https://github.com/microsoft/terminal/issues/16995)
- [GitHub - neurosnap/zmx: Session persistence for terminal processes](https://github.com/neurosnap/zmx)

### Critical Pitfalls - Browser Autoplay
- [Bypassing Browser Autoplay Restrictions](https://medium.com/@harryespant/bypassing-browser-autoplay-restrictions-a-smart-approach-to-notification-sounds-9e14ca34e5c5)
- [Autoplay policy in Chrome](https://developer.chrome.com/blog/autoplay)
- [Autoplay guide for media and Web Audio APIs - MDN](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)

### Critical Pitfalls - Memory Management
- [Finding and Fixing Ghostty's Largest Memory Leak](https://mitchellh.com/writing/ghostty-memory-leak-fix)
- [Terminal Scrollback Buffer Rewind Lag in Claude Code + Tmux · Issue #4851](https://github.com/anthropics/claude-code/issues/4851)
- [Scrollback memory pre-allocation and optimization · Issue #1236](https://github.com/alacritty/alacritty/issues/1236)

### Shell Integration & OSC Sequences
- [iTerm2 Shell Integration Protocol](https://gist.github.com/tep/e3f3d384de40dbda932577c7da576ec3)
- [Shell integration in the Windows Terminal](https://devblogs.microsoft.com/commandline/shell-integration-in-the-windows-terminal/)
- [Terminal Shell Integration - VS Code](https://code.visualstudio.com/docs/terminal/shell-integration)

### WebSocket Ordering & Race Conditions
- [WebSockets guarantee order - so why are my messages scrambled?](https://www.sitongpeng.com/writing/websockets-guarantee-order-so-why-are-my-messages-scrambled)
- [Is the order of messages guaranteed? · Issue #542](https://github.com/websockets/ws/issues/542)

### Zombie Processes
- [How to Fix 'Zombie Process' Issues in Linux](https://oneuptime.com/blog/post/2026-01-24-fix-zombie-process-issues/view)
- [What Happens to Processes When Parent Die? Zombie and Orphan Explained](https://medium.com/@mubeenulhassan.dev/what-happens-to-processes-when-parent-die-zombie-and-orphan-explained-101e98b0a3dd)

### Reference Implementation
- C:\Dev\claude-terminal-overseer\server\src\terminal\session.ts (Windows workarounds already implemented)

---
*Pitfalls research for: Claude PowerTerminal*
*Researched: 2026-02-24*
