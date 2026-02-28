/**
 * Type definitions for Session Templates.
 *
 * Templates allow users to save and reuse session configurations
 * (working directory, initial prompt, CLI flags) for common workflows.
 */

/**
 * Category for organizing templates by use case.
 */
export type TemplateCategory = 'general' | 'bugfix' | 'feature' | 'review' | 'test' | 'custom';

/**
 * A saved session template that can be used to quickly create new sessions.
 */
export interface SessionTemplate {
  /** Unique identifier (UUID v4) */
  id: string;
  /** User-visible template name */
  name: string;
  /** Category for filtering and visual grouping */
  category: TemplateCategory;
  /** Default working directory for sessions created from this template */
  workingDirectory: string;
  /** Optional prompt to inject after session spawn */
  initialPrompt?: string;
  /** Optional user-visible description */
  description?: string;
  /** ISO 8601 timestamp of template creation */
  createdAt: string;
  /** ISO 8601 timestamp of last usage */
  lastUsedAt?: string;
  /** Number of times this template has been used */
  useCount: number;
}
