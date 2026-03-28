# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [1.2.0] - 2026-03-28

### Features

- Fix remote browser access, add auto-mode permission selector and dev port isolation (37790b4)
- Sync session groups to remote browser via HTTP API (0778e28)
- Send PTY dimensions to non-owner clients for correct rendering (b6d7f8a)
- Add explorer, debugger agents and skill-debug pipeline (4a74824)
- Add review-reuse/efficiency/security agents, implement-pipeline, and skill-implement/skill-code (a53ddf5)
- Add test-generator agent with CPT-specific Vitest patterns (b09ca06)

### Bug Fixes

- Resolve all 41 system review findings — 3 critical, 14 major, 24 minor (db5354e)
- Only first connected client controls PTY resize — resize ownership (f07cbe4)
- Let non-owner clients use their own terminal size without PTY resize (c235e18)
- Add /api/app/info endpoint for LAN URL + fix HTTP base URL in dev mode (0f5b088)
- Correct HTTP base URL for dev mode, disable auth temporarily (0c87861)
- Bidirectional group sync between desktop and remote browser (d1ea679)
- Add cache-control headers and diagnostic logging for group sync (c77dde0)

### Refactoring

- Migrate all Angular services to HTTP-only — single source of truth (c31d83a)

### Tests

- Boost coverage from 63% to 75% with 90 new tests — 434 total (6b80c80)
- Add 5 resize ownership tests for WebSocket multi-client sessions (91293cc)
- Add critical backend test suites — 147 new tests (c2a7412)
- Add comprehensive HTTP route test suite — 82 tests (79552ed)

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
