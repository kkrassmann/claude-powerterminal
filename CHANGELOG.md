# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

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
