/**
 * Git context model for displaying repository state in terminal tiles.
 *
 * Used to show branch name and uncommitted changes count in the dashboard,
 * enabling quick visibility into which terminals have pending work.
 */

/**
 * Represents Git repository context for a terminal session.
 */
export interface GitContext {
  /**
   * Current Git branch name, or null if not in a Git repository or if Git command failed.
   */
  readonly branch: string | null;

  /**
   * Number of added/untracked files in working directory.
   */
  readonly added: number;

  /**
   * Number of modified files in working directory.
   */
  readonly modified: number;

  /**
   * Number of deleted files in working directory.
   */
  readonly deleted: number;

  /**
   * Whether the current directory is a Git repository.
   * False if not a repo, if Git is not installed, or if Git commands timeout.
   */
  readonly isGitRepo: boolean;
}
