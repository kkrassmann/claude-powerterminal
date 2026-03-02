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
- [x] **Phase 5: Network Access** - Mobile-responsive UI with LAN accessibility
- [x] **Phase 6: Session Log Analysis** - On-demand Claude CLI analysis of terminal logs for optimization recommendations
- [x] **Phase 7: Advanced Recommendations Engine** - Anti-pattern detection, achievement badges, score trends
- [ ] **Phase 8: Project Configuration Audit** - One-click audit of Claude Code project files
- [ ] **Phase 9: Local Code Review Panel** - Inline diff viewer with accept/reject and comments
- [ ] **Phase 10: Task Board with Drag & Drop** - Kanban board with terminal dispatch

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
**Plans**: 5 plans in 2 waves

Plans:
- [x] 05-01-PLAN.md — Backend network infrastructure (WS 0.0.0.0 binding, HTTP static server for Angular build, LAN IP discovery, LAN URL display) [Wave 1]
- [x] 05-02-PLAN.md — Frontend LAN compatibility + responsive CSS (dynamic WS URL, electronAPI guards, mobile/tablet breakpoints) [Wave 1]
- [x] 05-03-PLAN.md — Session list synchronization (Fix /api/sessions endpoint, add polling for remote browsers) [Wave 1]
- [x] 05-04-PLAN.md — Terminal buffer resync (Periodic buffer replay to prevent xterm.js glitches) [Wave 1]
- [x] 05-05-PLAN.md — Remote session creation (crypto.randomUUID polyfill, POST /api/sessions endpoint, HTTP API routing) [Wave 2, depends on 05-03]

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core PTY Infrastructure | 3/3 | Complete | 2026-02-24 |
| 2. WebSocket Bridge & UI | 1/2 | In Progress | - |
| 3. Dashboard Grid | 2/2 | Complete   | 2026-02-25 |
| 4. Status Detection & Alerts | 2/2 | Complete | 2026-02-25 |
| 5. Network Access | 5/5 | Complete | 2026-02-27 |
| 6. Session Log Analysis | 2/2 | Complete | 2026-02-27 |
| 7. Advanced Recommendations | 3/3 | Complete | 2026-02-28 |
| 8. Project Configuration Audit | 0/3 | Planned | - |
| 9. Local Code Review Panel | 2/3 | In Progress|  |
| 10. Task Board | 0/? | Planned | - |

### Phase 6: Session Log Analysis
**Goal**: Analyze Claude CLI JSONL session logs to display tool statistics, token efficiency, workflow recommendations (praise + improvements), and per-session live practice scores with badges in the dashboard
**Depends on**: Phase 5
**Requirements**: OPT-01, OPT-02, OPT-03
**Success Criteria** (what must be TRUE):
  1. User can open an analysis panel from the dashboard header showing tool usage, token stats, and recommendations
  2. Recommendation engine produces both praise (good practices) and improvement suggestions based on Claude best-practice rules
  3. Each active session tile shows a practice score (0-100) and earned badges in its header
  4. Analysis reads existing Claude CLI JSONL logs, stats-cache.json, and history.jsonl (read-only, no own logging)
  5. Works in both Electron app and remote browser (via HTTP API)
  6. Panel opens in <3 seconds, streaming parser never loads entire files into RAM
**Plans**: 2 plans in 2 waves

Plans:
- [x] 06-01-PLAN.md — Backend engine (shared types, streaming JSONL parser, recommendation engine, per-session scoring, IPC handlers, HTTP endpoints, unit tests) [Wave 1]
- [x] 06-02-PLAN.md — Frontend UI (Angular service, analysis panel component, tile-header scores + badges, dashboard wiring, app integration) [Wave 2, depends on 06-01]

### Phase 7: Advanced Recommendations Engine

**Goal:** Upgrade the analysis engine with research-backed Claude Code best practices, expanded JSONL field extraction (turn durations, compact events, API errors, model usage, slash commands), new scoring dimensions, anti-pattern detection, and an enhanced recommendation UI with categorized tips, achievement badges, and session-over-session trend tracking
**Depends on:** Phase 6
**Requirements**: OPT-04, OPT-05, OPT-06
**Success Criteria** (what must be TRUE):
  1. Parser extracts all available JSONL fields: turn_duration, compact_boundary, api_error, message.model, isSidechain, server_tool_use, cache_creation tiers
  2. Anti-pattern detection identifies: Bash-for-file-ops, correction loops (3+ edits same file without Read), kitchen-sink sessions, infinite exploration (high Read:Edit ratio)
  3. Recommendations reference official Anthropic best practices with actionable tips (e.g., "Use Grep instead of Bash grep")
  4. New badge system: Context Master, Zero Error, Planner, Parallel Pro, Speed Demon, Researcher
  5. Trend tracking shows session-over-session improvement for key metrics
  6. Recommendation categories: praise (green), tip (blue), warning (orange), anti-pattern (red), achievement (gold)
**Plans:** 3/3 plans complete

Plans:
- [ ] 07-01-PLAN.md — Backend extension: expanded JSONL fields, anti-pattern detection engine, 5-category recommendations, stats-cache v2 fix [Wave 1]
- [ ] 07-02-PLAN.md — Score history persistence + new IPC/HTTP channels for session detail and trend data [Wave 1]
- [ ] 07-03-PLAN.md — Angular UI: session detail panel, sparkline trends section, emoji badge upgrades, app wiring [Wave 2, depends on 07-01 + 07-02]

### Phase 8: Project Configuration Audit

**Goal:** Add a one-click folder audit that runs a specialized prompt against Claude Code project files (CLAUDE.md, skills, agents, orchestrators) to evaluate maintenance quality, best-practice conformance, and improvement potential — with the audit prompt living as an iterable, versionable file
**Depends on:** Phase 5 (network access for remote browser)
**Requirements**: AUD-01, AUD-02, AUD-03
**Success Criteria** (what must be TRUE):
  1. Button in UI triggers analysis of a selected/current Claude project folder
  2. Specialized audit prompt evaluates: CLAUDE.md quality, skill definitions, agent configurations, orchestrator patterns, subagent usage
  3. Results show per-file quality scores and an overall improvement potential percentage
  4. Audit prompt lives as a standalone file that can be iterated and improved independently
  5. Concrete recommendations for each file (what to fix, what's missing, what's outdated)
  6. Works in both Electron app and remote browser
**Plans:** 3 plans in 3 waves

Plans:
- [ ] 08-01-PLAN.md — Audit engine backend: shared types, heuristic engine, audit-prompt.md rule checklist [Wave 1]
- [ ] 08-02-PLAN.md — Dual-transport wiring: IPC channels + handlers, HTTP /api/audit/* endpoints [Wave 2, depends on 08-01]
- [ ] 08-03-PLAN.md — Angular UI: AuditService, tab switcher in analysis panel, project dropdown, scored results + expandable findings [Wave 3, depends on 08-01 + 08-02]

### Phase 9: Local Code Review Panel

**Goal:** Provide an integrated diff viewer in the dashboard so users can review Claude's code changes inline — with syntax highlighting, per-hunk accept/reject, and inline comments — without switching to an external editor
**Depends on:** Phase 3 (dashboard grid for tile integration)
**Requirements**: REVW-01, REVW-02, REVW-03, REVW-04, REVW-05
**Success Criteria** (what must be TRUE):
  1. User can open a diff viewer from a terminal tile header showing all uncommitted changes
  2. Diff is syntax-highlighted with file tree navigation (added/modified/deleted indicators)
  3. User can accept or reject individual hunks or entire files (reject reverts via `git checkout -- file`)
  4. User can click on a diff line to leave an inline comment (stored locally per session)
  5. "Review Changes" button appears automatically when terminal status is WAITING or DONE and uncommitted changes exist
  6. Works in both Electron app and remote browser
**Plans:** 2/3 plans executed

Plans:
- [ ] 09-01-PLAN.md -- Backend foundation: shared types, IPC handlers for git diff/apply, HTTP API mirrors, Angular CodeReviewService [Wave 1]
- [ ] 09-02-PLAN.md -- Diff viewer UI: fullscreen overlay, VS Code-style file tree, diff2html rendering with Catppuccin Mocha dark theme [Wave 2, depends on 09-01]
- [ ] 09-03-PLAN.md -- Review workflow: per-hunk accept/reject with undo, comment sidebar with terminal injection, tile-header button, app wiring [Wave 3, depends on 09-02]

### Phase 10: Task Board with Drag & Drop Execution

**Goal:** Add a Kanban-style task board where users can create work items, organize them by status, and drag cards directly onto terminal tiles to inject the task content as a prompt — turning PowerTerminal into a task orchestration platform
**Depends on:** Phase 2 (WebSocket for terminal I/O), Phase 4 (status detection for auto-tracking)
**Requirements**: TASK-01, TASK-02, TASK-03, TASK-04, TASK-05
**Success Criteria** (what must be TRUE):
  1. User can create, edit, and delete task cards with title, description, and category
  2. Kanban board with three columns: Backlog, In Progress, Done — with drag-drop between columns
  3. Dragging a card onto a terminal tile injects the card content as a prompt into that terminal
  4. Card status auto-updates based on terminal status detection (terminal DONE → card moves to Done)
  5. Task cards support templates for common patterns (bug fix, feature, test, refactor)
  6. Board state persists across app restarts
  7. Works in both Electron app and remote browser
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd:plan-phase 10 to break down)

---
*Roadmap created: 2026-02-24*
*Last updated: 2026-02-28 — added Phase 9 (Local Code Review) and Phase 10 (Task Board)*
