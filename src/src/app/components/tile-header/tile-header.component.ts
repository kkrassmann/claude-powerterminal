import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActiveSession } from '../../services/session-state.service';
import { GitContext } from '../../models/git-context.model';
import { TerminalStatus, STATUS_COLORS, STATUS_LABELS } from '../../models/terminal-status.model';

/**
 * Terminal tile header component displaying working directory, git context, and action buttons.
 *
 * Features:
 * - Path shortening with ~ replacement for home directory
 * - Git branch name and change counts (added/modified/deleted)
 * - Highlight animation when change counts update
 * - Action buttons: restart, kill, maximize/restore
 * - Double-click to maximize
 * - Drag handle for tile reordering
 */
@Component({
  selector: 'app-tile-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tile-header.component.html',
  styleUrls: ['./tile-header.component.css']
})
export class TileHeaderComponent {
  @Input() session!: ActiveSession;
  @Input() gitContext: GitContext | undefined;
  @Input() isChanged: boolean = false;
  @Input() isMaximized: boolean = false;
  @Input() homeDir: string = '';
  @Input() status: TerminalStatus = 'WORKING';

  @Output() maximize = new EventEmitter<void>();
  @Output() restart = new EventEmitter<void>();
  @Output() kill = new EventEmitter<void>();
  @Output() acknowledged = new EventEmitter<void>();

  /**
   * Get status color for the status dot.
   */
  get statusColor(): string {
    return STATUS_COLORS[this.status];
  }

  /**
   * Get status label for tooltip.
   */
  get statusLabel(): string {
    return STATUS_LABELS[this.status];
  }

  /**
   * Shorten path: show drive + first dir, last 2 segments, ellipsis in between.
   *
   * Examples:
   * - C:\Dev\api-slot-3           → C/Dev/api-slot-3
   * - C:\Dev\Konsti\System\projects\api → C/Dev/.../projects/api
   * - C:\Users\Konstantin\projects\app  → C/Users/.../projects/app
   */
  get shortenedPath(): string {
    let path = this.session.metadata.workingDirectory;
    path = path.replace(/\\/g, '/');

    // Split and remove empty segments (leading slash on unix produces empty first)
    const segments = path.split('/').filter(s => s.length > 0);

    if (segments.length <= 3) {
      return segments.join('/');
    }

    // Drive + first dir + ... + parent + target
    const head = segments.slice(0, 2);
    const tail = segments.slice(-2);
    return head.join('/') + '/.../' + tail.join('/');
  }

  /**
   * Handle click on header — acknowledge (dismiss) alert glow.
   */
  onHeaderClick(): void {
    this.acknowledged.emit();
  }

  /**
   * Handle double-click on header to toggle maximize.
   */
  onHeaderDblClick(): void {
    this.maximize.emit();
  }

  /**
   * Handle restart button click.
   */
  onRestart(): void {
    this.restart.emit();
  }

  /**
   * Handle kill button click.
   */
  onKill(): void {
    this.kill.emit();
  }

  /**
   * Handle maximize/restore button click.
   */
  onMaximize(): void {
    this.maximize.emit();
  }
}
