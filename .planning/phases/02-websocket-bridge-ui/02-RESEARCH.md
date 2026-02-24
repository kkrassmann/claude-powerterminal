# Phase 2: WebSocket Bridge & UI - Research

**Researched:** 2026-02-24
**Domain:** WebSocket transport, xterm.js terminal emulation, real-time bidirectional I/O
**Confidence:** HIGH

## Summary

Phase 2 bridges the PTY backend (Phase 1) to a browser-rendered terminal using WebSocket for transport and xterm.js for terminal emulation. The core pattern is well-established: the Electron main process runs a `ws` WebSocket server, the Angular renderer connects via native browser `WebSocket`, and xterm.js renders PTY output with full VT100/ANSI support. The reference project `claude-terminal-overseer` already implements this exact pattern with the same stack (Angular 17, xterm.js v6, ws v8), providing high-confidence validated patterns.

**Critical finding:** The user's CONTEXT.md specifies "Canvas renderer" but **the canvas addon (`@xterm/addon-canvas`) has been removed in xterm.js v6.0.0** (released December 2024). The xterm.js project recommends either the DOM renderer (default, no addon needed) or the WebGL renderer (`@xterm/addon-webgl`). The WebGL renderer provides up to 900% faster frame rendering than the former canvas renderer and is the standard choice for performance-critical multi-terminal scenarios. The reference project already uses `@xterm/addon-webgl@^0.19.0` with `@xterm/xterm@^6.0.0`. **Recommendation: Use WebGL renderer with DOM fallback** -- this achieves the performance intent behind the "canvas renderer" requirement while using the current standard approach.

**Primary recommendation:** Use `@xterm/xterm@^6.0.0` with `@xterm/addon-webgl` for rendering, `@xterm/addon-fit` for auto-sizing, `ws@^8.19.0` for WebSocket server in Electron main process. One WebSocket connection per terminal session (as specified in CONTEXT.md). Server-side scrollback buffer feeds full replay on WebSocket connect, client receives binary PTY data and sends input/resize JSON control messages.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Terminal look & feel:** Dark color scheme (dark background, light text) - no light mode or theme switching. Font family: Cascadia Code with monospace fallback chain. Font size: Auto-scale per tile - dynamically adjust based on terminal tile dimensions (larger when focused/single, smaller in grid view for Phase 3). Cursor: Block, blinking. Canvas renderer (specified in success criteria).
- **Scrollback & reconnect:** xterm.js scrollback buffer: 10k lines (matching the backend circular buffer from Phase 1). WebSocket disconnect: Silent auto-reconnect - reconnect in background, replay missed output seamlessly, user barely notices. Buffer replay on reconnect: Full buffer dump - send entire scrollback buffer, client gets complete history. Scrollbar: Always visible - persistent scrollbar for clear affordance of history above.
- **Input & clipboard:** Copy/paste: Ctrl+C/V (Windows-native) - Ctrl+C copies selected text, sends SIGINT only when nothing is selected. Keyboard shortcuts: Pass everything through to PTY - no app-level keyboard shortcuts, terminal behaves like a native terminal. Text selection: Click-drag to select, double-click selects word, triple-click selects line. Multi-line paste: No confirmation dialog - paste goes straight through, no friction.
- **Transport architecture:** WebSocket now (not Electron IPC) - renderer connects via ws://localhost, ready for Phase 5 network access without refactor. Protocol: Structured JSON messages with type field ({type: 'output', data: ...}, {type: 'resize', cols: 80, rows: 24}). Resize: Debounced (200ms) - send final dimensions after user stops dragging, prevents resize storm. Multiplexing: One WebSocket connection per session - simple, isolated, each terminal has own connection (6-10 connections for 6-10 terminals).

### Claude's Discretion
- Exact dark theme color values (Catppuccin, Dracula, or custom - as long as it's dark and readable)
- WebSocket server library choice (ws, socket.io, etc.)
- xterm.js addon selection (fit, webgl, web-links, addons)
- Auto-scale font size algorithm and breakpoints
- WebSocket reconnect backoff strategy
- JSON message type taxonomy beyond output/resize/input

### Deferred Ideas (OUT OF SCOPE)
None - discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TERM-03 | User can interact with any terminal (type input, see output) via xterm.js with canvas renderer | xterm.js v6 Terminal with WebGL addon (canvas removed in v6), onData handler for user input forwarded via WebSocket, terminal.write() for PTY output rendering. Full bidirectional I/O. |
| TERM-05 | User can scroll back through terminal history with buffer replay on WebSocket reconnect | Server-side ScrollbackBuffer (10k lines from Phase 1) replayed on WebSocket connect via session.onData() pattern. xterm.js scrollback: 10000 config. Always-visible scrollbar. |
| TERM-06 | User can resize grid tiles and terminals adapt dynamically | FitAddon auto-sizes terminal to container, debounced resize (200ms) sends {type:'resize', cols, rows} over WebSocket, server calls pty.resize() with exit-state guard. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @xterm/xterm | ^6.0.0 | Terminal emulator component for browser | Industry standard (VS Code, Hyper use it), TypeScript-first, full VT100/ANSI support, 222+ code snippets in Context7 |
| @xterm/addon-webgl | ^0.19.0 | GPU-accelerated terminal rendering | Up to 900% faster than canvas (now removed), handles multiple terminals efficiently, fallback to DOM renderer on failure |
| @xterm/addon-fit | ^0.11.0 | Auto-fit terminal to container element | Standard addon for responsive terminal sizing, required for dynamic grid tiles |
| ws | ^8.19.0 | WebSocket server for Node.js | Simple, fast, thoroughly tested, no overhead of socket.io, direct binary support, used by reference project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @xterm/addon-web-links | ^0.11.0 | Clickable URLs in terminal output | Nice-to-have for UX, auto-detects http(s) links in output |
| @xterm/addon-clipboard | (latest for v6) | OSC 52 clipboard support | If terminal apps use OSC 52 sequences for clipboard (Claude CLI may or may not) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ws | socket.io | socket.io adds reconnection/rooms/namespaces built-in but 2-3x bundle size, protocol overhead, unnecessary for local WebSocket with custom reconnect |
| @xterm/addon-webgl | DOM renderer (default) | DOM renderer requires no addon but significantly slower for multiple terminals, no GPU acceleration, performance degrades with 6-10 terminals |
| @xterm/xterm v6 | @xterm/xterm v5 + @xterm/addon-canvas | v5 still has canvas addon but is older, v6 has better scrollbar, ESM support, Shadow DOM compatibility. Canvas performance was inferior to WebGL anyway. |

**Installation:**
```bash
# In the Angular project (src/)
npm install @xterm/xterm@^6.0.0 @xterm/addon-webgl@^0.19.0 @xterm/addon-fit@^0.11.0 @xterm/addon-web-links@^0.11.0

# In the root project (for Electron main process)
npm install ws@^8.19.0
npm install -D @types/ws
```

**CSS import required:**
```typescript
// In angular.json styles array or global styles.css
@import '@xterm/xterm/css/xterm.css';
```

## Architecture Patterns

### Recommended Project Structure
```
electron/
├── main.ts                         # App entry, creates window + WS server
├── ipc/
│   ├── pty-handlers.ts            # Existing PTY IPC handlers (Phase 1)
│   └── session-handlers.ts        # Existing session IPC handlers (Phase 1)
├── websocket/
│   ├── ws-server.ts               # WebSocket server setup + connection routing
│   └── ws-protocol.ts             # Message type definitions (shared)
├── utils/
│   └── process-cleanup.ts         # Existing Windows kill logic (Phase 1)
└── preload.ts                     # Existing preload (Phase 1)
src/src/app/
├── services/
│   ├── pty-manager.service.ts     # Existing (Phase 1) - may need WebSocket variant
│   ├── session-manager.service.ts # Existing (Phase 1)
│   ├── session-state.service.ts   # Existing (Phase 1)
│   └── scrollback-buffer.service.ts # Existing (Phase 1) - used server-side
├── components/
│   ├── session-create/            # Existing (Phase 1)
│   └── terminal/
│       └── terminal.component.ts  # NEW: xterm.js terminal with WebSocket
└── models/
    └── ws-messages.model.ts       # NEW: WebSocket message type interfaces
src/shared/
├── ipc-channels.ts                # Existing (Phase 1)
└── ws-protocol.ts                 # NEW: Shared WebSocket message types
```

### Pattern 1: WebSocket Server in Electron Main Process
**What:** Run `ws` WebSocket server alongside Electron, route per-session connections
**When to use:** Always -- this is the transport layer for all terminal I/O
**Why in main process:** Main process already has access to PTY processes (from Phase 1), WebSocket server needs Node.js APIs

```typescript
// electron/websocket/ws-server.ts
// Source: ws README (https://github.com/websockets/ws), verified via Context7
import { WebSocketServer, WebSocket } from 'ws';
import { getPtyProcesses } from '../ipc/pty-handlers';
import { ScrollbackBuffer } from '../../src/src/app/services/scrollback-buffer.service';

const PORT = 9800; // Dedicated port for WS, separate from Angular dev server

// Map sessionId -> ScrollbackBuffer for replay on reconnect
const scrollbackBuffers = new Map<string, ScrollbackBuffer>();

export function startWebSocketServer(): WebSocketServer {
  const wss = new WebSocketServer({ port: PORT });

  wss.on('connection', (ws: WebSocket, req) => {
    // Extract sessionId from URL path: /terminal/{sessionId}
    const url = new URL(req.url!, `http://localhost:${PORT}`);
    const sessionId = url.pathname.split('/').pop();

    if (!sessionId) {
      ws.close(4000, 'Missing sessionId');
      return;
    }

    const ptyProcess = getPtyProcesses().get(sessionId);
    if (!ptyProcess) {
      ws.close(4004, 'Session not found');
      return;
    }

    // Replay scrollback buffer on connect
    const buffer = scrollbackBuffers.get(sessionId);
    if (buffer) {
      for (const line of buffer.getLines()) {
        ws.send(JSON.stringify({ type: 'output', data: line }));
      }
    }

    // Forward PTY output to WebSocket
    const dataHandler = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    };
    ptyProcess.onData(dataHandler);

    // Handle incoming messages from client
    ws.on('message', (raw: Buffer | string) => {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case 'input':
          ptyProcess.write(msg.data);
          break;
        case 'resize':
          ptyProcess.resize(msg.cols, msg.rows);
          break;
      }
    });

    ws.on('close', () => {
      // Session persists -- only WebSocket connection closes
    });
  });

  return wss;
}
```

### Pattern 2: xterm.js Terminal Component with WebSocket
**What:** Angular component that creates xterm.js Terminal, connects to per-session WebSocket, handles I/O
**When to use:** For each terminal tile in the grid
**Source:** Verified from Context7 (xterm.js), reference implementation (claude-terminal-overseer)

```typescript
// src/src/app/components/terminal/terminal.component.ts
import { Component, Input, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';

@Component({
  selector: 'app-terminal',
  standalone: true,
  template: `<div #terminalContainer class="terminal-container"></div>`,
  styles: [`.terminal-container { width: 100%; height: 100%; }`]
})
export class TerminalComponent implements OnInit, OnDestroy {
  @Input() sessionId!: string;
  @ViewChild('terminalContainer', { static: true })
  terminalContainer!: ElementRef<HTMLDivElement>;

  private term!: Terminal;
  private fitAddon!: FitAddon;
  private socket!: WebSocket;
  private resizeTimeout: any;

  ngOnInit(): void {
    this.term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
      scrollback: 10000,
      theme: { /* dark theme colors */ }
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);

    // WebGL with DOM fallback
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        // DOM renderer activates automatically
      });
      this.term.loadAddon(webglAddon);
    } catch (e) {
      console.warn('WebGL unavailable, using DOM renderer');
    }

    this.term.open(this.terminalContainer.nativeElement);
    this.fitAddon.fit();

    this.connectWebSocket();
    this.setupResizeHandler();
    this.setupClipboard();
  }

  private connectWebSocket(): void {
    this.socket = new WebSocket(`ws://localhost:9800/terminal/${this.sessionId}`);

    this.socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'output') {
        this.term.write(msg.data);
      }
    };

    // Forward user input
    this.term.onData((data) => {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'input', data }));
      }
    });
  }

  private setupResizeHandler(): void {
    const observer = new ResizeObserver(() => {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = setTimeout(() => {
        this.fitAddon.fit();
        if (this.socket.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({
            type: 'resize',
            cols: this.term.cols,
            rows: this.term.rows
          }));
        }
      }, 200); // Debounce per CONTEXT.md
    });
    observer.observe(this.terminalContainer.nativeElement);
  }

  private setupClipboard(): void {
    // Ctrl+C: Copy when selected, SIGINT when not
    this.term.attachCustomKeyEventHandler((event) => {
      if (event.ctrlKey && event.code === 'KeyC' && event.type === 'keydown') {
        if (this.term.hasSelection()) {
          navigator.clipboard.writeText(this.term.getSelection());
          this.term.clearSelection();
          return false; // Prevent xterm from processing
        }
        // No selection: let xterm send \x03 (SIGINT) to PTY
        return true;
      }
      if (event.ctrlKey && event.code === 'KeyV' && event.type === 'keydown') {
        // Let browser handle paste
        return false;
      }
      return true; // All other keys pass through to PTY
    });
  }

  ngOnDestroy(): void {
    this.socket?.close();
    this.term?.dispose();
  }
}
```

### Pattern 3: Silent Auto-Reconnect with Buffer Replay
**What:** Reconnect WebSocket transparently on disconnect, replay server-side buffer
**When to use:** On any WebSocket disconnection (network blip, server restart)
**Source:** Reference implementation (claude-terminal-overseer websocket.service.ts)

```typescript
// Reconnection pattern within terminal component
private reconnectAttempts = 0;
private maxReconnectDelay = 30000;

private connectWebSocket(): void {
  this.socket = new WebSocket(`ws://localhost:9800/terminal/${this.sessionId}`);

  this.socket.onopen = () => {
    this.reconnectAttempts = 0;
    // Server replays full scrollback buffer on connect
    // Terminal may need reset before replay to avoid duplicate content
  };

  this.socket.onclose = () => {
    if (!this.destroyed) {
      this.scheduleReconnect();
    }
  };

  this.socket.onerror = () => {
    // onclose will fire after onerror
  };
}

private scheduleReconnect(): void {
  const baseDelay = 1000;
  const delay = Math.min(
    baseDelay * Math.pow(2, this.reconnectAttempts),
    this.maxReconnectDelay
  );
  const jitter = delay * 0.1 * (Math.random() - 0.5);

  setTimeout(() => {
    this.reconnectAttempts++;
    this.connectWebSocket();
  }, delay + jitter);
}
```

### Pattern 4: Server-Side Scrollback Buffer Management
**What:** Maintain per-session scrollback buffer in Electron main process for replay
**When to use:** Every PTY session needs a buffer for WebSocket reconnect
**Source:** Phase 1 ScrollbackBuffer class + reference implementation pattern

```typescript
// In the WebSocket server or PTY handler setup
// When PTY is spawned, create associated scrollback buffer
const scrollbackBuffers = new Map<string, ScrollbackBuffer>();

function setupPtyWithBuffer(sessionId: string, ptyProcess: IPty): void {
  const buffer = new ScrollbackBuffer(10000);
  scrollbackBuffers.set(sessionId, buffer);

  ptyProcess.onData((data: string) => {
    buffer.append(data);
    // Forward to connected WebSocket clients
  });

  ptyProcess.onExit(() => {
    // Keep buffer for a grace period after exit (client may still be viewing)
    // Clean up when session is explicitly deleted
  });
}
```

### Pattern 5: Debounced Resize with PTY Sync
**What:** ResizeObserver on container, debounce 200ms, fitAddon.fit(), then notify server
**When to use:** Whenever terminal container dimensions change
**Source:** Context7 xterm.js resize documentation + CONTEXT.md locked decision

```typescript
// CRITICAL: Check exit state before calling pty.resize() on Windows
// From Phase 1 Research Pitfall 6: resize on exited PTY crashes on Windows
function handleResize(sessionId: string, cols: number, rows: number): void {
  const ptyProcess = ptyProcesses.get(sessionId);
  if (ptyProcess) {
    try {
      ptyProcess.resize(cols, rows);
    } catch (e) {
      console.warn(`Resize failed for ${sessionId}:`, e);
    }
  }
}
```

### Anti-Patterns to Avoid
- **Using IPC instead of WebSocket for terminal I/O:** Prevents Phase 5 network access without refactor. WebSocket is the explicit architectural decision.
- **Using the AttachAddon for WebSocket:** AttachAddon assumes raw binary WebSocket. Our protocol uses structured JSON messages with type fields, which is incompatible. Handle WebSocket messages manually.
- **Creating WebSocket server per terminal:** One server, multiple connections. Server listens on one port, routes by URL path.
- **Sending PTY output as base64-encoded strings:** Send as UTF-8 text in JSON. PTY output is already text. Binary encoding adds unnecessary overhead.
- **Calling pty.resize() without exit-state guard:** Crashes on Windows with exited ConPTY process (Phase 1 Pitfall 6).
- **Using @xterm/addon-canvas:** Removed in xterm.js v6. Use WebGL addon or DOM renderer.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Terminal emulation | Custom ANSI parser + canvas drawing | @xterm/xterm | VT100/VT220/xterm escape sequences are enormously complex. xterm.js handles 1000+ sequences, Unicode, ligatures, cursor movement, alternate screen buffer. |
| GPU-accelerated rendering | Custom WebGL shaders for terminal | @xterm/addon-webgl | Texture atlas management, glyph caching, GPU memory optimization are all handled. Context loss recovery built-in. |
| Terminal fit-to-container | Manual cell size calculation + resize | @xterm/addon-fit | Calculates cols/rows from container dimensions accounting for font metrics, padding, scrollbar. One call: fitAddon.fit(). |
| WebSocket server | HTTP upgrade handler + frame parser | ws | Frame parsing, masking, ping/pong, close codes, per-message-deflate compression negotiation. |
| Reconnection with backoff | Custom setTimeout chains | Exponential backoff pattern (simple enough to inline) | Standard pattern, but keep it simple -- no need for a library. 10 lines of code. |

**Key insight:** The terminal emulation layer (xterm.js) and the transport layer (ws) are both mature, well-tested libraries. The only custom code needed is the bridge: routing WebSocket connections to PTY processes, maintaining scrollback buffers, and handling the reconnect-replay lifecycle.

## Common Pitfalls

### Pitfall 1: Canvas Addon Removed in xterm.js v6
**What goes wrong:** npm install fails or runtime error when trying to use @xterm/addon-canvas with xterm.js v6
**Why it happens:** The canvas renderer addon was removed in xterm.js 6.0.0 (December 2024). The project recommends DOM renderer or WebGL renderer.
**How to avoid:** Use @xterm/addon-webgl for performance (900% faster than former canvas). Fall back to DOM renderer if WebGL2 is unavailable.
**Warning signs:** npm peer dependency warnings, import errors for @xterm/addon-canvas

### Pitfall 2: WebGL Context Loss in Electron
**What goes wrong:** Terminal goes blank, stops rendering after system sleep/GPU driver update
**Why it happens:** WebGL2 context can be lost when GPU resources are reclaimed by the OS or driver
**How to avoid:** Always register webglAddon.onContextLoss() handler that disposes and optionally recreates the addon. DOM renderer activates automatically as fallback.
**Warning signs:** Blank terminal area, console errors about WebGL context

### Pitfall 3: Duplicate Content on WebSocket Reconnect
**What goes wrong:** Terminal shows doubled output after reconnect because server replays buffer that client already has
**Why it happens:** Server sends full scrollback dump, client still has previous content in xterm.js buffer
**How to avoid:** On reconnect, call terminal.reset() or terminal.clear() before replaying buffer content. Alternatively, track what client already received and only send delta.
**Warning signs:** Duplicated prompt, repeated output blocks visible in terminal

### Pitfall 4: Change Detection Storm from WebSocket Messages
**What goes wrong:** Angular performance degrades, UI becomes sluggish with multiple active terminals
**Why it happens:** Each WebSocket message triggers Angular Zone.js change detection across all components
**How to avoid:** Run WebSocket operations outside NgZone using ngZone.runOutsideAngular(). Only re-enter zone for UI state changes (connection status). xterm.js renders independently of Angular change detection.
**Warning signs:** High CPU usage from Angular, DevTools shows excessive change detection cycles

### Pitfall 5: Port Conflict with Angular Dev Server
**What goes wrong:** WebSocket server fails to start, EADDRINUSE error
**Why it happens:** Using same port as Angular dev server (default 4200 or custom 5000)
**How to avoid:** Use a dedicated port for WebSocket server (e.g., 9800). Configure in one place, reference everywhere.
**Warning signs:** EADDRINUSE error on startup, WebSocket connection refused

### Pitfall 6: Resize Storm without Debounce
**What goes wrong:** Terminal flickers, garbled output, PTY overwhelmed during window resize
**Why it happens:** ResizeObserver fires rapidly during drag resize, each event triggers pty.resize() on server
**How to avoid:** Debounce resize events at 200ms (per CONTEXT.md). Only send final dimensions after user stops resizing.
**Warning signs:** Flickering during resize, garbled characters, high CPU during drag

### Pitfall 7: Memory Leak from Undisposed Terminals
**What goes wrong:** Memory grows unbounded as terminals are created and closed
**Why it happens:** xterm.js Terminal instances, WebGL contexts, and WebSocket connections not properly cleaned up
**How to avoid:** In ngOnDestroy: close WebSocket, call terminal.dispose(), clean up ResizeObserver. The WebGL addon is disposed automatically when terminal is disposed.
**Warning signs:** Memory tab in DevTools shows growing heap, canvas elements accumulate in DOM

### Pitfall 8: Ctrl+C Not Copying on Windows
**What goes wrong:** Ctrl+C always sends SIGINT (\x03) instead of copying selected text
**Why it happens:** xterm.js default behavior sends Ctrl+C as terminal control character
**How to avoid:** Use attachCustomKeyEventHandler to intercept Ctrl+C. Check term.hasSelection() -- if true, copy to clipboard and prevent default. If false, let xterm.js send \x03 to PTY.
**Warning signs:** Cannot copy text from terminal on Windows, Ctrl+C always interrupts even with selection

## Code Examples

Verified patterns from official sources and reference implementation:

### xterm.js Terminal with Dark Theme (Catppuccin Mocha-inspired)
```typescript
// Source: Context7 /xtermjs/xterm.js - Terminal constructor options
const terminal = new Terminal({
  cols: 80,
  rows: 24,
  cursorBlink: true,
  cursorStyle: 'block',
  fontSize: 14,
  fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, monospace',
  scrollback: 10000,
  scrollOnUserInput: true,
  theme: {
    background: '#1e1e2e',     // Catppuccin Mocha base
    foreground: '#cdd6f4',     // Catppuccin Mocha text
    cursor: '#f5e0dc',         // Catppuccin Mocha rosewater
    cursorAccent: '#1e1e2e',
    selectionBackground: '#585b70', // Catppuccin Mocha surface2
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8'
  }
});
```

### WebSocket Server Setup in Electron Main Process
```typescript
// Source: ws README (https://github.com/websockets/ws), Context7 /websockets/ws
import { WebSocketServer, WebSocket } from 'ws';

const WS_PORT = 9800;

function startWebSocketServer(): WebSocketServer {
  const wss = new WebSocketServer({ port: WS_PORT });

  // Heartbeat to detect dead connections
  const interval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  wss.on('connection', (ws: WebSocket, req) => {
    (ws as any).isAlive = true;
    ws.on('pong', () => { (ws as any).isAlive = true; });
    ws.on('error', console.error);

    // Route based on URL path
    const sessionId = extractSessionId(req.url);
    if (!sessionId) {
      ws.close(4000, 'Missing sessionId');
      return;
    }

    setupTerminalBridge(ws, sessionId);
  });

  console.log(`[WebSocket] Server listening on port ${WS_PORT}`);
  return wss;
}
```

### Ctrl+C / Ctrl+V Clipboard Handling
```typescript
// Source: xterm.js issues #1129, #2478, API docs (Context7)
terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
  // Only handle keydown to avoid double-processing
  if (event.type !== 'keydown') return true;

  if (event.ctrlKey && event.code === 'KeyC') {
    if (terminal.hasSelection()) {
      // Copy selected text to clipboard
      navigator.clipboard.writeText(terminal.getSelection());
      terminal.clearSelection();
      return false; // Prevent xterm from sending \x03
    }
    // No selection: let xterm send SIGINT (\x03)
    return true;
  }

  if (event.ctrlKey && event.code === 'KeyV') {
    // Let browser handle paste -- xterm will receive it via onData
    return false;
  }

  // All other keys: pass through to terminal/PTY
  return true;
});
```

### WebSocket Message Protocol
```typescript
// Source: CONTEXT.md locked decision, reference implementation pattern
// Shared between Electron main process and Angular renderer

/** Messages from server to client */
type ServerMessage =
  | { type: 'output'; data: string }      // PTY output chunk
  | { type: 'exit'; exitCode: number }     // PTY process exited

/** Messages from client to server */
type ClientMessage =
  | { type: 'input'; data: string }        // User keyboard input
  | { type: 'resize'; cols: number; rows: number } // Terminal resize
```

### Font Size Auto-Scaling Algorithm
```typescript
// Source: Research recommendation (Claude's discretion per CONTEXT.md)
// Scales font based on container dimensions for grid tile adaptive sizing
function calculateFontSize(
  containerWidth: number,
  containerHeight: number
): number {
  // Target: ~80 columns visible at minimum
  // Average character width is ~0.6 * fontSize for monospace fonts
  const targetCols = 80;
  const charWidthRatio = 0.6;

  // Calculate max font size that fits target columns
  const maxFontForWidth = containerWidth / (targetCols * charWidthRatio);

  // Also consider height (target ~24 rows minimum)
  const targetRows = 24;
  const lineHeightRatio = 1.2;
  const maxFontForHeight = containerHeight / (targetRows * lineHeightRatio);

  // Use smaller of the two, clamped to reasonable range
  const fontSize = Math.min(maxFontForWidth, maxFontForHeight);
  return Math.max(8, Math.min(18, Math.round(fontSize)));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| xterm.js canvas addon | WebGL addon or DOM renderer | xterm.js 6.0.0 (Dec 2024) | Canvas addon removed. WebGL is 900% faster. DOM is the fallback. |
| xterm (unscoped package) | @xterm/xterm (scoped) | xterm.js 5.0.0 (Sep 2022) | Old `xterm` npm package deprecated. Must use `@xterm/*` scoped packages. |
| socket.io for everything | ws for server-side, native WebSocket for browser | Ecosystem shift ~2022+ | socket.io overhead unnecessary for modern browsers with native WebSocket. ws is leaner and faster for server-to-server/Electron use. |
| Custom scrollbar styling | xterm.js v6 integrated VS Code scrollbar | xterm.js 6.0.0 (Dec 2024) | v6 integrated VS Code's base platform for scrollbar/viewport. Better scrollbar behavior out of the box. |

**Deprecated/outdated:**
- **@xterm/addon-canvas:** Removed in v6.0.0, no longer available
- **xterm (unscoped npm package):** Deprecated, use @xterm/xterm
- **xterm-addon-* (unscoped addon packages):** Deprecated, use @xterm/addon-*
- **Terminal `windowsMode` option:** Removed in v6.0.0
- **Terminal `fastScrollModifier` option:** Removed in v6.0.0
- **AttachAddon for JSON-protocol WebSocket:** AttachAddon expects raw binary framing, not JSON messages. Use manual WebSocket handling for structured protocols.

## Open Questions

1. **xterm.js CSS import path in Angular 17**
   - What we know: xterm.js requires importing `@xterm/xterm/css/xterm.css` for proper styling. Angular 17 uses Vite for dev server.
   - What's unclear: Whether the CSS import works via angular.json styles array or needs to be in styles.css @import.
   - Recommendation: Try angular.json `styles: ["node_modules/@xterm/xterm/css/xterm.css"]` first. If that fails, use `@import` in global styles.css.

2. **WebSocket port allocation strategy**
   - What we know: Angular dev server uses port 5000 (configured), Electron main process is separate.
   - What's unclear: Whether to use a fixed port (9800) or dynamically assign. Phase 5 needs the same port to be network-accessible.
   - Recommendation: Use fixed port 9800, configurable via environment variable. Simple, predictable, easy to firewall.

3. **Buffer replay strategy: full reset vs. delta**
   - What we know: CONTEXT.md says "Full buffer dump - send entire scrollback buffer." Server-side buffer stores raw PTY output chunks.
   - What's unclear: Whether full replay always produces clean output, or if ANSI state (colors, cursor position) can get corrupted.
   - Recommendation: Start with full replay (simpler). If visual artifacts occur, prepend an ANSI reset sequence (\x1Bc) before replay to clear terminal state.

4. **WebSocket server lifecycle in Electron**
   - What we know: WebSocket server must start before renderer connects. Must clean up on app quit.
   - What's unclear: Exact timing relative to BrowserWindow creation and PTY restore.
   - Recommendation: Start WebSocket server in app.whenReady(), before createWindow(). Close in will-quit handler after PTY cleanup.

## Sources

### Primary (HIGH confidence)
- Context7 `/xtermjs/xterm.js` - Terminal constructor options, WebGL addon setup, FitAddon usage, user input handling, buffer API, resize events
- Context7 `/websockets/ws` - WebSocket server creation, send patterns, heartbeat ping/pong mechanism
- [xterm.js 6.0.0 Release Notes](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0) - Breaking changes including canvas addon removal
- [ws npm package](https://www.npmjs.com/package/ws) - Version 8.19.0 confirmed latest
- Reference implementation: `C:\Dev\claude-terminal-overseer` - Validated working patterns for Angular 17 + xterm.js v6 + ws + WebSocket terminal bridge

### Secondary (MEDIUM confidence)
- [xterm.js GitHub Releases](https://github.com/xtermjs/xterm.js/releases) - Version history, 5.5.0 addon compatibility matrix
- [cockpit-project/cockpit Issue #22509](https://github.com/cockpit-project/cockpit/issues/22509) - Documents addon-canvas deprecation and removal in v6
- [xterm.js Issue #1129](https://github.com/xtermjs/xterm.js/issues/1129) - Ctrl+C copy behavior on Windows
- [xterm.js Issue #3271](https://github.com/xtermjs/xterm.js/issues/3271) - DOM renderer as default, canvas moved to addon

### Tertiary (LOW confidence)
- [Catppuccin Mocha color palette](https://github.com/catppuccin/catppuccin) - Theme color values (unverified exact hex values, but widely used)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - xterm.js v6 + ws v8 verified via Context7, npm, and reference implementation using identical versions
- Architecture: HIGH - WebSocket bridge pattern validated in production reference implementation (claude-terminal-overseer)
- Pitfalls: HIGH - Canvas removal verified via official release notes. WebGL context loss, resize guards, and clipboard patterns verified via Context7 and reference implementation.
- Reconnect/replay: MEDIUM - Pattern is sound but edge cases around ANSI state during replay need validation in practice

**Research date:** 2026-02-24
**Valid until:** 2026-03-26 (30 days - xterm.js v6 is stable, ws v8 is stable, patterns unlikely to change)
