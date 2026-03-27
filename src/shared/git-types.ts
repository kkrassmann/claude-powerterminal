/**
 * Canonical GitContext interface.
 * Single source of truth — imported by Electron git-handlers and Angular renderer.
 */
export interface GitContext {
  /** Current Git branch name, or null if not in a Git repository. */
  readonly branch: string | null;
  /** Number of added/untracked files in working directory. */
  readonly added: number;
  /** Number of modified files in working directory. */
  readonly modified: number;
  /** Number of deleted files in working directory. */
  readonly deleted: number;
  /** Whether the current directory is a Git repository. */
  readonly isGitRepo: boolean;
}
