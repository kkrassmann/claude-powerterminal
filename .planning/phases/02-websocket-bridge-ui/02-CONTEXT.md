# Phase 2: WebSocket Bridge & UI - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Stream PTY output to browser via WebSocket with xterm.js terminal emulation, supporting full interactive I/O. Includes WebSocket server, xterm.js rendering with canvas renderer, bidirectional input/output, scrollback buffer replay on reconnect, and dynamic terminal resize. Multi-terminal grid layout and status detection are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Terminal look & feel
- Dark color scheme (dark background, light text) - no light mode or theme switching
- Font family: Cascadia Code with monospace fallback chain
- Font size: Auto-scale per tile - dynamically adjust based on terminal tile dimensions (larger when focused/single, smaller in grid view for Phase 3)
- Cursor: Block, blinking
- Canvas renderer (specified in success criteria)

### Scrollback & reconnect
- xterm.js scrollback buffer: 10k lines (matching the backend circular buffer from Phase 1)
- WebSocket disconnect: Silent auto-reconnect - reconnect in background, replay missed output seamlessly, user barely notices
- Buffer replay on reconnect: Full buffer dump - send entire scrollback buffer, client gets complete history
- Scrollbar: Always visible - persistent scrollbar for clear affordance of history above

### Input & clipboard
- Copy/paste: Ctrl+C/V (Windows-native) - Ctrl+C copies selected text, sends SIGINT only when nothing is selected
- Keyboard shortcuts: Pass everything through to PTY - no app-level keyboard shortcuts, terminal behaves like a native terminal
- Text selection: Click-drag to select, double-click selects word, triple-click selects line
- Multi-line paste: No confirmation dialog - paste goes straight through, no friction

### Transport architecture
- WebSocket now (not Electron IPC) - renderer connects via ws://localhost, ready for Phase 5 network access without refactor
- Protocol: Structured JSON messages with type field ({type: 'output', data: ...}, {type: 'resize', cols: 80, rows: 24})
- Resize: Debounced (200ms) - send final dimensions after user stops dragging, prevents resize storm
- Multiplexing: One WebSocket connection per session - simple, isolated, each terminal has own connection (6-10 connections for 6-10 terminals)

### Claude's Discretion
- Exact dark theme color values (Catppuccin, Dracula, or custom - as long as it's dark and readable)
- WebSocket server library choice (ws, socket.io, etc.)
- xterm.js addon selection (fit, webgl, web-links, etc.)
- Auto-scale font size algorithm and breakpoints
- WebSocket reconnect backoff strategy
- JSON message type taxonomy beyond output/resize/input

</decisions>

<specifics>
## Specific Ideas

- Font size auto-scaling is important because Phase 3 puts 6-10 terminals in a grid - font must adapt to available tile size
- WebSocket chosen over IPC explicitly to avoid a transport refactor in Phase 5 (network access)
- Ctrl+C behavior must be context-aware: copy when text is selected, SIGINT when nothing is selected

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope

</deferred>

---

*Phase: 02-websocket-bridge-ui*
*Context gathered: 2026-02-24*
