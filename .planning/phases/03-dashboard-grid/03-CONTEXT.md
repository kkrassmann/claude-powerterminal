# Phase 3: Dashboard Grid - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Display multiple terminals simultaneously in a responsive grid layout with context information (working directory, Git branch, uncommitted changes count) in each tile's header. Users can view 6-10 active terminals at once, maximize individual tiles, and drag-drop to reorder.

</domain>

<decisions>
## Implementation Decisions

### Tile Header Design
- Two-line header layout with icons
- Line 1: Shortened working directory path (e.g. ~/p/my-app) + action buttons (restart, kill, maximize)
- Line 2: Git branch icon + branch name, uncommitted changes broken down as +added ~modified -deleted
- When working directory is not a git repo, hide the git line entirely (header becomes single-line)

### Grid Behavior
- Dynamic column count based on window width
- Minimum tile width ~400px — grid reduces columns when tiles would be smaller
- Fixed row height — all tiles in a row are the same height
- Vertical scrolling when tiles exceed viewport (tiles keep their size, page scrolls)

### Tile Resize & Focus
- No manual resize handles — tile sizes are determined by the grid only
- Maximize button: tile fills entire viewport, other tiles hidden. Toggle back to grid view.
- Double-click on header = maximize toggle (consistent with OS window behavior)
- Drag & drop reordering via header drag

### Status Updates & Refresh
- Git info (branch, changes) polled every 30 seconds
- Color change animation when uncommitted changes count changes (highlight then fade back)
- Branch change detection method: Claude's discretion (file watch vs polling based on effort/benefit)

### Claude's Discretion
- Branch change detection implementation (file watch vs polling)
- Exact Catppuccin Mocha color mapping for git status indicators
- Drag & drop animation/feedback style
- Header button icon choices and hover states

</decisions>

<specifics>
## Specific Ideas

- Header action buttons: restart, kill, maximize — visible at all times, not just on hover
- Git changes display like `+2 ~1 -0` — familiar to git users
- Shortened path style: intermediate dirs abbreviated, last dir full (~/p/my-app not ~/projects/m)
- Maximize should feel instant — no transition animation needed, just swap views

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-dashboard-grid*
*Context gathered: 2026-02-24*
