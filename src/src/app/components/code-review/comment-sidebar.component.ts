import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReviewComment } from '../../models/code-review.model';

/**
 * Comment sidebar component for the code review panel.
 *
 * Displays inline review comments for the currently selected file,
 * with resolved status checkboxes and terminal injection actions.
 *
 * Layout: 300px fixed-width panel to the right of the diff viewer.
 * Each comment card shows: line number, text, resolved checkbox, Send Now + Delete buttons.
 * Bottom area: Send Summary button for all unresolved comments.
 */
@Component({
  selector: 'app-comment-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './comment-sidebar.component.html',
  styleUrls: ['./comment-sidebar.component.css'],
})
export class CommentSidebarComponent implements OnChanges {
  /** Session ID (used for terminal injection labels) */
  @Input() sessionId: string = '';

  /** Currently selected filename */
  @Input() filename: string = '';

  /** Comments for the current file */
  @Input() comments: ReviewComment[] = [];

  /** Emitted when user clicks "Send Now" on a single comment */
  @Output() sendNow = new EventEmitter<ReviewComment>();

  /** Emitted when user clicks "Send Summary" to send all unresolved comments */
  @Output() sendSummary = new EventEmitter<ReviewComment[]>();

  /** Emitted when user toggles the resolved checkbox on a comment */
  @Output() commentResolved = new EventEmitter<string>();

  /** Emitted when user deletes a comment */
  @Output() commentDeleted = new EventEmitter<string>();

  /** Emitted when user clicks a comment's line number (scroll diff to line) */
  @Output() lineClicked = new EventEmitter<number>();

  /** Number of unresolved comments (used in Send Summary button label) */
  unresolvedCount = 0;

  ngOnChanges(): void {
    this.unresolvedCount = this.comments.filter(c => !c.resolved).length;
  }

  onSendNow(comment: ReviewComment): void {
    this.sendNow.emit(comment);
  }

  onSendSummary(): void {
    const unresolved = this.comments.filter(c => !c.resolved);
    this.sendSummary.emit(unresolved);
  }

  onToggleResolved(comment: ReviewComment): void {
    this.commentResolved.emit(comment.id);
    // Optimistically update count
    this.unresolvedCount = this.comments.filter(c => !c.resolved).length;
  }

  onDelete(comment: ReviewComment): void {
    this.commentDeleted.emit(comment.id);
  }

  onLineClick(line: number): void {
    this.lineClicked.emit(line);
  }
}
