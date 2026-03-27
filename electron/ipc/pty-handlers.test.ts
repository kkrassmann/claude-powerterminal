/**
 * Tests for PTY IPC handlers.
 *
 * Strategy: mock all external dependencies (electron, node-pty, ws-server, etc.)
 * then capture ipcMain.handle callbacks and invoke them directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// 1. Hoisted mock state — vi.hoisted() runs BEFORE vi.mock() factories,
//    so references defined here are available inside factory closures.
// ---------------------------------------------------------------------------

const {
  mockIpcHandlers,
  mockScrollbackBuffers,
  mockStatusDetectors,
  mockBroadcastStatus,
  mockSpawn,
  mockKillPtyProcess,
  mockAppendSessionLog,
  mockLoadSessionLog,
  mockDeleteSessionLog,
  mockSanitizeEnv,
  mockDeleteSessionFromDisk,
  mockGetSessionFromDisk,
  mockDetectorProcessOutput,
  mockDetectorProcessExit,
  mockDetectorDestroy,
  mockDetectorNotifyInput,
} = vi.hoisted(() => ({
  mockIpcHandlers: new Map<string, Function>(),
  mockScrollbackBuffers: new Map<string, any>(),
  mockStatusDetectors: new Map<string, any>(),
  mockBroadcastStatus: vi.fn(),
  mockSpawn: vi.fn(),
  mockKillPtyProcess: vi.fn(),
  mockAppendSessionLog: vi.fn(),
  mockLoadSessionLog: vi.fn(),
  mockDeleteSessionLog: vi.fn(),
  mockSanitizeEnv: vi.fn(),
  mockDeleteSessionFromDisk: vi.fn(),
  mockGetSessionFromDisk: vi.fn(),
  mockDetectorProcessOutput: vi.fn(),
  mockDetectorProcessExit: vi.fn(),
  mockDetectorDestroy: vi.fn(),
  mockDetectorNotifyInput: vi.fn(),
}));

// ---------------------------------------------------------------------------
// 2. Mock declarations — factories can reference hoisted vars directly
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      mockIpcHandlers.set(channel, handler);
    }),
  },
}));

vi.mock('node-pty', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

vi.mock('../websocket/ws-server', () => ({
  getScrollbackBuffers: () => mockScrollbackBuffers,
  getStatusDetectors: () => mockStatusDetectors,
  broadcastStatus: (...args: any[]) => mockBroadcastStatus(...args),
}));

vi.mock('../status/status-detector', () => {
  class StatusDetector {
    processOutput = mockDetectorProcessOutput;
    processExit = mockDetectorProcessExit;
    destroy = mockDetectorDestroy;
    notifyInput = mockDetectorNotifyInput;
    constructor(..._args: any[]) {}
  }
  return { StatusDetector };
});

vi.mock('../utils/process-cleanup', () => ({
  killPtyProcess: (...args: any[]) => mockKillPtyProcess(...args),
}));

vi.mock('../utils/session-log', () => ({
  appendSessionLog: (...args: any[]) => mockAppendSessionLog(...args),
  loadSessionLog: (...args: any[]) => mockLoadSessionLog(...args),
  deleteSessionLog: (...args: any[]) => mockDeleteSessionLog(...args),
}));

vi.mock('../utils/env-sanitize', () => ({
  sanitizeEnvForClaude: () => mockSanitizeEnv(),
}));

vi.mock('./session-handlers', () => ({
  deleteSessionFromDisk: (...args: any[]) => mockDeleteSessionFromDisk(...args),
  getSessionFromDisk: (...args: any[]) => mockGetSessionFromDisk(...args),
}));

// Silence log-service output during tests
vi.mock('../utils/log-service', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// ---------------------------------------------------------------------------
// 2. Import the module under test AFTER all vi.mock() declarations
// ---------------------------------------------------------------------------
import {
  getPtyProcesses,
  registerPtyHandlers,
  setShuttingDown,
  isShuttingDown,
  isSessionRestarting,
  markSessionRestarting,
  clearSessionRestarting,
} from './pty-handlers';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';

// ---------------------------------------------------------------------------
// 3. Helpers
// ---------------------------------------------------------------------------

/**
 * Convenience object mirroring the hoisted detector mock fns.
 * Used by tests that inject a fake detector into mockStatusDetectors.
 */
const mockDetectorObj = {
  get processOutput() { return mockDetectorProcessOutput; },
  get processExit() { return mockDetectorProcessExit; },
  get destroy() { return mockDetectorDestroy; },
  get notifyInput() { return mockDetectorNotifyInput; },
};

/** Creates a minimal fake PTY process object. */
function makeFakePty(pid = 1234) {
  return {
    pid,
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    resize: vi.fn(),
  };
}

/** Creates a minimal fake IPC event object with a live sender. */
function makeFakeEvent(destroyed = false) {
  return {
    sender: {
      isDestroyed: () => destroyed,
      send: vi.fn(),
    },
  };
}

/** Real temp directory that actually exists on disk. */
const realTmpDir = os.tmpdir();

// ---------------------------------------------------------------------------
// 4. Test setup — register handlers once, reset maps/mocks between tests
// ---------------------------------------------------------------------------

// Register handlers once at module level; handlers are stable function refs.
registerPtyHandlers();

beforeEach(() => {
  // Clear the live PTY map so each test starts fresh
  getPtyProcesses().clear();
  mockScrollbackBuffers.clear();
  mockStatusDetectors.clear();

  // Reset call records WITHOUT clearing mock implementations
  // (vi.clearAllMocks would wipe mockImplementation/mockReturnValue)
  mockSpawn.mockReset();
  mockSanitizeEnv.mockReset();
  mockGetSessionFromDisk.mockReset();
  mockLoadSessionLog.mockReset();
  mockDeleteSessionFromDisk.mockReset();
  mockDeleteSessionLog.mockReset();
  mockAppendSessionLog.mockReset();
  mockKillPtyProcess.mockReset();
  mockBroadcastStatus.mockReset();
  mockDetectorProcessOutput.mockReset();
  mockDetectorProcessExit.mockReset();
  mockDetectorDestroy.mockReset();
  mockDetectorNotifyInput.mockReset();

  // Default: spawn returns a fresh fake PTY
  mockSpawn.mockReturnValue(makeFakePty());

  // Default: env returns minimal object
  mockSanitizeEnv.mockReturnValue({ PATH: '/usr/bin' });

  // Default: getSessionFromDisk returns undefined (no existing session on disk)
  mockGetSessionFromDisk.mockReturnValue(undefined);

  // Default: no saved scrollback
  mockLoadSessionLog.mockReturnValue(null);

  // Default: kill resolves immediately
  mockKillPtyProcess.mockResolvedValue(undefined);

  // Default: not shutting down
  setShuttingDown(false);
});

// ---------------------------------------------------------------------------
// 5. getPtyProcesses()
// ---------------------------------------------------------------------------

describe('getPtyProcesses()', () => {
  it('returns the shared PTY map', () => {
    const map = getPtyProcesses();
    expect(map).toBeInstanceOf(Map);
  });

  it('reflects mutations made to the map', () => {
    const fakePty = makeFakePty(999);
    getPtyProcesses().set('test-session', fakePty as any);
    expect(getPtyProcesses().get('test-session')).toBe(fakePty);
    getPtyProcesses().delete('test-session');
    expect(getPtyProcesses().has('test-session')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. setShuttingDown / isShuttingDown
// ---------------------------------------------------------------------------

describe('setShuttingDown / isShuttingDown()', () => {
  it('defaults to false', () => {
    expect(isShuttingDown()).toBe(false);
  });

  it('sets and reads true', () => {
    setShuttingDown(true);
    expect(isShuttingDown()).toBe(true);
  });

  it('can be reset to false', () => {
    setShuttingDown(true);
    setShuttingDown(false);
    expect(isShuttingDown()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. isSessionRestarting / markSessionRestarting / clearSessionRestarting
// ---------------------------------------------------------------------------

describe('restart session flags', () => {
  it('reports false for unknown session', () => {
    expect(isSessionRestarting('unknown')).toBe(false);
  });

  it('markSessionRestarting makes isSessionRestarting return true', () => {
    markSessionRestarting('s1');
    expect(isSessionRestarting('s1')).toBe(true);
  });

  it('clearSessionRestarting removes the flag', () => {
    markSessionRestarting('s2');
    clearSessionRestarting('s2');
    expect(isSessionRestarting('s2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. PTY_SPAWN handler
// ---------------------------------------------------------------------------

describe('PTY_SPAWN handler', () => {
  const spawnHandler = () => mockIpcHandlers.get(IPC_CHANNELS.PTY_SPAWN)!;

  it('spawns a PTY and returns success with pid', async () => {
    const fakePty = makeFakePty(42);
    mockSpawn.mockReturnValue(fakePty);

    const event = makeFakeEvent();
    const result = await spawnHandler()(event, {
      sessionId: 'sess-1',
      cwd: realTmpDir,
      flags: [],
    });

    expect(result).toEqual({ success: true, pid: 42 });
    expect(getPtyProcesses().has('sess-1')).toBe(true);
  });

  it('registers the new session in scrollback buffers', async () => {
    const event = makeFakeEvent();
    await spawnHandler()(event, {
      sessionId: 'sess-sb',
      cwd: realTmpDir,
      flags: [],
    });

    expect(mockScrollbackBuffers.has('sess-sb')).toBe(true);
  });

  it('creates a StatusDetector for the new session', async () => {
    const event = makeFakeEvent();
    await spawnHandler()(event, {
      sessionId: 'sess-sd',
      cwd: realTmpDir,
      flags: [],
    });

    // StatusDetector instance is placed into the status detectors map
    expect(mockStatusDetectors.has('sess-sd')).toBe(true);
  });

  it('returns error when cwd does not exist', async () => {
    const event = makeFakeEvent();
    const result = await spawnHandler()(event, {
      sessionId: 'sess-bad',
      cwd: '/this/path/does/not/exist/ever',
      flags: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Directory does not exist/);
    expect(getPtyProcesses().has('sess-bad')).toBe(false);
  });

  it('returns error when cwd is a file, not a directory', async () => {
    // Create a real temp file to use as an invalid cwd
    const tmpFile = path.join(realTmpDir, `cpt-test-file-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'hello');
    try {
      const event = makeFakeEvent();
      const result = await spawnHandler()(event, {
        sessionId: 'sess-file',
        cwd: tmpFile,
        flags: [],
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Directory does not exist/);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('uses --resume when resume flag is true', async () => {
    const event = makeFakeEvent();
    await spawnHandler()(event, {
      sessionId: 'sess-resume',
      cwd: realTmpDir,
      flags: [],
      resume: true,
    });

    const spawnArgs = mockSpawn.mock.calls[0];
    expect(spawnArgs[1]).toContain('--resume');
    expect(spawnArgs[1]).toContain('sess-resume');
  });

  it('uses --session-id when resume is false and session not on disk', async () => {
    mockGetSessionFromDisk.mockReturnValue(undefined);
    const event = makeFakeEvent();
    await spawnHandler()(event, {
      sessionId: 'sess-new',
      cwd: realTmpDir,
      flags: [],
      resume: false,
    });

    const spawnArgs = mockSpawn.mock.calls[0];
    expect(spawnArgs[1]).toContain('--session-id');
    expect(spawnArgs[1]).toContain('sess-new');
  });

  it('uses --resume when session already exists on disk (even without resume flag)', async () => {
    mockGetSessionFromDisk.mockReturnValue({
      sessionId: 'sess-disk',
      workingDirectory: realTmpDir,
      cliFlags: [],
    });

    const event = makeFakeEvent();
    await spawnHandler()(event, {
      sessionId: 'sess-disk',
      cwd: realTmpDir,
      flags: [],
      resume: false,
    });

    const spawnArgs = mockSpawn.mock.calls[0];
    expect(spawnArgs[1]).toContain('--resume');
  });

  it('loads saved scrollback when resuming', async () => {
    mockGetSessionFromDisk.mockReturnValue({
      sessionId: 'sess-reload',
      workingDirectory: realTmpDir,
      cliFlags: [],
    });
    mockLoadSessionLog.mockReturnValue('previous output');

    const event = makeFakeEvent();
    await spawnHandler()(event, {
      sessionId: 'sess-reload',
      cwd: realTmpDir,
      flags: [],
      resume: true,
    });

    expect(mockLoadSessionLog).toHaveBeenCalledWith('sess-reload');
  });

  it('returns error when pty.spawn throws', async () => {
    mockSpawn.mockImplementation(() => { throw new Error('spawn failed'); });

    const event = makeFakeEvent();
    const result = await spawnHandler()(event, {
      sessionId: 'sess-throw',
      cwd: realTmpDir,
      flags: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('spawn failed');
  });

  it('appends session log in onData callback', async () => {
    const fakePty = makeFakePty(77);
    let capturedOnData: ((data: string) => void) | null = null;
    fakePty.onData.mockImplementation((cb: (data: string) => void) => {
      capturedOnData = cb;
    });
    mockSpawn.mockReturnValue(fakePty);

    const event = makeFakeEvent();
    await spawnHandler()(event, {
      sessionId: 'sess-data',
      cwd: realTmpDir,
      flags: [],
    });

    expect(capturedOnData).not.toBeNull();
    capturedOnData!('hello world');

    expect(mockAppendSessionLog).toHaveBeenCalledWith('sess-data', 'hello world');
  });

  it('sends PTY_DATA to renderer in onData callback when sender is alive', async () => {
    const fakePty = makeFakePty(88);
    let capturedOnData: ((data: string) => void) | null = null;
    fakePty.onData.mockImplementation((cb: (data: string) => void) => {
      capturedOnData = cb;
    });
    mockSpawn.mockReturnValue(fakePty);

    const event = makeFakeEvent(false); // not destroyed
    await spawnHandler()(event, {
      sessionId: 'sess-ipc',
      cwd: realTmpDir,
      flags: [],
    });

    capturedOnData!('output data');
    expect(event.sender.send).toHaveBeenCalledWith(
      IPC_CHANNELS.PTY_DATA,
      { sessionId: 'sess-ipc', data: 'output data' }
    );
  });

  it('does not send PTY_DATA when sender is destroyed', async () => {
    const fakePty = makeFakePty(89);
    let capturedOnData: ((data: string) => void) | null = null;
    fakePty.onData.mockImplementation((cb: (data: string) => void) => {
      capturedOnData = cb;
    });
    mockSpawn.mockReturnValue(fakePty);

    const event = makeFakeEvent(true); // destroyed
    await spawnHandler()(event, {
      sessionId: 'sess-destroyed',
      cwd: realTmpDir,
      flags: [],
    });

    capturedOnData!('output data');
    expect(event.sender.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. onExit cleanup (spawned via PTY_SPAWN)
// ---------------------------------------------------------------------------

describe('onExit cleanup (via PTY_SPAWN)', () => {
  const spawnHandler = () => mockIpcHandlers.get(IPC_CHANNELS.PTY_SPAWN)!;

  async function spawnAndCaptureExit(sessionId: string, opts?: { shutDown?: boolean }) {
    const fakePty = makeFakePty(55);
    let capturedOnExit: ((info: { exitCode: number; signal?: number }) => void) | null = null;
    fakePty.onExit.mockImplementation((cb: any) => { capturedOnExit = cb; });
    mockSpawn.mockReturnValue(fakePty);

    if (opts?.shutDown) setShuttingDown(true);

    const event = makeFakeEvent();
    await spawnHandler()(event, { sessionId, cwd: realTmpDir, flags: [] });

    return { capturedOnExit: capturedOnExit!, event, fakePty };
  }

  it('removes session from ptyProcesses on exit', async () => {
    const { capturedOnExit } = await spawnAndCaptureExit('sess-exit-1');
    expect(getPtyProcesses().has('sess-exit-1')).toBe(true);

    capturedOnExit({ exitCode: 0 });

    expect(getPtyProcesses().has('sess-exit-1')).toBe(false);
  });

  it('removes session from scrollback buffers on exit', async () => {
    const { capturedOnExit } = await spawnAndCaptureExit('sess-exit-2');
    expect(mockScrollbackBuffers.has('sess-exit-2')).toBe(true);

    capturedOnExit({ exitCode: 0 });

    expect(mockScrollbackBuffers.has('sess-exit-2')).toBe(false);
  });

  it('calls deleteSessionFromDisk when not shutting down', async () => {
    const { capturedOnExit } = await spawnAndCaptureExit('sess-exit-3');
    capturedOnExit({ exitCode: 0 });

    expect(mockDeleteSessionFromDisk).toHaveBeenCalledWith('sess-exit-3');
  });

  it('skips deleteSessionFromDisk when shutting down', async () => {
    const { capturedOnExit } = await spawnAndCaptureExit('sess-exit-4', { shutDown: true });
    capturedOnExit({ exitCode: 0 });

    expect(mockDeleteSessionFromDisk).not.toHaveBeenCalled();
  });

  it('calls deleteSessionLog on exit when not shutting down', async () => {
    const { capturedOnExit } = await spawnAndCaptureExit('sess-exit-5');
    capturedOnExit({ exitCode: 0 });

    expect(mockDeleteSessionLog).toHaveBeenCalledWith('sess-exit-5');
  });

  it('skips cleanup entirely when session is in restartingSessions', async () => {
    const { capturedOnExit } = await spawnAndCaptureExit('sess-restart');
    markSessionRestarting('sess-restart');

    capturedOnExit({ exitCode: 0 });

    // Map should NOT be cleaned up because the guard returns early
    expect(mockDeleteSessionFromDisk).not.toHaveBeenCalled();
    // PTY map entry is kept by the restart guard
    clearSessionRestarting('sess-restart');
  });

  it('sends PTY_EXIT to renderer on exit', async () => {
    const { capturedOnExit, event } = await spawnAndCaptureExit('sess-exit-6');
    capturedOnExit({ exitCode: 1, signal: 9 });

    expect(event.sender.send).toHaveBeenCalledWith(
      IPC_CHANNELS.PTY_EXIT,
      { sessionId: 'sess-exit-6', exitCode: 1, signal: 9 }
    );
  });

  it('destroys StatusDetector on exit', async () => {
    const { capturedOnExit } = await spawnAndCaptureExit('sess-exit-det');

    // Manually place a detector reference so the code path is exercised
    mockStatusDetectors.set('sess-exit-det', mockDetectorObj);

    capturedOnExit({ exitCode: 0 });

    expect(mockDetectorObj.destroy).toHaveBeenCalled();
    expect(mockStatusDetectors.has('sess-exit-det')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. PTY_KILL handler
// ---------------------------------------------------------------------------

describe('PTY_KILL handler', () => {
  const killHandler = () => mockIpcHandlers.get(IPC_CHANNELS.PTY_KILL)!;

  it('kills an existing session and returns success', async () => {
    const fakePty = makeFakePty(200);
    getPtyProcesses().set('kill-sess', fakePty as any);

    const result = await killHandler()({}, 'kill-sess');

    expect(result).toEqual({ success: true });
    expect(mockKillPtyProcess).toHaveBeenCalledWith(fakePty, 3000);
    expect(getPtyProcesses().has('kill-sess')).toBe(false);
  });

  it('returns error when session is not found', async () => {
    const result = await killHandler()({}, 'no-such-session');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session not found');
  });

  it('destroys StatusDetector when killing', async () => {
    const fakePty = makeFakePty(201);
    getPtyProcesses().set('kill-det', fakePty as any);
    mockStatusDetectors.set('kill-det', mockDetectorObj);

    await killHandler()({}, 'kill-det');

    expect(mockDetectorObj.destroy).toHaveBeenCalled();
    expect(mockStatusDetectors.has('kill-det')).toBe(false);
  });

  it('returns error when killPtyProcess throws', async () => {
    const fakePty = makeFakePty(202);
    getPtyProcesses().set('kill-throw', fakePty as any);
    mockKillPtyProcess.mockRejectedValueOnce(new Error('kill failed'));

    const result = await killHandler()({}, 'kill-throw');

    expect(result.success).toBe(false);
    expect(result.error).toBe('kill failed');
  });
});

// ---------------------------------------------------------------------------
// 11. PTY_WRITE handler
// ---------------------------------------------------------------------------

describe('PTY_WRITE handler', () => {
  const writeHandler = () => mockIpcHandlers.get(IPC_CHANNELS.PTY_WRITE)!;

  it('writes data to an existing PTY and returns success', async () => {
    const fakePty = makeFakePty(300);
    getPtyProcesses().set('write-sess', fakePty as any);

    const result = await writeHandler()({}, { sessionId: 'write-sess', data: 'hello\n' });

    expect(result).toEqual({ success: true });
    expect(fakePty.write).toHaveBeenCalledWith('hello\n');
  });

  it('returns error when session is not found', async () => {
    const result = await writeHandler()({}, { sessionId: 'no-sess', data: 'x' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session not found');
  });

  it('calls detector.notifyInput when writing to active session', async () => {
    const fakePty = makeFakePty(301);
    getPtyProcesses().set('write-det', fakePty as any);
    mockStatusDetectors.set('write-det', mockDetectorObj);

    await writeHandler()({}, { sessionId: 'write-det', data: 'input' });

    expect(mockDetectorObj.notifyInput).toHaveBeenCalled();
  });

  it('returns error when pty.write throws', async () => {
    const fakePty = makeFakePty(302);
    fakePty.write.mockImplementation(() => { throw new Error('write error'); });
    getPtyProcesses().set('write-err', fakePty as any);

    const result = await writeHandler()({}, { sessionId: 'write-err', data: 'x' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('write error');
  });
});

// ---------------------------------------------------------------------------
// 12. PTY_LIST handler
// ---------------------------------------------------------------------------

describe('PTY_LIST handler', () => {
  const listHandler = () => mockIpcHandlers.get(IPC_CHANNELS.PTY_LIST)!;

  it('returns empty array when no sessions are active', async () => {
    const result = await listHandler()();
    expect(result).toEqual([]);
  });

  it('returns all active session IDs and PIDs', async () => {
    getPtyProcesses().set('list-a', makeFakePty(10) as any);
    getPtyProcesses().set('list-b', makeFakePty(20) as any);

    const result = await listHandler()();

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ sessionId: 'list-a', pid: 10 });
    expect(result).toContainEqual({ sessionId: 'list-b', pid: 20 });
  });
});

// ---------------------------------------------------------------------------
// 13. PTY_RESTART handler
// ---------------------------------------------------------------------------

describe('PTY_RESTART handler', () => {
  const restartHandler = () => mockIpcHandlers.get(IPC_CHANNELS.PTY_RESTART)!;

  function setupRestartSession(sessionId: string, pid = 400) {
    const oldPty = makeFakePty(pid);
    // Simulate graceful exit immediately when /exit is written
    oldPty.onExit.mockImplementation((cb: () => void) => { cb(); });
    getPtyProcesses().set(sessionId, oldPty as any);
    mockGetSessionFromDisk.mockReturnValue({
      sessionId,
      workingDirectory: realTmpDir,
      cliFlags: ['--flag'],
    });
    return oldPty;
  }

  it('returns error when session is not found', async () => {
    const result = await restartHandler()(makeFakeEvent(), 'no-session');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Session not found');
  });

  it('returns error when session metadata not on disk', async () => {
    const fakePty = makeFakePty(401);
    getPtyProcesses().set('no-meta', fakePty as any);
    mockGetSessionFromDisk.mockReturnValue(undefined);

    const result = await restartHandler()(makeFakeEvent(), 'no-meta');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Session metadata not found');
  });

  it('spawns a new PTY with --resume on restart', async () => {
    setupRestartSession('restart-sess', 500);
    const newPty = makeFakePty(501);
    mockSpawn.mockReturnValue(newPty);

    const event = makeFakeEvent();
    const result = await restartHandler()(event, 'restart-sess');

    expect(result.success).toBe(true);
    expect(result.pid).toBe(501);

    // The new spawn call must use --resume
    const spawnCall = mockSpawn.mock.calls[0];
    expect(spawnCall[1]).toContain('--resume');
    expect(spawnCall[1]).toContain('restart-sess');
  });

  it('replaces the old PTY in the map with the new one', async () => {
    setupRestartSession('restart-map', 600);
    const newPty = makeFakePty(601);
    mockSpawn.mockReturnValue(newPty);

    await restartHandler()(makeFakeEvent(), 'restart-map');

    expect(getPtyProcesses().get('restart-map')).toBe(newPty);
  });

  it('creates a new StatusDetector after restart', async () => {
    setupRestartSession('restart-det', 700);
    mockSpawn.mockReturnValue(makeFakePty(701));

    await restartHandler()(makeFakeEvent(), 'restart-det');

    // New detector instance is placed in the map
    expect(mockStatusDetectors.has('restart-det')).toBe(true);
  });

  it('loads saved scrollback after restart', async () => {
    setupRestartSession('restart-log', 800);
    mockLoadSessionLog.mockReturnValue('saved output');
    mockSpawn.mockReturnValue(makeFakePty(801));

    await restartHandler()(makeFakeEvent(), 'restart-log');

    expect(mockLoadSessionLog).toHaveBeenCalledWith('restart-log');
  });
});

// ---------------------------------------------------------------------------
// 14. registerPtyHandlers — channel registration
// ---------------------------------------------------------------------------

describe('registerPtyHandlers()', () => {
  it('registers PTY_SPAWN handler', () => {
    expect(mockIpcHandlers.has(IPC_CHANNELS.PTY_SPAWN)).toBe(true);
  });

  it('registers PTY_KILL handler', () => {
    expect(mockIpcHandlers.has(IPC_CHANNELS.PTY_KILL)).toBe(true);
  });

  it('registers PTY_WRITE handler', () => {
    expect(mockIpcHandlers.has(IPC_CHANNELS.PTY_WRITE)).toBe(true);
  });

  it('registers PTY_LIST handler', () => {
    expect(mockIpcHandlers.has(IPC_CHANNELS.PTY_LIST)).toBe(true);
  });

  it('registers PTY_RESTART handler', () => {
    expect(mockIpcHandlers.has(IPC_CHANNELS.PTY_RESTART)).toBe(true);
  });
});
