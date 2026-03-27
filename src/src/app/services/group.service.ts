/**
 * Service for managing terminal session groups and layout presets.
 *
 * Provides reactive state for groups and layout configuration,
 * with persistence via IPC to groups.json in userData directory.
 */

import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SessionGroup, LayoutConfig, LayoutPreset, DEFAULT_GROUP_COLORS } from '../../../shared/group-types';
import { getHttpBaseUrl } from '../../../shared/ws-protocol';

@Injectable({
  providedIn: 'root'
})
export class GroupService implements OnDestroy {
  /** Reactive stream of all session groups. */
  groups$ = new BehaviorSubject<SessionGroup[]>([]);

  /** Reactive stream of active layout configuration. */
  activeLayout$ = new BehaviorSubject<LayoutConfig>({ preset: 'overview' });

  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.loadGroups();

    // Poll for group changes — keeps all clients (desktop + remote) in sync
    if (typeof window !== 'undefined') {
      this.pollIntervalId = setInterval(() => this.loadGroups(), 5000);
    }
  }

  ngOnDestroy(): void {
    if (this.pollIntervalId !== null) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  /**
   * Create a new group with the given name.
   * Automatically assigns the next available color from the palette.
   *
   * @param name - Display name for the group
   * @returns The newly created group
   */
  createGroup(name: string): SessionGroup {
    const groups = this.groups$.value;

    // Prevent duplicate names
    if (groups.some(g => g.name === name)) {
      throw new Error(`Group "${name}" already exists`);
    }

    // Pick next color from palette (cycle if exhausted)
    const usedColors = new Set(groups.map(g => g.color));
    const availableColor = DEFAULT_GROUP_COLORS.find(c => !usedColors.has(c))
      || DEFAULT_GROUP_COLORS[groups.length % DEFAULT_GROUP_COLORS.length];

    const newGroup: SessionGroup = {
      name,
      color: availableColor,
      sessionIds: [],
    };

    const updated = [...groups, newGroup];
    this.groups$.next(updated);
    this.persistGroups(updated);

    return newGroup;
  }

  /**
   * Delete a group by name. Sessions in the group become ungrouped.
   *
   * @param name - Name of the group to delete
   */
  deleteGroup(name: string): void {
    const groups = this.groups$.value;
    const updated = groups.filter(g => g.name !== name);

    // If the active filter was this group, reset to "All"
    const layout = this.activeLayout$.value;
    if (layout.activeGroup === name) {
      this.activeLayout$.next({ ...layout, activeGroup: undefined });
    }

    this.groups$.next(updated);
    this.persistGroups(updated);
  }

  /**
   * Add a session to a group. Removes it from any previous group first.
   *
   * @param sessionId - Session ID to assign
   * @param groupName - Target group name
   */
  addToGroup(sessionId: string, groupName: string): void {
    const groups = this.groups$.value.map(g => ({
      ...g,
      // Remove from any existing group
      sessionIds: g.sessionIds.filter(id => id !== sessionId),
    }));

    const target = groups.find(g => g.name === groupName);
    if (target) {
      target.sessionIds.push(sessionId);
    }

    this.groups$.next(groups);
    this.persistGroups(groups);
  }

  /**
   * Remove a session from its current group.
   *
   * @param sessionId - Session ID to ungroup
   */
  removeFromGroup(sessionId: string): void {
    const groups = this.groups$.value.map(g => ({
      ...g,
      sessionIds: g.sessionIds.filter(id => id !== sessionId),
    }));

    this.groups$.next(groups);
    this.persistGroups(groups);
  }

  /**
   * Update layout configuration.
   *
   * @param config - New layout config (partial merge with current)
   */
  setLayout(config: Partial<LayoutConfig>): void {
    const current = this.activeLayout$.value;
    this.activeLayout$.next({ ...current, ...config });
  }

  /**
   * Get the group a session belongs to.
   *
   * @param sessionId - Session ID to look up
   * @returns The group containing this session, or undefined
   */
  getGroupForSession(sessionId: string): SessionGroup | undefined {
    return this.groups$.value.find(g => g.sessionIds.includes(sessionId));
  }

  /**
   * Rename a group.
   *
   * @param oldName - Current group name
   * @param newName - New group name
   */
  renameGroup(oldName: string, newName: string): void {
    const groups = this.groups$.value;
    if (groups.some(g => g.name === newName)) {
      throw new Error(`Group "${newName}" already exists`);
    }

    const updated = groups.map(g =>
      g.name === oldName ? { ...g, name: newName } : g
    );

    // Update active filter if it referenced the old name
    const layout = this.activeLayout$.value;
    if (layout.activeGroup === oldName) {
      this.activeLayout$.next({ ...layout, activeGroup: newName });
    }

    this.groups$.next(updated);
    this.persistGroups(updated);
  }

  /**
   * Change a group's color.
   *
   * @param groupName - Group to update
   * @param color - New hex color
   */
  changeGroupColor(groupName: string, color: string): void {
    const updated = this.groups$.value.map(g =>
      g.name === groupName ? { ...g, color } : g
    );

    this.groups$.next(updated);
    this.persistGroups(updated);
  }

  /**
   * Clean up stale session IDs that no longer exist.
   * Called when sessions are removed from SessionStateService.
   *
   * @param activeSessionIds - Set of currently active session IDs
   */
  cleanupStaleSessionIds(activeSessionIds: Set<string>): void {
    let changed = false;
    const groups = this.groups$.value.map(g => {
      const filtered = g.sessionIds.filter(id => activeSessionIds.has(id));
      if (filtered.length !== g.sessionIds.length) {
        changed = true;
      }
      return { ...g, sessionIds: filtered };
    });

    if (changed) {
      this.groups$.next(groups);
      this.persistGroups(groups);
    }
  }

  /**
   * Load groups from persistent storage via HTTP API.
   */
  private async loadGroups(): Promise<void> {
    try {
      const resp = await fetch(`${getHttpBaseUrl()}/api/groups`);
      const groups = await resp.json();
      if (groups?.length > 0) {
        this.groups$.next(groups);
      }
    } catch (error) {
      console.error('[GroupService] Failed to load groups:', error);
    }
  }

  /**
   * Persist groups to disk via HTTP API.
   */
  private async persistGroups(groups: SessionGroup[]): Promise<void> {
    try {
      await fetch(`${getHttpBaseUrl()}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groups),
      });
    } catch (error) {
      console.error('[GroupService] Failed to save groups:', error);
    }
  }
}
