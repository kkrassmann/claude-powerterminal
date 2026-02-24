# Claude PowerTerminal

## What This Is

A web-based terminal management dashboard for running and monitoring multiple Claude CLI instances simultaneously. It spawns PTY processes in a grid layout, shows real-time status (working/waiting/done) with audio and visual alerts, persists Claude sessions across restarts, and is accessible from any device on the local network.

## Core Value

Never lose track of which terminal needs attention — instant visibility into the status of every running Claude instance, with alerts that pull you back when action is needed.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Spawn and manage multiple Claude CLI PTY processes from the web app
- [ ] Grid layout displaying all terminals with live output (xterm.js)
- [ ] Terminal header showing: working directory, Git branch, terminal status
- [ ] Status detection via PTY output parsing (prompt patterns) combined with idle-timeout heuristic
- [ ] Audio notification when a terminal needs input or finishes work
- [ ] Visual highlight/indicator for terminal status (working, waiting for input, done)
- [ ] Session persistence: save Claude CLI session IDs, restore with `--resume` on app restart
- [ ] Accessible via local network (phone/tablet can connect to the dashboard)
- [ ] Create new terminal sessions from the UI (select directory, start Claude)
- [ ] Close/kill terminal sessions from the UI
- [ ] Compact, space-efficient terminal tiles in the grid

### Out of Scope

- Code review / inline diff view — deferred to later phase
- Log analysis / AI optimization suggestions — deferred to later phase
- Remote access via ngrok / internet tunneling — deferred (local network only for v1)
- User authentication / login — not needed while local-network-only
- OAuth / multi-user support — single user for now

## Context

- User typically runs 6-10 parallel Claude CLI instances across different projects
- Windows 11 environment, bash shell
- Existing project `claude-terminal-overseer` (C:\Dev\claude-terminal-overseer) solves a different problem but shares technical DNA: Fastify + Angular 17 + node-pty + xterm.js + WebSocket. Patterns and Windows workarounds from that project are valuable references
- Claude Code CLI supports `--session-id` for creating sessions and `--resume` for restoring them
- Status detection is the hardest technical challenge: needs PTY output pattern matching (Claude's prompt indicator) plus idle-timeout fallback heuristic
- The PTY scrollback buffer pattern from overseer (replay on reconnect) is worth adopting

## Constraints

- **Tech stack**: Node.js backend, Angular frontend (modern Angular 17+, not AngularJS)
- **Platform**: Windows 11 primary target (PTY handling needs Windows-specific workarounds via node-pty)
- **Network**: Must bind to `0.0.0.0` or LAN IP for local network access
- **Reference project**: Learn from claude-terminal-overseer patterns but build fresh (separate codebase, different goals)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fresh project, not fork of overseer | Different goals, clean architecture, avoid inheriting constraints | — Pending |
| Node.js + Angular | User preference, proven combo from overseer experience | — Pending |
| Combined status detection (parsing + idle) | Pure parsing is fragile, pure idle is imprecise, both together are robust | — Pending |
| Local network first, auth later | Reduces v1 complexity, ngrok + login deferred to later phase | — Pending |
| Code review deferred | Significant scope, not needed for core "terminal oversight" value | — Pending |

---
*Last updated: 2025-02-24 after initialization*
