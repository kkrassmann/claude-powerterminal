import { Component, Input, Output, EventEmitter, HostListener, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActiveSession } from '../../services/session-state.service';
import { GitContext } from '../../models/git-context.model';
import { TerminalStatus, STATUS_COLORS, STATUS_LABELS } from '../../models/terminal-status.model';
import { SessionGroup } from '../../../../shared/group-types';

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
  constructor(private elementRef: ElementRef) {}

  @Input() session!: ActiveSession;
  @Input() sessionId: string = '';
  @Input() gitContext: GitContext | undefined;
  @Input() isChanged: boolean = false;
  @Input() isMaximized: boolean = false;
  @Input() homeDir: string = '';
  @Input() status: TerminalStatus = 'WORKING';
  @Input() practiceScore: number | null = null;
  @Input() badges: string[] = [];
  @Input() groupName: string = '';
  @Input() groupColor: string = '';
  @Input() availableGroups: SessionGroup[] = [];

  @Output() maximize = new EventEmitter<void>();
  @Output() restart = new EventEmitter<void>();
  @Output() kill = new EventEmitter<void>();
  @Output() acknowledged = new EventEmitter<void>();
  @Output() sessionSelected = new EventEmitter<string>();
  @Output() assignToGroup = new EventEmitter<string>();
  @Output() removeFromGroup = new EventEmitter<void>();

  /** Whether the group context menu is visible. */
  showGroupMenu = false;

  /**
   * Get color for the practice score based on value.
   * Green (>70), yellow (>40), red (<=40).
   */
  get scoreColor(): string {
    if (this.practiceScore === null) return '#6c7086';
    if (this.practiceScore > 70) return '#a6e3a1'; // green
    if (this.practiceScore > 40) return '#f9e2af'; // yellow
    return '#f38ba8'; // red
  }

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

  /**
   * Emit sessionSelected event when score chip is clicked.
   * Used to open the session detail panel.
   */
  onScoreClick(): void {
    if (this.sessionId) {
      this.sessionSelected.emit(this.sessionId);
    }
  }

  /**
   * Get emoji icon for a badge name.
   */
  getBadgeEmoji(badge: string): string {
    const map: Record<string, string> = {
      'Context Master': '🧠',
      'Zero Error': '✅',
      'Planner': '📋',
      'Parallel Pro': '⚡',
      'Speed Demon': '🚀',
      'Researcher': '🔍',
      'Tool Native': '🛠️',
      'Subagent Pro': '🤝',
      'Context Efficient': '🧠',
      'Orchestrated': '🤝',
      'Planned': '📋',
    };
    return map[badge] ?? '🏅';
  }

  /**
   * Returns true if the badge is one of the 6 special achievement badges.
   * These get the achievement-gold color treatment.
   */
  isAchievementBadge(badge: string): boolean {
    const achievementBadges = new Set([
      'Context Master', 'Zero Error', 'Planner', 'Parallel Pro', 'Speed Demon', 'Researcher',
    ]);
    return achievementBadges.has(badge);
  }

  /**
   * Toggle the group assignment dropdown.
   */
  toggleGroupMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.showGroupMenu = !this.showGroupMenu;
  }

  /**
   * Assign session to a group.
   */
  onAssignToGroup(groupName: string): void {
    this.assignToGroup.emit(groupName);
    this.showGroupMenu = false;
  }

  /**
   * Remove session from its current group.
   */
  onRemoveFromGroup(): void {
    this.removeFromGroup.emit();
    this.showGroupMenu = false;
  }

  /**
   * Close group menu on outside click (host listener on document).
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.showGroupMenu && !this.elementRef.nativeElement.contains(event.target)) {
      this.showGroupMenu = false;
    }
  }
}
