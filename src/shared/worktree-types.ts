/**
 * Shared type definitions for the Git Worktree Manager feature.
 * Used by both Electron main process and Angular renderer.
 */

export interface WorktreeInfo {
  path: string;           // absolute path to worktree
  branch: string;         // branch name (or "(detached)")
  commit: string;         // short commit hash
  isMain: boolean;        // true if this is the main worktree
  hasSession: boolean;    // true if a PowerTerminal session exists here
}

export interface WorktreeCreateOptions {
  repoPath: string;       // path to any worktree in the repo
  branchName: string;     // new branch name
  baseBranch?: string;    // base branch (default: current HEAD)
}
