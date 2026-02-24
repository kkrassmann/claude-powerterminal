# Phase 3: Dashboard Grid - Research

**Researched:** 2026-02-24
**Domain:** CSS Grid responsive layout, Angular CDK drag-drop, Git context detection (branch, changes), tile header UX
**Confidence:** HIGH

## Summary

Phase 3 transforms the existing flat terminal list into a responsive grid dashboard with context-rich tile headers. The work divides into three distinct domains: (1) CSS Grid layout with dynamic column count, maximize toggle, and vertical scrolling; (2) Angular CDK drag-drop for tile reorder via header handles; (3) Git context detection from the Electron main process using `child_process.execFile` to run `git` commands per session's working directory.

The current app already renders multiple terminals in a basic 2-column CSS Grid (`app.component.css`). Phase 3 replaces this with a dynamic `repeat(auto-fill, minmax(400px, 1fr))` grid, wraps each terminal in a tile component with a two-line header, and adds a maximize mode that hides the grid and shows a single terminal full-viewport. The tile header displays shortened working directory, action buttons, Git branch, and uncommitted change counts.

For Git context, the cleanest approach is a new IPC channel that the renderer polls every 30 seconds. The Electron main process runs `git rev-parse --abbrev-ref HEAD` and `git status --porcelain` in each session's working directory. This avoids spawning watchers or file system listeners for a 30-second poll interval -- polling is simpler, more reliable, and cheaper than file watching for this refresh rate.

**Primary recommendation:** Use pure CSS Grid with `auto-fill`/`minmax()` for responsive columns (no grid library needed), Angular CDK `@angular/cdk/drag-drop` for reorder, and a new `GitContextService` IPC channel on the Electron main process that shells out to `git` CLI. No additional npm dependencies beyond `@angular/cdk@17`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Tile Header Design:** Two-line header layout with icons. Line 1: Shortened working directory path (e.g. ~/p/my-app) + action buttons (restart, kill, maximize). Line 2: Git branch icon + branch name, uncommitted changes broken down as +added ~modified -deleted. When working directory is not a git repo, hide the git line entirely (header becomes single-line).
- **Grid Behavior:** Dynamic column count based on window width. Minimum tile width ~400px -- grid reduces columns when tiles would be smaller. Fixed row height -- all tiles in a row are the same height. Vertical scrolling when tiles exceed viewport (tiles keep their size, page scrolls).
- **Tile Resize & Focus:** No manual resize handles -- tile sizes are determined by the grid only. Maximize button: tile fills entire viewport, other tiles hidden. Toggle back to grid view. Double-click on header = maximize toggle (consistent with OS window behavior). Drag & drop reordering via header drag.
- **Status Updates & Refresh:** Git info (branch, changes) polled every 30 seconds. Color change animation when uncommitted changes count changes (highlight then fade back). Branch change detection method: Claude's discretion (file watch vs polling based on effort/benefit).

### Claude's Discretion
- Branch change detection implementation (file watch vs polling)
- Exact Catppuccin Mocha color mapping for git status indicators
- Drag & drop animation/feedback style
- Header button icon choices and hover states

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TERM-02 | User can view all active terminals simultaneously in a responsive grid layout (supports 6-10 terminals) | CSS Grid with `repeat(auto-fill, minmax(400px, 1fr))` auto-calculates column count. Tiles maintain minimum 400px width, grid wraps to fewer columns on narrow viewports. Vertical scroll when rows exceed viewport. |
| CTXT-01 | Terminal header displays the working directory path | Tile header component reads `session.metadata.workingDirectory` (already available in `ActiveSession`). Path shortened with algorithm: intermediate dirs abbreviated to first char, last segment full (e.g. `~/p/my-app`). |
| CTXT-02 | Terminal header displays the current Git branch name | New IPC channel `git:context` on Electron main process runs `git rev-parse --abbrev-ref HEAD` in session's working directory. Renderer polls every 30s via service. Non-git dirs return null (hide git line). |
| CTXT-03 | Terminal header displays the count of uncommitted Git changes | Same IPC handler runs `git status --porcelain` and parses output: count lines starting with `A`/`?` as added, `M` as modified, `D` as deleted. Displayed as `+2 ~1 -0` in header. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @angular/cdk | ^17.3.0 | Drag-drop module for tile reorder | Official Angular CDK, same major version as project's Angular 17. Provides `cdkDrag`, `cdkDragHandle`, `cdkDropList`, `moveItemInArray`. No full Material needed. |
| CSS Grid (native) | -- | Responsive grid layout | Built into all modern browsers. `auto-fill` + `minmax()` provides exact behavior needed (dynamic columns, minimum width). No library required. |
| Node.js child_process | built-in | Execute `git` CLI commands from Electron main process | `execFile` is the safe choice for running `git` with arguments (no shell injection). Already available in Electron main process. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @angular/cdk/drag-drop | ^17.3.0 (part of @angular/cdk) | Drag handles, drop events, array reorder utilities | For tile drag-drop reorder in grid |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS Grid auto-fill | gridstack.js / angular-gridster2 | Grid libraries add drag-resize, but user explicitly decided "no manual resize handles -- tile sizes determined by grid only." CSS Grid is simpler and sufficient. |
| @angular/cdk drag-drop | SortableJS / ngx-sortable | CDK is official Angular, maintained by Angular team, matches project version. Third-party alternatives add bundle size and version coupling risk. |
| git CLI via child_process | simple-git / isomorphic-git | `simple-git` wraps git CLI with nice API but adds a dependency for 2 commands. `isomorphic-git` is pure JS but massive (800KB+). Two `execFile` calls are trivially simple. |
| Polling every 30s | fs.watch on .git/HEAD + .git/index | File watching is more responsive but fragile: `.git/HEAD` is a file (not always rewritten on branch change), `.git/index` is binary and changes on any staging operation. 30s polling is the locked decision and simpler to implement reliably on Windows. |

**Installation:**
```bash
# In the Angular project (src/)
cd src && npm install @angular/cdk@^17.3.0
```

No other new dependencies needed. `child_process` is Node.js built-in.

## Architecture Patterns

### Recommended Project Structure
```
src/src/app/
├── components/
│   ├── dashboard/
│   │   ├── dashboard.component.ts      # Grid container, drag-drop, maximize state
│   │   ├── dashboard.component.html    # CSS Grid layout, cdkDropList
│   │   └── dashboard.component.css     # Grid styles, maximize mode
│   ├── tile-header/
│   │   ├── tile-header.component.ts    # Header with path, git info, buttons
│   │   ├── tile-header.component.html  # Two-line header layout
│   │   └── tile-header.component.css   # Header styles, change animation
│   ├── terminal/                        # Existing (Phase 2)
│   └── session-create/                  # Existing (Phase 1)
├── services/
│   ├── git-context.service.ts          # NEW: Polls git info per session via IPC
│   └── ... (existing services)
├── models/
│   ├── git-context.model.ts            # NEW: GitContext interface
│   └── ... (existing models)
electron/
├── ipc/
│   ├── git-handlers.ts                 # NEW: IPC handlers for git commands
│   └── ... (existing handlers)
```

### Pattern 1: Responsive CSS Grid with Dynamic Columns
**What:** CSS Grid with `auto-fill` and `minmax()` for automatic column adjustment based on viewport width
**When to use:** The main grid container that holds all terminal tiles

```css
/* Source: CSS Grid specification - auto-fill with minmax() */
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 4px;
  padding: 4px;
  overflow-y: auto;     /* Vertical scroll when tiles exceed viewport */
  overflow-x: hidden;
}

/* All tiles in a row are same height (grid default behavior with fixed row sizing) */
.dashboard-grid {
  grid-auto-rows: minmax(350px, 1fr); /* Minimum tile height, grow equally */
}
```

**How it works:**
- At 1600px viewport: `floor(1600 / 400) = 4` columns, each tile ~400px
- At 1200px viewport: `floor(1200 / 400) = 3` columns, each tile ~400px
- At 800px viewport: `floor(800 / 400) = 2` columns, each tile ~400px
- At 400px viewport: 1 column, tile fills width

This matches the locked decision: "Dynamic column count based on window width. Minimum tile width ~400px."

### Pattern 2: Maximize Mode (Tile fills viewport)
**What:** Toggle between grid view and single-tile maximized view
**When to use:** When user clicks maximize button or double-clicks tile header

```typescript
// Dashboard component state
maximizedSessionId: string | null = null;

toggleMaximize(sessionId: string): void {
  this.maximizedSessionId = this.maximizedSessionId === sessionId ? null : sessionId;
}
```

```html
<!-- Grid view: show all tiles -->
<div class="dashboard-grid" *ngIf="!maximizedSessionId">
  <div *ngFor="let session of sessions" class="tile" cdkDrag>
    <app-tile-header [session]="session" (maximize)="toggleMaximize(session.metadata.sessionId)" cdkDragHandle></app-tile-header>
    <app-terminal [sessionId]="session.metadata.sessionId"></app-terminal>
  </div>
</div>

<!-- Maximized view: single tile fills viewport -->
<div class="maximized-view" *ngIf="maximizedSessionId">
  <app-tile-header [session]="getSession(maximizedSessionId)" (maximize)="toggleMaximize(maximizedSessionId)"></app-tile-header>
  <app-terminal [sessionId]="maximizedSessionId"></app-terminal>
</div>
```

Per user decision: "Maximize should feel instant -- no transition animation needed, just swap views."

### Pattern 3: Angular CDK Drag-Drop with Header Handle
**What:** Reorder tiles by dragging via the header area
**When to use:** Grid view (not maximized view)

```typescript
// Source: Context7 /angular/components/17.3.10 - CDK drag-drop API
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

// In dashboard component
onDrop(event: CdkDragDrop<ActiveSession[]>): void {
  moveItemInArray(this.sessions, event.previousIndex, event.currentIndex);
  // Persist order if desired (e.g., localStorage)
}
```

```html
<div class="dashboard-grid" cdkDropList
     [cdkDropListData]="sessions"
     (cdkDropListDropped)="onDrop($event)">
  <div *ngFor="let session of sessions" class="tile" cdkDrag>
    <div class="tile-header" cdkDragHandle>
      <!-- Header content - this is the drag handle -->
    </div>
    <app-terminal [sessionId]="session.metadata.sessionId"></app-terminal>
  </div>
</div>
```

**Important:** CDK drag-drop uses `cdkDragHandle` to restrict the draggable area to the header only. Without it, dragging anywhere on the tile (including the terminal) would initiate a drag, breaking terminal interaction.

**CDK drag-drop with CSS Grid caveat:** Angular CDK's `cdkDropList` with CSS Grid wrapping layout can have issues with sorting animations because CDK assumes a single-axis list. Two solutions:
1. Use `cdkDropListOrientation="mixed"` (available in CDK 17+) -- **this is the recommended approach** for grid/wrapping layouts
2. Manage the array indices manually

### Pattern 4: Git Context via IPC + child_process
**What:** Electron main process runs `git` commands and returns results via IPC
**When to use:** Every 30 seconds per session, or on demand

```typescript
// electron/ipc/git-handlers.ts
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface GitContext {
  branch: string | null;       // Current branch name, null if not a git repo
  added: number;               // Untracked + staged new files
  modified: number;            // Modified files (staged + unstaged)
  deleted: number;             // Deleted files
  isGitRepo: boolean;
}

async function getGitContext(cwd: string): Promise<GitContext> {
  try {
    // Get current branch
    const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });

    // Get file status
    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd });

    let added = 0, modified = 0, deleted = 0;
    for (const line of status.split('\n').filter(l => l.trim())) {
      const code = line.substring(0, 2);
      if (code.includes('?') || code.includes('A')) added++;
      else if (code.includes('M')) modified++;
      else if (code.includes('D')) deleted++;
    }

    return { branch: branch.trim(), added, modified, deleted, isGitRepo: true };
  } catch {
    return { branch: null, added: 0, modified: 0, deleted: 0, isGitRepo: false };
  }
}
```

**Why `execFile` instead of `exec`:** `execFile` does not spawn a shell, which avoids shell injection if `cwd` contains special characters. It also has lower overhead.

**Why poll from renderer, not push from main:** The renderer knows which sessions are visible. A 30-second `setInterval` in the `GitContextService` calls the IPC handler for each active session. This avoids setting up timers in the main process and keeps the polling lifecycle tied to the Angular component lifecycle (stops when component is destroyed).

### Pattern 5: Path Shortening Algorithm
**What:** Abbreviate intermediate directory segments, keep last segment full
**When to use:** Display working directory in tile header

```typescript
// Source: User decision - "intermediate dirs abbreviated, last dir full (~/p/my-app not ~/projects/m)"
function shortenPath(fullPath: string): string {
  // Normalize separators
  const normalized = fullPath.replace(/\\/g, '/');

  // Replace home directory with ~
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const homeNormalized = home.replace(/\\/g, '/');
  const withTilde = homeNormalized && normalized.startsWith(homeNormalized)
    ? '~' + normalized.slice(homeNormalized.length)
    : normalized;

  const parts = withTilde.split('/').filter(Boolean);
  if (parts.length <= 2) return withTilde; // Already short enough

  // Abbreviate all but last segment to first character
  const abbreviated = parts.map((part, i) =>
    i === parts.length - 1 ? part : part[0]
  );

  return (withTilde.startsWith('/') ? '/' : '') + abbreviated.join('/');
}

// Examples:
// C:\Users\Konstantin\projects\my-app -> ~/p/my-app
// /home/user/dev/project/frontend     -> ~/d/p/frontend
// ~/projects/my-app                   -> ~/p/my-app (already short)
```

**Note:** This should run on the renderer side (in the tile-header component or a utility function) since `workingDirectory` is already available in `SessionMetadata`. No IPC needed for path shortening. The home directory path can be passed once from main process during init or derived from the working directory pattern.

### Pattern 6: Change Highlight Animation
**What:** Brief color animation when uncommitted changes count changes
**When to use:** When GitContext update shows different change counts from previous poll

```css
/* Catppuccin Mocha palette for git indicators */
.git-changes {
  transition: background-color 0.3s ease;
}

.git-changes.highlight {
  background-color: rgba(249, 226, 175, 0.2); /* Catppuccin yellow, semi-transparent */
  animation: change-pulse 1.5s ease-out;
}

@keyframes change-pulse {
  0%   { background-color: rgba(249, 226, 175, 0.3); }
  100% { background-color: transparent; }
}

/* Git status colors using Catppuccin Mocha */
.git-added   { color: #a6e3a1; }  /* green */
.git-modified { color: #f9e2af; } /* yellow */
.git-deleted  { color: #f38ba8; } /* red */
.git-branch   { color: #cba6f7; } /* mauve/purple - distinct from status colors */
```

### Anti-Patterns to Avoid
- **Using a third-party grid library (gridstack, angular-gridster2):** User explicitly said "no manual resize handles -- tile sizes determined by grid only." CSS Grid does this natively. Grid libraries add 50-100KB for features that are explicitly out of scope.
- **Running `git` commands in the renderer process:** The renderer is sandboxed (`contextIsolation: true`, `nodeIntegration: false`). Git commands must go through IPC to the main process.
- **Polling git from the main process on a global timer:** Polling should be driven by the renderer (knows which sessions are visible, ties to component lifecycle). Main process just responds to IPC requests.
- **Using `git log` or `git diff` for change detection:** `git status --porcelain` is specifically designed for machine parsing. It is stable across git versions and gives exactly the change counts needed. `git diff` output is harder to parse and slower for large repos.
- **Watching `.git/HEAD` for branch changes:** On Windows, file watchers on `.git/` are unreliable (locked files, atomic rename patterns, antivirus interference). The user locked 30-second polling as the refresh interval -- just poll.
- **Disabling xterm.js interaction during drag:** `cdkDragHandle` on the header restricts drag initiation to the header area. The terminal below the header remains fully interactive during drag operations by other tiles.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag-drop reorder in grid | Custom mousedown/mousemove/mouseup handlers with position calculation | @angular/cdk/drag-drop with cdkDragHandle | CDK handles drop animation, placeholder, scroll during drag, touch support, accessibility (keyboard reorder). 500+ lines of code you'd write. |
| Dynamic CSS Grid columns | JavaScript calculating column count + `grid-template-columns` | CSS `repeat(auto-fill, minmax(400px, 1fr))` | Browser handles column calculation on every resize, no JavaScript needed, no debounce, no race conditions. |
| Git status parsing | Regex on `git diff` or `git log` output | `git status --porcelain` | Porcelain format is machine-stable: exactly 2-char status code + filename per line. Designed for scripting. Never changes format between git versions. |
| Path shortening | Complex path parsing with edge cases | Simple split + map + join | The algorithm is 10 lines. Don't import a library for this. |

**Key insight:** The grid layout is pure CSS. The drag-drop is handled by CDK (already the standard for Angular). The git detection is two shell commands. There is no complex domain here that requires custom solutions -- the complexity is in wiring these pieces together cleanly.

## Common Pitfalls

### Pitfall 1: CDK Drag-Drop with CSS Grid Wrapping Layout
**What goes wrong:** Dragging items in a CSS Grid with wrapping (`auto-fill`) causes visual glitches. Items jump to wrong positions, animations are wrong.
**Why it happens:** CDK drag-drop historically assumed items flow in a single axis (vertical list or horizontal list). A CSS Grid with `auto-fill` wraps items across rows, which confuses the position calculation.
**How to avoid:** Use `cdkDropListOrientation="mixed"` -- added in Angular CDK 17 specifically for grid/wrapping layouts. This tells CDK to handle both horizontal and vertical movement.
**Warning signs:** Items snap to wrong positions during drag, placeholders appear in wrong grid cells.

### Pitfall 2: Terminal Resize Cascade on Grid Column Change
**What goes wrong:** When viewport narrows and grid drops from 3 to 2 columns, all terminals resize simultaneously, causing a storm of resize events and PTY resize messages.
**Why it happens:** Each terminal's `ResizeObserver` fires when its container changes size due to grid reflow.
**How to avoid:** The existing 200ms debounce in `terminal.component.ts` already handles this. Verify it works correctly when multiple terminals resize simultaneously. Each terminal has its own debounce timer, so they'll all settle independently.
**Warning signs:** High CPU during window resize, garbled terminal output, multiple resize messages in quick succession.

### Pitfall 3: `git status` Slow on Large Repos
**What goes wrong:** 30-second polling takes longer than 30 seconds for repos with many files (monorepos, node_modules not gitignored).
**Why it happens:** `git status` walks the entire working tree by default.
**How to avoid:** Use `git status --porcelain --untracked-files=normal` (the default). For very large repos, `git status` has its own internal caching. Set a timeout (e.g., 5 seconds) on the `execFile` call -- if git takes too long, skip that poll cycle.
**Warning signs:** Git context info lags behind actual state, main process CPU spikes every 30 seconds.

### Pitfall 4: WebGL Context Limit with Many Terminals
**What goes wrong:** After opening 8+ terminals, new terminals fail to create WebGL context. Blank terminal areas, console errors.
**Why it happens:** Browsers limit the number of active WebGL contexts (Chrome: ~16, but can be lower). Each terminal with WebGL addon uses one context.
**How to avoid:** The existing `WebglAddon.onContextLoss()` handler in `terminal.component.ts` already falls back to DOM renderer. Additionally, for terminals that are not visible (in maximized mode, below the fold), consider not loading WebGL addon or disposing it when off-screen. For 6-10 terminals, this should be within limits, but monitor.
**Warning signs:** Later-created terminals have blank areas, "WebGL context lost" in console.

### Pitfall 5: Home Directory Detection on Windows
**What goes wrong:** Path shortening fails to replace home directory with `~`, showing full `C:\Users\Username\...` paths.
**Why it happens:** `process.env.HOME` is not set on Windows. `process.env.USERPROFILE` is the Windows equivalent but the renderer process (sandboxed) doesn't have access to environment variables.
**How to avoid:** Pass the home directory from the main process to the renderer once at startup (via IPC or preload script). Or detect it from the working directory pattern. Alternatively, do path shortening in the main process and include the shortened path in the git context response.
**Warning signs:** All paths show full Windows paths instead of `~/...` prefix.

### Pitfall 6: Drag-Drop Breaking Terminal Interaction
**What goes wrong:** User tries to click/type in terminal but accidentally initiates a tile drag.
**Why it happens:** `cdkDrag` without a handle makes the entire element draggable.
**How to avoid:** Always use `cdkDragHandle` on the tile header element. The terminal area below the header should NOT be part of the drag handle. CDK correctly scopes drag initiation to the handle element only.
**Warning signs:** Clicking in terminal starts a drag instead of focusing the terminal.

### Pitfall 7: Maximize Toggle Loses Terminal State
**What goes wrong:** Terminal appears to reset or disconnect when switching between grid and maximized view.
**Why it happens:** If maximize/minimize causes the terminal component to be destroyed and recreated (e.g., by removing it from the DOM with `*ngIf`), the xterm.js instance and WebSocket connection are lost.
**How to avoid:** Use CSS to hide/show tiles rather than destroying them. In grid view, hide non-maximized tiles with `display: none` or `visibility: hidden`. Keep all terminal components alive in the DOM. Alternatively, use the existing approach where the terminal component manages its own WebSocket -- it already handles reconnection.
**Warning signs:** Terminal goes blank after un-maximize, WebSocket reconnection messages in console.

## Code Examples

Verified patterns from official sources:

### Complete Dashboard Grid Template
```html
<!-- Dashboard component template -->
<!-- Grid view -->
<div class="dashboard-grid"
     *ngIf="!maximizedSessionId"
     cdkDropList
     cdkDropListOrientation="mixed"
     [cdkDropListData]="sessions"
     (cdkDropListDropped)="onDrop($event)">

  <div *ngFor="let session of sessions; trackBy: trackBySessionId"
       class="tile"
       cdkDrag>

    <app-tile-header
      [session]="session"
      [gitContext]="gitContexts.get(session.metadata.sessionId)"
      (maximize)="toggleMaximize(session.metadata.sessionId)"
      (restart)="restartSession(session.metadata.sessionId)"
      (kill)="killSession(session.metadata.sessionId)"
      cdkDragHandle>
    </app-tile-header>

    <app-terminal
      [sessionId]="session.metadata.sessionId"
      (sessionExited)="onSessionExited($event)">
    </app-terminal>

  </div>
</div>

<!-- Maximized view -->
<div class="maximized-view" *ngIf="maximizedSessionId">
  <app-tile-header
    [session]="getSession(maximizedSessionId)"
    [gitContext]="gitContexts.get(maximizedSessionId)"
    [isMaximized]="true"
    (maximize)="toggleMaximize(maximizedSessionId)"
    (restart)="restartSession(maximizedSessionId)"
    (kill)="killSession(maximizedSessionId)">
  </app-tile-header>

  <app-terminal
    [sessionId]="maximizedSessionId"
    (sessionExited)="onSessionExited($event)">
  </app-terminal>
</div>
```

### Tile Header Component Template
```html
<!-- tile-header.component.html -->
<div class="header-line-1">
  <span class="working-dir" [title]="session.metadata.workingDirectory">
    {{ shortenedPath }}
  </span>
  <div class="header-actions">
    <button class="header-btn" (click)="restart.emit()" title="Restart">
      <!-- restart icon (Unicode or SVG) -->
      &#x21BB;
    </button>
    <button class="header-btn" (click)="kill.emit()" title="Kill">
      &#x2715;
    </button>
    <button class="header-btn" (click)="maximize.emit()" [title]="isMaximized ? 'Restore' : 'Maximize'">
      {{ isMaximized ? '&#x29C9;' : '&#x25A1;' }}
    </button>
  </div>
</div>

<div class="header-line-2" *ngIf="gitContext?.isGitRepo">
  <span class="git-branch">
    <!-- branch icon -->&#xE0A0; {{ gitContext.branch }}
  </span>
  <span class="git-changes" [class.highlight]="changesHighlighted">
    <span class="git-added">+{{ gitContext.added }}</span>
    <span class="git-modified">~{{ gitContext.modified }}</span>
    <span class="git-deleted">-{{ gitContext.deleted }}</span>
  </span>
</div>
```

### Git Context IPC Handler (Electron main process)
```typescript
// electron/ipc/git-handlers.ts
import { ipcMain } from 'electron';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitContext {
  branch: string | null;
  added: number;
  modified: number;
  deleted: number;
  isGitRepo: boolean;
}

export function registerGitHandlers(): void {
  ipcMain.handle('git:context', async (_event, cwd: string): Promise<GitContext> => {
    try {
      const [branchResult, statusResult] = await Promise.all([
        execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 5000 }),
        execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 5000 }),
      ]);

      let added = 0, modified = 0, deleted = 0;
      for (const line of statusResult.stdout.split('\n')) {
        if (!line.trim()) continue;
        const xy = line.substring(0, 2);
        // Untracked (??) or Added (A)
        if (xy.includes('?') || xy.trimStart().startsWith('A')) added++;
        // Modified (M) in either index or working tree
        else if (xy.includes('M')) modified++;
        // Deleted (D) in either index or working tree
        else if (xy.includes('D')) deleted++;
      }

      return {
        branch: branchResult.stdout.trim(),
        added,
        modified,
        deleted,
        isGitRepo: true,
      };
    } catch {
      return { branch: null, added: 0, modified: 0, deleted: 0, isGitRepo: false };
    }
  });
}
```

### Git Context Service (Angular renderer)
```typescript
// src/src/app/services/git-context.service.ts
import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface GitContext {
  branch: string | null;
  added: number;
  modified: number;
  deleted: number;
  isGitRepo: boolean;
}

@Injectable({ providedIn: 'root' })
export class GitContextService implements OnDestroy {
  private contexts = new BehaviorSubject<Map<string, GitContext>>(new Map());
  public contexts$ = this.contexts.asObservable();
  private pollInterval: any = null;
  private trackedSessions = new Map<string, string>(); // sessionId -> cwd

  startPolling(): void {
    if (this.pollInterval) return;
    this.pollAll(); // Immediate first poll
    this.pollInterval = setInterval(() => this.pollAll(), 30000);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  trackSession(sessionId: string, cwd: string): void {
    this.trackedSessions.set(sessionId, cwd);
  }

  untrackSession(sessionId: string): void {
    this.trackedSessions.delete(sessionId);
    const current = this.contexts.value;
    current.delete(sessionId);
    this.contexts.next(current);
  }

  private async pollAll(): Promise<void> {
    const current = this.contexts.value;
    for (const [sessionId, cwd] of this.trackedSessions) {
      try {
        const context = await window.electronAPI.invoke('git:context', cwd);
        current.set(sessionId, context);
      } catch {
        // Silent failure -- keep previous value
      }
    }
    this.contexts.next(new Map(current));
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }
}
```

### CSS Grid Dashboard Styles
```css
/* dashboard.component.css */
:host {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.dashboard-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  grid-auto-rows: minmax(300px, 1fr);
  gap: 4px;
  padding: 4px;
  overflow-y: auto;
  overflow-x: hidden;
}

.tile {
  display: flex;
  flex-direction: column;
  border: 1px solid #313244;
  border-radius: 4px;
  overflow: hidden;
  background: #1e1e2e;
}

.tile app-terminal {
  flex: 1;
  min-height: 0;  /* Critical: allows flex child to shrink below content size */
}

.maximized-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.maximized-view app-terminal {
  flex: 1;
  min-height: 0;
}

/* CDK drag-drop styling */
.cdk-drag-preview {
  box-sizing: border-box;
  border: 1px solid #cba6f7;
  border-radius: 4px;
  box-shadow: 0 5px 25px rgba(0, 0, 0, 0.5);
  opacity: 0.85;
}

.cdk-drag-placeholder {
  background: #11111b;
  border: 2px dashed #45475a;
  border-radius: 4px;
  opacity: 0.5;
}

.cdk-drag-animating {
  transition: transform 200ms cubic-bezier(0, 0, 0.2, 1);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Grid libraries (gridstack, angular-gridster2) | CSS Grid `auto-fill`/`minmax()` for simple responsive grids | CSS Grid Level 1 (2017, widely supported since 2018) | No JavaScript needed for column calculation. Browser handles responsive layout natively. |
| CDK drag-drop vertical/horizontal only | `cdkDropListOrientation="mixed"` for grid layouts | Angular CDK 17 (Nov 2023) | Enables CDK drag-drop in CSS Grid wrapping layouts without hacks |
| `exec()` for shell commands | `execFile()` for direct binary execution | Always available, but `execFile` is safer | No shell injection risk, slightly lower overhead |
| `git diff --stat` for change counts | `git status --porcelain` | Always the right choice for scripts | Stable machine-parseable format, handles all edge cases |

**Deprecated/outdated:**
- **gridstack.js for simple responsive grids:** Overkill when CSS Grid handles the layout natively. Gridstack is for drag-resize scenarios (which are explicitly out of scope).
- **CDK drag-drop without `orientation="mixed"`:** Prior to CDK 17, grid layouts required custom position tracking hacks. The `mixed` orientation mode solves this cleanly.

## Open Questions

1. **CDK drag-drop preview rendering with terminal content**
   - What we know: CDK creates a preview element (clone of the dragged item) that follows the cursor. This clone includes the terminal DOM content.
   - What's unclear: Whether the xterm.js canvas/WebGL content renders correctly in the CDK preview clone. Canvas elements may not clone properly.
   - Recommendation: Test during implementation. If the preview looks broken, use `*cdkDragPreview` to provide a simplified preview (just the header + a placeholder rectangle with the terminal's background color). This is actually better UX anyway -- a lightweight preview is less visually noisy than a full terminal clone.

2. **Home directory path for Windows renderer**
   - What we know: The renderer process is sandboxed and doesn't have access to `process.env.USERPROFILE`.
   - What's unclear: How to pass the home directory to the renderer for path shortening.
   - Recommendation: Either (a) expose it via the preload script as a one-time value, or (b) do path shortening in the main process alongside git context and return the shortened path. Option (b) is simpler -- add a `shortenedPath` field to the git context response, or create a separate one-time IPC call.

3. **Tile order persistence**
   - What we know: CDK drag-drop reorders the array in memory. App restart resets order.
   - What's unclear: Whether tile order should persist across sessions.
   - Recommendation: Start without persistence (order resets on restart). Add `localStorage` persistence later if users request it. Low effort to add but not required by any phase requirement.

## Sources

### Primary (HIGH confidence)
- Context7 `/angular/components/17.3.10` - CDK drag-drop API: `cdkDrag`, `cdkDragHandle`, `cdkDropList`, `moveItemInArray`, `CdkDragDrop` event type, `cdkDropListOrientation`
- CSS Grid specification (MDN) - `auto-fill`, `minmax()`, `grid-auto-rows` behavior
- Git documentation - `git status --porcelain` format, `git rev-parse --abbrev-ref HEAD`
- Node.js documentation - `child_process.execFile` for safe subprocess execution
- Existing codebase analysis - Current component structure, IPC patterns, Catppuccin Mocha theme colors

### Secondary (MEDIUM confidence)
- Angular CDK 17 release notes - `cdkDropListOrientation="mixed"` for grid layouts (verified via Context7 API showing `orientation: DropListOrientation` input)
- WebGL context limits in Chromium - ~16 contexts per page (commonly referenced, browser-specific)

### Tertiary (LOW confidence)
- CDK drag preview canvas cloning behavior - not verified, flagged as open question

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - CSS Grid is native browser feature, @angular/cdk@17 matches project version, child_process is Node.js built-in. All verified.
- Architecture: HIGH - Patterns follow existing codebase conventions (IPC handlers, services, component structure). CSS Grid responsive behavior is well-understood.
- Git detection: HIGH - `git status --porcelain` and `git rev-parse` are standard scripting patterns. `execFile` is the documented safe way to run subprocesses.
- Drag-drop in grid: MEDIUM - CDK `mixed` orientation is the right API but CDK drag-drop with CSS Grid wrapping has known edge cases. May need testing/tuning.
- Pitfalls: HIGH - All pitfalls are based on documented behavior (CDK grid limitations, WebGL context limits, Windows env vars).

**Research date:** 2026-02-24
**Valid until:** 2026-03-26 (30 days - all technologies are stable, CSS Grid and CDK drag-drop APIs are mature)
