# Phase 1: Core PTY Infrastructure - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Spawn and manage Claude CLI PTY processes with Windows-specific workarounds and session persistence for restart recovery. Includes session creation (directory selection + CLI flags), process termination, and JSON-based session storage. No UI streaming (Phase 2), no grid layout (Phase 3), no status detection (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Session Restore on App Startup
- All saved sessions auto-restore immediately on app start via `--resume` flag
- No user prompt or selection — everything restores automatically
- Sessions start staggered (e.g., 2 second delay between each) to avoid CPU/RAM spikes
- If `--resume` fails, automatically start a new Claude session in the same working directory (transparent fallback)
- No session limit — user can run as many sessions as they want

### Terminal Lifecycle
- Session persistence is ONLY for crash/restart recovery
- When user manually closes a session: PTY process is killed AND session data is deleted permanently
- Confirm dialog before killing a terminal ("Terminal schliessen?")
- No "inactive sessions" list — closed means gone

### New Session Creation
- Directory selection via dropdown of recently used directories + freetext input for new paths
- Standard CLI flags exposed as checkboxes (e.g., `--dangerously-skip-permissions`, `--verbose`)
- Additional freetext field for custom/arbitrary flags
- Global default flags configurable in app settings, overridable per session at creation time

### Persistence Strategy
- Storage: JSON file (sessions.json) in app directory — no migrations, easy to debug
- Data per session: Session-ID, working directory, CLI flags, creation timestamp
- Scrollback buffer NOT persisted to disk (only in-memory during session lifetime)
- Write immediately on every change (create, close) — no periodic batching
- App config (global default flags, etc.) stored in separate config file (JSON), not in sessions.json

### Claude's Discretion
- Windows kill behavior: force-kill timeout and conhost.exe cleanup approach
- Scrollback buffer size (10k lines as starting point from success criteria)
- Exact stagger timing for session restore
- JSON file format / structure details
- Error notification approach for kill failures

</decisions>

<specifics>
## Specific Ideas

- Reference `claude-terminal-overseer` patterns for Windows PTY workarounds (SIGKILL timeout, ConoutConnection thread cleanup)
- Claude CLI supports `--session-id` for creation and `--resume` for restoration
- Environment sanitization: remove CLAUDECODE vars so nested Claude sessions work

</specifics>

<deferred>
## Deferred Ideas

- Auto-workspace from Git (clone repo + checkout branch for reviews) — user initially requested but pulled back. Could be a future phase for streamlined code review setup
- Browse dialog for directory selection — could enhance UX later but freetext + recent is sufficient for v1

</deferred>

---

*Phase: 01-core-pty-infrastructure*
*Context gathered: 2026-02-24*
