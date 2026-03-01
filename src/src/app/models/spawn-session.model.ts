/**
 * Request to spawn a new session from a tile-header dropdown action.
 * Emitted from tile-header → dashboard → app.component for processing.
 */
export interface SpawnSessionRequest {
  type: 'same-directory' | 'existing-worktree' | 'new-worktree';
  cwd: string;
  worktreePath?: string;       // for existing-worktree
  branchName?: string;         // for new-worktree
  useExistingBranch?: boolean; // true = checkout existing branch, false = create new
}
