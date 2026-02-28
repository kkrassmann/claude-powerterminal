import { Injectable } from '@angular/core';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import { WorktreeInfo, WorktreeCreateOptions } from '../../../shared/worktree-types';

/**
 * Service for managing Git worktrees via IPC or HTTP API.
 *
 * Dual-mode: uses Electron IPC when running inside the Electron app,
 * falls back to HTTP fetch for remote browser access.
 */
@Injectable({
  providedIn: 'root'
})
export class WorktreeService {

  /**
   * List all worktrees for a repository.
   *
   * @param repoPath - Path to any directory within the repository
   * @returns Array of WorktreeInfo objects
   */
  async listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    if (window.electronAPI) {
      try {
        return await window.electronAPI.invoke(IPC_CHANNELS.WORKTREE_LIST, repoPath);
      } catch (error) {
        console.error('[WorktreeService] Failed to list worktrees via IPC:', error);
        return [];
      }
    }

    try {
      const resp = await fetch(
        `http://${window.location.hostname}:9801/api/worktrees?repoPath=${encodeURIComponent(repoPath)}`
      );
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      return await resp.json();
    } catch (error) {
      console.error('[WorktreeService] Failed to list worktrees via HTTP:', error);
      return [];
    }
  }

  /**
   * Create a new worktree with a new branch.
   *
   * @param options - Create options (repoPath, branchName, baseBranch)
   * @returns The created WorktreeInfo, or null on failure
   */
  async createWorktree(options: WorktreeCreateOptions): Promise<WorktreeInfo | null> {
    if (window.electronAPI) {
      try {
        return await window.electronAPI.invoke(IPC_CHANNELS.WORKTREE_CREATE, options);
      } catch (error) {
        console.error('[WorktreeService] Failed to create worktree via IPC:', error);
        throw error;
      }
    }

    try {
      const resp = await fetch(`http://${window.location.hostname}:9801/api/worktrees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      return await resp.json();
    } catch (error) {
      console.error('[WorktreeService] Failed to create worktree via HTTP:', error);
      throw error;
    }
  }

  /**
   * Delete a worktree.
   *
   * @param worktreePath - Absolute path to the worktree to remove
   * @returns true on success
   */
  async deleteWorktree(worktreePath: string): Promise<boolean> {
    if (window.electronAPI) {
      try {
        return await window.electronAPI.invoke(IPC_CHANNELS.WORKTREE_DELETE, worktreePath);
      } catch (error) {
        console.error('[WorktreeService] Failed to delete worktree via IPC:', error);
        throw error;
      }
    }

    try {
      const resp = await fetch(
        `http://${window.location.hostname}:9801/api/worktrees?path=${encodeURIComponent(worktreePath)}`,
        { method: 'DELETE' }
      );
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const result = await resp.json();
      return result.success;
    } catch (error) {
      console.error('[WorktreeService] Failed to delete worktree via HTTP:', error);
      throw error;
    }
  }
}
