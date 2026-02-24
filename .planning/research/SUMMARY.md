# Project Research Summary

**Project:** Claude PowerTerminal
**Domain:** Web-based terminal management dashboard
**Researched:** 2026-02-24
**Confidence:** HIGH

## Executive Summary

This project is a web-based dashboard for managing multiple Claude CLI terminal sessions simultaneously. The domain combines terminal emulation patterns (xterm.js + node-pty PTY spawning), real-time WebSocket streaming, and dashboard UI patterns from container management tools like Portainer. The core value proposition is solving "which terminal needs attention?" through status detection and proactive notifications - a genuinely differentiated feature not found in comparable products.

The recommended approach leverages a proven reference implementation (claude-terminal-overseer) with validated Windows-specific workarounds. Use Fastify + node-pty + xterm.js for the core PTY-to-browser bridge, Angular for the dashboard UI with reactive state management, and hybrid detection (process scanning + session file parsing) for auto-discovering existing Claude sessions. The architecture centers on a TerminalManager owning PTY lifecycle, SessionStore providing unified state with reconciliation, and WebSocket broadcasting for real-time updates across devices.

Critical risks are all Windows-specific PTY issues with known solutions: ConoutConnection worker thread doesn't terminate cleanly (requires forceful SIGKILL timeout), directory handle locks (spawn in neutral directory), resizing exited PTYs crashes Node (track exit state), and scrollback memory explosion (enforce 10k line limit). All pitfalls have proven mitigation patterns from the reference implementation. Secondary risks include xterm.js performance with multiple instances (use canvas renderer, not DOM) and WebSocket backpressure (monitor bufferedAmount). The biggest unknown is status detection accuracy - prompt pattern matching combined with idle timeout heuristics requires validation with real Claude CLI usage patterns.

## Key Findings

### Recommended Stack

The stack is centered on a proven combination validated in the claude-terminal-overseer reference implementation. Fastify 5.7+ provides the fastest Node.js web framework with built-in Pino logging and excellent WebSocket plugin support (@fastify/websocket 11.2+). Node-pty 1.1.0 is Microsoft-maintained with Windows conpty API support for spawning pseudo-terminals. Xterm.js 6.0+ is the industry-standard terminal renderer used by VS Code and Hyper, with scoped @xterm/* packages for security. Angular 21.1+ brings signals-based reactivity, zoneless support, and standalone components (no NgModules), making it ideal for real-time dashboard UIs with RxJS for WebSocket connection management.

**Core technologies:**
- **Fastify 5.7+**: Backend web framework - fastest Node.js framework with WebSocket plugin support, TypeScript-first, proven Windows compatibility
- **Node-pty 1.1.0**: PTY process management - Microsoft-maintained, Windows conpty API support, only stable option (v1.2.0 is beta)
- **xterm.js 6.0+**: Terminal emulation - industry standard with WebGL acceleration, scoped packages for security
- **Angular 21.1+**: Frontend framework - signals-based reactivity, RxJS for WebSocket streams, strong TypeScript integration
- **TypeScript 5.7+**: Type safety - ES2024 target support, required for large-scale Angular + Node.js projects
- **RxJS 7.8+**: Reactive programming - WebSocket connection management with auto-reconnection, Angular peer dependency

**Supporting libraries:**
- **@fastify/websocket 11.2+**: Real-time PTY I/O streaming, integrates with Fastify request lifecycle
- **simple-git 3.0+**: Git operations for terminal header metadata (working directory, current branch)
- **howler 2.2.4**: Audio notifications - simple, 7KB gzipped, Web Audio API with HTML5 Audio fallback
- **@xterm/addon-fit 0.10+**: Terminal auto-sizing for responsive grid layout
- **@xterm/addon-canvas 0.7+**: Canvas renderer for performance (5-45x faster than DOM, essential for 6-10 concurrent terminals)

**What NOT to use:**
- **xterm-addon-*** (unscoped)**: Deprecated packages, security risk (typosquatting) - use @xterm/* instead
- **socket.io**: Overkill for this use case, adds 50KB+ bundle, requires server + client library - use native WebSocket with @fastify/websocket
- **ts-node**: 20-30x slower than tsx for development execution - use tsx for dev, tsc for production builds
- **dotenv**: Unnecessary on Node.js 20+ which has native --env-file flag

### Expected Features

Research identified clear table stakes vs differentiators. The MVP must deliver the core value proposition (status visibility + notifications) while remaining buildable in a single focused phase.

**Must have (table stakes):**
- Multiple terminal display (grid layout) - core value requires seeing all terminals at once, standard since tmux/Tilix
- Terminal I/O (xterm.js + node-pty + WebSocket) - basic terminal functionality, proven pattern
- Create/close terminal sessions - can't manage terminals without lifecycle controls
- Session persistence (save/restore) - critical for multi-instance workflows, Claude CLI --resume enables this
- Scrollback history with replay on reconnect - prevents context loss on browser/WebSocket disconnect
- Basic terminal controls (resize, focus) - standard interaction patterns

**Should have (competitive advantage):**
- **Status detection (parsing + idle heuristic)** - genuinely differentiated, solves core problem, not in comparable products
- **Audio notifications on state change** - proactive attention management, low effort/high impact
- **Visual status indicators in grid** - at-a-glance status with color-coded tiles (dashboard pattern from Portainer)
- **Mobile/tablet access (responsive + 0.0.0.0 bind)** - monitoring from phone, uncommon for terminal managers, low effort to enable

**Defer (v1.1+):**
- Split panes within terminal tiles - may not be needed if grid layout sufficient, wait for user feedback
- Terminal header metadata (cwd, git branch) - nice-to-have context, adds parsing complexity
- Activity highlights on new output - only useful with focus modes or tabs
- Terminal themes/customization - anti-feature, adds bloat without clear value

**Future consideration (v2.0+):**
- Code review / inline diff view - massive scope creep, requires file watching, diff parsing, syntax highlighting
- Log analysis / AI optimization suggestions - unclear value, requires ML pipeline
- Remote access via ngrok - deferred per PROJECT.md, local network only for v1
- User authentication / multi-user - only needed when adding remote access

### Architecture Approach

The architecture follows a PTY-to-browser WebSocket bridge pattern with session state management and hybrid detection for auto-discovery. TerminalManager owns PTY lifecycle (create, kill, retrieve sessions) and integrates SessionPersistence for disk storage of Claude session IDs enabling restart recovery. TerminalSession wraps node-pty IPty with Windows-specific workarounds (forceful kill timeout, exit state tracking) and maintains permanent scrollback buffer for reconnection replay. SessionStore provides in-memory unified state with reconciliation logic, tracking active/terminated sessions with linger period before eviction. SessionScanner implements hybrid detection (process scan for liveness + session files for metadata) with PID cache to avoid rescanning files. WebSocketBroadcaster connects SessionStore events to WebSocket clients, broadcasting JSON state changes to all connected browsers. On the frontend, xterm.js Terminal instances with FitAddon and CanvasAddon render PTY output via WebSocket binary streams, while Angular Dashboard Grid displays status indicators and triggers audio alerts.

**Major components:**
1. **TerminalManager** - Session lifecycle facade, owns Map<id, TerminalSession>, integrates SessionPersistence for disk storage
2. **TerminalSession** - PTY wrapper with Windows workarounds (forceful kill, neutral directory spawn), maintains scrollback buffer for replay
3. **SessionStore** - In-memory state with reconciliation, emits events (added/updated/removed) for state changes
4. **SessionScanner** - Hybrid detection orchestrator, combines process query (WMI on Windows) with session file parsing, PID cache optimization
5. **WebSocketBroadcaster** - Stateless event forwarder, subscribes to SessionStore events and broadcasts JSON to all WebSocket clients
6. **Dashboard Grid (Angular)** - Visual overview with status indicators, integrates StatusDetectorService (pattern matching + idle heuristic) and AudioAlertsService
7. **Terminal Renderer (xterm.js)** - Browser-side emulator with canvas rendering (5-45x faster than DOM), handles resize, scrollback, WebSocket connection

**Key architectural patterns:**
- PTY-to-Browser WebSocket Bridge: Binary PTY output streams over WebSocket, xterm.js writes for input, resize control as JSON
- Scrollback Replay on Reconnection: TerminalSession maintains permanent buffer, replays full history to new WebSocket connections
- Windows PTY Directory Lock Workaround: Spawn in neutral directory (C:\Windows\System32), immediately `cd` to target - prevents ConPTY handle lock
- Forceful PTY Termination: `ptyProcess.kill()` + 3-second timeout with `process.kill(pid, 'SIGKILL')` - ensures ConoutConnection worker thread cleanup
- Session Persistence: TerminalManager writes Claude session metadata to JSON, restores on server restart with `claude --resume`
- Hybrid Detection: Process scan for liveness + session files for metadata, PID cache avoids repeated file scans
- Status Detection: PTY output pattern matching (Claude prompt indicators) + idle timeout heuristic (no output for 3s = waiting)

### Critical Pitfalls

1. **Windows ConoutConnection Worker Thread Doesn't Terminate Cleanly** - Calling `ptyProcess.kill()` alone doesn't stop the worker thread, causing resource leaks and orphaned conhost.exe processes. Mitigation: Implement forceful kill with 3-second SIGKILL timeout. Address in Phase 1 (Terminal Spawning).

2. **Resizing Exited PTY Crashes Node.js** - Calling `ptyProcess.resize()` on exited PTY accesses freed memory, causing unhandled exception crashes. Mitigation: Track exit state with `isExited` flag, check before every resize call. Address in Phase 1.

3. **Scrollback Buffer Memory Explosion** - Unbounded scrollback arrays consume 200MB+ per long-running terminal, unsustainable with 6-10 terminals. Claude Code's verbose output accelerates this (similar to 2026 Ghostty memory leak triggered by Claude Code patterns). Mitigation: Enforce circular buffer with 10,000 line limit (2MB per terminal). Address in Phase 1.

4. **xterm.js Performance Degradation with Multiple Instances** - 6-10 DOM-based terminals saturate main thread, cause input lag and janky scrolling. Single 160x24 terminal with 5000 scrollback = 34MB memory. Mitigation: Use CanvasAddon (5-45x faster than DOM renderer), share texture atlas between instances, limit scrollback to 5,000 for multiple terminals, virtual scrolling for off-screen terminals. Address in Phase 2 (Grid Layout).

5. **WebSocket Backpressure Causes Output Loss** - PTY output faster than WebSocket transmission fills send buffer, drops messages silently. Mitigation: Monitor `socket.bufferedAmount` (threshold 64KB), pause or buffer locally when backpressure detected. Address in Phase 3 (WebSocket Bridge).

## Implications for Roadmap

Based on research, suggested phase structure prioritizes core infrastructure first, builds up to dashboard visibility, then adds detection/alert features. Dependencies from architecture (PTY must work before WebSocket bridge, state management before detection) and pitfall timing (Windows workarounds needed immediately, canvas renderer before multi-terminal, backpressure before production) drive this ordering.

### Phase 1: Core PTY Infrastructure & Windows Hardening
**Rationale:** Foundational layer - can't build anything without functioning PTY processes. All critical Windows-specific pitfalls (worker thread termination, resize crash, scrollback memory) must be addressed from the start, not retrofitted. Reference implementation validation reduces risk.

**Delivers:** TerminalManager and TerminalSession with Windows workarounds validated, session lifecycle working (create/kill), Claude CLI spawning with flags, SessionPersistence for restart recovery, see PTY output in Node console.

**Addresses:**
- Terminal I/O (table stakes feature)
- Create/close terminal sessions (table stakes)
- Session persistence (table stakes)

**Avoids:**
- Pitfall 1: Windows ConoutConnection worker thread leak (forceful SIGKILL timeout)
- Pitfall 2: Resizing exited PTY crash (exit state tracking)
- Pitfall 3: Scrollback buffer memory explosion (10k line circular buffer)

**Research flag:** Skip research-phase - architecture patterns proven in reference implementation (claude-terminal-overseer), Windows workarounds documented with code examples.

### Phase 2: WebSocket Bridge & Basic UI
**Rationale:** Establishes real-time communication between PTY and browser. Must come before dashboard/grid because you need to see terminals working individually before building multi-terminal views. Canvas renderer non-negotiable for eventual multi-terminal use case.

**Delivers:** Fastify WebSocket route (/terminal/:sessionId), binary PTY output streaming, xterm.js integration with CanvasAddon and FitAddon, basic Angular component rendering single terminal, input/output working, resize handling.

**Addresses:**
- Terminal I/O (complete table stakes implementation)
- Basic terminal controls (resize, focus)
- Scrollback history (xterm.js built-in + replay on reconnect)

**Uses:**
- @fastify/websocket 11.2+ for server-side WebSocket
- xterm.js 6.0 with @xterm/addon-canvas for performance
- @xterm/addon-fit for responsive sizing
- RxJS webSocket() subject for connection management

**Avoids:**
- Pitfall 4: xterm.js performance degradation (CanvasAddon from the start, not retrofitted)
- Pitfall 5: WebSocket backpressure (monitor bufferedAmount, implement threshold checks)

**Research flag:** Skip research-phase - WebSocket bridge pattern is standard, documented in multiple sources (Ashish Poudel, Eddy Mens tutorials), reference implementation provides proven code.

### Phase 3: Session State Management & Auto-Detection
**Rationale:** Unified state is prerequisite for dashboard - must know all sessions (managed + detected) before displaying them. Hybrid detection enables auto-discovering existing Claude CLI sessions not spawned by app. Builds on working PTY and WebSocket from Phase 1-2.

**Delivers:** SessionStore with reconciliation logic, SessionScanner with hybrid detection (process query + session files), PID cache optimization, WebSocketBroadcaster for state synchronization, dashboard WebSocket route (/ws), sessions list updates in real-time.

**Implements:**
- SessionStore (EventEmitter with reconciliation)
- SessionScanner (WMI process query on Windows + session file parsing)
- WebSocketBroadcaster (store events → WebSocket JSON messages)

**Avoids:**
- Pitfall 6: Session scanner performance (PID cache avoids rescanning files)
- Pitfall 10: Session file parsing failures (graceful fallback with warning logs)

**Research flag:** Needs validation - hybrid detection heuristics (process start time ±10s window for matching session files) are from reference implementation but may need tuning for production use. Plan for testing with manual Claude CLI sessions.

### Phase 4: Dashboard Grid & Visual Status
**Rationale:** Now that state management works, build the visual overview. Grid layout enables core value proposition (see all terminals at once). Status detection is the key differentiator but requires working terminals and state management first.

**Delivers:** Dashboard Grid component with multiple terminal tiles, color-coded status indicators (working/waiting/done), StatusDetectorService (pattern matching + idle timeout heuristic), status dot rendering in tile headers, session create/terminate controls from UI.

**Addresses:**
- Multiple terminal display (grid layout) - table stakes
- Visual status indicators - competitive advantage differentiator
- Status detection (parsing + idle heuristic) - competitive advantage differentiator

**Implements:**
- Dashboard Grid Angular component
- StatusDetectorService (prompt pattern matching + 3s idle timeout)
- Session tile component with status visualization

**Avoids:**
- Pitfall 12: Status detection false positives (combine patterns with timeout, don't rely solely on text matching)

**Research flag:** Needs validation - status detection patterns for Claude CLI prompts (^assistant>, thinking markers) require testing with real usage. Prompt formats may vary with Claude CLI versions. Plan for pattern adjustment based on testing.

### Phase 5: Audio Alerts & Mobile Access
**Rationale:** Audio notifications complete the "proactive attention management" value proposition. Mobile access is low-effort (responsive UI + bind 0.0.0.0) with high value for monitoring scenarios. Both build on completed dashboard from Phase 4.

**Delivers:** AudioAlertsService with howler.js integration, notification sounds on status change (working → waiting, working → done), mobile gesture handling (iOS autoplay policy), responsive grid layout for tablet/phone viewports, CORS configuration for LAN access.

**Addresses:**
- Audio notifications on state change - competitive advantage differentiator
- Mobile/tablet access - competitive advantage differentiator

**Uses:**
- howler.js 2.2.4 for audio playback (Web Audio API with fallback)
- @fastify/cors 11.0+ for LAN device access
- Angular responsive layout patterns

**Avoids:**
- Pitfall 14: Mobile autoplay policy blocking (display unmute button on first load, require user gesture)

**Research flag:** Skip research-phase - audio notification patterns are straightforward (howler.js has clear API), mobile responsiveness is standard Angular Material, CORS configuration is documented in Fastify plugins.

### Phase Ordering Rationale

- **Phase 1 first:** Can't build anything without working PTY processes. All critical Windows pitfalls must be addressed immediately (worker thread termination, resize crash, scrollback memory) - retrofitting these is painful and error-prone.

- **Phase 2 before dashboard:** Must validate PTY-to-browser bridge works for single terminal before attempting multi-terminal grid. Canvas renderer needed from the start - switching from DOM renderer later is disruptive.

- **Phase 3 before dashboard:** Dashboard displays session state, so state management must exist first. Auto-detection enables discovering existing Claude sessions, but the store reconciliation is foundational.

- **Phase 4 builds on 1-3:** Status detection requires PTY output (Phase 1), WebSocket streaming (Phase 2), and unified state (Phase 3). Grid layout needs working session list. This is where the core value proposition becomes visible.

- **Phase 5 last:** Audio alerts and mobile access enhance the experience but depend on status detection working (Phase 4). Both are relatively low-effort finishes once dashboard is complete.

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 3 (Session State Management):** Hybrid detection heuristics (process start time matching ±10s window) are from reference implementation but need validation. Test with manual Claude CLI sessions to confirm accuracy.
- **Phase 4 (Dashboard Grid):** Status detection prompt patterns (^assistant>, thinking markers) require validation with real Claude CLI usage. Prompt format may vary with Claude CLI versions - patterns may need adjustment.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Core PTY Infrastructure):** Architecture proven in reference implementation (claude-terminal-overseer). Windows workarounds documented with code examples in PITFALLS.md.
- **Phase 2 (WebSocket Bridge):** Standard PTY-to-browser pattern, documented in multiple tutorials (Ashish Poudel, Eddy Mens), reference implementation provides working code.
- **Phase 5 (Audio Alerts & Mobile):** Howler.js API is straightforward, mobile responsiveness is standard Angular Material, CORS configuration is documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Fastify + node-pty + xterm.js is proven combination from reference implementation. All versions verified from official GitHub releases (Feb 2026). Angular 21.1+ is production-ready. No experimental dependencies. |
| Features | HIGH | Feature research cross-referenced multiple sources (tmux/Warp/VS Code patterns, dashboard UI best practices, WebSocket tutorials). Table stakes vs differentiators clearly identified. MVP scope is well-defined. |
| Architecture | HIGH | Architecture extracted from working reference implementation (claude-terminal-overseer). Component responsibilities and patterns validated in production on Windows 11. Data flows proven. Build order follows dependency graph. |
| Pitfalls | HIGH | All critical pitfalls (Windows worker thread, resize crash, scrollback memory, xterm performance, backpressure) have concrete mitigation code from reference implementation. Warning signs documented for detection. Phase timing specified. |

**Overall confidence:** HIGH

### Gaps to Address

- **Status detection accuracy:** Prompt pattern matching (^assistant>, thinking markers) is based on observation of Claude CLI output patterns but not formally documented by Anthropic. Patterns may change with Claude CLI updates. Mitigation: Combine with idle timeout heuristic (not solely pattern matching), design StatusDetectorService for easy pattern updates, plan for testing with real usage during Phase 4 implementation.

- **Hybrid detection edge cases:** Process start time matching (±10s window) may miss very old sessions or produce false positives if multiple Claude sessions start near-simultaneously. Mitigation: PID cache optimization reduces impact, add manual "claim session" UI as fallback, log matching decisions for debugging.

- **Mobile audio autoplay policies:** iOS Safari has strictest autoplay policies, may block howler.js even with user gesture. Android Chrome behavior varies by version. Mitigation: Display visual "unmute" button on first load, test on iOS Safari and Android Chrome during Phase 5, provide visual-only fallback if audio consistently blocked.

- **Session persistence directory validation:** Working directory may be deleted/renamed between server restarts. Mitigation: Check `fs.existsSync()` before restoring session from persistence file, log warning if directory missing, allow user to update path or discard session.

- **Cross-platform compatibility:** All research and reference implementation focuses on Windows 11. macOS/Linux have different PTY behavior (no conpty API, different shell paths). Mitigation: PROJECT.md explicitly states Windows 11 target, defer cross-platform to v2.0+ if requested. Add platform detection guards if attempting Linux/macOS support.

## Sources

### Primary (HIGH confidence)
- [Fastify GitHub Releases](https://github.com/fastify/fastify/releases) - Verified v5.7.4 latest (Feb 2026)
- [xterm.js GitHub Releases](https://github.com/xtermjs/xterm.js/releases) - Verified v6.0.0 with scoped packages
- [Angular GitHub Releases](https://github.com/angular/angular/releases) - Verified v21.1.5 latest (Feb 2026)
- [node-pty GitHub Releases](https://github.com/microsoft/node-pty/releases) - v1.1.0 latest stable
- [TypeScript 5.7 Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html) - ES2024 target, import rewriting
- claude-terminal-overseer reference implementation (C:\Dev\claude-terminal-overseer\server\) - Production-tested architecture, Windows workarounds, proven patterns

### Secondary (MEDIUM confidence)
- [Web Terminal with Xterm.JS, node-pty and web sockets](https://ashishpoudel.substack.com/p/web-terminal-with-xtermjs-node-pty) - WebSocket bridge pattern
- [Creating A Browser-based Interactive Terminal](https://www.eddymens.com/blog/creating-a-browser-based-interactive-terminal-using-xtermjs-and-nodejs) - Integration patterns
- [Fastify WebSocket Best Practices - VideoSDK](https://www.videosdk.live/developer-hub/websocket/fastify-websocket) - Authentication, error handling
- [Better Stack: Fastify WebSockets](https://betterstack.com/community/guides/scaling-nodejs/fastify-websockets/) - Connection management, backpressure
- [Angular WebSockets with RxJS - Medium](https://medium.com/@saranipeiris17/websockets-in-angular-a-comprehensive-guide-e92ca33f5d67) - Service-based architecture
- [Building Robust WebSocket with RxJS](https://craigsh.dev/blog/robust-websockets-using-rxjs/) - Reconnection patterns
- [Portainer Dashboard Documentation](https://docs.portainer.io/user/docker/dashboard) - Dashboard UI patterns
- [tmux: The Complete Guide for 2026](https://devtoolbox.dedyn.io/blog/tmux-complete-guide) - Session management patterns
- [Terminal Multiplexers: tmux vs Zellij Comparison](https://dasroot.net/posts/2026/02/terminal-multiplexers-tmux-vs-zellij-comparison/) - Feature landscape
- [Best Terminal Emulators for Developers in 2026](https://scopir.com/posts/best-terminal-emulators-developers-2026/) - Competitive analysis

### Tertiary (LOW confidence - needs validation)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) - Session ID and resume flag documentation (assumed stable but not verified)
- WebSearch results for dashboard UI patterns (verified against official Portainer/Grafana docs)
- Status detection prompt patterns (observed from Claude CLI usage, not formally documented by Anthropic)

---
*Research completed: 2026-02-24*
*Ready for roadmap: yes*
