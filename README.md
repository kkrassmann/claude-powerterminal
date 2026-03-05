# Claude PowerTerminal

**Run 6-10+ Claude Code sessions at once. See which ones need you. Ignore the rest.**

<img width="769" height="395" alt="image" src="https://github.com/user-attachments/assets/5442d75f-77ac-4a21-a5c3-afe50c2ac21f" />

A desktop dashboard for power users who run many [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) sessions in parallel. Each session lives in a tile with live terminal output, real-time status detection, and audio alerts &mdash; so you only context-switch when it matters.

## Quick Start

```bash
npx claude-powerterminal
```

Downloads the latest binary, caches it locally, and launches the app. That's it.

Or download manually from [Releases](https://github.com/kkrassmann/claude-powerterminal/releases).

Or build from source:

```bash
git clone https://github.com/kkrassmann/claude-powerterminal.git
cd claude-powerterminal
npm install && cd src && npm install && cd ..
npm run build && npm run start:electron
```

> **Requires:** [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated, Node.js 18+

## Why This Exists

If you use Claude Code seriously, you're running multiple sessions &mdash; one fixing a bug, another writing tests, a third exploring a codebase. The problem: you're constantly alt-tabbing between terminals to check which one finished, which one is waiting for input, and which one errored out.

Claude PowerTerminal puts all sessions in one view with **intelligent attention management**. A state machine monitors every session's PTY output and tells you exactly where your attention is needed.

## Features

### Multi-Session Grid

Spawn sessions in a responsive tiled grid. Drag-and-drop to reorder, double-click to maximize, resize by dragging edges.

### Intelligent Status Detection

Each session is classified in real-time:

<img width="123" height="76" alt="Working status indicator" src="https://github.com/user-attachments/assets/7053d247-b57e-4a0a-8326-ce2b1f788d37" /> <img width="93" height="66" alt="Waiting status indicator" src="https://github.com/user-attachments/assets/d8d8176d-e02a-4011-b7f7-acc6d887de52" />

**WORKING** &middot; **THINKING** &middot; **WAITING** &middot; **ERROR** &middot; **DONE**

Uses prompt pattern matching, content hashing (to ignore TUI redraws), and idle timeout heuristics.

### Audio & Visual Alerts

Synthesized notification sounds (Web Audio API, zero external files) fire when a session needs input or hits an error. Tiles glow until you interact. Debounced and priority-ranked to avoid noise.

### Session Analysis & Practice Score

<img width="873" height="395" alt="image" src="https://github.com/user-attachments/assets/dc7a6340-fd88-40b6-bc18-0c8ef124b220" />


The built-in analysis engine parses Claude CLI's JSONL session logs and gives you a **practice score out of 100**, broken down across 5 dimensions:

- **Tool Nativeness** &mdash; Are native tools (Grep, Glob, Read) preferred over Bash workarounds?
- **Subagent Usage** &mdash; Is work being delegated to subagents for parallel execution?
- **Read-before-Write** &mdash; Are files read before being edited? (Prevents correction loops)
- **Context Efficiency** &mdash; How well is the cache being reused vs. rebuilt?
- **Error Rate** &mdash; What percentage of interactions result in errors?

The engine also detects **anti-patterns** (correction loops, kitchen-sink sessions, endless exploration, Bash chains instead of subagents) and generates **actionable recommendations** with suggested CLAUDE.md rules to fix them.

Score trends are tracked across sessions so you can see your workflow improving over time.

### Session Persistence

Sessions survive app restarts. On launch, Claude PowerTerminal attempts `--resume` for each saved session, falling back to a fresh `--session-id` start.

### LAN Access

<img width="150" alt="Mobile LAN access" src="https://github.com/user-attachments/assets/0263331b-7e11-4fd3-b2fd-c7ab4b4fddb1" />

Monitor from any device on your network. Open `http://<your-ip>:9801` on your phone or tablet to watch sessions, create new ones, and run analysis.


### Terminal Grouping & Layout Presets

<img width="925" height="101" alt="image" src="https://github.com/user-attachments/assets/8ec75b6b-c0ae-4113-8dab-de7b63d72b00" />

Organize sessions into named groups. Apply layout presets (2-column, 3-column, focus mode) per group. Groups persist across restarts.



### Session Templates

<img width="486" height="720" alt="image" src="https://github.com/user-attachments/assets/bd1e0ea5-5dbc-4c24-891d-7fa7492feb90" />

Save reusable session configurations &mdash; working directory, CLI flags, initial prompt &mdash; and spawn new sessions from templates with one click.

### Git Worktree Manager

<img width="493" height="636" alt="image" src="https://github.com/user-attachments/assets/1b453983-2617-46f0-80bb-9e26fccac676" />

Create, list, and delete Git worktrees directly from the session creation dialog. Spin up isolated worktrees for parallel feature work without leaving the app.



### Project Configuration Audit

<img width="351" height="186" alt="image" src="https://github.com/user-attachments/assets/d9473378-3eaf-45f8-bda3-fe8ee8386b27" />

<img width="356" height="185" alt="image" src="https://github.com/user-attachments/assets/2cd6763b-7329-4ae7-89d0-b63cfbdf07d1" />


A built-in audit engine checks your project setup against a rule checklist and scores configuration quality. Deep audit mode uses LLM-based per-file analysis for detailed findings with collapsible accordion results.


### Git Context

<img width="274" height="49" alt="Git context in tile header" src="https://github.com/user-attachments/assets/7dd3c4db-7e9f-457c-bac9-3fe75e20823b" /> 

Each tile header shows the current branch and file change counts (added/modified/deleted), updated every 30 seconds.


### Terminal Emulation

Full xterm.js with WebGL rendering, 10,000-line scrollback, Catppuccin Mocha theme, and auto-fit to container.

## Installation

### Option 1: npx (recommended)

```bash
npx claude-powerterminal
```

Requires Node.js 18+. Automatically downloads the correct binary for your platform and caches it in `~/.claude-powerterminal/`.

### Option 2: GitHub Releases

Download the latest binary from [Releases](https://github.com/kkrassmann/claude-powerterminal/releases):

- **Windows:** `claude-powerterminal-x.x.x-win-x64.exe` (portable, no install)
- **Linux:** `claude-powerterminal-x.x.x-linux-x64.AppImage`
- **macOS:** `claude-powerterminal-x.x.x-mac-arm64.dmg` (Apple Silicon) / `claude-powerterminal-x.x.x-mac-x64.dmg` (Intel)

### Option 3: Build from source

```bash
git clone https://github.com/kkrassmann/claude-powerterminal.git
cd claude-powerterminal
npm install && cd src && npm install && cd ..
npm run build && npm run start:electron
```

## Development

```bash
git clone https://github.com/kkrassmann/claude-powerterminal.git
cd claude-powerterminal
npm ci && cd src && npm ci && cd ..
npm run dev
```

Runs Angular dev server (port 4800) + Electron with hot-reload.

## Architecture

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron 28 |
| Frontend | Angular 17, xterm.js 5.5, Angular CDK |
| Terminal Backend | node-pty (ConPTY on Windows) |
| Real-Time | WebSocket (ws 8.x) for PTY I/O |
| HTTP API | Node.js HTTP for LAN access |
| Analysis | Streaming JSONL parser + scoring engine |
| Tests | Vitest |

Dual-transport architecture: IPC for local Electron communication, HTTP/WebSocket for remote browser access. Both expose the same API surface.

## HTTP API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List active sessions |
| `POST` | `/api/sessions` | Create new session |
| `GET` | `/api/git-context?cwd=<path>` | Git branch + file changes |
| `GET` | `/api/analysis` | Full session analysis |
| `GET` | `/api/analysis/session?id=<id>` | Per-session practice score |
| `GET` | `/api/analysis/trends` | Score trends (last 10 sessions) |

## Supported Platforms

| Platform | Arch | Format |
|----------|------|--------|
| Windows | x64 | Portable `.exe` |
| Linux | x64 | `.AppImage` |
| macOS | x64, arm64 | `.dmg` / `.zip` |

> **macOS note:** The app is not code-signed. On first launch, right-click the app and select "Open" to bypass Gatekeeper, or run `xattr -cr "Claude PowerTerminal.app"` from Terminal.

## License

[GPL-3.0](LICENSE)
