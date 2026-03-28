import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted() so mockExecAsync is available inside the vi.mock factory
const { mockExecAsync } = vi.hoisted(() => {
  return { mockExecAsync: vi.fn() };
});

vi.mock('child_process', () => ({ exec: vi.fn() }));

// promisify is called once at module init to produce execAsync.
// Return our hoisted mock so process-cleanup.ts uses it.
vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecAsync),
}));

import { killPtyProcess } from './process-cleanup';

/** Build a minimal fake IPty object */
function makeFakePty(pid = 1234) {
  const exitCallbacks: Array<(...args: any[]) => void> = [];
  const pty = {
    pid,
    kill: vi.fn(),
    onExit: vi.fn((cb: (...args: any[]) => void) => {
      exitCallbacks.push(cb);
      return { dispose: vi.fn() };
    }),
    _triggerExit: () => exitCallbacks.forEach((cb) => cb({ exitCode: 0, signal: 0 })),
  };
  return pty;
}

describe('killPtyProcess', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, 'platform', { value: platform, writable: true });
  }

  it('calls kill() on the pty process', async () => {
    setPlatform('linux');
    const pty = makeFakePty(100);
    const promise = killPtyProcess(pty as any, 1000);
    pty._triggerExit();
    await vi.runAllTimersAsync();
    await promise;
    expect(pty.kill).toHaveBeenCalledOnce();
  });

  it('resolves after graceful exit within timeout (non-Windows)', async () => {
    setPlatform('linux');
    const pty = makeFakePty(200);
    const promise = killPtyProcess(pty as any, 5000);
    pty._triggerExit();
    await vi.runAllTimersAsync();
    await promise;
    // On non-Windows, execAsync should NOT be called
    expect(mockExecAsync).not.toHaveBeenCalled();
  });

  it('force-kills via taskkill on Windows after timeout', async () => {
    setPlatform('win32');
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    const pty = makeFakePty(300);
    // Do NOT trigger exit — let timeout fire
    const promise = killPtyProcess(pty as any, 500);
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(mockExecAsync).toHaveBeenCalledWith('taskkill /PID 300 /T /F');
  });

  it('force-kills via taskkill on Windows even after graceful exit (always runs on win32)', async () => {
    setPlatform('win32');
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    const pty = makeFakePty(400);
    const promise = killPtyProcess(pty as any, 2000);
    pty._triggerExit();
    await vi.runAllTimersAsync();
    await promise;
    // taskkill is still called on Windows (design: always run to clean up conhost.exe)
    expect(mockExecAsync).toHaveBeenCalledWith('taskkill /PID 400 /T /F');
  });

  it('handles "not found" taskkill error gracefully (process already exited)', async () => {
    setPlatform('win32');
    const err = new Error('ERROR: The process "500" not found.');
    mockExecAsync.mockRejectedValue(err);
    const pty = makeFakePty(500);
    const promise = killPtyProcess(pty as any, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBeUndefined();
  });

  it('handles "no tasks" taskkill error gracefully', async () => {
    setPlatform('win32');
    const err = new Error('ERROR: no tasks running with matching criteria');
    mockExecAsync.mockRejectedValue(err);
    const pty = makeFakePty(600);
    const promise = killPtyProcess(pty as any, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBeUndefined();
  });

  it('handles unexpected taskkill error without rethrowing', async () => {
    setPlatform('win32');
    const err = new Error('Access denied');
    mockExecAsync.mockRejectedValue(err);
    const pty = makeFakePty(700);
    const promise = killPtyProcess(pty as any, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBeUndefined();
  });

  it('uses default timeout of 3000ms when not specified', async () => {
    setPlatform('linux');
    const pty = makeFakePty(800);
    const promise = killPtyProcess(pty as any); // no timeoutMs arg
    await vi.advanceTimersByTimeAsync(3000);
    await promise;
    expect(pty.kill).toHaveBeenCalledOnce();
  });

  it('registers onExit listener to detect graceful termination', async () => {
    setPlatform('linux');
    const pty = makeFakePty(900);
    const promise = killPtyProcess(pty as any, 1000);
    pty._triggerExit();
    await vi.runAllTimersAsync();
    await promise;
    expect(pty.onExit).toHaveBeenCalledOnce();
  });

  it('does not call taskkill on non-Windows platforms', async () => {
    for (const platform of ['linux', 'darwin']) {
      vi.clearAllMocks();
      setPlatform(platform);
      const pty = makeFakePty(1000);
      const promise = killPtyProcess(pty as any, 100);
      await vi.advanceTimersByTimeAsync(100);
      await promise;
      expect(mockExecAsync).not.toHaveBeenCalled();
    }
  });

  it('taskkill is called only after timeout fires on Windows', async () => {
    setPlatform('win32');
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
    const pty = makeFakePty(1100);
    const promise = killPtyProcess(pty as any, 200);
    // Advance only partway — not yet timed out
    await vi.advanceTimersByTimeAsync(100);
    expect(mockExecAsync).not.toHaveBeenCalled();
    // Advance past timeout
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    expect(mockExecAsync).toHaveBeenCalledWith('taskkill /PID 1100 /T /F');
  });
});
