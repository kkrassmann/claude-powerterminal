# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Install dependencies (two-level: root + Angular frontend)
npm install && cd src && npm install && cd ..

# Development (Angular dev server on :4800 + Electron with hot-reload)
npm run dev

# Build everything (Electron TS → dist/, Angular → src/dist/)
npm run build

# Build individually
npm run build:electron   # tsc -p tsconfig.json
npm run build:angular    # cd src && ng build --base-href ./

# Start Electron from built files
npm run start:electron

# Package distributable
npm run dist:win         # Portable .exe
npm run dist:linux       # AppImage
```

## Testing

```bash
# Run all tests (Vitest, covers electron/ backend code)
npm test

# Run a single test file
npx vitest run electron/analysis/log-analyzer.test.ts

# Run tests in watch mode
npx vitest electron/analysis/log-analyzer.test.ts
```

Tests live next to source files (`*.test.ts`), configured in `vitest.config.ts` to include `electron/**/*.test.ts`. Angular frontend tests use Karma/Jasmine (`cd src && npm test`) but are not actively maintained.

## Architecture

### Dual-Transport Design

The app runs two parallel communication layers exposing the same API surface:

1. **IPC** (Electron) — `window.electronAPI.invoke(channel, ...args)` for the local desktop window
2. **HTTP + WebSocket** (remote) — REST on `:9801`, WS on `:9800` for LAN browser access

Angular services detect which mode they're in by checking `window.electronAPI` existence and route calls accordingly.

### Process Model

```
Electron Main Process
├── IPC handlers (electron/ipc/*.ts)         — registered in main.ts on app.whenReady()
├── WebSocket server (electron/websocket/)   — PTY I/O bridge, scrollback replay, heartbeat
├── HTTP server (electron/http/)             — static files + REST API (mirrors IPC handlers)
├── Status detection (electron/status/)      — heuristic state machine per session
├── Analysis engine (electron/analysis/)     — JSONL log parser, scoring, anti-patterns
└── PTY processes (node-pty)                 — one per Claude CLI session

Angular Renderer (src/src/app/)
├── Components: dashboard, terminal, tile-header, session-create, analysis-panel, session-detail
├── Services: pty-manager, session-manager, session-state, git-context, audio-alert, log-analysis
└── Shared types: src/shared/ (ipc-channels, ws-protocol, analysis-types)
```

### Key Patterns

**Adding an IPC channel:** Use `/skill-add-ipc-channel CONSTANT_NAME "description"`. Manually: define constant in `src/shared/ipc-channels.ts` → implement handler in `electron/ipc/` using `ipcMain.handle()` → mirror as HTTP endpoint in `electron/http/static-server.ts` → consume via Angular service checking `window.electronAPI`. Always use `IPC_CHANNELS.*` constants, never hardcoded channel strings.

**Shared code:** `src/shared/` is compiled by both the root `tsconfig.json` (Electron) and `src/tsconfig.app.json` (Angular). Types defined there are available on both sides. **New shared types belong in `src/shared/`, not duplicated across files.**

**Status detection:** `StatusDetector` is a heuristic state machine that classifies PTY output into WORKING/THINKING/WAITING/ERROR/DONE using prompt pattern matching, content hashing, and idle timeouts.

**Session restore:** On startup, `main.ts` reads `sessions.json` from userData, spawns PTY processes sequentially (3s delay between each to avoid `.claude.json` write races), tries `--resume` first, falls back to `--session-id`.

### Ports

| Port | Purpose |
|------|---------|
| 9800 | WebSocket — real-time PTY I/O |
| 9801 | HTTP — static files + REST API |
| 4800 | Angular dev server (dev only) |

## Code Conventions

- TypeScript strict mode, ES2020 target, CommonJS modules (Electron side)
- Angular 17 with standalone components (no NgModules)
- Catppuccin Mocha dark theme for all UI
- Communication language: German. Code and comments: English.

## Known Technical Debt

These are confirmed findings from `/skill-review-system`. Address when touching related code:

- **SessionMetadata** is defined in 4 files (session.model.ts, main.ts, session-handlers.ts, static-server.ts). Should live once in `src/shared/`.
- **loadSessionsFromDisk** is implemented 3 times (main.ts, session-handlers.ts, static-server.ts). Export from session-handlers.ts.
- **PTY registration** (buffer + detector + onData/onExit wiring) is copy-pasted 4 times. Extract a shared `wirePtyHandlers()` function.
- **Port 9801** is hardcoded in 7 files. Add `HTTP_PORT` constant to `src/shared/`.
- **ScrollbackBuffer** lives in `src/src/app/services/` but is imported by 4 Electron main-process files. Move to `src/shared/` or `electron/utils/`.
- **Preload script** (`electron/preload.ts`) exposes all IPC channels without a whitelist. Add `validChannels` filter from `IPC_CHANNELS`.
- **HTTP API** has no authentication — any LAN device can spawn PTY sessions.
- **`execSync('wmic ...')`** in pty-handlers.ts blocks the main process for up to 3 seconds. Replace with async.
- **WebSocket onExit handler** leaks — new handler per connection, never disposed on close.
- **Test coverage:** 15 of 18 backend modules have zero tests. StatusDetector (core heuristic) is untested.

## Custom Skills

Run `/skill-preflight` before committing. Available project-specific skills:

| Skill | Purpose |
|-------|---------|
| `/skill-add-ipc-channel` | Generate boilerplate for new IPC channel (constant + handler + HTTP + service) |
| `/skill-preflight` | Build + test + dual-transport consistency check |
| `/skill-integration-check` | Deep audit of IPC/HTTP/Angular channel consistency |
| `/skill-new-component` | Scaffold Angular standalone component with Catppuccin theme |
| `/skill-review-system` | Full system review via 3 parallel agents → `system-review.md` |
