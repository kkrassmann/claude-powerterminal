/**
 * Tests for session-handlers.ts
 *
 * Strategy: mock `electron` (app + ipcMain) and `fs` module so no real files
 * are written. Capture ipcMain.handle callbacks and invoke them directly to
 * test the full handler logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures variables are initialized before vi.mock() factories run
// ---------------------------------------------------------------------------

// Captured handler map: channel → callback
const ipcHandlers: Record<string, (...args: any[]) => any> = {};

// fs mock — hoisted so it can be referenced inside the vi.mock() factory.
// Uses mockImplementation() so vi.fn() actually delegates to our logic.
// The `state` object is mutated in-place across resets (no re-assignment),
// so closures remain valid for the lifetime of the test file.
const fsMock = vi.hoisted(() => {
  const state = {
    store: {} as Record<string, string>,
    dirs: new Set<string>(),
  };

  const existsSync = vi.fn().mockImplementation((p: string) =>
    p in state.store || state.dirs.has(p)
  );

  const readFileSync = vi.fn().mockImplementation((p: string, _enc: string) => {
    if (!(p in state.store)) throw new Error(`ENOENT: ${p}`);
    return state.store[p];
  });

  const writeFileSync = vi.fn().mockImplementation((p: string, data: string, _enc: string) => {
    state.store[p] = data;
  });

  const mkdirSync = vi.fn().mockImplementation((p: string, _opts?: any) => {
    state.dirs.add(p);
  });

  return {
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,

    // Test helpers
    _setFile(path: string, content: string) { state.store[path] = content; },
    _getFile(path: string): string { return state.store[path]; },
    _hasFile(path: string): boolean { return path in state.store; },
    _reset() {
      for (const key of Object.keys(state.store)) delete state.store[key];
      state.dirs.clear();
      // mockReset clears both call tracking AND any one-time overrides
      existsSync.mockReset().mockImplementation((p: string) =>
        p in state.store || state.dirs.has(p)
      );
      readFileSync.mockReset().mockImplementation((p: string, _enc: string) => {
        if (!(p in state.store)) throw new Error(`ENOENT: ${p}`);
        return state.store[p];
      });
      writeFileSync.mockReset().mockImplementation((p: string, data: string, _enc: string) => {
        state.store[p] = data;
      });
      mkdirSync.mockReset().mockImplementation((p: string, _opts?: any) => {
        state.dirs.add(p);
      });
    },
    // Read-only state access for assertions
    get _store() { return state.store; },
    get _dirs() { return state.dirs; },
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((_key: string) => '/fake/userData'),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      ipcHandlers[channel] = handler;
    }),
  },
}));

vi.mock('fs', () => fsMock);

// Silence log-service console output during tests
vi.mock('../utils/log-service', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are in place
// ---------------------------------------------------------------------------

import { ipcMain } from 'electron';
import {
  registerSessionHandlers,
  deleteSessionFromDisk,
  getSessionFromDisk,
} from './session-handlers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Use `path.join` so the key matches what the module produces on every platform
// (Windows uses backslashes; forward-slash literals would cause mismatches)
import * as path from 'path';
const SESSIONS_PATH = path.join('/fake/userData', 'sessions.json');

function setSessionsOnDisk(sessions: object[]) {
  fsMock._setFile(SESSIONS_PATH, JSON.stringify(sessions));
}

function getSessionsOnDisk(): object[] {
  return JSON.parse(fsMock._getFile(SESSIONS_PATH) ?? '[]');
}

function makeSession(id: string) {
  return {
    sessionId: id,
    workingDirectory: `/projects/${id}`,
    cliFlags: ['--model', 'claude-opus'],
    createdAt: new Date().toISOString(),
  };
}

// Invoke a captured IPC handler (simulates Electron renderer calling invoke)
async function callHandler(channel: string, ...args: any[]) {
  const handler = ipcHandlers[channel];
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  // Electron passes event as first arg; we pass a dummy object
  return handler({} as any, ...args);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerSessionHandlers()', () => {
  beforeEach(() => {
    fsMock._reset();
    // Clear captured handlers between runs
    for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key];
  });

  it('registers all four IPC handlers', () => {
    registerSessionHandlers();

    expect(ipcMain.handle).toHaveBeenCalledWith('session:save', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('session:load', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('session:delete', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('session:get', expect.any(Function));
  });
});

// ---------------------------------------------------------------------------
// SESSION_LOAD
// ---------------------------------------------------------------------------

describe('SESSION_LOAD handler', () => {
  beforeEach(() => {
    fsMock._reset();
    for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key];
    registerSessionHandlers();
  });

  it('returns empty array when sessions file does not exist', async () => {
    const result = await callHandler('session:load');
    expect(result.success).toBe(true);
    expect(result.sessions).toEqual([]);
  });

  it('returns persisted sessions from disk', async () => {
    const sessions = [makeSession('s1'), makeSession('s2')];
    setSessionsOnDisk(sessions);

    const result = await callHandler('session:load');
    expect(result.success).toBe(true);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0].sessionId).toBe('s1');
    expect(result.sessions[1].sessionId).toBe('s2');
  });

  it('returns empty array when sessions file contains corrupt JSON', async () => {
    fsMock._setFile(SESSIONS_PATH, '{ not valid json |||');
    const result = await callHandler('session:load');
    expect(result.success).toBe(true);
    expect(result.sessions).toEqual([]);
  });

  it('returns empty array when sessions file is empty string', async () => {
    fsMock._setFile(SESSIONS_PATH, '');
    const result = await callHandler('session:load');
    expect(result.success).toBe(true);
    expect(result.sessions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SESSION_SAVE
// ---------------------------------------------------------------------------

describe('SESSION_SAVE handler', () => {
  beforeEach(() => {
    fsMock._reset();
    for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key];
    registerSessionHandlers();
  });

  it('saves a session when no file exists yet', async () => {
    const session = makeSession('s-new');
    const result = await callHandler('session:save', session);

    expect(result.success).toBe(true);
    const stored = getSessionsOnDisk() as any[];
    expect(stored).toHaveLength(1);
    expect(stored[0].sessionId).toBe('s-new');
  });

  it('appends a session to existing sessions', async () => {
    setSessionsOnDisk([makeSession('existing')]);

    const result = await callHandler('session:save', makeSession('new'));
    expect(result.success).toBe(true);

    const stored = getSessionsOnDisk() as any[];
    expect(stored).toHaveLength(2);
    expect(stored.map((s: any) => s.sessionId)).toContain('existing');
    expect(stored.map((s: any) => s.sessionId)).toContain('new');
  });

  it('creates the userData directory if it does not exist', async () => {
    // Override existsSync so BOTH the sessions file and userData dir appear missing,
    // triggering the mkdirSync branch in saveSessionsToDisk.
    fsMock.existsSync.mockImplementation(() => false);

    await callHandler('session:save', makeSession('s1'));

    expect(fsMock.mkdirSync).toHaveBeenCalledWith(path.join('/fake/userData'), { recursive: true });
  });

  it('preserves all session fields after save', async () => {
    const session = makeSession('full-test');
    await callHandler('session:save', session);

    const stored = getSessionsOnDisk() as any[];
    expect(stored[0]).toMatchObject(session);
  });

  it('returns success: false when writeFileSync throws', async () => {
    fsMock._setFile(SESSIONS_PATH, '[]');
    fsMock.writeFileSync.mockImplementationOnce(() => {
      throw new Error('Disk full');
    });

    const result = await callHandler('session:save', makeSession('s1'));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Disk full/);
  });
});

// ---------------------------------------------------------------------------
// SESSION_DELETE
// ---------------------------------------------------------------------------

describe('SESSION_DELETE handler', () => {
  beforeEach(() => {
    fsMock._reset();
    for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key];
    registerSessionHandlers();
  });

  it('removes the specified session from disk', async () => {
    setSessionsOnDisk([makeSession('keep'), makeSession('remove-me')]);

    const result = await callHandler('session:delete', 'remove-me');
    expect(result.success).toBe(true);

    const stored = getSessionsOnDisk() as any[];
    expect(stored).toHaveLength(1);
    expect(stored[0].sessionId).toBe('keep');
  });

  it('is a no-op when the session does not exist', async () => {
    setSessionsOnDisk([makeSession('s1')]);

    const result = await callHandler('session:delete', 'ghost');
    expect(result.success).toBe(true);

    const stored = getSessionsOnDisk() as any[];
    expect(stored).toHaveLength(1);
  });

  it('returns success: true when file does not exist (nothing to delete)', async () => {
    // No file on disk at all
    const result = await callHandler('session:delete', 'any-id');
    expect(result.success).toBe(true);
  });

  it('removes only the matching session when multiple exist', async () => {
    setSessionsOnDisk([makeSession('a'), makeSession('b'), makeSession('c')]);

    await callHandler('session:delete', 'b');

    const stored = getSessionsOnDisk() as any[];
    expect(stored.map((s: any) => s.sessionId)).toEqual(['a', 'c']);
  });
});

// ---------------------------------------------------------------------------
// SESSION_GET
// ---------------------------------------------------------------------------

describe('SESSION_GET handler', () => {
  beforeEach(() => {
    fsMock._reset();
    for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key];
    registerSessionHandlers();
  });

  it('returns the session when it exists', async () => {
    setSessionsOnDisk([makeSession('find-me'), makeSession('other')]);

    const result = await callHandler('session:get', 'find-me');
    expect(result).not.toBeNull();
    expect(result.sessionId).toBe('find-me');
  });

  it('returns null when session is not found', async () => {
    setSessionsOnDisk([makeSession('exists')]);

    const result = await callHandler('session:get', 'does-not-exist');
    expect(result).toBeNull();
  });

  it('returns null when sessions file does not exist', async () => {
    const result = await callHandler('session:get', 'any-id');
    expect(result).toBeNull();
  });

  it('returns correct session when multiple sessions share similar IDs', async () => {
    setSessionsOnDisk([makeSession('session-1'), makeSession('session-10'), makeSession('session-100')]);

    const result = await callHandler('session:get', 'session-10');
    expect(result.sessionId).toBe('session-10');
  });
});

// ---------------------------------------------------------------------------
// deleteSessionFromDisk() — exported utility
// ---------------------------------------------------------------------------

describe('deleteSessionFromDisk()', () => {
  beforeEach(() => {
    fsMock._reset();
  });

  it('removes the target session and persists the rest', () => {
    setSessionsOnDisk([makeSession('a'), makeSession('b')]);

    deleteSessionFromDisk('a');

    const stored = getSessionsOnDisk() as any[];
    expect(stored).toHaveLength(1);
    expect(stored[0].sessionId).toBe('b');
  });

  it('does nothing when the session does not exist on disk', () => {
    setSessionsOnDisk([makeSession('s1')]);

    expect(() => deleteSessionFromDisk('ghost')).not.toThrow();

    const stored = getSessionsOnDisk() as any[];
    // writeFileSync should NOT have been called — no change needed
    // The session count stays the same
    expect(stored).toHaveLength(1);
  });

  it('does not throw when sessions file is missing', () => {
    expect(() => deleteSessionFromDisk('any')).not.toThrow();
  });

  it('does not throw when sessions file contains corrupt JSON', () => {
    fsMock._setFile(SESSIONS_PATH, '<<broken>>');
    expect(() => deleteSessionFromDisk('any')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getSessionFromDisk() — exported utility
// ---------------------------------------------------------------------------

describe('getSessionFromDisk()', () => {
  beforeEach(() => {
    fsMock._reset();
  });

  it('returns the session matching the given ID', () => {
    setSessionsOnDisk([makeSession('x'), makeSession('y')]);

    const session = getSessionFromDisk('x');
    expect(session).toBeDefined();
    expect(session!.sessionId).toBe('x');
  });

  it('returns undefined for an unknown ID', () => {
    setSessionsOnDisk([makeSession('x')]);

    const session = getSessionFromDisk('z');
    expect(session).toBeUndefined();
  });

  it('returns undefined when no file exists', () => {
    const session = getSessionFromDisk('anything');
    expect(session).toBeUndefined();
  });
});
