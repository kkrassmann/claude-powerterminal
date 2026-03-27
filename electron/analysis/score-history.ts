/**
 * Score history persistence module.
 *
 * Manages score-history.json in the Electron userData directory.
 * Provides bounded persistence (max 50 entries), deduplication by sessionId,
 * and graceful handling of missing/corrupt files.
 */

import * as fs from 'fs';
import * as path from 'path';

// Accept optional path for testing — avoids dependency on Electron app being ready
let _userDataPath: string | null = null;

export function setUserDataPath(p: string): void {
  _userDataPath = p;
}

function getHistoryFilePath(): string {
  if (_userDataPath) return path.join(_userDataPath, 'score-history.json');
  // Lazy import to avoid issues if module is imported before app is ready
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'score-history.json');
}

const MAX_ENTRIES = 50;

export interface HistoryEntry {
  sessionId: string;
  timestamp: string;
  score: number;
  toolNativenessScore: number;
  subagentScore: number;
  readBeforeWriteScore: number;
  contextEfficiencyScore: number;
  errorScore: number;
  antiPatternCount: number;
}

/**
 * Read all score history entries from disk.
 * Returns empty array if file is missing, empty, or corrupt.
 */
function readScoreHistory(): HistoryEntry[] {
  try {
    const filePath = getHistoryFilePath();
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as HistoryEntry[];
  } catch {
    return [];
  }
}

/**
 * Append a score history entry to disk.
 * Deduplicates by sessionId (re-analysis case replaces previous entry).
 * Caps history at MAX_ENTRIES (50) by dropping oldest entries.
 * Silent fail — score history is non-critical persistence.
 */
export function appendScoreHistory(entry: HistoryEntry): void {
  let history = readScoreHistory();
  // Remove previous entry for same sessionId (re-analysis case)
  history = history.filter(h => h.sessionId !== entry.sessionId);
  history.push(entry);
  if (history.length > MAX_ENTRIES) {
    history = history.slice(history.length - MAX_ENTRIES);
  }
  try {
    fs.writeFileSync(getHistoryFilePath(), JSON.stringify(history, null, 2), 'utf-8');
  } catch {
    // Silent fail — non-critical persistence
  }
}

/**
 * Get the last N score history entries for trend tracking.
 * Returns entries in chronological order (oldest first).
 */
export function getTrends(lastN = 10): HistoryEntry[] {
  const history = readScoreHistory();
  return history.slice(-lastN);
}
