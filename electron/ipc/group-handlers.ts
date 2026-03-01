/**
 * Group persistence IPC handlers.
 *
 * Handles saving and loading terminal group definitions to/from groups.json
 * in the app's userData directory. Separate from sessions.json to keep concerns clean.
 */

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { SessionGroup } from '../../src/shared/group-types';

/**
 * Get the path to groups.json file in userData directory.
 */
function getGroupsFilePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'groups.json');
}

/**
 * Load groups from a JSON file.
 * Returns empty array if file doesn't exist or is invalid.
 *
 * @param filePath - Absolute path to groups JSON file
 */
export function loadGroupsFromFile(filePath: string): SessionGroup[] {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error: any) {
    console.error('[Group Handlers] Error loading groups:', error.message);
    return [];
  }
}

/**
 * Save groups to a JSON file (synchronous for durability).
 *
 * @param filePath - Absolute path to groups JSON file
 * @param groups - Array of groups to persist
 */
export function saveGroupsToFile(filePath: string, groups: SessionGroup[]): void {
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  const data = JSON.stringify(groups, null, 2);
  fs.writeFileSync(filePath, data, 'utf-8');
}

/**
 * Register all group persistence IPC handlers.
 * Call this once during app initialization in main.ts.
 */
export function registerGroupHandlers(): void {
  console.log('[Group Handlers] Registering group IPC handlers');

  // GROUPS_LOAD - Load all groups
  ipcMain.handle(IPC_CHANNELS.GROUPS_LOAD, async () => {
    try {
      const groups = loadGroupsFromFile(getGroupsFilePath());
      return { success: true, groups };
    } catch (error: any) {
      console.error('[Group Handlers] Failed to load groups:', error);
      return { success: false, error: error.message, groups: [] };
    }
  });

  // GROUPS_SAVE - Save all groups (full replacement)
  ipcMain.handle(IPC_CHANNELS.GROUPS_SAVE, async (_event, groups: SessionGroup[]) => {
    try {
      saveGroupsToFile(getGroupsFilePath(), groups);
      return { success: true };
    } catch (error: any) {
      console.error('[Group Handlers] Failed to save groups:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Group Handlers] All group IPC handlers registered successfully');
}
