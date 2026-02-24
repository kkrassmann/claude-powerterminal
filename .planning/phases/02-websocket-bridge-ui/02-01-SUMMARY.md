---
phase: 02-websocket-bridge-ui
plan: 01
subsystem: websocket-infrastructure
tags: [websocket, pty-bridge, scrollback, real-time]
completed: 2026-02-24
duration: 3
dependency_graph:
  requires: [01-02-pty-core]
  provides: [ws-server, ws-protocol, scrollback-replay]
  affects: [pty-handlers, main-lifecycle]
tech_stack:
  added: [ws@8.19.0, @types/ws]
  patterns: [websocket-bridge, circular-buffer, heartbeat-detection]
key_files:
  created:
    - electron/websocket/ws-server.ts
    - src/shared/ws-protocol.ts
  modified:
    - electron/ipc/pty-handlers.ts
    - electron/main.ts
    - package.json
decisions:
  - id: WS-PORT-9800
    summary: "Use port 9800 for WebSocket server (avoids common port conflicts)"
  - id: HEARTBEAT-30S
    summary: "30-second heartbeat interval for dead connection detection (balanced responsiveness/overhead)"
  - id: SCROLLBACK-10K
    summary: "10,000 line scrollback buffer limit (balances memory usage with history)"
  - id: BUFFERING-SIGNALS
    summary: "Send buffering/buffered signals around replay to enable client-side terminal.reset()"
  - id: RESIZE-GUARD
    summary: "Wrap PTY resize in try/catch to prevent Windows crash on exited PTY"
---

# Phase 02 Plan 01: WebSocket Bridge Infrastructure Summary

**One-liner:** WebSocket server on port 9800 bridges PTY I/O to browser clients with scrollback buffer replay, heartbeat detection, and Windows-safe resize handling.

## What Was Built

### Core Infrastructure

1. **WebSocket Server (`electron/websocket/ws-server.ts`)**
   - WebSocketServer listening on port 9800
   - Heartbeat mechanism (30-second interval) for dead connection detection
   - Connection handler with sessionId extraction from URL path (`/terminal/{sessionId}`)
   - Scrollback buffer management (10,000 line circular buffer per session)

2. **Shared Protocol Types (`src/shared/ws-protocol.ts`)**
   - `ServerMessage` type: output, exit, buffering, buffered
   - `ClientMessage` type: input, resize
   - `WS_CLOSE_CODES` constants for connection management
   - `WS_PORT` constant (9800)

3. **PTY Bridge Integration**
   - Real-time PTY output forwarding to WebSocket clients
   - Client input forwarding to PTY processes
   - Terminal resize handling with exit-state guard (Windows crash prevention)
   - Scrollback buffer replay on WebSocket connect (with buffering/buffered signals)

### Integration Points

1. **PTY Handlers Enhancement (`electron/ipc/pty-handlers.ts`)**
   - Create scrollback buffer on PTY spawn
   - Append PTY output to scrollback buffer
   - Clean up scrollback buffer on PTY exit

2. **Main Process Lifecycle (`electron/main.ts`)**
   - Start WebSocket server in `app.whenReady()` before window creation
   - Stop WebSocket server in `will-quit` handler before PTY cleanup

## Implementation Highlights

### Scrollback Buffer Replay

The WebSocket server sends a three-phase replay sequence when clients connect:

1. **Buffering signal**: `{ type: 'buffering', total: lineCount }` — tells client to prepare (call `terminal.reset()`)
2. **Buffer content**: Multiple `{ type: 'output', data: line }` messages for each buffered line
3. **Buffered signal**: `{ type: 'buffered' }` — tells client replay is complete

This solves the "duplicate content on reconnect" problem identified in RESEARCH.md Pitfall 3.

### Heartbeat Detection

Every 30 seconds, the server:
- Checks each client's `isAlive` flag
- Terminates clients with `isAlive === false` (missed last pong)
- Sends `ping()` to all clients and sets `isAlive = false`
- Clients respond with `pong` events, setting `isAlive = true`

This detects stale connections that failed to close properly (network issues, browser crashes).

### Windows Resize Guard

PTY resize messages are wrapped in try/catch:

```typescript
try {
  ptyProcess.resize(msg.cols, msg.rows);
} catch (error: any) {
  console.warn(`[WebSocket] Resize failed for session ${sessionId}:`, error.message);
}
```

This prevents crashes when clients send resize messages after the PTY process has exited (Windows-specific bug identified in RESEARCH.md Pitfall 1).

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Port 9800 | Avoids common development ports (3000, 4200, 5000, 8080) while staying in user port range |
| 30-second heartbeat | Balances responsiveness (detect dead connections quickly) with overhead (don't spam pings) |
| 10,000 line buffer | Based on claude-terminal-overseer reference — enough history for long sessions without unbounded memory growth |
| Buffering signals | Enables client to call `terminal.reset()` before replay, preventing duplicate content on reconnect |
| Resize guard | Windows-specific workaround for node-pty crash when resizing exited PTY process |

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

All verification criteria passed:

- ✅ `npm run build:electron` succeeds (TypeScript compiles for all electron/ files)
- ✅ `ws-server.ts` exports `startWebSocketServer` and `stopWebSocketServer`
- ✅ `main.ts` calls `startWebSocketServer()` in `app.whenReady()` before `createWindow()`
- ✅ `main.ts` calls `stopWebSocketServer()` in `will-quit` handler
- ✅ `pty-handlers.ts` creates scrollback buffers on PTY spawn and appends output data
- ✅ Protocol types in `ws-protocol.ts` define ServerMessage and ClientMessage
- ✅ Heartbeat interval set to 30 seconds for dead connection detection

## Task Breakdown

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Create shared WebSocket protocol types and install ws dependency | f90fbb8 | src/shared/ws-protocol.ts, package.json |
| 2 | Create WebSocket server with PTY bridge, scrollback buffer, and heartbeat | 7d37928 | electron/websocket/ws-server.ts, electron/ipc/pty-handlers.ts, electron/main.ts |

## Success Criteria Met

- ✅ WebSocket server infrastructure is complete and compiles
- ✅ PTY output is captured in scrollback buffers for replay
- ✅ Shared protocol types exist for both server and client to import
- ✅ Server lifecycle is managed (start on ready, stop on quit)
- ✅ All existing Phase 1 functionality remains intact (no regressions)

## Next Steps

Plan 02-02 will build the Angular client-side WebSocket integration:
- WebSocket client service
- Terminal UI component with xterm.js
- Session switching and reconnection logic

## Self-Check

Verifying all claimed artifacts exist:

- ✅ FOUND: src/shared/ws-protocol.ts
- ✅ FOUND: electron/websocket/ws-server.ts
- ✅ Commit f90fbb8 exists (Task 1)
- ✅ Commit 7d37928 exists (Task 2)

## Self-Check: PASSED
