# Phase 5: Network Access - Research

**Researched:** 2026-02-25
**Domain:** Network binding, HTTP static file serving, responsive CSS, WebSocket LAN access
**Confidence:** HIGH

## Summary

Phase 5 enables mobile/tablet access to Claude PowerTerminal via the local network. The current architecture has two binding points that need changes: the WebSocket server (port 9800, implicit localhost) and the Angular UI (served via Electron's `loadFile` or dev server on port 4800). For LAN clients, we need (1) the WS server to bind `0.0.0.0`, (2) a new HTTP server to serve the Angular build output to remote browsers, and (3) the frontend WebSocket URL to use `window.location.hostname` instead of hardcoded `localhost`.

The responsive UI work is straightforward CSS -- the current layout already uses flexbox with `flex: 1 1 400px` tiles, so mobile simply needs a lower `min-width` breakpoint (around 300px) and some header/button sizing adjustments. The viewport meta tag already exists in `index.html`.

A critical architectural constraint: the Angular frontend uses `window.electronAPI` (Electron IPC) extensively for session creation, persistence, PTY management, and git context. Remote browsers will not have this API. The pragmatic approach is to expose these operations via WebSocket protocol extensions (new message types) or a REST API on the same HTTP server, with the frontend detecting whether it's running inside Electron or a remote browser and switching transport accordingly.

**Primary recommendation:** Add `host: '0.0.0.0'` to the existing `ws` WebSocketServer, spin up a lightweight `http.createServer` to serve Angular static files on a new port (e.g., 9801), extend the WebSocket protocol with IPC-equivalent messages for remote clients, detect LAN IP via `os.networkInterfaces()`, and log the URL on startup. CSS responsive adjustments are minimal.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NET-01 | App binds to `0.0.0.0` for local network accessibility | ws library `host` option confirmed (Context7 verified). HTTP static server needed for Angular UI. |
| NET-02 | UI is responsive and usable on mobile/tablet viewports | Current flexbox layout needs `min-width` reduction + touch-friendly sizing. xterm.js mobile support is limited but functional for monitoring. |
| NET-03 | App displays its local network URL on startup for easy phone access | Node.js `os.networkInterfaces()` provides LAN IP. Log to console + display in Electron UI. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ws | 8.19.0 | WebSocket server with `host: '0.0.0.0'` binding | Already in project, `host` option is a constructor parameter |
| http (Node.js built-in) | N/A | Static HTTP server for Angular build files on LAN | Zero dependencies, sufficient for serving static files |
| os (Node.js built-in) | N/A | `os.networkInterfaces()` for LAN IP discovery | Standard Node.js approach, no npm package needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| path (Node.js built-in) | N/A | Resolve Angular build output path | For static file serving |
| fs (Node.js built-in) | N/A | Read static files from disk | For HTTP response body |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node.js `http` module | express | Express adds dependency weight for something `http.createServer` + static file handler does in ~30 lines. Not worth it. |
| `os.networkInterfaces()` | `local-ipv4-address` npm | Extra dependency for a 10-line utility function. Not worth it. |
| Custom HTTP static server | `electron-serve` | Only works inside Electron window (file:// protocol), doesn't serve to remote browsers. Not applicable. |

**Installation:**
```bash
# No new packages needed. All functionality from existing ws + Node.js built-ins.
```

## Architecture Patterns

### Recommended Changes to Existing Structure
```
electron/
  main.ts                      # MODIFY: start HTTP server, log LAN URL
  websocket/
    ws-server.ts               # MODIFY: add host: '0.0.0.0' to WebSocketServer
  http/
    static-server.ts           # NEW: HTTP server for Angular static files
  utils/
    network-info.ts            # NEW: LAN IP discovery utility
src/src/
  app/
    components/
      dashboard/
        dashboard.component.css # MODIFY: responsive breakpoints
      tile-header/
        tile-header.component.css # MODIFY: mobile-friendly sizing
      session-create/
        session-create.component.css # MODIFY: mobile dialog sizing
      terminal/
        terminal.component.ts   # MODIFY: use dynamic WS host instead of localhost
    app.component.css           # MODIFY: mobile header layout
    app.component.html          # MODIFY: display LAN URL (optional)
  shared/
    ws-protocol.ts              # MODIFY: add IPC-equivalent message types for remote clients
```

### Pattern 1: WebSocket Server 0.0.0.0 Binding
**What:** Change `new WebSocketServer({ port: WS_PORT })` to `new WebSocketServer({ host: '0.0.0.0', port: WS_PORT })`
**When to use:** Immediately -- single-line change.
**Example:**
```typescript
// Source: Context7 /websockets/ws - verified
// Before (current):
wss = new WebSocketServer({ port: WS_PORT });

// After:
wss = new WebSocketServer({ host: '0.0.0.0', port: WS_PORT });
```

### Pattern 2: Static HTTP Server for Angular Build Output
**What:** Lightweight HTTP server serving Angular's `dist/` directory to LAN clients.
**When to use:** Remote browsers need the Angular app (can't use Electron's `loadFile`).
**Example:**
```typescript
// Source: Node.js http docs
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const STATIC_ROOT = path.join(__dirname, '../../src/dist/claude-powerterminal-angular/browser');

export function startStaticServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    let filePath = path.join(STATIC_ROOT, req.url === '/' ? 'index.html' : req.url!);

    // SPA fallback: serve index.html for routes without file extensions
    if (!path.extname(filePath)) {
      filePath = path.join(STATIC_ROOT, 'index.html');
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // SPA fallback for 404
        fs.readFile(path.join(STATIC_ROOT, 'index.html'), (err2, indexData) => {
          if (err2) {
            res.writeHead(500);
            res.end('Server error');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(indexData);
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[HTTP] Static server listening on 0.0.0.0:${port}`);
  });

  return server;
}
```

### Pattern 3: LAN IP Discovery
**What:** Use `os.networkInterfaces()` to find the machine's LAN IP address.
**When to use:** On startup, to display the access URL.
**Example:**
```typescript
// Source: Node.js os.networkInterfaces() docs
import * as os from 'os';

export function getLocalNetworkAddress(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      // Skip loopback and non-IPv4
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}
```

### Pattern 4: Dynamic WebSocket URL (Critical for LAN Access)
**What:** Replace hardcoded `ws://localhost:9800` with dynamic host based on browser location.
**When to use:** The terminal component must connect back to the server it was loaded from.
**Example:**
```typescript
// Before (current - broken for LAN):
this.socket = new WebSocket(`ws://localhost:${WS_PORT}/terminal/${this.sessionId}`);

// After (works for both localhost and LAN):
const wsHost = window.location.hostname || 'localhost';
this.socket = new WebSocket(`ws://${wsHost}:${WS_PORT}/terminal/${this.sessionId}`);
```

### Pattern 5: Electron vs Browser Detection for IPC Bridge
**What:** Detect whether running inside Electron (has `window.electronAPI`) or a remote browser, and route operations accordingly.
**When to use:** For session creation, kill, restart, git context -- operations that currently rely on Electron IPC.
**Example:**
```typescript
// Detect environment
const isElectron = !!window.electronAPI;

if (isElectron) {
  // Use IPC as before
  await window.electronAPI.invoke('pty:spawn', options);
} else {
  // Use WebSocket or HTTP API
  await fetch(`http://${window.location.hostname}:${HTTP_PORT}/api/pty/spawn`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}
```

### Anti-Patterns to Avoid
- **Hardcoded `localhost` in WebSocket URLs:** Will break on any remote device. Use `window.location.hostname`.
- **Relying on `window.electronAPI` without fallback:** Remote browsers don't have Electron preload. Check existence before use.
- **Using `127.0.0.1` instead of `0.0.0.0`:** 127.0.0.1 only accepts local connections. 0.0.0.0 accepts from all interfaces.
- **Complex responsive framework (Tailwind, Bootstrap):** Overkill for this project. CSS media queries + existing flexbox layout is sufficient.
- **Trying to make xterm.js fully touch-native:** xterm.js has limited mobile support (documented issue #5377). Focus on monitoring (view output, see status), not heavy terminal input on mobile.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MIME type detection | Custom file extension parsing | Simple map of known extensions | Only ~6 file types in Angular build output |
| LAN IP detection | Complex network scanning | `os.networkInterfaces()` with IPv4 filter | Built-in, covers all platforms |
| WebSocket reconnect | Custom retry logic | Already implemented in terminal.component.ts | Existing exponential backoff works for LAN too |

**Key insight:** Phase 5 is primarily a configuration/binding change, not new functionality. The heavy lifting (WebSocket server, terminal rendering, status detection) already exists. The main work is making it accessible from outside Electron.

## Common Pitfalls

### Pitfall 1: WebSocket Connects to `localhost` from Remote Device
**What goes wrong:** Remote browser loads Angular app but WebSocket tries `ws://localhost:9800` which points to the remote device itself, not the server.
**Why it happens:** Hardcoded `localhost` in terminal.component.ts line 208.
**How to avoid:** Replace with `window.location.hostname` which resolves to the server's IP that served the page.
**Warning signs:** Terminal tiles show but remain empty/disconnected on remote devices.

### Pitfall 2: Windows Firewall Blocks Incoming Connections
**What goes wrong:** 0.0.0.0 binding works but devices can't connect due to Windows Firewall.
**Why it happens:** Windows Firewall blocks inbound connections by default for Node.js/Electron.
**How to avoid:** Document that users may need to allow Node.js through Windows Firewall. Consider showing a hint in the UI or console. Do NOT try to programmatically modify firewall rules.
**Warning signs:** Works on the host machine but not from other devices; connection timeout errors.

### Pitfall 3: `window.electronAPI` Undefined on Remote Browser
**What goes wrong:** JavaScript errors crash the app because `window.electronAPI.invoke(...)` is called but `electronAPI` doesn't exist in a regular browser.
**Why it happens:** Electron's preload script only injects `electronAPI` into the Electron BrowserWindow.
**How to avoid:** Two approaches:
  1. **Minimal (monitoring-only):** Guard all `electronAPI` calls with `if (window.electronAPI)`, gracefully degrade for remote clients (view-only mode: no session creation, no kill/restart from remote).
  2. **Full (remote management):** Create a WebSocket or HTTP API bridge that mirrors IPC channels, with an `ElectronOrRemoteService` abstraction.
**Warning signs:** Blank screen or console errors about "Cannot read properties of undefined" on remote devices.

### Pitfall 4: xterm.js WebGL on Mobile Safari
**What goes wrong:** WebGL context creation fails or behaves erratically on older iOS devices.
**Why it happens:** Mobile Safari has WebGL2 limitations and aggressive context management.
**How to avoid:** The existing WebGL fallback to DOM renderer in terminal.component.ts already handles this via the `onContextLoss` handler. Verify it works on mobile Safari.
**Warning signs:** Terminal displays blank white/black area on mobile devices.

### Pitfall 5: Tile Minimum Width Too Large for Mobile
**What goes wrong:** Tiles at `min-width: 400px` force horizontal scroll on phones (typical width 360-414px).
**Why it happens:** Current CSS has `flex: 1 1 400px` and `min-width: 400px`.
**How to avoid:** Add CSS media query for small screens: reduce `min-width` to 100% and stack tiles vertically.
**Warning signs:** Layout broken on phones, horizontal scrollbar appears.

### Pitfall 6: Touch Input Limitations in xterm.js
**What goes wrong:** Users expect to tap the terminal and type, but mobile keyboard integration is poor.
**Why it happens:** xterm.js issue #5377 -- mobile touch support is officially "non-existent" per maintainers. Virtual keyboard input is unreliable.
**How to avoid:** Position mobile use case as "monitoring dashboard" -- view terminal output, see status indicators, hear audio alerts. Don't promise full terminal interaction on mobile. Consider adding a simple text input field below the terminal as a workaround for basic commands.
**Warning signs:** Keyboard doesn't appear on tap, typed characters appear duplicated or garbled.

## Code Examples

Verified patterns from official sources:

### WebSocket Server with 0.0.0.0 Host (Context7 Verified)
```typescript
// Source: Context7 /websockets/ws - "Server with full options" example
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({
  port: 9800,
  host: '0.0.0.0',        // Accept connections from all interfaces
  clientTracking: true,
});
```

### LAN IP Discovery (Node.js Docs)
```typescript
// Source: Node.js os module documentation
import * as os from 'os';

function getLocalNetworkAddress(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

// Usage in main.ts startup:
const lanIp = getLocalNetworkAddress();
if (lanIp) {
  console.log(`\n  Local network access: http://${lanIp}:9801\n`);
}
```

### CSS Responsive Breakpoint for Mobile
```css
/* Mobile viewport: single-column, reduced min-width */
@media (max-width: 600px) {
  .tile {
    flex: 1 1 100%;
    min-width: 100%;
    min-height: 150px;
  }

  .tile-header {
    padding: 4px 8px;
    min-height: 40px;
  }

  .header-btn {
    width: 28px;
    height: 28px;
    font-size: 16px;
  }

  .app-header h1 {
    font-size: 14px;
  }
}
```

### Electron Detection Guard
```typescript
// Guard for services that use electronAPI
function isElectronContext(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI;
}

// Example usage in git-context.service.ts:
async fetchGitContext(cwd: string): Promise<GitContext | null> {
  if (!isElectronContext()) {
    // Remote browser: skip git context (or use WebSocket API)
    return null;
  }
  return await window.electronAPI.invoke('git:context', cwd);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express.js for static serving | Node.js `http` module sufficient for simple static files | Always (Express was never needed for pure static serving) | Zero dependencies |
| `ws` defaults to 127.0.0.1 | Explicit `host: '0.0.0.0'` | ws library design | Must be set explicitly |
| Fixed `localhost` WebSocket URLs | `window.location.hostname` dynamic resolution | Standard web practice | Required for any non-localhost access |

**Deprecated/outdated:**
- `electron-serve`: Serves within Electron's BrowserWindow only, not to external browsers. Not applicable for LAN access.
- Complex responsive frameworks: For an app with ~5 components and a grid layout, CSS media queries are the right tool.

## Open Questions

1. **Remote Session Management: Monitoring-Only vs Full Control?**
   - What we know: Remote browsers lack `window.electronAPI`. Terminal I/O works via WebSocket (already network-capable).
   - What's unclear: Should remote clients be able to create/kill/restart sessions, or just monitor?
   - Recommendation: Start with monitoring-only (view terminals, see status, hear alerts). Guard `electronAPI` calls to degrade gracefully. This satisfies NET-02 ("UI is fully functional on mobile/tablet viewports") for the monitoring use case. If full remote management is needed, add a REST or WebSocket API bridge in a follow-up.

2. **HTTP Server Port Number**
   - What we know: WebSocket is on 9800. Angular dev server is on 4800.
   - What's unclear: Best port for the static HTTP server.
   - Recommendation: Use 9801 (adjacent to WebSocket port 9800). Easy to remember, unlikely to conflict.

3. **Windows Firewall User Experience**
   - What we know: Windows Firewall will likely prompt or block on first LAN access attempt.
   - What's unclear: Whether Electron's `app.requestSingleInstanceLock()` or similar triggers the firewall prompt automatically.
   - Recommendation: Log a clear message to console with instructions. Optionally show in the Electron window UI.

## Sources

### Primary (HIGH confidence)
- Context7 /websockets/ws - WebSocketServer constructor options, `host: '0.0.0.0'` example verified
- Node.js os module documentation - `os.networkInterfaces()` API
- Node.js http module documentation - `http.createServer` API
- Codebase analysis - All files in `electron/` and `src/src/app/` examined directly

### Secondary (MEDIUM confidence)
- [ws GitHub issue #132](https://github.com/websockets/ws/issues/132) - Confirms default host behavior
- [ws official docs](https://github.com/websockets/ws/blob/master/doc/ws.md) - Full WebSocketServer options reference
- [xterm.js issue #5377](https://github.com/xtermjs/xterm.js/issues/5377) - Mobile touch support status ("non-existent")
- [xterm.js issue #2403](https://github.com/xtermjs/xterm.js/issues/2403) - Mobile keyboard issues
- [Node.js issue #43908](https://github.com/nodejs/node/issues/43908) - 0.0.0.0 binding Windows caveat (loopback)

### Tertiary (LOW confidence)
- None -- all critical claims verified with primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries needed. ws `host` option verified via Context7. Node.js built-ins are well-documented.
- Architecture: HIGH - Pattern is standard (HTTP static server + WebSocket binding). Codebase structure is fully understood. Changes are surgical (3-4 files modified, 2 new files).
- Pitfalls: HIGH - xterm.js mobile limitations confirmed via official GitHub issues. Windows Firewall is well-known. `electronAPI` guard pattern is standard.
- Responsive CSS: HIGH - Current layout is already flexbox-based. Only needs breakpoint for small screens.

**Research date:** 2026-02-25
**Valid until:** 2026-03-25 (stable domain, no fast-moving libraries)
