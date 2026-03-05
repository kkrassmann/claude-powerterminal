/**
 * Per-session rolling log file manager.
 *
 * Persists every PTY output chunk to disk instantly via appendFileSync.
 * When the file exceeds 1MB, trims to ~900KB. On session close, deletes
 * the file. On restore, loads saved data into ScrollbackBuffer.
 *
 * Storage: userData/scrollback/{sessionId}.buf
 */

import * as fs from 'fs';
import * as path from 'path';

const MAX_LOG_BYTES = 1_048_576;  // 1MB
const TRIM_TARGET   =   921_600;  // ~900KB — keep this much after trim

let scrollbackDir: string = '';

/** Approximate byte size per session (avoids fs.statSync on every append) */
const byteCounts = new Map<string, number>();

/**
 * Initialize the scrollback directory. Must be called once before any other function.
 */
export function initSessionLogDir(dir: string): void {
  scrollbackDir = dir;
  fs.mkdirSync(dir, { recursive: true });
}

function logPath(sessionId: string): string {
  return path.join(scrollbackDir, `${sessionId}.buf`);
}

/**
 * Append PTY output chunk to session's log file (sync, instant).
 * Trims to TRIM_TARGET if file exceeds MAX_LOG_BYTES.
 */
export function appendSessionLog(sessionId: string, data: string): void {
  const filePath = logPath(sessionId);
  fs.appendFileSync(filePath, data, 'utf-8');

  const added = Buffer.byteLength(data, 'utf-8');
  const current = (byteCounts.get(sessionId) ?? 0) + added;
  byteCounts.set(sessionId, current);

  if (current > MAX_LOG_BYTES) {
    try {
      const content = fs.readFileSync(filePath);
      if (content.length > MAX_LOG_BYTES) {
        const trimmed = content.subarray(content.length - TRIM_TARGET);
        fs.writeFileSync(filePath, trimmed);
        byteCounts.set(sessionId, trimmed.length);
      } else {
        byteCounts.set(sessionId, content.length);
      }
    } catch { /* file may have been deleted concurrently */ }
  }
}

/**
 * Load saved log for session restore (sync, returns null if not found).
 * Also initializes the byte counter from file size.
 */
export function loadSessionLog(sessionId: string): string | null {
  try {
    const filePath = logPath(sessionId);
    const content = fs.readFileSync(filePath, 'utf-8');
    byteCounts.set(sessionId, Buffer.byteLength(content, 'utf-8'));
    return content;
  } catch {
    return null;
  }
}

/**
 * Delete session's log file (async, fire-and-forget, ENOENT safe).
 */
export function deleteSessionLog(sessionId: string): void {
  byteCounts.delete(sessionId);
  fs.promises.unlink(logPath(sessionId)).catch(() => {});
}

/**
 * Remove .buf files for sessions not in activeIds set.
 */
export function cleanupOrphanedLogs(activeIds: Set<string>): void {
  try {
    const files = fs.readdirSync(scrollbackDir);
    for (const file of files) {
      if (!file.endsWith('.buf')) continue;
      const id = file.slice(0, -4); // strip .buf
      if (!activeIds.has(id)) {
        fs.promises.unlink(path.join(scrollbackDir, file)).catch(() => {});
      }
    }
  } catch { /* directory may not exist yet */ }
}
