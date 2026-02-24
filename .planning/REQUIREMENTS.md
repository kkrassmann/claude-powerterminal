# Requirements: Claude PowerTerminal

**Defined:** 2026-02-24
**Core Value:** Never lose track of which terminal needs attention — instant visibility into every running Claude instance with proactive alerts.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Terminal Management

- [x] **TERM-01**: User can create a new terminal session by selecting a working directory and spawning Claude CLI with `--session-id`
- [ ] **TERM-02**: User can view all active terminals simultaneously in a responsive grid layout (supports 6-10 terminals)
- [x] **TERM-03**: User can interact with any terminal (type input, see output) via xterm.js with canvas renderer
- [x] **TERM-04**: User can close/kill a terminal session from the UI with proper PTY cleanup (Windows SIGKILL timeout)
- [x] **TERM-05**: User can scroll back through terminal history with buffer replay on WebSocket reconnect
- [ ] **TERM-06**: User can resize grid tiles and terminals adapt dynamically

### Status Detection & Alerts

- [ ] **STAT-01**: App detects terminal status (working/waiting for input/done) via PTY output pattern matching
- [ ] **STAT-02**: App uses idle-timeout heuristic as fallback when pattern matching is inconclusive
- [ ] **STAT-03**: Each terminal tile displays a color-coded visual indicator reflecting its current status
- [ ] **STAT-04**: App plays an audio notification when a terminal transitions to "waiting for input" or "done"
- [ ] **STAT-05**: User can mute/unmute audio notifications globally

### Context Information

- [x] **CTXT-01**: Terminal header displays the working directory path
- [x] **CTXT-02**: Terminal header displays the current Git branch name
- [x] **CTXT-03**: Terminal header displays the count of uncommitted Git changes

### Session Persistence

- [x] **SESS-01**: App saves Claude CLI session IDs and working directories to persistent storage on session creation
- [x] **SESS-02**: On app restart, user can restore all previous sessions via Claude CLI `--resume` flag
- [x] **SESS-03**: App detects when a resumed session fails and notifies the user

### Network Access

- [ ] **NET-01**: App binds to `0.0.0.0` for local network accessibility
- [ ] **NET-02**: UI is responsive and usable on mobile/tablet viewports
- [ ] **NET-03**: App displays its local network URL on startup for easy phone access

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Code Review

- **REVW-01**: User can view Git diff inline within the dashboard
- **REVW-02**: User can place review comments on specific lines
- **REVW-03**: Review comments are submitted as GitHub PR reviews via GitHub API

### Remote Access

- **RMTE-01**: App supports ngrok tunneling for internet access
- **RMTE-02**: User authentication via login when accessed remotely
- **RMTE-03**: Sessions are protected with HTTPS when tunneled

### Optimization

- **OPTM-01**: App analyzes terminal logs for Claude usage patterns
- **OPTM-02**: App suggests workflow improvements (agents, skills, hooks)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Terminal multiplexing (tmux/screen integration) | Direct PTY spawning is simpler, session persistence achieves same goal |
| Multi-user support | Single-user workflow, not needed until remote access |
| Terminal themes/customization | Feature bloat, ship with single sensible theme |
| Log aggregation/search across terminals | Scope explosion, Claude provides conversation history |
| Terminal sharing/collaboration | Solo workflow, not pair programming |
| Split panes within a terminal tile | Grid layout is sufficient for overview, adds complexity |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TERM-01 | Phase 1 | Complete |
| TERM-04 | Phase 1 | Complete |
| SESS-01 | Phase 1 | Complete |
| SESS-02 | Phase 1 | Complete |
| SESS-03 | Phase 1 | Complete |
| TERM-03 | Phase 2 | Complete |
| TERM-05 | Phase 2 | Complete |
| TERM-06 | Phase 2 | Pending |
| TERM-02 | Phase 3 | Pending |
| CTXT-01 | Phase 3 | Complete |
| CTXT-02 | Phase 3 | Complete |
| CTXT-03 | Phase 3 | Complete |
| STAT-01 | Phase 4 | Pending |
| STAT-02 | Phase 4 | Pending |
| STAT-03 | Phase 4 | Pending |
| STAT-04 | Phase 4 | Pending |
| STAT-05 | Phase 4 | Pending |
| NET-01 | Phase 5 | Pending |
| NET-02 | Phase 5 | Pending |
| NET-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-24*
*Last updated: 2026-02-24 after roadmap creation (traceability updated)*
