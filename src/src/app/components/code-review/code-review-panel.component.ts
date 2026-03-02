import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { parse as parseDiff } from 'diff2html';
import type { DiffFile } from 'diff2html/lib/types';
import { CodeReviewService } from '../../services/code-review.service';
import { detectProjectType, sortFilesByLayer } from '../../models/code-review.model';
import { FileTreeComponent } from './file-tree.component';
import { DiffViewerComponent } from './diff-viewer.component';

/**
 * Fullscreen overlay for the local code review panel.
 *
 * Orchestrates the file tree and diff viewer:
 * - Fetches the full git diff via CodeReviewService.fetchDiff()
 * - Parses with diff2html to get DiffFile[]
 * - Sorts files by architectural layer using detectProjectType() + sortFilesByLayer()
 * - Manages file selection and Prev/Next navigation
 * - Handles loading and error states
 * - Closes on Escape key or X button
 */
@Component({
  selector: 'app-code-review-panel',
  standalone: true,
  imports: [CommonModule, FileTreeComponent, DiffViewerComponent],
  templateUrl: './code-review-panel.component.html',
  styleUrls: ['./code-review-panel.component.css'],
})
export class CodeReviewPanelComponent implements OnInit {
  @Input() sessionId!: string;
  @Input() cwd!: string;
  @Output() close = new EventEmitter<void>();

  /** Loading state while diff is being fetched */
  loading = true;

  /** Error state if diff fetch fails */
  error: string | null = null;

  /** Raw unified diff string from git */
  rawDiff = '';

  /** Parsed diff files from diff2html */
  files: DiffFile[] = [];

  /** Currently selected file index */
  selectedFileIndex = 0;

  /** Diff output format */
  outputFormat: 'side-by-side' | 'line-by-line' = 'side-by-side';

  /** Set of file indices that have been reviewed */
  reviewedIndices = new Set<number>();

  constructor(private codeReviewService: CodeReviewService) {}

  async ngOnInit(): Promise<void> {
    try {
      this.rawDiff = await this.codeReviewService.fetchDiff(this.cwd);

      if (!this.rawDiff) {
        this.error = 'No uncommitted changes found in this directory.';
        this.loading = false;
        return;
      }

      // Parse with diff2html
      const parsed = parseDiff(this.rawDiff);

      // Detect project type and sort by architectural layer
      const filePaths = parsed.map(f => (f.newName !== '/dev/null' ? f.newName : f.oldName));
      const projectType = detectProjectType(filePaths);
      const sortInput = parsed.map(f => ({
        file: f,
        filename: f.newName !== '/dev/null' ? f.newName : f.oldName,
      }));
      const sortedInput = sortFilesByLayer(sortInput, projectType);
      this.files = sortedInput.map(s => s.file);

      this.selectedFileIndex = 0;
    } catch (err: any) {
      this.error = err?.message ?? 'Failed to load diff.';
    } finally {
      this.loading = false;
    }
  }

  get selectedFile(): DiffFile | null {
    return this.files[this.selectedFileIndex] ?? null;
  }

  prevFile(): void {
    if (this.selectedFileIndex > 0) {
      this.selectedFileIndex--;
    }
  }

  nextFile(): void {
    if (this.selectedFileIndex < this.files.length - 1) {
      this.selectedFileIndex++;
    }
  }

  onFileSelected(index: number): void {
    this.selectedFileIndex = index;
  }

  toggleFormat(): void {
    this.outputFormat = this.outputFormat === 'side-by-side' ? 'line-by-line' : 'side-by-side';
  }

  markReviewed(index: number): void {
    if (this.reviewedIndices.has(index)) {
      this.reviewedIndices.delete(index);
    } else {
      this.reviewedIndices.add(index);
    }
    // Force change detection by replacing the set reference
    this.reviewedIndices = new Set(this.reviewedIndices);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close.emit();
  }
}
