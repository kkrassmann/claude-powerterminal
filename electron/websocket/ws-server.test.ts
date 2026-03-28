/**
 * Tests for ws-server.ts
 *
 * Strategy:
 * - Mock `../ipc/pty-handlers` so we control the PTY process Map.
 * - Mock `../status/status-detector` to avoid real heuristic logic.
 * - Use a real WebSocket server on a random port + real `ws` client to exercise
 *   the full network path (connection, message routing, close codes, etc.).
 * - Use vitest fake timers for the heartbeat interval.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { ScrollbackBuffer } from '../../src/shared/scrollback-buffer';
import { WS_CLOSE_CODES } from '../../src/shared/ws-protocol';

// ---------------------------------------------------------------------------
// PTY process factory — minimal fake that tracks calls
// ---------------------------------------------------------------------------

function makeFakePty() {
  const dataListeners: Array<(data: string) => void> = [];
  const exitListeners: Array<(ev: { exitCode: number }) => void> = [];

  return {
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn((cb: (data: string) => void) => {
      dataListeners.push(cb);
      return { dispose: vi.fn(() => { const i = dataListeners.indexOf(cb); if (i !== -1) dataListeners.splice(i, 1); }) };
    }),
    onExit: vi.fn((cb: (ev: { exitCode: number }) => void) => {
      exitListeners.push(cb);
      return { dispose: vi.fn(() => { const i = exitListeners.indexOf(cb); if (i !== -1) exitListeners.splice(i, 1); }) };
    }),
    // Test helpers
    _emitData: (data: string) => dataListeners.forEach((cb) => cb(data)),
    _emitExit: (exitCode: number) => exitListeners.forEach((cb) => cb({ exitCode })),
  };
}

// ---------------------------------------------------------------------------
// Shared mutable PTY registry — controlled per test
// ---------------------------------------------------------------------------

const ptyRegistry = new Map<string, ReturnType<typeof makeFakePty>>();

vi.mock('../ipc/pty-handlers', () => ({
  getPtyProcesses: vi.fn(() => ptyRegistry as any),
}));

// StatusDetector mock
vi.mock('../status/status-detector', () => ({
  StatusDetector: vi.fn().mockImplementation(() => ({
    getStatus: vi.fn(() => 'WAITING'),
    notifyInput: vi.fn(),
    onStatusChange: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import {
  startWebSocketServer,
  stopWebSocketServer,
  getScrollbackBuffers,
  getStatusDetectors,
  broadcastStatus,
} from './ws-server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a free port by letting the OS assign one to a temporary server */
async function getFreePort(): Promise<number> {
  const { createServer } = await import('net');
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      server.close(() => resolve(addr.port));
    });
    server.on('error', reject);
  });
}

/**
 * Open a WS connection and return it with a pre-attached message collector.
 * The collector starts buffering messages from the moment the WS is created,
 * so no messages are lost to race conditions between open + listener setup.
 */
async function openClientWithCollector(url: string) {
  const ws = new WebSocket(url);
  const collector = createMessageCollector(ws); // attach BEFORE open event fires

  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  return { ws, collector };
}

/** Open a WS connection and wait until it is fully open (no collector) */
function openClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/**
 * Create a message collector that buffers ALL incoming messages.
 * Call this BEFORE openClient so no messages are missed due to race conditions.
 * Then call `collector.take(n)` to get the next N messages.
 */
function createMessageCollector(ws: WebSocket) {
  const buffer: object[] = [];
  const waiters: Array<{ count: number; resolve: (msgs: object[]) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];

  ws.on('message', (raw) => {
    buffer.push(JSON.parse(raw.toString()));
    // Check if any waiter can be satisfied
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (buffer.length >= waiters[i].count) {
        const waiter = waiters.splice(i, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(buffer.splice(0, waiter.count));
      }
    }
  });

  return {
    take(count: number, timeoutMs = 2000): Promise<object[]> {
      if (buffer.length >= count) {
        return Promise.resolve(buffer.splice(0, count));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timeout waiting for ${count} messages (got ${buffer.length})`)),
          timeoutMs
        );
        waiters.push({ count, resolve, reject, timer });
      });
    },
  };
}

/** Collect next N messages from a client (legacy helper — attaches listener immediately) */
function collectMessages(ws: WebSocket, count: number, timeoutMs = 2000): Promise<object[]> {
  const collector = createMessageCollector(ws);
  return collector.take(count, timeoutMs);
}

/** Wait for a WebSocket to close and return its close code */
function waitForClose(ws: WebSocket, timeoutMs = 2000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for close')), timeoutMs);
    ws.once('close', (code) => { clearTimeout(timer); resolve(code); });
    ws.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Send a JSON message and wait for it to be flushed */
function sendMessage(ws: WebSocket, msg: object): Promise<void> {
  return new Promise((resolve, reject) => ws.send(JSON.stringify(msg), (err) => err ? reject(err) : resolve()));
}

// ---------------------------------------------------------------------------
// Per-suite server lifecycle helpers
// ---------------------------------------------------------------------------

let testPort: number;

/** Fake StatusDetector — always returns WAITING */
function makeFakeDetector() {
  return {
    getStatus: vi.fn(() => 'WAITING' as const),
    notifyInput: vi.fn(),
    onStatusChange: vi.fn(),
  };
}

/**
 * Register a session in both the PTY registry and the status-detector map.
 * This ensures the server sends an initial `status` message on connect.
 */
function registerSession(id: string, pty?: ReturnType<typeof makeFakePty>) {
  const fakePty = pty ?? makeFakePty();
  ptyRegistry.set(id, fakePty as any);
  getStatusDetectors().set(id, makeFakeDetector() as any);
  return fakePty;
}

async function startTestServer() {
  testPort = await getFreePort();
  // Reset module-level maps between tests
  getScrollbackBuffers().clear();
  getStatusDetectors().clear();
  ptyRegistry.clear();
  const server = startWebSocketServer(testPort);
  // Wait for the server to be fully listening before returning
  await new Promise<void>((resolve, reject) => {
    server.on('listening', resolve);
    server.on('error', reject);
    // If already listening (shouldn't happen but guard), resolve immediately
    if (server.address()) resolve();
  });
  return server;
}

function stopTestServer(): Promise<void> {
  stopWebSocketServer();
  // Give the server a tick to fully close
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * Open a connection and wait for the initial status message.
 * Uses a pre-attached collector to avoid race conditions.
 * Returns `{ ws, collector }` — use collector.take(n) for subsequent messages.
 */
async function openClientAndWaitForStatus(sessionId: string) {
  const { ws, collector } = await openClientWithCollector(
    `ws://127.0.0.1:${testPort}/terminal/${sessionId}`
  );
  await collector.take(2); // consume initial 'pty-size' + 'status'
  return { ws, collector };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startWebSocketServer() / stopWebSocketServer()', () => {
  afterEach(async () => {
    await stopTestServer();
  });

  it('starts a server that accepts connections', async () => {
    await startTestServer();
    registerSession('s1');

    const ws = await openClient(`ws://127.0.0.1:${testPort}/terminal/s1`);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('returns a WebSocketServer instance', async () => {
    const server = await startTestServer();
    expect(server).toBeDefined();
    expect(typeof server.close).toBe('function');
  });

  it('stopWebSocketServer() closes cleanly without throwing', async () => {
    await startTestServer();
    expect(() => stopWebSocketServer()).not.toThrow();
  });

  it('stopWebSocketServer() is idempotent (safe to call when not running)', () => {
    // Server not started — should not throw
    expect(() => stopWebSocketServer()).not.toThrow();
    expect(() => stopWebSocketServer()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Connection validation
// ---------------------------------------------------------------------------

describe('Connection validation', () => {
  beforeEach(async () => {
    await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer();
  });

  it('closes with code 4000 when sessionId is missing from URL', async () => {
    // Connect to root path — no sessionId segment
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/`);
    const code = await waitForClose(ws);
    expect(code).toBe(WS_CLOSE_CODES.MISSING_SESSION_ID);
  });

  it('closes with code 4000 when URL is just /terminal (no sessionId)', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/terminal`);
    const code = await waitForClose(ws);
    expect(code).toBe(WS_CLOSE_CODES.MISSING_SESSION_ID);
  });

  it('closes with code 4004 when sessionId is not in PTY registry', async () => {
    // No entry in ptyRegistry for 'unknown-session'
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/terminal/unknown-session`);
    const code = await waitForClose(ws);
    expect(code).toBe(WS_CLOSE_CODES.SESSION_NOT_FOUND);
  });

  it('accepts connection when sessionId exists in PTY registry', async () => {
    registerSession('valid');
    const ws = await openClient(`ws://127.0.0.1:${testPort}/terminal/valid`);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Scrollback buffer replay on connect
// ---------------------------------------------------------------------------

describe('Scrollback buffer replay', () => {
  beforeEach(async () => {
    await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer();
  });

  it('replays buffered lines on connect', async () => {
    registerSession('buf-session');

    const buf = new ScrollbackBuffer();
    buf.append('line1\n');
    buf.append('line2\n');
    getScrollbackBuffers().set('buf-session', buf);

    // Use collector created BEFORE open, to capture all messages including rapid ones
    const { ws, collector } = await openClientWithCollector(
      `ws://127.0.0.1:${testPort}/terminal/buf-session`
    );
    // buffering(1) + 2 output + buffered(1) + status(1) = 5 msgs
    const msgs = await collector.take(5);

    const types = msgs.map((m: any) => m.type);
    expect(types).toContain('buffering');
    expect(types).toContain('buffered');
    expect(types.filter((t) => t === 'output')).toHaveLength(2);
    ws.close();
  });

  it('does not send buffering messages when buffer is empty', async () => {
    registerSession('no-buf');

    const { ws, collector } = await openClientWithCollector(
      `ws://127.0.0.1:${testPort}/terminal/no-buf`
    );
    // Empty buffer — pty-size + status message arrive
    const msgs = await collector.take(2);
    const types = msgs.map((m: any) => m.type);
    expect(types).not.toContain('buffering');
    ws.close();
  });

  it('sends status message after scrollback replay', async () => {
    registerSession('status-test');

    const buf = new ScrollbackBuffer();
    buf.append('data\n');
    getScrollbackBuffers().set('status-test', buf);

    const { ws, collector } = await openClientWithCollector(
      `ws://127.0.0.1:${testPort}/terminal/status-test`
    );
    // pty-size(1) + buffering(1) + 1 output line + buffered(1) + status(1) = 5
    const msgs = await collector.take(5);
    const statusMsg = msgs.find((m: any) => m.type === 'status') as any;
    expect(statusMsg).toBeDefined();
    expect(statusMsg.status).toBe('WAITING');
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// PTY data forwarding
// ---------------------------------------------------------------------------

describe('PTY output forwarding', () => {
  beforeEach(async () => {
    await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer();
  });

  it('forwards PTY output to the connected client', async () => {
    const pty = makeFakePty();
    registerSession('fwd-session', pty);

    const { ws, collector } = await openClientAndWaitForStatus('fwd-session');

    pty._emitData('hello from pty');
    const [msg] = await collector.take(1) as any[];

    expect(msg.type).toBe('output');
    expect(msg.data).toBe('hello from pty');
    ws.close();
  });

  it('sends exit message when PTY exits', async () => {
    const pty = makeFakePty();
    registerSession('exit-session', pty);

    const { ws, collector } = await openClientAndWaitForStatus('exit-session');

    pty._emitExit(0);
    const [msg] = await collector.take(1) as any[];

    expect(msg.type).toBe('exit');
    expect(msg.exitCode).toBe(0);
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

describe('Client message handling', () => {
  beforeEach(async () => {
    await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer();
  });

  it('forwards input message to PTY write()', async () => {
    const pty = makeFakePty();
    registerSession('input-session', pty);

    const { ws } = await openClientAndWaitForStatus('input-session');

    await sendMessage(ws, { type: 'input', data: 'ls -la\n' });
    await new Promise((r) => setTimeout(r, 30));

    expect(pty.write).toHaveBeenCalledWith('ls -la\n');
    ws.close();
  });

  it('forwards resize message to PTY resize()', async () => {
    const pty = makeFakePty();
    registerSession('resize-session', pty);

    const { ws } = await openClientAndWaitForStatus('resize-session');

    await sendMessage(ws, { type: 'resize', cols: 120, rows: 40 });
    await new Promise((r) => setTimeout(r, 30));

    expect(pty.resize).toHaveBeenCalledWith(120, 40);
    ws.close();
  });

  it('handles resize gracefully when PTY resize() throws', async () => {
    const pty = makeFakePty();
    pty.resize.mockImplementationOnce(() => { throw new Error('PTY gone'); });
    registerSession('bad-resize', pty);

    const { ws } = await openClientAndWaitForStatus('bad-resize');

    // Must not crash the server — connection should remain open
    await sendMessage(ws, { type: 'resize', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 30));

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('responds to buffer-replay request with buffer-clear + buffer-replay messages', async () => {
    const pty = makeFakePty();
    registerSession('replay-session', pty);

    const buf = new ScrollbackBuffer();
    buf.append('first\n');
    buf.append('second\n');
    getScrollbackBuffers().set('replay-session', buf);

    const { ws, collector } = await openClientWithCollector(
      `ws://127.0.0.1:${testPort}/terminal/replay-session`
    );
    // Initial: pty-size + buffering + 2 output + buffered + status = 6
    await collector.take(6);

    await sendMessage(ws, { type: 'buffer-replay' });
    const msgs = await collector.take(2) as any[];

    const types = msgs.map((m: any) => m.type);
    expect(types).toContain('buffer-clear');
    expect(types).toContain('buffer-replay');
    ws.close();
  });

  it('ignores unknown message types without crashing', async () => {
    const pty = makeFakePty();
    registerSession('unknown-msg', pty);

    const { ws } = await openClientAndWaitForStatus('unknown-msg');

    await sendMessage(ws, { type: 'unknown-type', payload: 42 });
    await new Promise((r) => setTimeout(r, 30));

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('ignores malformed (non-JSON) client messages without crashing', async () => {
    const pty = makeFakePty();
    registerSession('bad-json', pty);

    const { ws } = await openClientAndWaitForStatus('bad-json');

    ws.send('not json at all %%$$');
    await new Promise((r) => setTimeout(r, 30));

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// getScrollbackBuffers() / getStatusDetectors()
// ---------------------------------------------------------------------------

describe('getScrollbackBuffers()', () => {
  it('returns a Map', () => {
    const buffers = getScrollbackBuffers();
    expect(buffers).toBeInstanceOf(Map);
  });

  it('reflects entries added directly to the map', () => {
    const buf = new ScrollbackBuffer();
    buf.append('test\n');
    getScrollbackBuffers().set('test-id', buf);

    expect(getScrollbackBuffers().get('test-id')).toBe(buf);
    getScrollbackBuffers().delete('test-id');
  });
});

describe('getStatusDetectors()', () => {
  it('returns a Map', () => {
    expect(getStatusDetectors()).toBeInstanceOf(Map);
  });

  it('reflects entries added directly to the map', () => {
    const detector = { getStatus: () => 'WAITING' as const, notifyInput: () => {} };
    getStatusDetectors().set('det-id', detector as any);

    expect(getStatusDetectors().has('det-id')).toBe(true);
    getStatusDetectors().delete('det-id');
  });
});

// ---------------------------------------------------------------------------
// broadcastStatus()
// ---------------------------------------------------------------------------

describe('broadcastStatus()', () => {
  beforeEach(async () => {
    await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer();
  });

  it('sends status message to a connected client for the matching session', async () => {
    registerSession('broad-session');

    const { ws, collector } = await openClientAndWaitForStatus('broad-session');

    broadcastStatus('broad-session', 'WORKING');
    const [msg] = await collector.take(1) as any[];

    expect(msg.type).toBe('status');
    expect(msg.status).toBe('WORKING');
    ws.close();
  });

  it('does not send to clients connected to a different session', async () => {
    registerSession('s-a');
    registerSession('s-b');

    const { ws: wsA } = await openClientAndWaitForStatus('s-a');
    const { ws: wsB } = await openClientAndWaitForStatus('s-b');

    let receivedOnA = false;
    wsA.on('message', () => { receivedOnA = true; });

    broadcastStatus('s-b', 'DONE');
    await new Promise((r) => setTimeout(r, 60));

    expect(receivedOnA).toBe(false);

    wsA.close();
    wsB.close();
  });

  it('does nothing when server is not running', () => {
    stopWebSocketServer(); // ensure stopped
    expect(() => broadcastStatus('any', 'WORKING')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Multiple concurrent connections
// ---------------------------------------------------------------------------

describe('Multiple concurrent connections', () => {
  beforeEach(async () => {
    await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer();
  });

  it('handles multiple clients connected to the same session', async () => {
    registerSession('multi');

    const { ws: ws1 } = await openClientAndWaitForStatus('multi');
    const { ws: ws2 } = await openClientAndWaitForStatus('multi');

    expect(ws1.readyState).toBe(WebSocket.OPEN);
    expect(ws2.readyState).toBe(WebSocket.OPEN);

    ws1.close();
    ws2.close();
  });

  it('handles multiple clients connected to different sessions', async () => {
    registerSession('sess-x');
    registerSession('sess-y');

    const { ws: wsX } = await openClientAndWaitForStatus('sess-x');
    const { ws: wsY } = await openClientAndWaitForStatus('sess-y');

    expect(wsX.readyState).toBe(WebSocket.OPEN);
    expect(wsY.readyState).toBe(WebSocket.OPEN);

    wsX.close();
    wsY.close();
  });

  it('cleans up data listener when client disconnects', async () => {
    const pty = makeFakePty();
    registerSession('cleanup-session', pty);

    const { ws } = await openClientAndWaitForStatus('cleanup-session');

    expect(pty.onData).toHaveBeenCalledOnce();
    const disposeCallCount = () =>
      (pty.onData.mock.results[0]?.value?.dispose as ReturnType<typeof vi.fn>).mock.calls.length;

    ws.close();
    await new Promise((r) => setTimeout(r, 80));

    // dispose() should have been called once on close
    expect(disposeCallCount()).toBe(1);
  });

  it('broadcasts to all clients on a session when PTY emits data', async () => {
    const pty = makeFakePty();
    registerSession('all-clients', pty);

    const { ws: ws1, collector: c1 } = await openClientAndWaitForStatus('all-clients');
    const { ws: ws2, collector: c2 } = await openClientAndWaitForStatus('all-clients');

    pty._emitData('broadcast!');

    const [m1] = await c1.take(1) as any[];
    const [m2] = await c2.take(1) as any[];

    expect(m1.data).toBe('broadcast!');
    expect(m2.data).toBe('broadcast!');

    ws1.close();
    ws2.close();
  });
});

// ---------------------------------------------------------------------------
// Resize ownership
// ---------------------------------------------------------------------------

describe('Resize ownership', () => {
  beforeEach(async () => {
    await startTestServer();
  });

  afterEach(async () => {
    await stopTestServer();
  });

  it('first client becomes resize owner — PTY.resize() is called with its dimensions', async () => {
    const pty = makeFakePty();
    registerSession('owner-session', pty);

    const { ws } = await openClientAndWaitForStatus('owner-session');

    await sendMessage(ws, { type: 'resize', cols: 120, rows: 40 });
    await new Promise((r) => setTimeout(r, 30));

    expect(pty.resize).toHaveBeenCalledWith(120, 40);
    ws.close();
  });

  it('second client resize is ignored — PTY.resize() is only called once (for the first client)', async () => {
    const pty = makeFakePty();
    registerSession('two-clients-session', pty);

    const { ws: ws1 } = await openClientAndWaitForStatus('two-clients-session');
    const { ws: ws2 } = await openClientAndWaitForStatus('two-clients-session');

    // First client claims ownership
    await sendMessage(ws1, { type: 'resize', cols: 100, rows: 30 });
    await new Promise((r) => setTimeout(r, 30));

    // Second client sends resize — should be ignored
    await sendMessage(ws2, { type: 'resize', cols: 200, rows: 50 });
    await new Promise((r) => setTimeout(r, 30));

    expect(pty.resize).toHaveBeenCalledTimes(1);
    expect(pty.resize).toHaveBeenCalledWith(100, 30);

    ws1.close();
    ws2.close();
  });

  it('resize ownership transfers when owner disconnects — second client can then resize', async () => {
    const pty = makeFakePty();
    registerSession('transfer-session', pty);

    const { ws: ws1 } = await openClientAndWaitForStatus('transfer-session');
    const { ws: ws2 } = await openClientAndWaitForStatus('transfer-session');

    // First client becomes owner
    await sendMessage(ws1, { type: 'resize', cols: 80, rows: 24 });
    await new Promise((r) => setTimeout(r, 30));
    expect(pty.resize).toHaveBeenCalledTimes(1);

    // Owner disconnects
    ws1.close();
    await new Promise((r) => setTimeout(r, 80));

    // Second client sends resize — ownership should have transferred
    await sendMessage(ws2, { type: 'resize', cols: 160, rows: 48 });
    await new Promise((r) => setTimeout(r, 30));

    expect(pty.resize).toHaveBeenCalledTimes(2);
    expect(pty.resize).toHaveBeenLastCalledWith(160, 48);

    ws2.close();
  });

  it('sends pty-size message immediately on connect', async () => {
    registerSession('pty-size-session');

    const { ws, collector } = await openClientWithCollector(
      `ws://127.0.0.1:${testPort}/terminal/pty-size-session`
    );

    // First message must be pty-size, second is status
    const [first] = await collector.take(1) as any[];

    expect(first.type).toBe('pty-size');
    expect(typeof first.cols).toBe('number');
    expect(typeof first.rows).toBe('number');

    ws.close();
  });

  it('multiple sessions have independent resize owners', async () => {
    const ptyA = makeFakePty();
    const ptyB = makeFakePty();
    registerSession('resize-session-a', ptyA);
    registerSession('resize-session-b', ptyB);

    const { ws: wsA } = await openClientAndWaitForStatus('resize-session-a');
    const { ws: wsB } = await openClientAndWaitForStatus('resize-session-b');

    // Each client resizes its own session
    await sendMessage(wsA, { type: 'resize', cols: 90, rows: 25 });
    await sendMessage(wsB, { type: 'resize', cols: 110, rows: 35 });
    await new Promise((r) => setTimeout(r, 30));

    // Both PTYs must have been resized independently
    expect(ptyA.resize).toHaveBeenCalledWith(90, 25);
    expect(ptyB.resize).toHaveBeenCalledWith(110, 35);

    wsA.close();
    wsB.close();
  });
});
