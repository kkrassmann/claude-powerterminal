# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [1.1.1] - 2026-03-05

### Bug Fixes

- Session restart now reconnects WebSocket correctly (4402fbd)
- Kill button directly removes tile instead of relying on WebSocket round-trip (4402fbd)
- Session exit cleans up status tracking and group membership — fixes stale group badges (4402fbd)
- False alerts during typing fixed via StatusDetector.notifyInput() (4402fbd)
- Resized tiles respect explicit height (4402fbd)
- New sessions auto-assign to active group tab (4402fbd)
- Restart guard kept 5s to absorb delayed Windows PTY exit events (4402fbd)

### Features

- Scrollback persistence: instant write-through to rolling 1MB session log files (4402fbd)
- macOS build targets — dmg/zip for x64 + arm64 (4402fbd)
- Dev/release userData isolation — separate directories prevent file conflicts (4402fbd)
- Local code review panel foundation — IPC channels, shared types, Angular components (69e8f5a..fa2b9e4)

### Other Changes

- Port changes: Angular 4500, WS 9820, HTTP 9821 (4402fbd)
- Review button hidden until feature is complete (4402fbd)

## [1.1.0] - 2026-03-02

### Features

- Add deep audit engine with per-file LLM analysis and accordion UI (c06b5ca)
- Integrate worktree management into session creation dialog (ccce80a)
- Add Git Worktree Manager for listing, creating, and deleting worktrees (a235b2c)
- Add session templates for reusable session configurations (91dc1af)
- Add terminal grouping & layout presets (a0d9336)
- Add crash logger and pre-dist import verification (c566ba1)
- Add audit tab HTML, CSS, and raise CSS budget (52b5d36)
- Add AuditService and extend analysis-panel TypeScript (ab902a1)
- Wire audit engine into dual-transport layer (3239916)
- Add audit engine, shared types, and rule checklist (369c1d9)

### Bug Fixes

- Save and restore CLI flags in session templates (d060cb2)
- Group persistence, attention badges, terminal scroll behavior (10c3725)
- Use ESM imports in check-package-imports.mjs (f4536aa)
- Move ScrollbackBuffer to src/shared, add package import checker (518332a)
- Copy audit-prompt.md to dist during electron build (7985e80)
- Select session via tile header click, switch UI strings to English (e18beed)
