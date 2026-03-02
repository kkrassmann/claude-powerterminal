import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  ViewChild,
  ElementRef,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { html as renderDiffHtml } from 'diff2html';
import type { DiffFile } from 'diff2html/lib/types';
import { ColorSchemeType } from 'diff2html/lib/types';

/**
 * Event emitted when a diff line is clicked (for future comment placement).
 */
export interface LineClickEvent {
  filename: string;
  line: number;
  side: 'old' | 'new';
}

/**
 * Diff viewer component — renders a single file's diff using diff2html.
 *
 * Features:
 * - Side-by-side and unified view via outputFormat input
 * - Word-level inline diffs (diffStyle: 'word')
 * - Catppuccin Mocha dark theme via CSS variable overrides
 * - highlight.js syntax highlighting with Catppuccin color palette
 * - New/added files shown collapsed by default with expand toggle
 * - Line click handlers for future comment placement (emits lineClicked event)
 *
 * IMPORTANT: Uses nativeElement.innerHTML directly — Angular's [innerHTML] binding
 * strips CSS classes and data attributes from diff2html output (sanitizer issue).
 * diff content comes from git (trusted source), so direct DOM assignment is safe.
 */
@Component({
  selector: 'app-diff-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './diff-viewer.component.html',
  styleUrls: ['./diff-viewer.component.css'],
  // ViewEncapsulation.None: lets our CSS override diff2html's global classes
  // since this is a fullscreen overlay, style leakage is minimal and contained
  encapsulation: ViewEncapsulation.None,
})
export class DiffViewerComponent implements OnChanges {
  @Input() file: DiffFile | null = null;
  @Input() outputFormat: 'side-by-side' | 'line-by-line' = 'side-by-side';
  @Input() rawDiff = '';

  @Output() lineClicked = new EventEmitter<LineClickEvent>();

  @ViewChild('diffContainer', { static: true }) diffContainer!: ElementRef<HTMLDivElement>;

  /** Whether an added file is expanded (added files start collapsed) */
  isAddedFileExpanded = false;

  /** Cache of the last rendered file path to avoid re-renders when only index changes */
  private lastRenderedPath = '';
  private lastFormat = '';

  ngOnChanges(): void {
    if (!this.file) {
      this.clearContainer();
      return;
    }

    const currentPath = this.file.newName !== '/dev/null' ? this.file.newName : this.file.oldName;
    const formatChanged = this.lastFormat !== this.outputFormat;
    const fileChanged = this.lastRenderedPath !== currentPath;

    if (!fileChanged && !formatChanged) return;

    // Reset expanded state when switching to a new added file
    if (fileChanged && this.isAddedFile(this.file)) {
      this.isAddedFileExpanded = false;
    }

    this.lastRenderedPath = currentPath;
    this.lastFormat = this.outputFormat;

    this.renderDiff();
  }

  private isAddedFile(file: DiffFile): boolean {
    return file.oldName === '/dev/null' || file.oldName === 'dev/null';
  }

  private clearContainer(): void {
    if (this.diffContainer?.nativeElement) {
      this.diffContainer.nativeElement.innerHTML = '';
    }
    this.lastRenderedPath = '';
  }

  expandAddedFile(): void {
    this.isAddedFileExpanded = true;
    this.renderDiff();
  }

  private renderDiff(): void {
    if (!this.file || !this.diffContainer?.nativeElement) return;

    // For added files that are collapsed, show the placeholder instead
    if (this.isAddedFile(this.file) && !this.isAddedFileExpanded) {
      this.diffContainer.nativeElement.innerHTML = '';
      return;
    }

    // Extract single-file diff from rawDiff by matching the diff header for this file
    const fileDiff = this.extractFileDiff(this.file);
    if (!fileDiff) {
      this.diffContainer.nativeElement.innerHTML =
        '<div class="diff-empty">No diff content available for this file.</div>';
      return;
    }

    // Render using diff2html.html() — handles word-level highlighting, line numbering, alignment
    const html = renderDiffHtml(fileDiff, {
      outputFormat: this.outputFormat,
      drawFileList: false,
      matching: 'lines',
      diffStyle: 'word',
      colorScheme: ColorSchemeType.DARK,
    });

    // Direct nativeElement assignment — avoids Angular sanitizer stripping CSS classes
    this.diffContainer.nativeElement.innerHTML = html;

    // Attach line click handlers for future comment placement
    this.attachLineClickHandlers(this.file);
  }

  /**
   * Extract the single-file portion from the full raw diff string.
   * Finds the diff header matching this file and returns everything until the next diff header.
   */
  private extractFileDiff(file: DiffFile): string {
    if (!this.rawDiff) return '';

    // Find by newName or oldName in the diff header
    const searchNames = [file.newName, file.oldName].filter(
      n => n && n !== '/dev/null' && n !== 'dev/null'
    );

    const lines = this.rawDiff.split('\n');
    let startIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('diff --git')) {
        if (searchNames.some(name => line.includes(name))) {
          startIdx = i;
          break;
        }
      }
    }

    if (startIdx === -1) return this.rawDiff; // Fallback: use full diff

    // Find the end: next 'diff --git' header
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith('diff --git')) {
        endIdx = i;
        break;
      }
    }

    return lines.slice(startIdx, endIdx).join('\n');
  }

  /**
   * Attach click handlers on line number elements for comment placement.
   * Emits lineClicked event with filename and line number.
   */
  private attachLineClickHandlers(file: DiffFile): void {
    const container = this.diffContainer.nativeElement;
    const filename = file.newName !== '/dev/null' ? file.newName : file.oldName;

    // Side-by-side: .d2h-code-side-linenumber
    // Unified: .d2h-code-linenumber
    const selectors = ['.d2h-code-linenumber', '.d2h-code-side-linenumber'];

    selectors.forEach(selector => {
      const lineNumbers = container.querySelectorAll<HTMLElement>(selector);
      lineNumbers.forEach(el => {
        el.style.cursor = 'pointer';
        el.title = 'Click to add comment';

        el.addEventListener('click', (event) => {
          event.stopPropagation();
          const lineNum = parseInt(el.dataset['lineNumber'] ?? el.textContent ?? '0', 10);
          const side = el.classList.contains('d2h-code-old-linenumber') ? 'old' : 'new';
          if (lineNum > 0) {
            this.lineClicked.emit({ filename, line: lineNum, side });
          }
        });
      });
    });
  }
}
