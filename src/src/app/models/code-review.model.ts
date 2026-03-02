/**
 * Shared data model for the local code review panel.
 *
 * Defines types for diff hunks, file states, inline comments,
 * and project-type-aware file ordering.
 */

// ---------------------------------------------------------------------------
// Comment types
// ---------------------------------------------------------------------------

/**
 * An inline review comment attached to a specific line in a file.
 */
export interface ReviewComment {
  id: string;
  sessionId: string;
  filename: string;
  line: number;
  text: string;
  resolved: boolean;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// File and hunk state types
// ---------------------------------------------------------------------------

/**
 * The git status of a file in the diff.
 */
export type ReviewFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

/**
 * The review decision for a single hunk.
 */
export type ReviewHunkState = 'pending' | 'accepted' | 'rejected';

/**
 * Per-file review state tracking hunk decisions and overall review completion.
 */
export interface ReviewFileState {
  filename: string;
  status: ReviewFileStatus;
  hunkStates: ReviewHunkState[];
  reviewed: boolean;
}

// ---------------------------------------------------------------------------
// Project type detection and file ordering
// ---------------------------------------------------------------------------

/**
 * A project type definition used for intelligent file ordering in the review panel.
 * Files are sorted by their position in the layerOrder array so reviewers see
 * higher-level concerns first.
 */
export interface ProjectType {
  name: string;
  layerOrder: string[];
}

/**
 * Known project types and their preferred review layer order.
 *
 * Angular: routes first, then components, services, models, shared, finally tests.
 * Express API: routes → controllers → managers/brokers → models → middleware → tests.
 */
export const PROJECT_TYPES: ProjectType[] = [
  {
    name: 'angular',
    layerOrder: ['routes', 'components', 'services', 'models', 'shared', 'tests'],
  },
  {
    name: 'express-api',
    layerOrder: ['routes', 'controllers', 'managers', 'brokers', 'models', 'middleware', 'tests'],
  },
];

/**
 * Detect the project type from a list of changed file paths.
 *
 * Heuristics:
 * - angular.json present or src/app/ path pattern → 'angular'
 * - routes/ + (controllers/ or managers/) path pattern → 'express-api'
 * - Otherwise null (unknown / fallback alphabetical sort)
 *
 * @param changedFiles - Array of file paths relative to project root
 * @returns Project type name or null if undetectable
 */
export function detectProjectType(changedFiles: string[]): string | null {
  const paths = changedFiles.map(f => f.replace(/\\/g, '/').toLowerCase());

  // Angular: angular.json present or src/app/ directory structure
  if (
    paths.some(p => p === 'angular.json' || p.endsWith('/angular.json')) ||
    paths.some(p => p.includes('src/app/'))
  ) {
    return 'angular';
  }

  // Express API: routes/ combined with controllers/ or managers/
  const hasRoutes = paths.some(p => p.includes('routes/'));
  const hasControllers = paths.some(p => p.includes('controllers/'));
  const hasManagers = paths.some(p => p.includes('managers/'));

  if (hasRoutes && (hasControllers || hasManagers)) {
    return 'express-api';
  }

  return null;
}

/**
 * Return the layer index for a file path within the given project type's layer order.
 * Returns a high number for unrecognised paths so they sort to the end.
 *
 * @param filename - File path to classify
 * @param layerOrder - Layer order array from a ProjectType
 * @returns Numeric sort key
 */
function getLayerIndex(filename: string, layerOrder: string[]): number {
  const normalized = filename.replace(/\\/g, '/').toLowerCase();
  for (let i = 0; i < layerOrder.length; i++) {
    if (normalized.includes(`/${layerOrder[i]}/`) || normalized.includes(`${layerOrder[i]}/`)) {
      return i;
    }
  }
  return layerOrder.length; // Unknown: sort to end
}

/**
 * Sort files by project-layer order, falling back to alphabetical for unknowns.
 *
 * @param files - Array of objects with a `filename` property
 * @param projectTypeName - Name of the project type (from detectProjectType)
 * @returns New sorted array (input is not mutated)
 */
export function sortFilesByLayer<T extends { filename: string }>(
  files: T[],
  projectTypeName: string | null
): T[] {
  const projectType = projectTypeName
    ? PROJECT_TYPES.find(pt => pt.name === projectTypeName)
    : null;

  if (!projectType) {
    // Unknown project type: sort alphabetically
    return [...files].sort((a, b) => a.filename.localeCompare(b.filename));
  }

  return [...files].sort((a, b) => {
    const ia = getLayerIndex(a.filename, projectType.layerOrder);
    const ib = getLayerIndex(b.filename, projectType.layerOrder);
    if (ia !== ib) return ia - ib;
    // Within same layer: sort alphabetically
    return a.filename.localeCompare(b.filename);
  });
}
