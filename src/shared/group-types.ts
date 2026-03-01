/**
 * Terminal grouping and layout preset types.
 *
 * Shared between Angular renderer and Electron main process
 * for persistence of group state.
 */

/**
 * Represents a named group of terminal sessions.
 */
export interface SessionGroup {
  /** Display name of the group (e.g., "Frontend", "Backend"). */
  name: string;

  /** Hex color for visual identification (e.g., "#89b4fa"). */
  color: string;

  /** IDs of sessions assigned to this group. */
  sessionIds: string[];
}

/**
 * Available layout presets for the dashboard grid.
 * - overview: default grid with auto-fill columns
 * - focus: single session maximized
 * - split: two sessions side by side
 * - columns: three equal columns
 */
export type LayoutPreset = 'overview' | 'focus' | 'split' | 'columns';

/**
 * Configuration for the current dashboard layout.
 */
export interface LayoutConfig {
  /** Active layout preset. */
  preset: LayoutPreset;

  /** Filter to show only sessions from this group. Undefined = show all. */
  activeGroup?: string;

  /** Session ID to focus in 'focus' preset. */
  focusedSessionId?: string;
}

/**
 * Default color palette for new groups (Catppuccin Mocha accent colors).
 */
export const DEFAULT_GROUP_COLORS = [
  '#89b4fa',  // blue
  '#a6e3a1',  // green
  '#fab387',  // peach
  '#cba6f7',  // mauve
  '#f38ba8',  // red
  '#f9e2af',  // yellow
  '#94e2d5',  // teal
  '#74c7ec',  // sapphire
];
