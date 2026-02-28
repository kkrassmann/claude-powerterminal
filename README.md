# Claude PowerTerminal

A desktop dashboard for running and monitoring multiple [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) sessions simultaneously. Built with Electron and Angular.

<img width="1252" height="848" alt="image" src="https://github.com/user-attachments/assets/c211fc62-dc92-4abb-87a3-dc5e4307e46b" />

Run 6-10+ Claude instances in a tiled grid. Each tile shows live terminal output, Git branch, file changes, and a real-time status indicator. Audio alerts notify you when any session needs attention &mdash; so you can context-switch only when it matters.

## Features

**Multi-Session Grid** &mdash; Spawn multiple Claude CLI sessions in a responsive grid layout. Drag-and-drop to reorder, double-click to maximize, resize width and height by dragging tile edges.

**Intelligent Status Detection** &mdash; A state machine analyzes PTY output in real-time to classify each session as WORKING, THINKING, WAITING, ERROR, or DONE. Uses a combination of prompt pattern matching, content hashing, and idle timeout heuristics.

<img width="123" height="76" alt="image" src="https://github.com/user-attachments/assets/7053d247-b57e-4a0a-8326-ce2b1f788d37" />
<img width="93" height="66" alt="image" src="https://github.com/user-attachments/assets/d8d8176d-e02a-4011-b7f7-acc6d887de52" />


**Audio & Visual Alerts** &mdash; Synthesized notification sounds (Web Audio API, no external files) fire when a session needs input or encounters an error. Tiles glow to draw your eye. Alerts are debounced and priority-ranked to avoid noise.

**Session Persistence** &mdash; Sessions survive app restarts. On launch, Claude PowerTerminal attempts `--resume` for each saved session to preserve conversation history, falling back to a fresh `--session-id` start.

**LAN Access** &mdash; The dashboard is accessible from any device on your local network. Open `http://<your-ip>:9801` on your phone or tablet to monitor and create sessions remotely.

![Screenshot_20260228_183851_Chrome](https://github.com/user-attachments/assets/0263331b-7e11-4fd3-b2fd-c7ab4b4fddb1)

**Git Context** &mdash; Each tile header shows the current Git branch, plus added/modified/deleted file counts. Updated every 30 seconds.

<img width="274" height="49" alt="image" src="https://github.com/user-attachments/assets/7dd3c4db-7e9f-457c-bac9-3fe75e20823b" />

**Terminal Emulation** &mdash; Full xterm.js with WebGL rendering, 10,000-line scrollback, Catppuccin Mocha theme, and auto-fit to container size.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron 28 |
| Frontend | Angular 17, xterm.js 5.5, Angular CDK |
| Terminal Backend | node-pty (ConPTY on Windows) |
| Real-Time | WebSocket (ws 8.x) for PTY I/O streaming |
| HTTP API | Node.js HTTP server for remote browser access |
| Tests | Vitest |

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** 9+
- **Claude CLI** installed and authenticated (`claude` or `claude.exe` in PATH)
- **Git** (for branch/status display in tile headers)
- **Windows 11** / macOS / Linux (Windows with ConPTY tested most)

> **Note:** You need a working [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installation. Claude PowerTerminal spawns `claude` as a subprocess &mdash; it does not communicate with the Anthropic API directly.

## Setup

```bash
# Clone the repository
git clone https://github.com/kkrassmann/claude-powerterminal.git
cd claude-powerterminal

# Install Electron/backend dependencies
npm install

# Install Angular/frontend dependencies
cd src && npm install && cd ..

# Build everything
npm run build
```

### Native Dependencies

`node-pty` requires native compilation. If `npm install` fails:

```bash
# Windows: Install Build Tools
npm install -g windows-build-tools
# or install Visual Studio Build Tools with "Desktop development with C++"

# macOS: Install Xcode Command Line Tools
xcode-select --install

# Linux (Debian/Ubuntu):
sudo apt install build-essential python3
```

## Running

### Development (hot-reload)

```bash
# Start Angular dev server + Electron concurrently
npm run dev
```

This runs:
- Angular dev server on `http://localhost:4800`
- Electron app connecting to the dev server
- WebSocket server on port `9800`
- HTTP API on port `9801`

### Production

```bash
# Build Angular + Electron
npm run build

# Start the app
npm run start:electron
```

### Accessing from Other Devices

Once running, the console shows:

```
LAN access: http://192.168.x.x:9801
```

Open that URL on any device on your network (phone, tablet, another PC). The remote browser gets the same dashboard with live terminal output via WebSocket.

## Building a Distributable

```bash
# Package as standalone app (uses electron-builder)
npx electron-builder --win     # Windows (.exe)
npx electron-builder --mac     # macOS (.dmg)
npx electron-builder --linux   # Linux (.AppImage)
```

The output lands in the `release/` directory.

## Ports

| Port | Purpose |
|------|---------|
| `9800` | WebSocket &mdash; real-time PTY I/O streaming |
| `9801` | HTTP &mdash; static files + REST API for remote browsers |
| `4800` | Angular dev server (development only) |

## HTTP API

For remote browser integration and automation:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List active sessions (ID, PID, working directory) |
| `POST` | `/api/sessions` | Create new session `{ sessionId, cwd, flags? }` |
| `GET` | `/api/git-context?cwd=<path>` | Git branch and file change counts |

## Project Structure

```
claude-powerterminal/
  electron/              # Electron main process
    main.ts              # App lifecycle, window, session restore
    preload.ts           # IPC security bridge
    ipc/                 # IPC handlers (pty, sessions, git)
    websocket/           # WebSocket PTY bridge
    http/                # HTTP static server + API
    status/              # Terminal status detection state machine
    utils/               # Env sanitization, process cleanup
  src/                   # Angular frontend
    src/app/
      components/
        dashboard/       # Grid layout, tile management
        terminal/        # xterm.js terminal emulation
        tile-header/     # Status, git context, actions
        session-create/  # New session dialog
      services/          # State, persistence, PTY, git, audio
      models/            # TypeScript interfaces
  src/shared/            # Shared types (IPC channels, WS protocol)
```

## Tests

```bash
npm test
```

Runs Vitest against Electron-side logic (git status parsing, API response contracts, resize constraints).

## Configuration

Session data is stored in the Electron user data directory:

- **Windows:** `%APPDATA%/claude-powerterminal/sessions.json`
- **macOS:** `~/Library/Application Support/claude-powerterminal/sessions.json`
- **Linux:** `~/.config/claude-powerterminal/sessions.json`

There is no separate config file. Sessions are automatically persisted and restored.

## How It Works

1. **You create a session** &mdash; pick a working directory, Claude PowerTerminal spawns `claude --session-id <uuid>` as a PTY subprocess.

2. **Terminal output streams** over WebSocket to xterm.js in the browser. Input goes back the same way.

3. **A status detector** analyzes every chunk of PTY output &mdash; pattern matching for prompts and errors, content hashing to ignore TUI redraws, idle timers for thinking/waiting detection.

4. **When status changes** to WAITING or ERROR, an audio alert plays and the tile glows until you interact with it.

5. **On restart**, saved sessions are resumed with `claude --resume` to preserve conversation history.

## License

ISC
