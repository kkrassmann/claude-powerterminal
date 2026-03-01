/**
 * Central logging service with ring buffer for structured internal logs.
 *
 * All log calls forward to console.log/warn/error so existing debug output
 * is preserved. Entries are stored in a fixed-size ring buffer (2000 entries)
 * and can be exported as JSONL for offline analysis.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  sessionId?: string;
  message: string;
  details?: any;
}

const MAX_ENTRIES = 2000;
const entries: LogEntry[] = [];

function addEntry(level: LogLevel, source: string, message: string, sessionId?: string, details?: any): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    ...(sessionId !== undefined && { sessionId }),
    ...(details !== undefined && { details }),
  };

  if (entries.length >= MAX_ENTRIES) {
    entries.shift();
  }
  entries.push(entry);

  // Forward to console (preserves existing output behavior)
  const formatted = `[${source}] ${message}`;
  switch (level) {
    case 'ERROR':
      console.error(formatted, details !== undefined ? details : '');
      break;
    case 'WARN':
      console.warn(formatted, details !== undefined ? details : '');
      break;
    case 'DEBUG':
      // Debug goes to console.log (visible in dev tools)
      console.log(formatted, details !== undefined ? details : '');
      break;
    default:
      console.log(formatted, details !== undefined ? details : '');
  }
}

export function info(source: string, message: string, sessionId?: string, details?: any): void {
  addEntry('INFO', source, message, sessionId, details);
}

export function warn(source: string, message: string, sessionId?: string, details?: any): void {
  addEntry('WARN', source, message, sessionId, details);
}

export function error(source: string, message: string, sessionId?: string, details?: any): void {
  addEntry('ERROR', source, message, sessionId, details);
}

export function debug(source: string, message: string, sessionId?: string, details?: any): void {
  addEntry('DEBUG', source, message, sessionId, details);
}

/**
 * Get all log entries (newest last).
 */
export function getEntries(): LogEntry[] {
  return entries;
}

/**
 * Export all entries as a JSONL string (one JSON object per line).
 */
export function exportAsJsonl(): string {
  return entries.map(e => JSON.stringify(e)).join('\n');
}

/**
 * Reset internal state. Only for use in unit tests.
 */
export function _resetForTesting(): void {
  entries.length = 0;
}
