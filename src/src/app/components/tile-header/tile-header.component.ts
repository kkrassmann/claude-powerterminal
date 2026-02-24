import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActiveSession } from '../../services/session-state.service';
import { GitContext } from '../../models/git-context.model';

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

  @Output() maximize = new EventEmitter<void>();
  @Output() restart = new EventEmitter<void>();
  @Output() kill = new EventEmitter<void>();

  /**
   * Shorten path by abbreviating all segments except the last one.
   * Replace home directory prefix with ~.
   *
   * Examples:
   * - C:\Users\Konstantin\projects\my-app → ~/p/my-app
   * - /home/user/code/project → ~/c/project
   * - D:\projects\test → D:/p/test
   */
  get shortenedPath(): string {
    let path = this.session.metadata.workingDirectory;

    // Normalize backslashes to forward slashes
    path = path.replace(/\\/g, '/');

    // Replace home directory prefix with ~
    if (this.homeDir) {
      const normalizedHome = this.homeDir.replace(/\\/g, '/');
      if (path.startsWith(normalizedHome)) {
        path = '~' + path.substring(normalizedHome.length);
      }
    }

    // Split by / and abbreviate all segments except last
    const segments = path.split('/').filter(s => s.length > 0);
    if (segments.length <= 1) {
      return path; // No shortening needed
    }

    const abbreviated = segments.slice(0, -1).map(seg => seg[0]);
    const lastSegment = segments[segments.length - 1];

    return abbreviated.join('/') + '/' + lastSegment;
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
