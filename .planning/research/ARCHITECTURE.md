# Architecture Research

**Domain:** Web-based terminal management dashboard
**Researched:** 2026-02-24
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser Layer                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │Dashboard │  │Terminal  │  │Terminal  │  │Terminal  │        │
│  │Grid View│  │Renderer  │  │Renderer  │  │Renderer  │        │
│  │          │  │(xterm.js)│  │(xterm.js)│  │(xterm.js)│        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │              │              │              │
│       └─────────────┴──────────────┴──────────────┘              │
│                     │                                            │
│              WebSocket Streams (binary)                          │
│                     │                                            │
├─────────────────────┴────────────────────────────────────────────┤
│                     Node.js Server                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │TerminalManager │  │SessionStore    │  │WebSocketBroadcast│  │
│  │ (PTY lifecycle)│  │ (state)        │  │ (events)         │  │
│  └───────┬────────┘  └───────┬────────┘  └────────┬─────────┘  │
│          │                   │                     │            │
│          ├───creates────────→│                     │            │
│          │                   ├───emits events─────→│            │
│          │                   │                     │            │
├──────────┴───────────────────┴─────────────────────┴────────────┤
│                     Process Layer                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐  ┌────────────┐               │
│  │PTY Process │  │PTY Process │  │PTY Process │               │
│  │(Claude CLI)│  │(Claude CLI)│  │(Claude CLI)│               │
│  └────────────┘  └────────────┘  └────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **TerminalManager** | Owns PTY lifecycle - create, kill, retrieve sessions. Persists Claude session IDs to disk for restart recovery. | Class with Map<id, TerminalSession>, SessionPersistence integration |
| **TerminalSession** | Wraps node-pty IPty with Windows-specific workarounds (neutral directory spawn, forceful kill timeout). Maintains scrollback buffer for reconnection replay. | Class with PTY instance, output handlers, exit handlers |
| **SessionStore** | In-memory session state with reconciliation logic. Tracks active/terminated sessions, linger period before eviction. Emits events for state changes. | EventEmitter with Map<pid, Session>, reconcile() method |
| **SessionScanner** | Hybrid detection: process scan for liveness + session files for metadata (cwd, git branch). PID cache avoids rescanning session files. | Interval-based poller with queryClaudeProcesses(), PID cache Map |
| **WebSocketBroadcaster** | Connects SessionStore events to WebSocket clients. Broadcasts session state changes (added/updated/removed) to all connected browsers. | EventEmitter subscriber forwarding JSON messages to Set<WebSocket> |
| **Terminal Renderer (xterm.js)** | Browser-side terminal emulator. Renders PTY output, captures keyboard input, handles resize, scrollback. GPU-accelerated with WebGL addon. | xterm.js Terminal instance with FitAddon, WebglAddon, WebSocket connection |
| **Dashboard Grid** | Visual overview of all sessions. Shows status indicators (working/waiting/done), triggers audio alerts, provides session creation/termination controls. | Angular component with grid layout, status detection service, notification service |
| **SessionPersistence** | Writes session metadata (Claude session ID, cwd, flags) to JSON file. Loads on server restart to spawn --resume sessions. | JSON file operations with add/remove/load/clear methods |

## Recommended Project Structure

```
server/
├── terminal/              # PTY management
│   ├── manager.ts         # TerminalManager (session lifecycle)
│   ├── session.ts         # TerminalSession (PTY wrapper)
│   ├── persistence.ts     # SessionPersistence (disk storage)
│   ├── index.ts           # WebSocket route registration
│   └── types.ts           # Shared types (TerminalOptions, etc.)
├── store/                 # Session state
│   ├── index.ts           # SessionStore (in-memory state + reconciliation)
│   └── types.ts           # Session, SessionResponse types
├── scanner/               # Auto-detection
│   ├── index.ts           # SessionScanner (hybrid detection orchestrator)
│   ├── process-query.ts   # Windows WMI query for Claude processes
│   ├── session-files.ts   # Claude session file parsing
│   └── types.ts           # RawProcess, SessionFile types
├── websocket/             # Real-time communication
│   ├── index.ts           # WebSocket route registration
│   ├── broadcast.ts       # WebSocketBroadcaster (store→clients)
│   └── protocol.ts        # Message types (SnapshotMessage, etc.)
├── routes/                # REST API
│   ├── sessions.ts        # GET /api/sessions
│   └── terminal.ts        # POST /api/terminal (create), DELETE /api/terminal/:id (kill)
└── server.ts              # Fastify server bootstrap

client/src/app/
├── dashboard/             # Grid overview
│   ├── dashboard.component.ts     # Session grid layout
│   ├── session-tile.component.ts  # Individual session display
│   ├── status-detector.service.ts # PTY output pattern matching + idle heuristic
│   └── audio-alerts.service.ts    # Notification sounds
├── terminal/              # Interactive terminal
│   ├── terminal-container.component.ts  # Tabbed UI (mat-tab-group)
│   ├── terminal-tab.component.ts        # xterm.js instance + WebSocket
│   └── terminal.service.ts              # Session creation/termination API
├── shared/
│   ├── services/
│   │   ├── websocket.service.ts   # WebSocket client with reconnection
│   │   └── session-state.service.ts  # BehaviorSubject store for sessions
│   └── types/
│       └── session.types.ts       # SessionResponse, SessionStatus types
└── core/
    └── layout/
        ├── header.component.ts    # New Session button, navigation
        └── layout.component.ts    # Mat sidenav + router-outlet
```

### Structure Rationale

- **server/terminal/:** Isolates PTY concerns from business logic. TerminalManager is the facade for session lifecycle, TerminalSession encapsulates Windows workarounds.
- **server/store/:** Single source of truth for session state. EventEmitter pattern allows loose coupling with broadcaster and scanner.
- **server/scanner/:** Separation of concerns - process querying (WMI) separate from session file parsing. PID cache optimization lives in orchestrator.
- **server/websocket/:** WebSocket concerns isolated from terminal logic. Broadcaster is stateless event forwarder.
- **client/dashboard/:** Status detection logic lives in service (testable, reusable). Tile component is presentation-only.
- **client/terminal/:** Tabbed container manages lifecycle, individual tab owns xterm.js instance. Service handles API calls.
- **client/shared/:** WebSocket service with RxJS reconnection logic (retryWhen). Session state service provides reactive store for dashboard and terminals.

## Architectural Patterns

### Pattern 1: PTY-to-Browser WebSocket Bridge

**What:** Node-pty output streams over WebSocket as binary data. xterm.js writes to WebSocket for input. Resize control messages sent as JSON.

**When to use:** Always for PTY-based terminals (standard pattern).

**Trade-offs:**
- **Pro:** Full-duplex, low latency, binary efficient, mimics real terminal semantics
- **Con:** Requires WebSocket infrastructure, more complex than REST polling

**Example:**
```typescript
// Server: terminal/index.ts
fastify.get('/terminal/:sessionId', { websocket: true }, (socket, req) => {
  const session = terminalManager.getSession(req.params.sessionId);

  // PTY output → WebSocket binary
  const unsubscribe = session.onData((data: string) => {
    socket.send(Buffer.from(data, 'utf8'));
  });

  // WebSocket input → PTY (with resize control message parsing)
  socket.on('message', (msg: Buffer | string) => {
    const data = Buffer.isBuffer(msg) ? msg.toString('utf8') : msg;
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'resize') {
        session.resize(parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // Not JSON, treat as terminal input
    }
    session.write(data);
  });

  socket.on('close', () => unsubscribe());
});

// Client: terminal-tab.component.ts
this.socket = new WebSocket(`ws://localhost:3000/terminal/${this.sessionId}`);
this.socket.binaryType = 'arraybuffer';

this.socket.onmessage = (event) => {
  this.term.write(new Uint8Array(event.data));
};

this.term.onData((data) => {
  this.socket.send(data);
});
```

### Pattern 2: Scrollback Replay on Reconnection

**What:** TerminalSession maintains permanent scrollback buffer. When WebSocket connects, replay full history before streaming live output.

**When to use:** Always for web terminals where browser may disconnect but PTY persists.

**Trade-offs:**
- **Pro:** Reconnecting client sees full terminal history, no lost output
- **Con:** Memory overhead (10k lines × average 80 chars = ~800KB per session)

**Example:**
```typescript
// terminal/session.ts
export class TerminalSession {
  private scrollback: string[] = [];
  private static readonly MAX_SCROLLBACK = 10000;
  private outputHandlers: ((data: string) => void)[] = [];

  constructor(options: TerminalOptions) {
    this.ptyProcess.onData((data: string) => {
      // Add to permanent scrollback
      this.scrollback.push(data);
      if (this.scrollback.length > TerminalSession.MAX_SCROLLBACK) {
        this.scrollback.splice(0, this.scrollback.length - TerminalSession.MAX_SCROLLBACK);
      }
      // Forward to live handlers
      for (const h of this.outputHandlers) {
        h(data);
      }
    });
  }

  onData(handler: (data: string) => void): () => void {
    // Replay full scrollback to new handler
    for (const data of this.scrollback) {
      handler(data);
    }
    // Register for live output
    this.outputHandlers.push(handler);
    return () => {
      const idx = this.outputHandlers.indexOf(handler);
      if (idx !== -1) this.outputHandlers.splice(idx, 1);
    };
  }
}
```

### Pattern 3: Windows PTY Directory Lock Workaround

**What:** Spawn PTY in neutral directory (C:\Windows\System32), then immediately `cd` to target directory. Prevents Windows ConPTY directory handle lock.

**When to use:** Always on Windows when spawning PTY processes.

**Trade-offs:**
- **Pro:** Users can rename/delete project folders with active terminals
- **Con:** Adds initial `cd` + `cls` commands to scrollback, slight startup delay

**Example:**
```typescript
// terminal/session.ts
constructor(options: TerminalOptions) {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const spawnCwd = options.workingDirectory; // Use target directory directly

  this.ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: options.cols ?? 80,
    rows: options.rows ?? 24,
    cwd: spawnCwd, // Spawn in target directory
    env: process.env,
  });

  // Build and send Claude CLI command
  const command = this.buildCommand(options);
  const newline = process.platform === 'win32' ? '\r' : '\n';
  this.ptyProcess.write(`${command}${newline}`);
}
```

### Pattern 4: Forceful PTY Termination with Worker Thread Cleanup

**What:** Call `ptyProcess.kill()` then set 3-second timeout with `process.kill(pid, 'SIGKILL')`. Ensures ConoutConnection worker thread terminates.

**When to use:** Always when killing Windows PTY processes.

**Trade-offs:**
- **Pro:** Prevents zombie worker threads, clean Node process exit
- **Con:** Delay before termination guaranteed, may kill process abruptly

**Example:**
```typescript
// terminal/session.ts
async kill(): Promise<void> {
  return new Promise<void>((resolve) => {
    let exited = false;

    this.ptyProcess.onExit(() => {
      exited = true;
      this.isExited = true;
      resolve();
    });

    // Attempt graceful kill
    this.ptyProcess.kill();

    // Forceful timeout for worker thread cleanup (3 seconds)
    setTimeout(() => {
      if (!exited) {
        try {
          process.kill(this.ptyProcess.pid, 'SIGKILL');
        } catch (e) {
          // Process may already be dead - ignore error
        }
        this.isExited = true;
        resolve();
      }
    }, 3000);
  });
}
```

### Pattern 5: Session Persistence for Restart Recovery

**What:** TerminalManager writes Claude session metadata (session ID, cwd, flags) to JSON file. On server restart, reads file and spawns `claude --resume` sessions.

**When to use:** For managed sessions (not --continue mode).

**Trade-offs:**
- **Pro:** Claude conversations survive server restarts, seamless user experience
- **Con:** Disk I/O on every session create/terminate, must validate cwd still exists

**Example:**
```typescript
// terminal/manager.ts
createSession(options: TerminalOptions): TerminalSession {
  const session = new TerminalSession(options);
  this.sessions.set(session.id, session);

  // Persist for restart recovery (skip --continue sessions)
  const hasContinue = (options.flags ?? []).includes('--continue');
  if (session.claudeSessionId && !hasContinue) {
    this.persistence.add({
      terminalSessionId: session.id,
      claudeSessionId: session.claudeSessionId,
      workingDirectory: session.workingDirectory,
      createdAt: session.createdAt.toISOString(),
      flags: options.flags ?? [],
    });
  }

  return session;
}

restoreSessions(): TerminalSession[] {
  const persisted = this.persistence.load();
  const restored: TerminalSession[] = [];

  for (const entry of persisted) {
    // Validate working directory still exists
    if (!existsSync(entry.workingDirectory)) continue;

    // Strip flags that conflict with resume
    const flags = entry.flags.filter(f => f !== '--continue' && !f.startsWith('--session-id'));

    const session = this.createSession({
      workingDirectory: entry.workingDirectory,
      flags,
      claudeSessionId: entry.claudeSessionId,
      resuming: true,
    });

    restored.push(session);
  }

  return restored;
}
```

### Pattern 6: Hybrid Detection (Process Scan + Session Files)

**What:** SessionScanner uses process query for liveness + session file parsing for metadata. PID cache avoids rescanning files.

**When to use:** For auto-detecting existing Claude CLI sessions not spawned by the manager.

**Trade-offs:**
- **Pro:** Fast after first scan (cached PIDs), accurate metadata (git branch, cwd)
- **Con:** Heuristic matching (process start time ±10s), may miss very old sessions

**Example:**
```typescript
// scanner/index.ts
private async scan(): Promise<void> {
  // Step 1: Get running processes
  const rawProcesses = await queryClaudeProcesses();

  // Step 2: Find processes not yet in cache
  const uncachedProcesses = rawProcesses.filter(
    p => !this.pidCache.has(p.ProcessId)
  );

  // Step 3: Only scan session files for uncached processes
  if (uncachedProcesses.length > 0) {
    const sessionFiles = await getAllSessionFiles();
    for (const proc of uncachedProcesses) {
      const match = findMatchingSession(new Date(proc.CreationDate), sessionFiles);
      if (match) {
        this.pidCache.set(proc.ProcessId, {
          cwd: match.cwd,
          gitBranch: match.gitBranch,
        });
      }
    }
  }

  // Step 4: Build live processes from cache
  const liveProcesses = rawProcesses.map(proc => ({
    pid: proc.ProcessId,
    workingDirectory: this.pidCache.get(proc.ProcessId)?.cwd || 'unknown',
    gitBranch: this.pidCache.get(proc.ProcessId)?.gitBranch || null,
    startTime: new Date(proc.CreationDate),
  }));

  // Step 5: Reconcile with store
  this.store.reconcile(liveProcesses);
}
```

### Pattern 7: Status Detection (Pattern Matching + Idle Timeout)

**What:** Watch PTY output for Claude prompt indicators (e.g., "^assistant>", thinking phase markers). Combine with idle timeout heuristic (no output for N seconds = waiting).

**When to use:** For visual status indicators (working/waiting/done).

**Trade-offs:**
- **Pro:** More accurate than pure timeout, less fragile than pure pattern matching
- **Con:** Prompt patterns may change with Claude updates, requires maintenance

**Example:**
```typescript
// dashboard/status-detector.service.ts
export class StatusDetectorService {
  private static readonly WAITING_PATTERNS = [
    /^assistant>/m,             // Claude prompt
    /Enter your message/i,      // Input request
    /Press Enter to continue/i, // Continuation prompt
  ];

  private static readonly WORKING_PATTERNS = [
    /Thinking\.\.\./i,
    /Processing/i,
    /Reading file/i,
  ];

  private static readonly IDLE_TIMEOUT_MS = 3000;

  detectStatus(recentOutput: string, lastOutputTime: Date): SessionStatus {
    const now = Date.now();
    const idleMs = now - lastOutputTime.getTime();

    // Check for explicit working patterns
    for (const pattern of StatusDetectorService.WORKING_PATTERNS) {
      if (pattern.test(recentOutput)) {
        return 'working';
      }
    }

    // Check for waiting patterns
    for (const pattern of StatusDetectorService.WAITING_PATTERNS) {
      if (pattern.test(recentOutput)) {
        return 'waiting';
      }
    }

    // Idle timeout heuristic
    if (idleMs > StatusDetectorService.IDLE_TIMEOUT_MS) {
      return 'waiting';
    }

    return 'working';
  }
}
```

## Data Flow

### Session Creation Flow

```
[User: New Session button]
    ↓
[Dashboard Component] → POST /api/terminal { cwd, flags }
    ↓
[Terminal Route Handler] → TerminalManager.createSession()
    ↓
[TerminalManager] → new TerminalSession() → pty.spawn()
    ↓                       ↓
[SessionStore]         [SessionPersistence.add()]
insertManaged()             ↓
    ↓                   [JSON file write]
[WebSocketBroadcaster] ← session:added event
    ↓
[All WebSocket Clients] ← broadcast JSON
    ↓
[Dashboard Component] ← updates session list (reactive)
```

### PTY Output Streaming Flow

```
[PTY Process: stdout]
    ↓
[TerminalSession.onData handlers]
    ↓ (push to scrollback + forward to handlers)
[WebSocket /terminal/:id] → socket.send(binary)
    ↓
[Browser: WebSocket.onmessage]
    ↓
[xterm.js Terminal.write()] → DOM rendering
```

### Status Detection Flow

```
[PTY output arrives]
    ↓
[TerminalSession scrollback buffer]
    ↓
[StatusDetectorService.detectStatus(recentOutput, lastOutputTime)]
    ↓ (pattern matching + idle timeout)
[SessionStatus: working | waiting | done]
    ↓
[Dashboard Tile Component] → status dot color + audio alert
```

### Key Data Flows

1. **Session state synchronization:** SessionStore emits events → WebSocketBroadcaster → JSON messages → all connected browsers. Ensures dashboard shows real-time session list across all devices on LAN.

2. **PTY output streaming:** PTY binary data → WebSocket binary frames → xterm.js Uint8Array. No JSON serialization overhead, preserves ANSI escape sequences intact.

3. **Session persistence:** TerminalManager → SessionPersistence → JSON file on disk. On restart: JSON file → TerminalManager.restoreSessions() → pty.spawn() with `--resume` flag.

4. **Hybrid detection:** Process query (liveness) + session files (metadata) → PID cache → SessionStore.reconcile(). Scanner provides metadata for sessions not spawned by manager.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-10 terminals | Standard architecture works. Single Node process, in-memory SessionStore, no optimizations needed. |
| 10-50 terminals | Enable WebGL renderer (GPU acceleration), implement lazy terminal rendering (only render active tab). Monitor Node memory (each PTY = ~10MB base + scrollback). |
| 50-100 terminals | Limit scrollback buffer size (5k lines max), consider evicting terminated sessions immediately (no linger). Profile memory usage, may need Node --max-old-space-size adjustment. |
| 100+ terminals | Not recommended for single-user dashboard. If truly needed: move to tmux-backed sessions (share PTY across multiple WebSocket connections), implement terminal pooling (kill idle terminals after timeout). |

### Scaling Priorities

1. **First bottleneck (10-50 terminals):** DOM rendering performance. Each xterm.js instance with DOM renderer is CPU-intensive. **Fix:** Enable WebglAddon for GPU acceleration (3-5x performance improvement), lazy-load terminals (only render visible tab).

2. **Second bottleneck (50-100 terminals):** Node memory usage. Each PTY process consumes ~10MB base + scrollback buffer (10k lines × 80 chars = ~800KB). 100 terminals = ~1.8GB minimum. **Fix:** Reduce scrollback to 5k lines, evict terminated sessions immediately (no linger period), monitor with `process.memoryUsage()`.

## Anti-Patterns

### Anti-Pattern 1: Spawning PTY with Target CWD on Windows

**What people do:** `pty.spawn('powershell.exe', [], { cwd: 'C:\\Users\\Dev\\project' })`

**Why it's wrong:** Windows ConPTY keeps directory handle open for process lifetime. Users cannot rename or delete the folder while terminal is active.

**Do this instead:** Spawn in neutral directory (`C:\Windows\System32`), then immediately `cd` to target directory. See Pattern 3.

### Anti-Pattern 2: Calling ptyProcess.kill() and Moving On

**What people do:** `ptyProcess.kill(); console.log('Terminated');`

**Why it's wrong:** ConoutConnection worker thread may not terminate immediately. Node process hangs on exit, zombie threads accumulate.

**Do this instead:** Use forceful termination with SIGKILL timeout (3 seconds). See Pattern 4.

### Anti-Pattern 3: Creating Unlimited Terminal Instances Without Lazy Loading

**What people do:** Render xterm.js instance for every open tab, even off-screen tabs.

**Why it's wrong:** Each terminal instance consumes CPU for rendering, even if not visible. 10+ terminals cause FPS drops and UI lag.

**Do this instead:** Lazy-load terminals - only create xterm.js instance when tab is active. Destroy instance when tab is not visible (replay scrollback on re-activation).

### Anti-Pattern 4: Forgetting to dispose() xterm.js Terminals

**What people do:** Remove terminal component from DOM without calling `term.dispose()`.

**Why it's wrong:** DOM event listeners and charAtlasCache references persist, causing memory leaks. Long-running sessions with many terminal create/destroy cycles leak hundreds of MB.

**Do this instead:** Always call `term.dispose()` in Angular `ngOnDestroy()`. Explicitly remove window resize listeners before dispose.

### Anti-Pattern 5: Using HTTP Polling for PTY Output

**What people do:** Poll `GET /terminal/:id/output` every 500ms to fetch new output.

**Why it's wrong:** High latency (500ms average delay), server overhead (repeated HTTP requests), inefficient (sends full output each poll or complex diff logic).

**Do this instead:** Use WebSocket bridge pattern (Pattern 1). Full-duplex, low latency, binary efficient.

### Anti-Pattern 6: Hardcoded Prompt Pattern Matching

**What people do:** `if (output.includes('user>')) { status = 'waiting'; }`

**Why it's wrong:** Brittle - prompt format may change with Claude updates, may match false positives in output text.

**Do this instead:** Combine pattern matching with idle timeout heuristic. Use regex arrays for multiple prompt variations. Update patterns when Claude CLI version changes. See Pattern 7.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Claude CLI | Spawn as PTY subprocess with `--session-id` or `--resume` flags | Session IDs enable persistence across restarts. Strip `CLAUDECODE` env var to allow nested sessions. |
| Windows WMI | Query via `Get-CimInstance Win32_Process` for process discovery | Only runs on Windows. Linux alternative: `ps aux`. Used by SessionScanner for hybrid detection. |
| Claude Session Files | Read JSON files from `~/.claude/sessions/` for metadata (cwd, git branch) | Heuristic matching by process start time ±10s window. Cache results to avoid repeated file scans. |
| File System | Watch directories for git branch detection, validate cwd exists before restore | Use `fs.existsSync()` before spawning restored sessions. Git branch detection via `.git/HEAD` parsing. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| TerminalManager ↔ SessionStore | Direct method calls (insertManaged, markTerminated) | Manager pushes state changes, Store is passive recipient. Store emits events for state changes. |
| SessionStore ↔ WebSocketBroadcaster | EventEmitter (sessions:added, sessions:updated, sessions:removed) | Broadcaster subscribes to Store events, forwards to WebSocket clients. Stateless event forwarder. |
| SessionScanner ↔ SessionStore | Direct method calls (store.reconcile(liveProcesses)) | Scanner polls processes, pushes reconciliation to Store. Store applies linger logic and emits events. |
| TerminalSession ↔ WebSocket | Handler registration (session.onData(handler)) with cleanup callback | WebSocket route registers handler on connection, unregisters on disconnect. Session maintains handler list. |
| Dashboard Component ↔ WebSocket Service | RxJS Observable (sessionState$) | Service exposes BehaviorSubject, Component subscribes with async pipe. Reactive state updates. |
| Terminal Component ↔ Terminal Service | Async REST API calls (createSession, killSession) | Service wraps fetch() calls, returns Promises. Component awaits responses. |

## Build Order Recommendations

### Phase 1: Core PTY Infrastructure
**Goal:** Get PTY processes spawning and outputting to console.

**Components:**
1. TerminalSession (PTY wrapper with Windows workarounds)
2. TerminalManager (session lifecycle map)
3. SessionPersistence (JSON file operations)

**Verification:** Can create/kill PTY sessions, see output in Node console, sessions persist across restarts.

### Phase 2: WebSocket Bridge
**Goal:** Stream PTY output to browser.

**Components:**
1. Fastify WebSocket route (`/terminal/:sessionId`)
2. xterm.js integration in Angular component
3. Binary message handling (PTY → WebSocket → xterm.js)

**Verification:** Open browser, connect to terminal WebSocket, see live PTY output rendered in xterm.js. Can type input, see it echoed back.

### Phase 3: Session State Management
**Goal:** Track all sessions (managed + detected) in unified store.

**Components:**
1. SessionStore (in-memory Map with reconciliation)
2. WebSocketBroadcaster (events → JSON messages)
3. Dashboard WebSocket route (`/ws`)
4. Dashboard Angular service (WebSocket client)

**Verification:** Dashboard shows list of all sessions. Creating/killing sessions updates dashboard in real-time. Refreshing browser replays full session list (snapshot on connect).

### Phase 4: Hybrid Detection
**Goal:** Auto-detect existing Claude CLI sessions.

**Components:**
1. SessionScanner (process query + session files)
2. Process query (Windows WMI, Linux ps)
3. Session file parsing

**Verification:** Start Claude CLI manually outside the app. Dashboard shows detected session with cwd and git branch. Killing process removes session from dashboard after linger period.

### Phase 5: Status Detection & Alerts
**Goal:** Visual indicators and audio alerts for terminal status.

**Components:**
1. StatusDetectorService (pattern matching + idle timeout)
2. AudioAlertsService (notification sounds)
3. Dashboard tile component (status dot, alerts)

**Verification:** Dashboard tile changes color when terminal is working/waiting/done. Audio alert plays when status changes to waiting.

### Phase 6: Tabbed Terminal UI
**Goal:** Full interactive terminal with tabbed interface.

**Components:**
1. Terminal container component (mat-tab-group)
2. Terminal tab component (xterm.js + WebSocket)
3. Terminal service (REST API for create/kill)
4. Smart auto-scroll (Pattern 3)

**Verification:** Can open multiple terminal tabs. Each tab shows live xterm.js. Closing tab kills session with confirmation. Scrolling behavior works (auto-scroll at bottom, manual scroll stays in place).

## Sources

### Primary (HIGH confidence)

- [claude-terminal-overseer reference implementation](file://C:/Dev/claude-terminal-overseer/server/src/) - TerminalManager, SessionStore, SessionScanner architecture validated in production
- [node-pty GitHub Repository](https://github.com/microsoft/node-pty) - PTY API, Windows ConPTY support, known issues
- [xterm.js GitHub Repository](https://github.com/xtermjs/xterm.js) - Terminal API, addon ecosystem, performance documentation
- [Web Terminal with Xterm.JS, node-pty and web sockets](https://ashishpoudel.substack.com/p/web-terminal-with-xtermjs-node-pty) - Integration patterns
- [Creating A Browser-based Interactive Terminal (Using XtermJS And NodeJS)](https://www.eddymens.com/blog/creating-a-browser-based-interactive-terminal-using-xtermjs-and-nodejs) - WebSocket bridge pattern

### Secondary (MEDIUM confidence)

- [Efficient and Scalable Usage of Node.js PTY with Socket.io for Multiple Users](https://medium.com/@deysouvik700/efficient-and-scalable-usage-of-node-js-pty-with-socket-io-for-multiple-users-402851075c4a) - Multi-user session management patterns
- [GitHub - dews/webssh: xterm + node-pty + websocket](https://github.com/dews/webssh) - Reference implementation
- [Zellij terminal multiplexer](https://www.maketecheasier.com/zellij-terminal-multiplexer/) - Session manager UI patterns
- [Terminal Multiplexers: tmux vs Zellij comparison](https://dasroot.net/posts/2026/02/terminal-multiplexers-tmux-vs-zellij-comparison/) - Grid layout and dashboard features

### Tertiary (LOW confidence)

- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) - Session ID and resume flag documentation
- WebSearch results for terminal dashboard patterns (verified against official docs)

---

*Architecture research for: Web-based terminal management dashboard*
*Researched: 2026-02-24*
