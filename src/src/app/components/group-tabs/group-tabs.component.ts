/**
 * Group tab bar component for filtering and managing terminal session groups.
 *
 * Features:
 * - "All" tab + one tab per group with color dot, name, and session count
 * - Click tab to filter dashboard to that group's sessions
 * - Right-click tab for context menu: rename, change color, delete
 * - "+" button to create new groups
 * - Layout preset buttons (overview, focus, split, columns)
 * - Drag-drop: sessions can be dragged onto tabs to assign groups
 */

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, combineLatest } from 'rxjs';
import { GroupService } from '../../services/group.service';
import { SessionStateService } from '../../services/session-state.service';
import { SessionGroup, LayoutPreset, DEFAULT_GROUP_COLORS } from '../../../../shared/group-types';

@Component({
  selector: 'app-group-tabs',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './group-tabs.component.html',
  styleUrls: ['./group-tabs.component.css']
})
export class GroupTabsComponent implements OnInit, OnDestroy {
  groups: SessionGroup[] = [];
  activeGroup: string | undefined;
  activePreset: LayoutPreset = 'overview';
  totalSessionCount = 0;

  /** State for the create-group inline input. */
  showCreateInput = false;
  newGroupName = '';

  /** State for the context menu. */
  contextMenuVisible = false;
  contextMenuX = 0;
  contextMenuY = 0;
  contextMenuGroup: SessionGroup | null = null;

  /** State for inline rename. */
  renamingGroup: string | null = null;
  renameValue = '';

  /** State for color picker. */
  showColorPicker = false;
  colorPickerGroup: SessionGroup | null = null;
  availableColors = DEFAULT_GROUP_COLORS;

  private subscription: Subscription | null = null;

  constructor(
    public groupService: GroupService,
    private sessionStateService: SessionStateService
  ) {}

  ngOnInit(): void {
    this.subscription = combineLatest([
      this.groupService.groups$,
      this.groupService.activeLayout$,
      this.sessionStateService.sessions$
    ]).subscribe(([groups, layout, sessions]) => {
      this.groups = groups;
      this.activeGroup = layout.activeGroup;
      this.activePreset = layout.preset;
      this.totalSessionCount = sessions.size;
    });

    // Close context menu on click anywhere
    this.onDocumentClick = this.onDocumentClick.bind(this);
    document.addEventListener('click', this.onDocumentClick);
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    document.removeEventListener('click', this.onDocumentClick);
  }

  /**
   * Select the "All" tab (show all sessions, no group filter).
   */
  selectAll(): void {
    this.groupService.setLayout({ activeGroup: undefined });
  }

  /**
   * Select a group tab to filter dashboard.
   */
  selectGroup(groupName: string): void {
    this.groupService.setLayout({ activeGroup: groupName });
  }

  /**
   * Set layout preset.
   */
  setPreset(preset: LayoutPreset): void {
    this.groupService.setLayout({ preset });
  }

  /**
   * Show create group input.
   */
  startCreateGroup(): void {
    this.showCreateInput = true;
    this.newGroupName = '';
    // Focus will be handled by template autofocus
  }

  /**
   * Confirm group creation.
   */
  confirmCreateGroup(): void {
    const name = this.newGroupName.trim();
    if (name) {
      try {
        this.groupService.createGroup(name);
      } catch (e) {
        // Duplicate name — silently ignore
      }
    }
    this.showCreateInput = false;
    this.newGroupName = '';
  }

  /**
   * Cancel group creation.
   */
  cancelCreateGroup(): void {
    this.showCreateInput = false;
    this.newGroupName = '';
  }

  /**
   * Handle keydown in create input.
   */
  onCreateKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.confirmCreateGroup();
    } else if (event.key === 'Escape') {
      this.cancelCreateGroup();
    }
  }

  /**
   * Show context menu for a group tab.
   */
  onTabContextMenu(event: MouseEvent, group: SessionGroup): void {
    event.preventDefault();
    event.stopPropagation();
    this.contextMenuVisible = true;
    this.contextMenuX = event.clientX;
    this.contextMenuY = event.clientY;
    this.contextMenuGroup = group;
  }

  /**
   * Start renaming a group.
   */
  startRename(): void {
    if (!this.contextMenuGroup) return;
    this.renamingGroup = this.contextMenuGroup.name;
    this.renameValue = this.contextMenuGroup.name;
    this.contextMenuVisible = false;
  }

  /**
   * Confirm rename.
   */
  confirmRename(): void {
    if (this.renamingGroup && this.renameValue.trim()) {
      try {
        this.groupService.renameGroup(this.renamingGroup, this.renameValue.trim());
      } catch (e) {
        // Duplicate name — ignore
      }
    }
    this.renamingGroup = null;
    this.renameValue = '';
  }

  /**
   * Cancel rename.
   */
  cancelRename(): void {
    this.renamingGroup = null;
    this.renameValue = '';
  }

  /**
   * Handle keydown in rename input.
   */
  onRenameKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.confirmRename();
    } else if (event.key === 'Escape') {
      this.cancelRename();
    }
  }

  /**
   * Show color picker for a group.
   */
  startChangeColor(): void {
    if (!this.contextMenuGroup) return;
    this.colorPickerGroup = this.contextMenuGroup;
    this.showColorPicker = true;
    this.contextMenuVisible = false;
  }

  /**
   * Select a new color for the group.
   */
  selectColor(color: string): void {
    if (this.colorPickerGroup) {
      this.groupService.changeGroupColor(this.colorPickerGroup.name, color);
    }
    this.showColorPicker = false;
    this.colorPickerGroup = null;
  }

  /**
   * Cancel color picker.
   */
  cancelColorPicker(): void {
    this.showColorPicker = false;
    this.colorPickerGroup = null;
  }

  /**
   * Delete the context menu group.
   */
  deleteGroup(): void {
    if (!this.contextMenuGroup) return;
    this.groupService.deleteGroup(this.contextMenuGroup.name);
    this.contextMenuVisible = false;
    this.contextMenuGroup = null;
  }

  /**
   * Handle drag-over on a group tab (allow drop).
   */
  onTabDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  /**
   * Handle drop of a session onto a group tab.
   */
  onTabDrop(event: DragEvent, groupName: string): void {
    event.preventDefault();
    const sessionId = event.dataTransfer?.getData('text/plain');
    if (sessionId) {
      this.groupService.addToGroup(sessionId, groupName);
    }
  }

  /**
   * Handle drop on the "All" tab = remove from group.
   */
  onAllTabDrop(event: DragEvent): void {
    event.preventDefault();
    const sessionId = event.dataTransfer?.getData('text/plain');
    if (sessionId) {
      this.groupService.removeFromGroup(sessionId);
    }
  }

  /**
   * Close context menu on outside click.
   */
  private onDocumentClick(): void {
    if (this.contextMenuVisible) {
      this.contextMenuVisible = false;
    }
  }
}
