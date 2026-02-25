# Roadmap: Claude PowerTerminal

## Overview

This roadmap takes Claude PowerTerminal from empty directory to a production-ready web dashboard that manages multiple Claude CLI terminals with real-time status detection and proactive alerts. The journey starts with core PTY infrastructure and Windows-specific hardening, builds up through WebSocket streaming and grid visualization, adds the key differentiator (status detection with audio alerts), and finishes with mobile/LAN access for monitoring from anywhere.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Core PTY Infrastructure** - Spawn Claude CLI in PTY with Windows workarounds, session persistence
- [x] **Phase 2: WebSocket Bridge & UI** - Stream PTY to browser via xterm.js with real-time I/O
- [x] **Phase 3: Dashboard Grid** - Multi-terminal grid layout with context headers (completed 2026-02-25)
- [x] **Phase 4: Status Detection & Alerts** - Pattern-based status detection with audio notifications (completed 2026-02-25)
- [ ] **Phase 5: Network Access** - Mobile-responsive UI with LAN accessibility
- [ ] **Phase 6: Session Log Analysis** - On-demand Claude CLI analysis of terminal logs for optimization recommendations

## Phase Details

### Phase 1: Core PTY Infrastructure
**Goal**: Spawn and manage Claude CLI PTY processes with Windows-specific workarounds and session persistence for restart recovery
**Depends on**: Nothing (first phase)
**Requirements**: TERM-01, TERM-04, SESS-01, SESS-02, SESS-03
**Success Criteria** (what must be TRUE):
  1. User can create a new terminal session by selecting a directory, which spawns Claude CLI with --session-id
  2. User can close a terminal session from the UI, and the PTY process terminates cleanly without orphaned conhost.exe processes
  3. Session IDs and working directories are saved to disk when created
  4. On app restart, all previous sessions are restored via Claude CLI --resume flag
  5. Scrollback buffer is limited to prevent memory explosion (10k line circular buffer)
**Plans**: 3 plans in 3 waves

Plans:
- [x] 01-01-PLAN.md — Foundation & Models (Electron + Angular scaffold, session persistence service)
- [x] 01-02-PLAN.md — PTY Lifecycle (PTY spawn/kill with Windows cleanup, IPC handlers)
- [x] 01-03-PLAN.md — Session Management UI & Restore (Session creation UI, auto-restore logic, scrollback buffer)

### Phase 2: WebSocket Bridge & UI
**Goal**: Stream PTY output to browser via WebSocket with xterm.js terminal emulation, supporting full interactive I/O
**Depends on**: Phase 1
**Requirements**: TERM-03, TERM-05, TERM-06
**Success Criteria** (what must be TRUE):
  1. User can see real-time PTY output rendered in xterm.js terminal in the browser
  2. User can type input into the terminal and it reaches the PTY process
  3. User can scroll back through terminal history with buffer replay on WebSocket reconnect
  4. Terminal resizes automatically when browser window changes size
  5. Canvas renderer is used (not DOM) for performance with multiple terminals
**Plans**: 2 plans in 2 waves

Plans:
- [x] 02-01-PLAN.md — WebSocket server + protocol types (ws server in Electron main, PTY bridge, scrollback buffer replay, heartbeat)
- [ ] 02-02-PLAN.md — xterm.js terminal component (WebGL renderer, dark theme, clipboard, auto-reconnect, resize, app wiring)

### Phase 3: Dashboard Grid
**Goal**: Display multiple terminals simultaneously in a responsive grid layout with context information (working directory, Git branch, uncommitted changes) and tile management (maximize, drag-drop reorder)
**Depends on**: Phase 2
**Requirements**: TERM-02, CTXT-01, CTXT-02, CTXT-03
**Success Criteria** (what must be TRUE):
  1. User can view 6-10 active terminals simultaneously in a grid layout
  2. Each terminal tile displays the working directory in the header
  3. Each terminal tile displays the current Git branch name in the header
  4. Each terminal tile displays the count of uncommitted Git changes in the header
  5. Grid layout is responsive and tiles can be resized
**Plans**: 2 plans in 2 waves

Plans:
- [x] 03-01-PLAN.md — Git context pipeline (GitContext model, IPC handler for git branch/status, GitContextService with 30s polling)
- [x] 03-02-PLAN.md — Dashboard grid UI (CSS Grid layout, CDK drag-drop, tile headers with path/git/actions, maximize toggle, app wiring)

### Phase 4: Status Detection & Alerts
**Goal**: Detect terminal status (working/waiting/done) via pattern matching and idle heuristics, with audio alerts on state changes
**Depends on**: Phase 3
**Requirements**: STAT-01, STAT-02, STAT-03, STAT-04, STAT-05
**Success Criteria** (what must be TRUE):
  1. Terminal status is detected correctly via PTY output pattern matching (Claude prompt indicators)
  2. Idle-timeout heuristic provides fallback when pattern matching is inconclusive
  3. Each terminal tile shows a color-coded visual indicator (working = yellow, waiting = red, done = green)
  4. Audio notification plays when a terminal transitions to "waiting for input" or "done"
  5. User can mute/unmute audio notifications globally via a toggle in the UI
**Plans**: 2 plans in 2 waves

Plans:
- [x] 04-01-PLAN.md — StatusDetector backend engine (ANSI stripping, pattern matching state machine, WebSocket protocol extension, PTY handler + WS server wiring)
- [x] 04-02-PLAN.md — Frontend status UI (status dot in tile header, box-shadow glow, Web Audio API alerts with debounce, global mute toggle)

### Phase 5: Network Access
**Goal**: Enable mobile/tablet access via local network with responsive UI and automatic network discovery
**Depends on**: Phase 4
**Requirements**: NET-01, NET-02, NET-03
**Success Criteria** (what must be TRUE):
  1. App binds to 0.0.0.0 and is accessible from other devices on the local network
  2. UI is fully functional on mobile/tablet viewports (tested on phone and tablet)
  3. App displays its local network URL on startup for easy access from other devices
  4. Session list syncs automatically between Electron and remote browsers
  5. Terminal output streams cleanly without glitches during rapid output
  6. Session creation works from remote browsers over HTTP
**Plans**: 5 plans in 1 wave

Plans:
- [x] 05-01-PLAN.md — Backend network infrastructure (WS 0.0.0.0 binding, HTTP static server for Angular build, LAN IP discovery, LAN URL display)
- [x] 05-02-PLAN.md — Frontend LAN compatibility + responsive CSS (dynamic WS URL, electronAPI guards, mobile/tablet breakpoints)
- [ ] 05-03-PLAN.md — Session list synchronization (Fix /api/sessions endpoint, add polling for remote browsers)
- [ ] 05-04-PLAN.md — Terminal buffer resync (Periodic buffer replay to prevent xterm.js glitches)
- [ ] 05-05-PLAN.md — Remote session creation (crypto.randomUUID polyfill, POST /api/sessions endpoint, HTTP API routing)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core PTY Infrastructure | 3/3 | Complete | 2026-02-24 |
| 2. WebSocket Bridge & UI | 1/2 | In Progress | - |
| 3. Dashboard Grid | 2/2 | Complete   | 2026-02-25 |
| 4. Status Detection & Alerts | 2/2 | Complete | 2026-02-25 |
| 5. Network Access | 2/5 | In Progress | - |
| 6. Session Log Analysis | 0/? | Not started | - |

### Phase 6: Session Log Analysis
**Goal**: On-demand optimization analysis of terminal session logs — user clicks a button, a new Claude CLI process reads the scrollback buffer and analyzes: context window utilization, recommendations for specialized agents/orchestrator skills, workflow difficulties, and optimization potential
**Depends on**: Phase 5
**Requirements**: OPT-01, OPT-02, OPT-03
**Success Criteria** (what must be TRUE):
  1. User can trigger a log analysis from the UI for any active terminal session
  2. Analysis runs in a dedicated Claude CLI process (no API key needed)
  3. Results are displayed in the UI with actionable optimization recommendations
**Plans**: TBD

Plans:
- [ ] TBD (will be created during phase planning)

---
*Roadmap created: 2026-02-24*
*Last updated: 2026-02-25 after Phase 5 UAT gap closure planning*
