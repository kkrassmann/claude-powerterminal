import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initSessionLogDir,
  appendSessionLog,
  loadSessionLog,
  deleteSessionLog,
  cleanupOrphanedLogs,
} from './session-log';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-log-test-'));
  initSessionLogDir(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('session-log', () => {
  it('append then load returns identical data', () => {
    appendSessionLog('s1', 'hello world');
    const result = loadSessionLog('s1');
    expect(result).toBe('hello world');
  });

  it('multiple appends concatenate correctly', () => {
    appendSessionLog('s2', 'aaa');
    appendSessionLog('s2', 'bbb');
    appendSessionLog('s2', 'ccc');
    const result = loadSessionLog('s2');
    expect(result).toBe('aaabbbccc');
  });

  it('file is trimmed when exceeding 1MB', () => {
    const chunk = 'x'.repeat(100_000); // 100KB per chunk
    // Write 12 chunks = 1.2MB — should trigger trim
    for (let i = 0; i < 12; i++) {
      appendSessionLog('s3', chunk);
    }

    const filePath = path.join(tmpDir, 's3.buf');
    const stat = fs.statSync(filePath);
    // After trim, file should be around 900KB (TRIM_TARGET), not > 1.1MB
    expect(stat.size).toBeLessThan(1_100_000);
    expect(stat.size).toBeGreaterThan(800_000);
  });

  it('load non-existent returns null', () => {
    expect(loadSessionLog('nonexistent')).toBeNull();
  });

  it('delete removes file', async () => {
    appendSessionLog('s4', 'data');
    const filePath = path.join(tmpDir, 's4.buf');
    expect(fs.existsSync(filePath)).toBe(true);

    deleteSessionLog('s4');
    // deleteSessionLog is async fire-and-forget, wait briefly
    await new Promise(r => setTimeout(r, 100));
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('delete non-existent does not throw', () => {
    expect(() => deleteSessionLog('ghost')).not.toThrow();
  });

  it('cleanupOrphanedLogs removes stale, keeps active', async () => {
    appendSessionLog('active1', 'keep');
    appendSessionLog('stale1', 'remove');
    appendSessionLog('stale2', 'remove');

    cleanupOrphanedLogs(new Set(['active1']));

    // Wait for async deletes
    await new Promise(r => setTimeout(r, 100));

    expect(fs.existsSync(path.join(tmpDir, 'active1.buf'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'stale1.buf'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'stale2.buf'))).toBe(false);
  });

  it('preserves escape sequences in roundtrip', () => {
    const ansi = '\x1b[31mRED\x1b[0m normal \x1b[1;32mGREEN\x1b[0m';
    appendSessionLog('s5', ansi);
    expect(loadSessionLog('s5')).toBe(ansi);
  });
});
