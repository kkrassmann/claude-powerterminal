---
phase: 09-local-code-review-panel
plan: "02"
subsystem: code-review
tags: [angular, diff2html, components, catppuccin, typescript]
dependency_graph:
  requires:
    - 09-01 (CodeReviewService, code-review.model.ts types)
  provides:
    - CodeReviewPanelComponent: fullscreen overlay orchestrating file tree + diff viewer
    - FileTreeComponent: VS Code-style directory tree with A/M/D status indicators
    - DiffViewerComponent: diff2html-powered renderer with Catppuccin Mocha dark theme
  affects:
    - src/angular.json (diff2html CSS added to styles array)
    - src/package.json (diff2html ^3.4.56 dependency)
tech_stack:
  added:
    - diff2html ^3.4.56 (diff parsing, HTML rendering, word-level diffs)
  patterns:
    - ViewEncapsulation.None for diff2html CSS override scope
    - nativeElement.innerHTML direct assignment (bypasses Angular sanitizer)
    - Single-file diff extraction from full raw diff by header matching
    - Collapsed-by-default for added files with expand toggle
key_files:
  created:
    - src/src/app/components/code-review/code-review-panel.component.ts
    - src/src/app/components/code-review/code-review-panel.component.html
    - src/src/app/components/code-review/code-review-panel.component.css
    - src/src/app/components/code-review/file-tree.component.ts
    - src/src/app/components/code-review/file-tree.component.html
    - src/src/app/components/code-review/file-tree.component.css
    - src/src/app/components/code-review/diff-viewer.component.ts
    - src/src/app/components/code-review/diff-viewer.component.html
    - src/src/app/components/code-review/diff-viewer.component.css
  modified:
    - src/angular.json (diff2html CSS in styles array)
    - src/package.json (diff2html dependency)
decisions:
  - id: REVIEW-D5
    summary: "Use ColorSchemeType.DARK enum value (not 'dark' string literal) — diff2html v3.4.56 types require enum, string literal causes TS2322"
  - id: REVIEW-D6
    summary: "ViewEncapsulation.None on DiffViewerComponent — required for diff2html CSS class overrides; leakage is minimal since it's a fullscreen overlay"
  - id: REVIEW-D7
    summary: "Extract single-file diff from rawDiff by matching 'diff --git' headers — renders per-file rather than full multi-file diff"
metrics:
  duration_minutes: 4
  completed_date: "2026-03-02"
  tasks_completed: 2
  files_created: 9
  files_modified: 2
---

# Phase 9 Plan 02: Angular Components for Code Review Panel Summary

**One-liner:** Three Angular components — fullscreen overlay, VS Code-style file tree, and diff2html diff viewer with Catppuccin Mocha dark theme and word-level syntax highlighting.

## What Was Built

1. **diff2html installation**: `npm install diff2html` in the Angular frontend (^3.4.56). CSS added to `angular.json` styles array so it loads globally before component styles.

2. **CodeReviewPanelComponent** (`code-review-panel.component.ts`):
   - Fullscreen overlay at z-index 1001 (above session-detail's 1000)
   - Fetches git diff via `CodeReviewService.fetchDiff()` on init
   - Parses with `diff2html.parse()`, applies `detectProjectType()` + `sortFilesByLayer()` for architectural ordering
   - Manages `selectedFileIndex`, `outputFormat`, `reviewedIndices` state
   - Prev/Next navigation buttons with bounds-checking
   - "Mark Reviewed" toggle per file (visual dimming + strikethrough in tree)
   - Side-by-side / Unified format toggle
   - Loading spinner state, error state with message
   - Escape key closes via `@HostListener('document:keydown.escape')`

3. **FileTreeComponent** (`file-tree.component.ts`):
   - Builds nested tree structure from flat file path list by splitting on `/`
   - All directories expanded by default (stored in `expandedPaths: Set<string>`)
   - Status detection: oldName === '/dev/null' → Added (A), newName === '/dev/null' → Deleted (D), else Modified (M)
   - Status badges: A = Catppuccin green, M = yellow, D = red
   - Click-to-select files, directory chevron expand/collapse
   - Keyboard nav: ArrowUp/Down cycles through visible files, Enter selects
   - Reviewed files: dimmed + strikethrough + checkmark indicator

4. **DiffViewerComponent** (`diff-viewer.component.ts`):
   - `ViewEncapsulation.None` to allow diff2html CSS class overrides
   - `nativeElement.innerHTML` direct assignment — avoids Angular sanitizer stripping classes (RESEARCH.md Pitfall 1)
   - Renders via `diff2html.html()` with `diffStyle: 'word'`, `matching: 'lines'`, `ColorSchemeType.DARK`
   - Single-file diff extraction: finds `diff --git` header for the selected file, slices to next header
   - Added files start collapsed: shows filename + line count header with "Show diff" expand button
   - Line click handlers on `.d2h-code-linenumber` and `.d2h-code-side-linenumber` — emit `lineClicked` for future comment placement
   - Catppuccin Mocha CSS variable overrides for all `--d2h-dark-*` variables
   - highlight.js color overrides: mauve keywords, green strings, peach numbers, overlay0 comments, blue functions, yellow types

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed diff2html ColorSchemeType enum usage**
- **Found during:** Task 2 verification (TypeScript compile)
- **Issue:** `colorScheme: 'dark'` fails with TS2322 — diff2html v3.4.56 types require `ColorSchemeType` enum, not a string literal
- **Fix:** Import `ColorSchemeType` from `diff2html/lib/types` and use `ColorSchemeType.DARK`
- **Files modified:** `diff-viewer.component.ts`
- **Commit:** 8f21ec0

## Decisions Made

| ID | Decision |
|----|----------|
| REVIEW-D5 | `ColorSchemeType.DARK` enum value required by diff2html v3.4.56 types (string 'dark' causes TS2322) |
| REVIEW-D6 | `ViewEncapsulation.None` on DiffViewerComponent — needed for diff2html class overrides, acceptable for fullscreen overlay |
| REVIEW-D7 | Single-file diff extracted from rawDiff by 'diff --git' header matching — cleaner per-file rendering |

## Verification

- TypeScript compilation: 0 errors (Angular side)
- All 112 existing unit tests pass
- 9 component files created under `src/src/app/components/code-review/`
- `diff2html` in `src/package.json` dependencies
- `d2h-dark-color-scheme` CSS block present in diff-viewer.component.css
- `nativeElement.innerHTML` used directly (not `[innerHTML]` binding)
- `diff2html.min.css` added to `angular.json` styles array

## Self-Check: PASSED

Files created:
- `src/src/app/components/code-review/code-review-panel.component.ts` FOUND
- `src/src/app/components/code-review/code-review-panel.component.html` FOUND
- `src/src/app/components/code-review/code-review-panel.component.css` FOUND
- `src/src/app/components/code-review/file-tree.component.ts` FOUND
- `src/src/app/components/code-review/file-tree.component.html` FOUND
- `src/src/app/components/code-review/file-tree.component.css` FOUND
- `src/src/app/components/code-review/diff-viewer.component.ts` FOUND
- `src/src/app/components/code-review/diff-viewer.component.html` FOUND
- `src/src/app/components/code-review/diff-viewer.component.css` FOUND

Commits:
- `49ebcc9` FOUND (Task 1)
- `8f21ec0` FOUND (Task 2)
