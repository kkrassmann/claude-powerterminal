# Phase 9: Local Code Review Panel - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrated diff viewer in the dashboard so users can review Claude's code changes inline — with syntax highlighting, per-hunk accept/reject, inline comments, and intelligent file ordering — without switching to an external editor. Automated code analysis/scoring is out of scope (deferred).

</domain>

<decisions>
## Implementation Decisions

### Diff Display
- Side-by-side and Unified diff views with a toggle button (default: side-by-side)
- 3 lines of context around changes (standard git diff default)
- Word-level diffs: changed words/characters highlighted inline within modified lines (like GitHub)
- New/added files shown collapsed by default with filename + line count header; click to expand
- Files can be marked as "reviewed" which collapses them back — visual progress indicator

### Intelligent File Ordering
- Changed files sorted in logical project-aware order, not alphabetical
- System detects project type (API, Angular, etc.) and orders files by architectural layer
- Example for API: routes → managers/services → brokers → persistence/models → tests
- Project-type detection is automatic via heuristics (file patterns, directory structure)
- Fallback to alphabetical when project type is unclear

### Panel Placement
- Fullscreen overlay covering the entire dashboard (dashboard continues running underneath)
- Layout: file tree panel on the left, diff view on the right
- File tree displays full directory structure (like VS Code explorer), not flat list
- Status indicators on files: Modified (M), Added (A), Deleted (D)
- Close via X-button (top right) and Escape key — no confirmation dialog

### File Navigation
- Click file in tree to view its diff
- Prev/Next buttons at the top of the diff view for sequential file browsing
- Keyboard shortcuts for navigation (up/down arrows in tree, Enter to open)

### Review Workflow
- "Review Changes" button appears in tile header when terminal status is WAITING or DONE AND uncommitted changes exist (git status check)
- Accept: marks hunk/file as accepted (visual confirmation, no git action needed)
- Reject: immediately reverts the hunk/file via `git checkout -p` / `git restore -p`
- Undo button appears after each reject (timed, ~10 seconds) as safety net
- File-level bulk operations: "Accept All" / "Reject All" buttons in each file header
- No global "Accept All Remaining" — review should be per-file at minimum

### Inline Comments
- Click on a diff line to add a comment — appears in a sidebar list on the right side of the diff view
- Each comment is a trackable task item with a checkbox (can be checked off as resolved)
- Two sending modes per comment:
  - "Send Now" — immediately injects the comment as a prompt into the terminal, Claude starts working
  - "Send Summary" — collects all comments for a file and sends them as one structured prompt
- Send format: structured prompt — "Review-Feedback für [filename]:\n- Zeile 42: [comment]\n- Zeile 87: [comment]"
- Comments persist per terminal session (survive panel close, cleared when terminal session ends)
- Clicking a comment in the sidebar jumps to the relevant diff line

### Claude's Discretion
- Exact heuristics for project-type detection and layer ordering
- Syntax highlighting library/approach choice
- Exact keyboard shortcut mappings
- Undo button timing and animation
- Comment sidebar styling and layout details
- How git operations (restore, checkout) are executed safely in the background

</decisions>

<specifics>
## Specific Ideas

- "Bei einer API zum Beispiel mit der Routen-Definition, dann Manager, Broker, Persistenz und zum Schluss die Tests" — clear architectural layer ordering expectation
- Comments should function as a mini review checklist — write comments, send them, check them off as resolved
- "Send Now" enables an interactive review loop: spot issue → comment → Claude fixes → verify
- "Send Summary" enables batch feedback: review entire file → send all issues at once

</specifics>

<deferred>
## Deferred Ideas

- **Automated Standard Reviews** — System automatically evaluates Architecture, Code Quality, Security, and Test Quality of changes and displays scores/findings. This is a separate analytical capability requiring static analysis rules, scoring logic, and a review engine. Belongs in its own phase.

</deferred>

---

*Phase: 09-local-code-review-panel*
*Context gathered: 2026-02-28*
