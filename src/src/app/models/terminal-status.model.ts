/**
 * Terminal status model with color constants for status visualization.
 *
 * Re-exports TerminalStatus from ws-protocol for consistent typing across the app.
 * Provides color mappings using Catppuccin Mocha theme colors.
 */

import { TerminalStatus } from '../../../shared/ws-protocol';

// Re-export for convenience
export { TerminalStatus };

/**
 * Status colors using Catppuccin Mocha palette.
 */
export const STATUS_COLORS: Record<TerminalStatus, string> = {
  WORKING: '#a6e3a1',   // green
  THINKING: '#94e2d5',  // teal
  WAITING: '#fab387',   // peach
  ERROR: '#f38ba8',     // red
  DONE: '#b4befe'       // lavender
};

/**
 * Human-readable status labels for tooltips and UI.
 */
export const STATUS_LABELS: Record<TerminalStatus, string> = {
  WORKING: 'Working',
  THINKING: 'Thinking',
  WAITING: 'Waiting for input',
  ERROR: 'Error',
  DONE: 'Done'
};
