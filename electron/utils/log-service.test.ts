import { describe, it, expect, beforeEach, vi } from 'vitest';
import { info, warn, error, debug, getEntries, exportAsJsonl, _resetForTesting } from './log-service';

describe('LogService', () => {
  beforeEach(() => {
    _resetForTesting();
    vi.restoreAllMocks();
  });

  it('stores log entries with correct fields', () => {
    info('TestSource', 'hello world');
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('INFO');
    expect(entries[0].source).toBe('TestSource');
    expect(entries[0].message).toBe('hello world');
    expect(entries[0].timestamp).toBeTruthy();
  });

  it('stores all log levels', () => {
    debug('S', 'debug msg');
    info('S', 'info msg');
    warn('S', 'warn msg');
    error('S', 'error msg');

    const entries = getEntries();
    expect(entries).toHaveLength(4);
    expect(entries.map(e => e.level)).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR']);
  });

  it('includes optional sessionId and details', () => {
    info('S', 'msg', 'session-123', { foo: 'bar' });
    const entry = getEntries()[0];
    expect(entry.sessionId).toBe('session-123');
    expect(entry.details).toEqual({ foo: 'bar' });
  });

  it('omits sessionId and details when not provided', () => {
    info('S', 'msg');
    const entry = getEntries()[0];
    expect(entry).not.toHaveProperty('sessionId');
    expect(entry).not.toHaveProperty('details');
  });

  it('enforces ring buffer limit of 2000 entries', () => {
    for (let i = 0; i < 2050; i++) {
      info('S', `msg ${i}`);
    }
    const entries = getEntries();
    expect(entries).toHaveLength(2000);
    // First entry should be msg 50 (oldest 50 were shifted out)
    expect(entries[0].message).toBe('msg 50');
    expect(entries[1999].message).toBe('msg 2049');
  });

  it('exports entries as JSONL', () => {
    info('A', 'first');
    warn('B', 'second');

    const jsonl = exportAsJsonl();
    const lines = jsonl.split('\n');
    expect(lines).toHaveLength(2);

    const parsed0 = JSON.parse(lines[0]);
    expect(parsed0.source).toBe('A');
    expect(parsed0.message).toBe('first');

    const parsed1 = JSON.parse(lines[1]);
    expect(parsed1.level).toBe('WARN');
    expect(parsed1.source).toBe('B');
  });

  it('exports empty string when no entries', () => {
    expect(exportAsJsonl()).toBe('');
  });

  it('forwards to console.log for INFO level', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    info('Src', 'test message');
    expect(spy).toHaveBeenCalledWith('[Src] test message', '');
  });

  it('forwards to console.warn for WARN level', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warn('Src', 'warning');
    expect(spy).toHaveBeenCalledWith('[Src] warning', '');
  });

  it('forwards to console.error for ERROR level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    error('Src', 'error msg');
    expect(spy).toHaveBeenCalledWith('[Src] error msg', '');
  });

  it('forwards details to console when provided', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    info('S', 'msg', undefined, { key: 'val' });
    expect(spy).toHaveBeenCalledWith('[S] msg', { key: 'val' });
  });

  it('resets entries on _resetForTesting', () => {
    info('S', 'a');
    info('S', 'b');
    expect(getEntries()).toHaveLength(2);
    _resetForTesting();
    expect(getEntries()).toHaveLength(0);
  });
});
