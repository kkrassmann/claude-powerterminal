# Phase 1: Core PTY Infrastructure - Research

**Researched:** 2026-02-24
**Domain:** Node.js PTY management, Windows process handling, session persistence
**Confidence:** HIGH

## Summary

Phase 1 focuses on spawning and managing Claude CLI PTY processes with Windows-specific workarounds and crash recovery through session persistence. The standard stack is **node-pty** (Microsoft's pseudoterminal library) with JSON-based session storage. Windows PTY management has well-documented challenges (orphaned conhost.exe, SIGKILL emulation, worker thread cleanup) that require specific workarounds.

Key technical decisions are locked: auto-restore all sessions on startup via `--resume` with staggered spawning, JSON file storage with immediate writes, manual close = permanent deletion. The implementation must handle Windows-specific PTY termination patterns (graceful kill with force fallback, conhost.exe cleanup, process tree termination).

**Primary recommendation:** Use node-pty for cross-platform PTY support with Windows ConPTY mode (auto-enabled on Windows 10 1809+), implement force-kill timeout pattern for Windows process cleanup, use BehaviorSubject-based Angular service for session state management, and persist sessions as JSON with synchronous writes on every change.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Session Restore on App Startup:** All saved sessions auto-restore immediately on app start via `--resume` flag. No user prompt or selection — everything restores automatically. Sessions start staggered (e.g., 2 second delay between each) to avoid CPU/RAM spikes. If `--resume` fails, automatically start a new Claude session in the same working directory (transparent fallback). No session limit — user can run as many sessions as they want.

- **Terminal Lifecycle:** Session persistence is ONLY for crash/restart recovery. When user manually closes a session: PTY process is killed AND session data is deleted permanently. Confirm dialog before killing a terminal ("Terminal schliessen?"). No "inactive sessions" list — closed means gone.

- **New Session Creation:** Directory selection via dropdown of recently used directories + freetext input for new paths. Standard CLI flags exposed as checkboxes (e.g., `--dangerously-skip-permissions`, `--verbose`). Additional freetext field for custom/arbitrary flags. Global default flags configurable in app settings, overridable per session at creation time.

- **Persistence Strategy:** Storage: JSON file (sessions.json) in app directory — no migrations, easy to debug. Data per session: Session-ID, working directory, CLI flags, creation timestamp. Scrollback buffer NOT persisted to disk (only in-memory during session lifetime). Write immediately on every change (create, close) — no periodic batching. App config (global default flags, etc.) stored in separate config file (JSON), not in sessions.json.

### Claude's Discretion
- Windows kill behavior: force-kill timeout and conhost.exe cleanup approach
- Scrollback buffer size (10k lines as starting point from success criteria)
- Exact stagger timing for session restore
- JSON file format / structure details
- Error notification approach for kill failures

### Deferred Ideas (OUT OF SCOPE)
- Auto-workspace from Git (clone repo + checkout branch for reviews) — user initially requested but pulled back. Could be a future phase for streamlined code review setup
- Browse dialog for directory selection — could enhance UX later but freetext + recent is sufficient for v1
</user_constraints>

<phase_requirements>
## Phase Requirements

This phase MUST implement the following requirements from REQUIREMENTS.md:

| ID | Description | Research Support |
|----|-------------|-----------------|
| TERM-01 | User can create a new terminal session by selecting a working directory and spawning Claude CLI with `--session-id` | node-pty spawn() API with cwd option, Claude CLI `--session-id` flag for new sessions |
| TERM-04 | User can close/kill a terminal session from the UI with proper PTY cleanup (Windows SIGKILL timeout) | pty.kill() with force-kill timeout fallback, taskkill /F /T for Windows process tree cleanup |
| SESS-01 | App saves Claude CLI session IDs and working directories to persistent storage on session creation | fs.writeFileSync() for immediate JSON persistence, session metadata structure |
| SESS-02 | On app restart, user can restore all previous sessions via Claude CLI `--resume` flag | Claude CLI `--resume <session-id>` for restoration, staggered spawn pattern |
| SESS-03 | App detects when a resumed session fails and notifies the user | Monitor pty.onExit() during resume, fallback to fresh session in same cwd |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-pty | 1.1.0+ | PTY process spawning and management | Official Microsoft implementation, cross-platform (Windows ConPTY, Unix ptys), TypeScript support, active maintenance |
| node-addon-api | ^7.1.0 | Native addon dependency for node-pty | Required peer dependency for node-pty's native bindings |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Angular Services | (built-in) | Session state management and PTY lifecycle | Standard Angular pattern for shared state, works well with BehaviorSubject for reactive updates |
| fs (Node.js) | (built-in) | JSON file persistence | Synchronous writes (fs.writeFileSync) for immediate durability, no external dependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node-pty | node-pty-prebuilt-multiarch | Prebuilt binaries avoid compilation, but less flexible for custom configurations and may lag behind official releases |
| JSON files | SQLite/LevelDB | Better query performance and transactions, but adds complexity and migration burden for simple session storage |
| Angular Services | NgRx/Akita | More structured state management for complex apps, but overkill for simple session list with CRUD operations |

**Installation:**
```bash
npm install node-pty@^1.1.0
```

Note: Requires Windows Build Tools (Windows SDK, Visual Studio Build Tools) for native compilation on Windows. Node.js 16+ required.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   ├── services/
│   │   ├── pty-manager.service.ts      # PTY lifecycle (spawn, kill, resize)
│   │   ├── session-manager.service.ts  # Session persistence (save, load, restore)
│   │   └── session-state.service.ts    # In-memory session state (BehaviorSubject)
│   ├── models/
│   │   ├── session.model.ts            # Session metadata interface
│   │   └── pty-config.model.ts         # PTY spawn options interface
│   └── components/
│       └── session-create/             # Directory selection + flag configuration UI
├── electron/
│   ├── main.ts                         # Electron main process entry
│   ├── ipc/
│   │   └── pty-handlers.ts            # IPC handlers for PTY operations
│   └── utils/
│       └── process-cleanup.ts         # Windows-specific kill logic
└── shared/
    └── ipc-channels.ts                 # Typed IPC channel definitions
```

### Pattern 1: PTY Process Lifecycle Management
**What:** Spawn PTY processes via Electron main process, communicate via IPC, manage lifecycle events
**When to use:** Always — renderer process cannot access node-pty (requires Node.js APIs)
**Example:**
```typescript
// electron/ipc/pty-handlers.ts
import * as pty from 'node-pty';
import { ipcMain } from 'electron';

interface PTYSpawnOptions {
  sessionId: string;
  cwd: string;
  flags: string[];
}

const ptyProcesses = new Map<string, pty.IPty>();

ipcMain.handle('pty:spawn', async (event, options: PTYSpawnOptions) => {
  const { sessionId, cwd, flags } = options;

  // Environment sanitization: remove CLAUDECODE vars
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDECODE_SESSION_ID;

  const ptyProcess = pty.spawn('claude', ['--session-id', sessionId, ...flags], {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd,
    env,
    useConpty: true, // Windows ConPTY mode (auto-enabled on Win10 1809+)
  });

  ptyProcesses.set(sessionId, ptyProcess);

  // Stream output to renderer
  ptyProcess.onData((data) => {
    event.sender.send('pty:data', { sessionId, data });
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    event.sender.send('pty:exit', { sessionId, exitCode, signal });
    ptyProcesses.delete(sessionId);
  });

  return { pid: ptyProcess.pid };
});
```

### Pattern 2: Session Persistence with Immediate Writes
**What:** Save session metadata to JSON file synchronously on every change (create, close)
**When to use:** Always — ensures durability, prevents data loss on crash
**Example:**
```typescript
// app/services/session-manager.service.ts
import { Injectable } from '@angular/core';
import * as fs from 'fs';
import * as path from 'path';

interface SessionMetadata {
  sessionId: string;
  workingDirectory: string;
  cliFlags: string[];
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class SessionManagerService {
  private readonly sessionsFilePath = path.join(app.getPath('userData'), 'sessions.json');

  saveSession(session: SessionMetadata): void {
    const sessions = this.loadSessions();
    sessions.push(session);
    // Synchronous write for immediate durability
    fs.writeFileSync(this.sessionsFilePath, JSON.stringify(sessions, null, 2), 'utf8');
  }

  deleteSession(sessionId: string): void {
    const sessions = this.loadSessions().filter(s => s.sessionId !== sessionId);
    fs.writeFileSync(this.sessionsFilePath, JSON.stringify(sessions, null, 2), 'utf8');
  }

  loadSessions(): SessionMetadata[] {
    try {
      const data = fs.readFileSync(this.sessionsFilePath, 'utf8');
      return JSON.parse(data);
    } catch {
      return []; // File doesn't exist or invalid JSON
    }
  }
}
```

### Pattern 3: Windows-Specific Process Kill with Timeout
**What:** Attempt graceful kill (SIGHUP), wait with timeout, force-kill with taskkill if needed
**When to use:** Always on Windows — prevents orphaned conhost.exe processes
**Example:**
```typescript
// electron/utils/process-cleanup.ts
import { IPty } from 'node-pty';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function killPtyProcess(ptyProcess: IPty, timeoutMs = 3000): Promise<void> {
  const pid = ptyProcess.pid;

  // Attempt graceful kill (SIGHUP on Unix, unconditional termination on Windows)
  ptyProcess.kill();

  // Wait for process to exit
  const exitPromise = new Promise<void>((resolve) => {
    ptyProcess.onExit(() => resolve());
  });

  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });

  await Promise.race([exitPromise, timeoutPromise]);

  // Force-kill if still running (Windows-specific)
  if (process.platform === 'win32') {
    try {
      // /F = force, /T = terminate process tree (kills child processes including conhost.exe)
      await execAsync(`taskkill /PID ${pid} /T /F`);
    } catch (error) {
      // Process already terminated or doesn't exist
      console.warn(`Force-kill failed for PID ${pid}:`, error);
    }
  }
}
```

### Pattern 4: Staggered Session Restore on Startup
**What:** Load saved sessions, spawn PTY processes sequentially with delay to avoid CPU spike
**When to use:** App startup — prevents system overload when restoring many sessions
**Example:**
```typescript
// app/services/session-manager.service.ts
async restoreAllSessions(): Promise<void> {
  const sessions = this.loadSessions();

  for (const session of sessions) {
    try {
      // Attempt --resume first
      await this.spawnSession({
        sessionId: session.sessionId,
        cwd: session.workingDirectory,
        flags: ['--resume', session.sessionId, ...session.cliFlags],
      });
    } catch (error) {
      // Fallback: start fresh session in same directory
      console.warn(`Resume failed for ${session.sessionId}, starting fresh:`, error);
      await this.spawnSession({
        sessionId: session.sessionId,
        cwd: session.workingDirectory,
        flags: session.cliFlags,
      });
    }

    // Stagger spawns (2 second delay recommended)
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
```

### Pattern 5: Circular Buffer for Scrollback
**What:** Fixed-size array for terminal output, overwrite oldest data when full
**When to use:** Always — prevents memory explosion with long-running terminals
**Example:**
```typescript
// app/services/scrollback-buffer.service.ts
export class ScrollbackBuffer {
  private buffer: string[] = [];
  private readonly maxLines: number;
  private head = 0; // Write position

  constructor(maxLines = 10000) {
    this.maxLines = maxLines;
  }

  append(line: string): void {
    if (this.buffer.length < this.maxLines) {
      this.buffer.push(line);
    } else {
      // Overwrite oldest line
      this.buffer[this.head] = line;
      this.head = (this.head + 1) % this.maxLines;
    }
  }

  getLines(): string[] {
    // Return lines in chronological order
    if (this.buffer.length < this.maxLines) {
      return this.buffer;
    }
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
  }

  clear(): void {
    this.buffer = [];
    this.head = 0;
  }
}
```

### Anti-Patterns to Avoid
- **Spawn PTY from renderer process:** Node.js APIs unavailable in renderer, security risk, violates Electron process model
- **Async writes for session persistence:** Risk data loss on crash, defeats purpose of persistence
- **Skip process tree termination on Windows:** Leaves orphaned conhost.exe processes consuming memory
- **Single-threaded session restore:** CPU spike on startup with many sessions, UI freezes
- **Unlimited scrollback buffer:** Memory explosion with long-running sessions, crashes app

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PTY process spawning | Custom fork/exec wrapper with pseudo-terminal emulation | node-pty | Cross-platform PTY handling is complex (Windows ConPTY vs Unix ptys), signal handling, resize events, encoding. Microsoft maintains node-pty with production testing. |
| Process cleanup on Windows | Simple process.kill() | pty.kill() + taskkill fallback with /T flag | Windows doesn't support Unix signals, child processes (conhost.exe) aren't killed by parent termination, requires process tree termination with /T flag. |
| Circular buffer | Array with manual index tracking | Existing libraries (ring-buffer-ts, cbuffer) OR simple implementation | Off-by-one errors, thread safety, edge cases. For 10k lines, simple implementation is fine. For complex use cases, use library. |
| Session restore timing | Promise.all() for parallel spawns | Sequential spawns with setTimeout() | Parallel PTY spawns cause CPU/RAM spikes, system thrashing, potential OOM. Staggered spawns keep system responsive. |

**Key insight:** Windows PTY management has unique challenges (signal emulation, ConPTY API, conhost.exe lifecycle) that aren't obvious from Unix experience. Use platform-specific handling rather than assuming cross-platform behavior.

## Common Pitfalls

### Pitfall 1: Orphaned conhost.exe Processes on Windows
**What goes wrong:** Killing PTY process leaves conhost.exe running, consuming memory and holding resources
**Why it happens:** Windows ConPTY architecture spawns conhost.exe as separate process, parent termination doesn't kill children by default
**How to avoid:** Use taskkill with /T (tree) and /F (force) flags after graceful kill timeout
**Warning signs:** Task Manager shows multiple conhost.exe processes after closing terminals, memory usage grows over time

### Pitfall 2: Environment Variable Inheritance Breaking Nested Claude
**What goes wrong:** Spawned Claude CLI inherits CLAUDECODE environment variables, crashes or refuses to start
**Why it happens:** Claude CLI detects parent Claude session via CLAUDECODE=1, rejects nested sessions to prevent conflicts
**How to avoid:** Explicitly delete CLAUDECODE-related environment variables before spawning PTY
**Warning signs:** Claude CLI exits immediately with error about nested sessions, logs mention CLAUDECODE variable

### Pitfall 3: Synchronous File Writes Blocking UI
**What goes wrong:** App freezes when saving sessions, especially with many sessions or slow disk
**Why it happens:** fs.writeFileSync() blocks Node.js event loop until write completes
**How to avoid:** Run file I/O in Electron main process, use IPC for async communication with renderer
**Warning signs:** UI stutters when creating/closing sessions, input lag during session operations

### Pitfall 4: Race Condition in Session Restore
**What goes wrong:** --resume fails because session file hasn't been written yet by previous Claude instance
**Why it happens:** Async writes complete after session is saved to app's sessions.json, Claude CLI can't find session
**How to avoid:** Use synchronous writes (fs.writeFileSync) for session creation, verify session exists before --resume
**Warning signs:** Resume failures immediately after app restart, "session not found" errors despite sessions.json having the ID

### Pitfall 5: Memory Leak in Scrollback Buffer
**What goes wrong:** App memory usage grows unbounded with long-running terminals, eventual crash
**Why it happens:** Appending all PTY output to array/string without limit, no garbage collection
**How to avoid:** Implement circular buffer with fixed size (10k lines recommended), overwrite oldest data
**Warning signs:** Memory usage grows linearly with terminal output, slowdowns after hours of operation

### Pitfall 6: PTY Resize on Windows Crashes Terminal
**What goes wrong:** Calling pty.resize() on Windows causes terminal to hang or crash
**Why it happens:** Windows ConPTY resize race condition between frontend and backend state, documented issue
**How to avoid:** For Phase 1 (fixed-size terminals), don't call resize(). For Phase 2+, call pty.clear() on Windows after resize to sync state
**Warning signs:** Terminal stops responding after resize, garbled output after window size changes

### Pitfall 7: Session ID Collision on Restore
**What goes wrong:** Multiple sessions restore with same ID, processes conflict, data corruption
**Why it happens:** Using timestamp/counter for session ID instead of UUID, concurrent session creation
**How to avoid:** Use UUIDs (crypto.randomUUID()) for session IDs, validate uniqueness before spawn
**Warning signs:** Claude CLI errors about duplicate sessions, multiple terminals showing same session

## Code Examples

Verified patterns from official sources and production implementations:

### Spawning Claude CLI with node-pty (Windows)
```typescript
// Source: node-pty API documentation (https://www.jsdocs.io/package/node-pty)
import * as pty from 'node-pty';
import { randomUUID } from 'crypto';

const sessionId = randomUUID();
const workingDirectory = 'C:\\Users\\username\\projects\\my-app';

const ptyProcess = pty.spawn('claude', ['--session-id', sessionId], {
  name: 'xterm-256color',
  cols: 80,
  rows: 30,
  cwd: workingDirectory,
  env: {
    ...process.env,
    CLAUDECODE: '', // Override inherited CLAUDECODE to prevent nested session rejection
  },
  useConpty: true, // Auto-enabled on Windows 10 1809+, no need to check version
});

// Listen for output
ptyProcess.onData((data: string) => {
  console.log('Output:', data);
});

// Listen for exit
ptyProcess.onExit(({ exitCode, signal }) => {
  console.log(`Process exited with code ${exitCode}, signal ${signal}`);
});

// Write input to terminal
ptyProcess.write('Hello Claude!\n');

// Resize terminal (Phase 2+)
ptyProcess.resize(120, 40);
```

### Resuming Claude CLI Session
```typescript
// Source: Claude CLI reference (https://code.claude.com/docs/en/cli-reference)
const existingSessionId = '550e8400-e29b-41d4-a716-446655440000';

const ptyProcess = pty.spawn('claude', ['--resume', existingSessionId], {
  name: 'xterm-256color',
  cols: 80,
  rows: 30,
  cwd: workingDirectory,
  env: {
    ...process.env,
    CLAUDECODE: '',
  },
});

// Monitor for resume failure (exit within first few seconds)
const resumeTimeout = setTimeout(() => {
  console.log('Resume successful');
}, 5000);

ptyProcess.onExit(({ exitCode }) => {
  clearTimeout(resumeTimeout);
  if (exitCode !== 0) {
    console.error('Resume failed, starting fresh session');
    // Spawn new session with same working directory
  }
});
```

### Windows Process Tree Termination
```typescript
// Source: Windows taskkill documentation (https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill)
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function forceKillProcessTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    return; // Unix platforms don't need this
  }

  try {
    // /F = force termination
    // /T = terminate process tree (kills all child processes)
    // /PID = target process ID
    await execAsync(`taskkill /PID ${pid} /T /F`);
    console.log(`Force-killed process tree for PID ${pid}`);
  } catch (error: any) {
    // Error is expected if process already terminated
    if (!error.message.includes('not found')) {
      console.error(`Failed to force-kill PID ${pid}:`, error);
    }
  }
}
```

### Session Metadata JSON Structure
```typescript
// Sessions file: %APPDATA%/claude-powerterminal/sessions.json
interface SessionMetadata {
  sessionId: string;           // UUID from Claude CLI --session-id
  workingDirectory: string;    // Absolute path
  cliFlags: string[];          // Additional flags (--verbose, --dangerously-skip-permissions, etc.)
  createdAt: string;           // ISO 8601 timestamp
}

// Example sessions.json
[
  {
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "workingDirectory": "C:\\Users\\username\\projects\\my-app",
    "cliFlags": ["--verbose"],
    "createdAt": "2026-02-24T10:30:00.000Z"
  },
  {
    "sessionId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "workingDirectory": "C:\\Users\\username\\projects\\other-app",
    "cliFlags": ["--dangerously-skip-permissions"],
    "createdAt": "2026-02-24T11:15:00.000Z"
  }
]
```

### Electron IPC Type-Safe Handlers
```typescript
// shared/ipc-channels.ts
export const IPC_CHANNELS = {
  PTY_SPAWN: 'pty:spawn',
  PTY_WRITE: 'pty:write',
  PTY_KILL: 'pty:kill',
  PTY_RESIZE: 'pty:resize',
  PTY_DATA: 'pty:data',
  PTY_EXIT: 'pty:exit',
  SESSION_SAVE: 'session:save',
  SESSION_LOAD: 'session:load',
  SESSION_DELETE: 'session:delete',
} as const;

// electron/main.ts
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';

ipcMain.handle(IPC_CHANNELS.PTY_SPAWN, async (event, options) => {
  // Spawn PTY process
  return { success: true, pid };
});

ipcMain.handle(IPC_CHANNELS.SESSION_SAVE, async (event, session) => {
  // Save session to JSON
  return { success: true };
});

// app/services/pty-manager.service.ts (Angular)
import { Injectable } from '@angular/core';
import { IPC_CHANNELS } from '../../shared/ipc-channels';

declare const window: Window & {
  electronAPI: {
    invoke: (channel: string, ...args: any[]) => Promise<any>;
    on: (channel: string, callback: (...args: any[]) => void) => void;
  };
};

@Injectable({ providedIn: 'root' })
export class PtyManagerService {
  async spawnSession(options: PTYSpawnOptions): Promise<{ pid: number }> {
    return window.electronAPI.invoke(IPC_CHANNELS.PTY_SPAWN, options);
  }

  listenForOutput(callback: (data: { sessionId: string; data: string }) => void): void {
    window.electronAPI.on(IPC_CHANNELS.PTY_DATA, callback);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WinPTY (separate DLL) | ConPTY (built into Windows) | Windows 10 1809 (2018) | Native Windows PTY support, better performance, fewer workarounds. node-pty auto-detects and uses ConPTY on supported systems. |
| Manual signal handling on Windows | pty.kill() + taskkill fallback | node-pty 0.9.0+ (2019) | Simplified kill logic, but still requires taskkill for process tree termination. |
| Promise.all() for parallel operations | Staggered sequential operations | Best practice (2020+) | Prevents CPU spikes, respects system resources. Especially important for PTY spawns (heavy operations). |
| Interval-based persistence | Immediate writes | Modern Node.js (fs.writeFileSync) | Ensures durability, simplifies code. Trade-off: blocks event loop briefly, mitigated by running in main process. |

**Deprecated/outdated:**
- **WinPTY explicit usage:** node-pty auto-detects ConPTY availability, manual WinPTY configuration no longer needed
- **useConpty: false option:** Only needed for Windows 7/8 (unsupported), modern apps should use ConPTY
- **node-pty < 1.0:** Versions before 1.0 had API inconsistencies, TypeScript issues. Always use 1.1.0+

## Open Questions

1. **Optimal stagger timing for session restore**
   - What we know: User specified "e.g., 2 second delay" as starting point, goal is preventing CPU/RAM spikes
   - What's unclear: Whether 2s is optimal, whether delay should vary based on system load or session count
   - Recommendation: Start with 2000ms, add configuration option for users to adjust, consider adaptive timing in future (measure CPU usage, adjust dynamically)

2. **Force-kill timeout value**
   - What we know: Need timeout between graceful kill and taskkill force, Claude CLI should exit quickly when killed
   - What's unclear: Optimal timeout for Claude CLI (1s? 3s? 5s?), whether timeout should be configurable
   - Recommendation: Start with 3000ms (3 seconds), add configuration option, log actual exit times to inform future defaults

3. **Error notification approach for kill failures**
   - What we know: User marked this as "Claude's Discretion", need to notify when taskkill fails
   - What's unclear: UI pattern (toast, dialog, inline), retry strategy, whether to attempt cleanup at next startup
   - Recommendation: Non-blocking toast notification ("Failed to close terminal [sessionId]"), log error details for debugging, attempt cleanup on next startup (check for orphaned processes matching saved session PIDs)

4. **Scrollback buffer implementation details**
   - What we know: 10k lines as starting point, circular buffer pattern, in-memory only
   - What's unclear: Line splitting strategy (split on \n? \r\n? handle ANSI sequences?), whether to buffer raw output or parsed lines
   - Recommendation: Buffer raw output chunks, split on \n for line count tracking, let terminal emulator handle ANSI. 10k lines = ~500KB-1MB typical (50-100 bytes/line average), acceptable memory footprint.

## Sources

### Primary (HIGH confidence)
- [node-pty GitHub Repository](https://github.com/microsoft/node-pty) - Official Microsoft node-pty project
- [node-pty API Documentation (jsDocs.io)](https://www.jsdocs.io/package/node-pty) - Complete TypeScript API reference
- [Claude CLI Reference](https://code.claude.com/docs/en/cli-reference) - Official Claude CLI documentation with --session-id, --resume flags
- [Windows taskkill Command Reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill) - Official Microsoft documentation for process termination
- [Electron Process Model Documentation](https://www.electronjs.org/docs/latest/tutorial/process-model) - Official Electron architecture guide
- [Electron IPC Documentation](https://www.electronjs.org/docs/latest/tutorial/ipc) - Official inter-process communication patterns

### Secondary (MEDIUM confidence)
- [node-pty npm Package](https://www.npmjs.com/package/node-pty) - Package metadata, version information
- [node-pty Issue #437 - Unable to kill pty process on Windows](https://github.com/microsoft/node-pty/issues/437) - Community-reported Windows kill issues
- [Windows ConPTY Issue #4050 - ClosePseudoConsole() leaves lingering conhost.exe](https://github.com/microsoft/terminal/issues/4050) - Upstream Windows Terminal issue documenting conhost.exe orphaning
- [Claude Agent SDK Issue #573 - CLAUDECODE environment variable in subprocesses](https://github.com/anthropics/claude-agent-sdk-python/issues/573) - Documented solution for nested Claude sessions
- [LogRocket: Electron IPC Response/Request architecture with TypeScript](https://blog.logrocket.com/electron-ipc-response-request-architecture-with-typescript/) - Type-safe IPC patterns
- [LogRocket: Advanced Electron.js architecture](https://blog.logrocket.com/advanced-electron-js-architecture/) - Backend service architecture patterns

### Tertiary (LOW confidence)
- [Snyk: node-pty Code Examples](https://snyk.io/advisor/npm-package/node-pty/example) - Community examples
- [ring-buffer-ts GitHub](https://github.com/domske/ring-buffer-ts) - TypeScript circular buffer reference implementation
- [Exercism: Circular Buffer in TypeScript](https://exercism.org/tracks/typescript/exercises/circular-buffer) - Educational circular buffer implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - node-pty is official Microsoft library, well-documented, production-tested
- Architecture: HIGH - Patterns verified from official Electron/node-pty documentation and reference implementations
- Pitfalls: HIGH - Windows PTY issues documented in official node-pty and Windows Terminal issue trackers
- Claude CLI flags: HIGH - Verified from official Claude CLI documentation
- Circular buffer: MEDIUM - Standard CS pattern, multiple implementations available, but specific line-splitting strategy needs validation

**Research date:** 2026-02-24
**Valid until:** 2026-03-26 (30 days - stable domain, node-pty updates infrequent, Windows PTY behavior unlikely to change)
