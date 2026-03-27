import { Injectable } from '@angular/core';
import { IPC_CHANNELS } from '../../../shared/ipc-channels';
import { getHttpBaseUrl } from '../../../shared/ws-protocol';
import { ReviewComment, ReviewFileState, ReviewHunkState, ReviewFileStatus } from '../models/code-review.model';

declare const window: Window & {
  electronAPI?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> };
};

/**
 * Angular service for the local code review panel.
 *
 * Dual-transport:
 * - Electron (IPC): Uses window.electronAPI.invoke for direct main-process calls
 * - Remote browser (HTTP): Falls back to fetch() against the HTTP static server
 *
 * Manages:
 * - Git diff fetching and hunk/file reject operations
 * - In-memory inline comment state (per session)
 * - In-memory per-file review state (hunk decisions, reviewed flag)
 */
@Injectable({ providedIn: 'root' })
export class CodeReviewService {

  // ---------------------------------------------------------------------------
  // In-memory comment store: sessionId → comments
  // ---------------------------------------------------------------------------

  private comments = new Map<string, ReviewComment[]>();

  // ---------------------------------------------------------------------------
  // In-memory file review state: sessionId → (filename → ReviewFileState)
  // ---------------------------------------------------------------------------

  private fileStates = new Map<string, Map<string, ReviewFileState>>();

  // ---------------------------------------------------------------------------
  // Git operations (dual-transport)
  // ---------------------------------------------------------------------------

  /**
   * Fetch the full unified diff for all uncommitted changes in the given directory.
   *
   * @param cwd - Working directory of the session (absolute path)
   * @returns Raw unified diff string, or empty string if no changes
   */
  async fetchDiff(cwd: string): Promise<string> {
    try {
      if (window.electronAPI) {
        return (await window.electronAPI.invoke(IPC_CHANNELS.REVIEW_DIFF, cwd)) as string;
      } else {
        const resp = await fetch(
          `${getHttpBaseUrl()}/api/review/diff?cwd=${encodeURIComponent(cwd)}`
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json() as { diff: string };
        return json.diff ?? '';
      }
    } catch (error: any) {
      console.warn('[CodeReviewService] fetchDiff failed:', error.message);
      return '';
    }
  }

  /**
   * Reject (revert) a specific hunk by applying the patch content in reverse.
   *
   * @param cwd - Working directory of the session
   * @param patchContent - The raw unified diff hunk to reverse
   * @returns Success/error result
   */
  async rejectHunk(cwd: string, patchContent: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (window.electronAPI) {
        return (await window.electronAPI.invoke(
          IPC_CHANNELS.REVIEW_REJECT_HUNK,
          cwd,
          patchContent
        )) as { success: boolean; error?: string };
      } else {
        const resp = await fetch(
          `${getHttpBaseUrl()}/api/review/reject-hunk`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cwd, patchContent }),
          }
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json() as { success: boolean; error?: string };
      }
    } catch (error: any) {
      console.warn('[CodeReviewService] rejectHunk failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reject (revert) all changes to a file by restoring it from HEAD.
   *
   * @param cwd - Working directory of the session
   * @param filePath - Relative file path within the repo
   * @returns Success/error result
   */
  async rejectFile(cwd: string, filePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (window.electronAPI) {
        return (await window.electronAPI.invoke(
          IPC_CHANNELS.REVIEW_REJECT_FILE,
          cwd,
          filePath
        )) as { success: boolean; error?: string };
      } else {
        const resp = await fetch(
          `${getHttpBaseUrl()}/api/review/reject-file`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cwd, filePath }),
          }
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json() as { success: boolean; error?: string };
      }
    } catch (error: any) {
      console.warn('[CodeReviewService] rejectFile failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Apply a patch directly (forward apply, not reverse).
   * Used for undo operations: re-applying a rejected hunk's patch.
   *
   * @param cwd - Working directory of the session
   * @param patchContent - The raw unified diff to apply
   * @returns Success/error result
   */
  async applyPatch(cwd: string, patchContent: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (window.electronAPI) {
        return (await window.electronAPI.invoke(
          IPC_CHANNELS.REVIEW_APPLY_PATCH,
          cwd,
          patchContent
        )) as { success: boolean; error?: string };
      } else {
        const resp = await fetch(
          `${getHttpBaseUrl()}/api/review/apply-patch`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cwd, patchContent }),
          }
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json() as { success: boolean; error?: string };
      }
    } catch (error: any) {
      console.warn('[CodeReviewService] applyPatch failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ---------------------------------------------------------------------------
  // Comment state management
  // ---------------------------------------------------------------------------

  /**
   * Add a new inline comment to a session.
   *
   * @param sessionId - Session identifier
   * @param filename - File the comment is attached to
   * @param line - Line number within the file
   * @param text - Comment text
   * @returns The created ReviewComment
   */
  addComment(sessionId: string, filename: string, line: number, text: string): ReviewComment {
    const comment: ReviewComment = {
      id: crypto.randomUUID(),
      sessionId,
      filename,
      line,
      text,
      resolved: false,
      createdAt: new Date(),
    };

    const list = this.comments.get(sessionId) ?? [];
    list.push(comment);
    this.comments.set(sessionId, list);

    return comment;
  }

  /**
   * Get all comments for a session, optionally filtered by filename.
   *
   * @param sessionId - Session identifier
   * @param filename - Optional filename filter
   * @returns Array of matching ReviewComment objects
   */
  getComments(sessionId: string, filename?: string): ReviewComment[] {
    const list = this.comments.get(sessionId) ?? [];
    if (filename === undefined) return list;
    return list.filter(c => c.filename === filename);
  }

  /**
   * Convenience method: get comments for a specific file in a session.
   *
   * @param sessionId - Session identifier
   * @param filename - File path to filter by
   * @returns Array of ReviewComment objects for that file
   */
  getCommentsForFile(sessionId: string, filename: string): ReviewComment[] {
    return this.getComments(sessionId, filename);
  }

  /**
   * Toggle the resolved flag on a comment.
   *
   * @param sessionId - Session identifier
   * @param commentId - Comment ID to toggle
   */
  toggleResolved(sessionId: string, commentId: string): void {
    const list = this.comments.get(sessionId);
    if (!list) return;
    const comment = list.find(c => c.id === commentId);
    if (comment) {
      comment.resolved = !comment.resolved;
    }
  }

  /**
   * Remove a comment by ID.
   *
   * @param sessionId - Session identifier
   * @param commentId - Comment ID to remove
   */
  removeComment(sessionId: string, commentId: string): void {
    const list = this.comments.get(sessionId);
    if (!list) return;
    const index = list.findIndex(c => c.id === commentId);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }

  /**
   * Remove all comments for a session (e.g. when session is closed).
   *
   * @param sessionId - Session identifier
   */
  clearSession(sessionId: string): void {
    this.comments.delete(sessionId);
    this.fileStates.delete(sessionId);
  }

  // ---------------------------------------------------------------------------
  // File review state management
  // ---------------------------------------------------------------------------

  /**
   * Get the review state for a specific file in a session.
   * Returns undefined if no state has been set yet.
   *
   * @param sessionId - Session identifier
   * @param filename - File path
   * @returns ReviewFileState or undefined
   */
  getFileState(sessionId: string, filename: string): ReviewFileState | undefined {
    return this.fileStates.get(sessionId)?.get(filename);
  }

  /**
   * Initialize or reset file state for a file in a session.
   *
   * @param sessionId - Session identifier
   * @param filename - File path
   * @param status - Git file status (added, modified, deleted, renamed)
   * @param hunkCount - Number of hunks in the file's diff
   */
  initFileState(
    sessionId: string,
    filename: string,
    status: ReviewFileStatus,
    hunkCount: number
  ): void {
    const sessionMap = this.fileStates.get(sessionId) ?? new Map<string, ReviewFileState>();
    sessionMap.set(filename, {
      filename,
      status,
      hunkStates: Array(hunkCount).fill('pending') as ReviewHunkState[],
      reviewed: false,
    });
    this.fileStates.set(sessionId, sessionMap);
  }

  /**
   * Update the state of a specific hunk.
   *
   * @param sessionId - Session identifier
   * @param filename - File path
   * @param hunkIndex - Zero-based index of the hunk
   * @param state - New hunk state
   */
  setHunkState(
    sessionId: string,
    filename: string,
    hunkIndex: number,
    state: ReviewHunkState
  ): void {
    const fileState = this.fileStates.get(sessionId)?.get(filename);
    if (!fileState || hunkIndex < 0 || hunkIndex >= fileState.hunkStates.length) return;
    fileState.hunkStates[hunkIndex] = state;
  }

  /**
   * Mark a file as fully reviewed (all hunks seen, decision made).
   *
   * @param sessionId - Session identifier
   * @param filename - File path
   * @param reviewed - Whether the file has been reviewed
   */
  setFileReviewed(sessionId: string, filename: string, reviewed: boolean): void {
    const fileState = this.fileStates.get(sessionId)?.get(filename);
    if (fileState) {
      fileState.reviewed = reviewed;
    }
  }

  /**
   * Get all file states for a session.
   *
   * @param sessionId - Session identifier
   * @returns Array of ReviewFileState objects
   */
  getAllFileStates(sessionId: string): ReviewFileState[] {
    const sessionMap = this.fileStates.get(sessionId);
    if (!sessionMap) return [];
    return Array.from(sessionMap.values());
  }
}
