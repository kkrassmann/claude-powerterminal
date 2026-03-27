/**
 * Integration tests for the HTTP static server API routes.
 *
 * Strategy: mock all heavy external dependencies (electron, node-pty, internal modules)
 * then start a real HTTP server and make actual HTTP requests against it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// 1. Mock all external dependencies BEFORE importing static-server
// ---------------------------------------------------------------------------

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpt-test-userdata-'));
let tmpBuildDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => tmpUserData,
    isPackaged: false,
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

// Controllable Map for PTY processes
const mockPtyProcesses = new Map<string, any>();
vi.mock('../ipc/pty-handlers', () => ({
  getPtyProcesses: () => mockPtyProcesses,
}));

vi.mock('../ipc/session-handlers', () => ({
  deleteSessionFromDisk: vi.fn(),
}));

const mockLoadGroups = vi.fn().mockReturnValue([]);
const mockSaveGroups = vi.fn();
vi.mock('../ipc/group-handlers', () => ({
  loadGroupsFromFile: (...args: any[]) => mockLoadGroups(...args),
  saveGroupsToFile: (...args: any[]) => mockSaveGroups(...args),
}));

const mockLoadTemplates = vi.fn().mockReturnValue([]);
const mockSaveTemplates = vi.fn();
vi.mock('../ipc/template-handlers', () => ({
  loadTemplatesFromDisk: (...args: any[]) => mockLoadTemplates(...args),
  saveTemplatesToDisk: (...args: any[]) => mockSaveTemplates(...args),
}));

const mockScrollbackBuffers = new Map<string, any>();
const mockStatusDetectors = new Map<string, any>();
vi.mock('../websocket/ws-server', () => ({
  getScrollbackBuffers: () => mockScrollbackBuffers,
  getStatusDetectors: () => mockStatusDetectors,
  broadcastStatus: vi.fn(),
}));

vi.mock('../utils/window-ref', () => ({
  getMainWindow: () => null,
}));

vi.mock('../utils/env-sanitize', () => ({
  sanitizeEnvForClaude: () => ({ ...process.env }),
}));

vi.mock('../utils/git-status-parser', () => ({
  parseGitStatus: (output: string) => {
    const lines = output.trim().split('\n').filter(Boolean);
    let added = 0, modified = 0, deleted = 0;
    for (const line of lines) {
      const code = line.substring(0, 2);
      if (code.includes('A') || code.includes('?')) added++;
      if (code.includes('M')) modified++;
      if (code.includes('D')) deleted++;
    }
    return { added, modified, deleted };
  },
}));

vi.mock('../analysis/log-analyzer', () => ({
  analyzeAllSessions: vi.fn().mockResolvedValue({ sessions: [], summary: {} }),
  computeSessionScore: vi.fn().mockResolvedValue({ score: 75, details: {} }),
}));

vi.mock('../analysis/audit-engine', () => ({
  discoverClaudeProjects: vi.fn().mockReturnValue([]),
  runProjectAudit: vi.fn().mockReturnValue({ findings: [] }),
}));

vi.mock('../analysis/deep-audit-engine', () => ({
  runDeepAudit: vi.fn().mockResolvedValue({ result: 'ok' }),
  cancelDeepAudit: vi.fn().mockReturnValue(true),
}));

vi.mock('../analysis/score-history', () => ({
  getTrends: vi.fn().mockReturnValue([]),
}));

vi.mock('../utils/log-service', () => ({
  exportAsJsonl: vi.fn().mockReturnValue(''),
}));

vi.mock('../utils/session-log', () => ({
  appendSessionLog: vi.fn(),
  loadSessionLog: vi.fn().mockReturnValue(null),
  deleteSessionLog: vi.fn(),
}));

vi.mock('../status/status-detector', () => {
  class MockStatusDetector {
    processOutput = vi.fn();
    processExit = vi.fn();
    destroy = vi.fn();
    constructor(_sessionId: string, _callback: any) {}
  }
  return { StatusDetector: MockStatusDetector };
});

vi.mock('../../src/shared/scrollback-buffer', () => {
  class MockScrollbackBuffer {
    append = vi.fn();
    getLines = vi.fn().mockReturnValue([]);
    getAll = vi.fn().mockReturnValue('');
    constructor(_maxLines?: number) {}
  }
  return { ScrollbackBuffer: MockScrollbackBuffer };
});

// Mock getAngularBuildDir to return our temp directory with an index.html
vi.mock('../utils/paths', () => ({
  getAngularBuildDir: () => tmpBuildDir,
}));

// ---------------------------------------------------------------------------
// 2. Import the module under test AFTER all mocks are set up
// ---------------------------------------------------------------------------
import { startStaticServer } from './static-server';

// ---------------------------------------------------------------------------
// 3. HTTP request helper
// ---------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
  rawBody: string;
}

function request(
  server: http.Server,
  method: string,
  urlPath: string,
  body?: any
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      return reject(new Error('Server not listening'));
    }

    const payload = body !== undefined ? JSON.stringify(body) : undefined;

    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed: any;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: parsed,
          rawBody: data,
        });
      });
    });

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// 4. Test suite
// ---------------------------------------------------------------------------

let server: http.Server;

beforeAll(async () => {
  // Create a temp build directory with an index.html
  tmpBuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpt-test-builddir-'));
  fs.writeFileSync(path.join(tmpBuildDir, 'index.html'), '<html><body>Test App</body></html>');
  fs.writeFileSync(path.join(tmpBuildDir, 'main.js'), 'console.log("app");');
  fs.writeFileSync(path.join(tmpBuildDir, 'styles.css'), 'body { color: red; }');

  // Start the server on a random port (port 0 lets the OS assign one)
  server = startStaticServer(0);

  // Wait for server to start listening
  await new Promise<void>((resolve) => {
    // The server might already be listening from startStaticServer, but it binds on 0.0.0.0
    // We need to wait for it to be ready
    if (server.listening) {
      resolve();
    } else {
      server.on('listening', () => resolve());
    }
  });
});

afterAll(async () => {
  // Close the server
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Clean up temp directories
  fs.rmSync(tmpBuildDir, { recursive: true, force: true });
  fs.rmSync(tmpUserData, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset state between tests
  mockPtyProcesses.clear();
  mockScrollbackBuffers.clear();
  mockStatusDetectors.clear();
  mockLoadGroups.mockReturnValue([]);
  mockSaveGroups.mockReset();
  mockLoadTemplates.mockReturnValue([]);
  mockSaveTemplates.mockReset();

  // Reset sessions.json
  const sessionsPath = path.join(tmpUserData, 'sessions.json');
  if (fs.existsSync(sessionsPath)) {
    fs.unlinkSync(sessionsPath);
  }
});

// =========================================================================
// CORS Preflight
// =========================================================================

describe('CORS preflight', () => {
  it('OPTIONS /api/sessions returns 204 with CORS headers', async () => {
    const res = await request(server, 'OPTIONS', '/api/sessions');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-methods']).toContain('GET');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
    expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
  });

  it('OPTIONS /api/groups returns 204 with CORS headers', async () => {
    const res = await request(server, 'OPTIONS', '/api/groups');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('OPTIONS /api/templates returns 204 with CORS headers', async () => {
    const res = await request(server, 'OPTIONS', '/api/templates');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('OPTIONS on non-API path does NOT trigger CORS preflight', async () => {
    const res = await request(server, 'OPTIONS', '/some-page');
    // Non-API paths fall through to static file serving
    expect(res.status).not.toBe(204);
  });
});

// =========================================================================
// GET /api/sessions
// =========================================================================

describe('GET /api/sessions', () => {
  it('returns empty array when no active PTYs exist', async () => {
    const res = await request(server, 'GET', '/api/sessions');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.body).toEqual([]);
  });

  it('returns active sessions cross-referenced with saved data', async () => {
    // Set up saved sessions on disk
    const sessions = [
      { sessionId: 'sess-1', workingDirectory: '/tmp/project-a', cliFlags: [], createdAt: '2026-01-01T00:00:00Z' },
      { sessionId: 'sess-2', workingDirectory: '/tmp/project-b', cliFlags: [], createdAt: '2026-01-01T00:00:00Z' },
    ];
    fs.writeFileSync(path.join(tmpUserData, 'sessions.json'), JSON.stringify(sessions));

    // Only sess-1 has an active PTY
    mockPtyProcesses.set('sess-1', { pid: 1234 });

    const res = await request(server, 'GET', '/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toEqual({
      sessionId: 'sess-1',
      pid: 1234,
      workingDirectory: '/tmp/project-a',
    });
  });

  it('filters out sessions with no active PTY process', async () => {
    const sessions = [
      { sessionId: 'dead-sess', workingDirectory: '/tmp/dead', cliFlags: [], createdAt: '2026-01-01T00:00:00Z' },
    ];
    fs.writeFileSync(path.join(tmpUserData, 'sessions.json'), JSON.stringify(sessions));
    // No PTY registered for dead-sess

    const res = await request(server, 'GET', '/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('includes CORS headers in response', async () => {
    const res = await request(server, 'GET', '/api/sessions');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// =========================================================================
// POST /api/sessions
// =========================================================================

describe('POST /api/sessions', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = await request(server, 'POST', '/api/sessions', { cwd: os.tmpdir() });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing sessionId or cwd');
  });

  it('returns 400 when cwd is missing', async () => {
    const res = await request(server, 'POST', '/api/sessions', { sessionId: 'test-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing sessionId or cwd');
  });

  it('returns 400 when both sessionId and cwd are missing', async () => {
    const res = await request(server, 'POST', '/api/sessions', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing sessionId or cwd');
  });

  it('returns 400 for non-existent directory', async () => {
    const res = await request(server, 'POST', '/api/sessions', {
      sessionId: 'test-sess',
      cwd: '/this/path/definitely/does/not/exist/anywhere',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Directory does not exist');
  });

  it('spawns a PTY session for a valid request', async () => {
    const pty = await import('node-pty');
    const mockPty = {
      pid: 9999,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      kill: vi.fn(),
      resize: vi.fn(),
    };
    vi.mocked(pty.spawn).mockReturnValue(mockPty as any);

    const validDir = os.tmpdir();
    const res = await request(server, 'POST', '/api/sessions', {
      sessionId: 'new-sess-1',
      cwd: validDir,
      flags: ['--verbose'],
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.pid).toBe(9999);
    expect(res.body.sessionId).toBe('new-sess-1');

    // Verify PTY was spawned with correct args
    expect(pty.spawn).toHaveBeenCalledWith(
      expect.stringContaining('claude'),
      ['--session-id', 'new-sess-1', '--verbose'],
      expect.objectContaining({
        cwd: expect.any(String),
        cols: 80,
        rows: 30,
      })
    );

    // Verify PTY was registered in the map
    expect(mockPtyProcesses.has('new-sess-1')).toBe(true);

    // Verify scrollback buffer was created
    expect(mockScrollbackBuffers.has('new-sess-1')).toBe(true);

    // Verify status detector was created
    expect(mockStatusDetectors.has('new-sess-1')).toBe(true);
  });

  it('uses --resume flag when resume is true', async () => {
    const pty = await import('node-pty');
    const mockPty = {
      pid: 8888,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      kill: vi.fn(),
      resize: vi.fn(),
    };
    vi.mocked(pty.spawn).mockReturnValue(mockPty as any);

    const res = await request(server, 'POST', '/api/sessions', {
      sessionId: 'resume-sess',
      cwd: os.tmpdir(),
      resume: true,
    });

    expect(res.status).toBe(201);
    expect(pty.spawn).toHaveBeenCalledWith(
      expect.stringContaining('claude'),
      ['--resume', 'resume-sess'],
      expect.any(Object)
    );
  });

  it('returns 500 for invalid JSON body', async () => {
    // Send raw invalid JSON
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('not listening');

    const res = await new Promise<HttpResponse>((resolve, reject) => {
      const payload = 'this is not json';
      const req = http.request({
        hostname: '127.0.0.1',
        port: (addr as any).port,
        path: '/api/sessions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: JSON.parse(data),
            rawBody: data,
          });
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('includes CORS headers in response', async () => {
    const res = await request(server, 'POST', '/api/sessions', { sessionId: 'x', cwd: os.tmpdir() });
    // Even error responses should have CORS
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// =========================================================================
// DELETE /api/sessions
// =========================================================================

describe('DELETE /api/sessions', () => {
  it('returns 400 when id is missing', async () => {
    const res = await request(server, 'DELETE', '/api/sessions');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing session id');
  });

  it('returns 404 for unknown session', async () => {
    const res = await request(server, 'DELETE', '/api/sessions?id=nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Session not found');
  });

  it('kills the PTY process for a valid session', async () => {
    const mockKill = vi.fn();
    mockPtyProcesses.set('kill-me', { pid: 5555, kill: mockKill });

    const res = await request(server, 'DELETE', '/api/sessions?id=kill-me');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockKill).toHaveBeenCalledOnce();
  });

  it('returns 500 if kill throws', async () => {
    mockPtyProcesses.set('bad-kill', {
      pid: 6666,
      kill: () => { throw new Error('kill failed'); },
    });

    const res = await request(server, 'DELETE', '/api/sessions?id=bad-kill');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('kill failed');
  });

  it('includes CORS headers', async () => {
    const res = await request(server, 'DELETE', '/api/sessions?id=x');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// =========================================================================
// POST /api/pty/write
// =========================================================================

describe('POST /api/pty/write', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = await request(server, 'POST', '/api/pty/write', { data: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing sessionId or data');
  });

  it('returns 400 when data is missing', async () => {
    const res = await request(server, 'POST', '/api/pty/write', { sessionId: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing sessionId or data');
  });

  it('returns 404 for unknown session', async () => {
    const res = await request(server, 'POST', '/api/pty/write', {
      sessionId: 'ghost',
      data: 'hello',
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Session not found');
  });

  it('writes data to a valid PTY session', async () => {
    const mockWrite = vi.fn();
    mockPtyProcesses.set('write-sess', { pid: 7777, write: mockWrite });

    const res = await request(server, 'POST', '/api/pty/write', {
      sessionId: 'write-sess',
      data: 'test input\n',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockWrite).toHaveBeenCalledWith('test input\n');
  });

  it('writes empty string data without error', async () => {
    const mockWrite = vi.fn();
    mockPtyProcesses.set('empty-write', { pid: 1111, write: mockWrite });

    const res = await request(server, 'POST', '/api/pty/write', {
      sessionId: 'empty-write',
      data: '',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockWrite).toHaveBeenCalledWith('');
  });

  it('includes CORS headers', async () => {
    const res = await request(server, 'POST', '/api/pty/write', { sessionId: 'x', data: 'y' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// =========================================================================
// GET /api/groups
// =========================================================================

describe('GET /api/groups', () => {
  it('returns empty array when no groups saved', async () => {
    mockLoadGroups.mockReturnValue([]);
    const res = await request(server, 'GET', '/api/groups');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns saved groups', async () => {
    const groups = [
      { name: 'Frontend', color: '#89b4fa', sessionIds: ['s1', 's2'] },
      { name: 'Backend', color: '#a6e3a1', sessionIds: [] },
    ];
    mockLoadGroups.mockReturnValue(groups);

    const res = await request(server, 'GET', '/api/groups');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('Frontend');
    expect(res.body[1].name).toBe('Backend');
  });

  it('returns 500 when loadGroupsFromFile throws', async () => {
    mockLoadGroups.mockImplementation(() => { throw new Error('disk error'); });

    const res = await request(server, 'GET', '/api/groups');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('disk error');
  });

  it('passes correct file path to loadGroupsFromFile', async () => {
    await request(server, 'GET', '/api/groups');
    expect(mockLoadGroups).toHaveBeenCalledWith(
      path.join(tmpUserData, 'groups.json')
    );
  });

  it('includes CORS headers', async () => {
    const res = await request(server, 'GET', '/api/groups');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// =========================================================================
// POST /api/groups
// =========================================================================

describe('POST /api/groups', () => {
  it('saves groups and returns success', async () => {
    const groups = [
      { name: 'Test', color: '#f38ba8', sessionIds: ['a'] },
    ];

    const res = await request(server, 'POST', '/api/groups', groups);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSaveGroups).toHaveBeenCalledWith(
      path.join(tmpUserData, 'groups.json'),
      groups
    );
  });

  it('returns 500 for invalid JSON body', async () => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('not listening');

    const res = await new Promise<HttpResponse>((resolve, reject) => {
      const payload = 'not-valid-json';
      const req = http.request({
        hostname: '127.0.0.1',
        port: (addr as any).port,
        path: '/api/groups',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: JSON.parse(data),
            rawBody: data,
          });
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    expect(res.status).toBe(500);
  });

  it('returns 500 when saveGroupsToFile throws', async () => {
    mockSaveGroups.mockImplementation(() => { throw new Error('write error'); });

    const res = await request(server, 'POST', '/api/groups', [{ name: 'X', color: '#000', sessionIds: [] }]);
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('write error');
  });

  it('includes CORS headers', async () => {
    const res = await request(server, 'POST', '/api/groups', []);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// =========================================================================
// GET /api/templates
// =========================================================================

describe('GET /api/templates', () => {
  it('returns empty array when no templates saved', async () => {
    mockLoadTemplates.mockReturnValue([]);
    const res = await request(server, 'GET', '/api/templates');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns saved templates', async () => {
    const templates = [
      { id: 'tpl-1', name: 'Bugfix', category: 'bugfix', workingDirectory: '/tmp', createdAt: '2026-01-01', useCount: 3 },
    ];
    mockLoadTemplates.mockReturnValue(templates);

    const res = await request(server, 'GET', '/api/templates');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Bugfix');
  });

  it('returns 500 when loadTemplatesFromDisk throws', async () => {
    mockLoadTemplates.mockImplementation(() => { throw new Error('template read error'); });

    const res = await request(server, 'GET', '/api/templates');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('template read error');
  });

  it('includes CORS headers', async () => {
    const res = await request(server, 'GET', '/api/templates');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// =========================================================================
// POST /api/templates
// =========================================================================

describe('POST /api/templates', () => {
  it('creates a new template and returns success', async () => {
    mockLoadTemplates.mockReturnValue([]);

    const template = {
      id: 'tpl-new',
      name: 'Feature Dev',
      category: 'feature',
      workingDirectory: '/tmp/project',
      createdAt: '2026-03-01',
      useCount: 0,
    };

    const res = await request(server, 'POST', '/api/templates', template);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSaveTemplates).toHaveBeenCalledWith([template]);
  });

  it('updates an existing template by id', async () => {
    const existing = {
      id: 'tpl-existing',
      name: 'Old Name',
      category: 'general',
      workingDirectory: '/old',
      createdAt: '2026-01-01',
      useCount: 5,
    };
    mockLoadTemplates.mockReturnValue([existing]);

    const updated = { ...existing, name: 'New Name', workingDirectory: '/new' };
    const res = await request(server, 'POST', '/api/templates', updated);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSaveTemplates).toHaveBeenCalledWith([updated]);
  });

  it('returns 400 when id is missing', async () => {
    const res = await request(server, 'POST', '/api/templates', { name: 'No ID' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing required fields');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(server, 'POST', '/api/templates', { id: 'tpl-no-name' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing required fields');
  });

  it('returns 500 for invalid JSON body', async () => {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('not listening');

    const res = await new Promise<HttpResponse>((resolve, reject) => {
      const payload = '{broken json';
      const req = http.request({
        hostname: '127.0.0.1',
        port: (addr as any).port,
        path: '/api/templates',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: JSON.parse(data),
            rawBody: data,
          });
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    expect(res.status).toBe(500);
  });

  it('includes CORS headers', async () => {
    const res = await request(server, 'POST', '/api/templates', { id: 'x', name: 'x' });
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// =========================================================================
// DELETE /api/templates
// =========================================================================

describe('DELETE /api/templates', () => {
  it('returns 400 when id is missing', async () => {
    const res = await request(server, 'DELETE', '/api/templates');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing id');
  });

  it('deletes the template and returns success', async () => {
    const templates = [
      { id: 'tpl-a', name: 'A', category: 'general', workingDirectory: '/', createdAt: '', useCount: 0 },
      { id: 'tpl-b', name: 'B', category: 'general', workingDirectory: '/', createdAt: '', useCount: 0 },
    ];
    mockLoadTemplates.mockReturnValue(templates);

    const res = await request(server, 'DELETE', '/api/templates?id=tpl-a');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify that saveTemplatesToDisk was called without tpl-a
    expect(mockSaveTemplates).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'tpl-b' }),
    ]);
  });

  it('saves empty array when deleting the only template', async () => {
    mockLoadTemplates.mockReturnValue([
      { id: 'only-one', name: 'Only', category: 'general', workingDirectory: '/', createdAt: '', useCount: 0 },
    ]);

    const res = await request(server, 'DELETE', '/api/templates?id=only-one');
    expect(res.status).toBe(200);
    expect(mockSaveTemplates).toHaveBeenCalledWith([]);
  });

  it('includes CORS headers', async () => {
    const res = await request(server, 'DELETE', '/api/templates?id=x');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// =========================================================================
// GET /api/app/git-branch
// =========================================================================

describe('GET /api/app/git-branch', () => {
  it('returns a branch name or null with 200', async () => {
    const res = await request(server, 'GET', '/api/app/git-branch');
    expect(res.status).toBe(200);
    // In a git repo, branch will be a string; outside, null
    expect(res.body).toHaveProperty('branch');
    expect(res.body).toHaveProperty('cwd');
  });

  it('includes CORS headers', async () => {
    const res = await request(server, 'GET', '/api/app/git-branch');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// =========================================================================
// GET /api/git-context
// =========================================================================

describe('GET /api/git-context', () => {
  it('returns 400 when cwd is missing', async () => {
    const res = await request(server, 'GET', '/api/git-context');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing cwd');
  });

  it('returns git context for a valid git repository', async () => {
    // Use the actual project directory which is a git repo
    const res = await request(server, 'GET', `/api/git-context?cwd=${encodeURIComponent(process.cwd())}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('branch');
    expect(res.body).toHaveProperty('isGitRepo');
    expect(res.body).toHaveProperty('added');
    expect(res.body).toHaveProperty('modified');
    expect(res.body).toHaveProperty('deleted');
  });

  it('returns safe defaults for non-git directory', async () => {
    const nonGitDir = os.tmpdir();
    const res = await request(server, 'GET', `/api/git-context?cwd=${encodeURIComponent(nonGitDir)}`);
    expect(res.status).toBe(200);
    expect(res.body.branch).toBeNull();
    expect(res.body.isGitRepo).toBe(false);
    expect(res.body.added).toBe(0);
    expect(res.body.modified).toBe(0);
    expect(res.body.deleted).toBe(0);
  });

  it('includes CORS headers', async () => {
    const res = await request(server, 'GET', '/api/git-context?cwd=/tmp');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// =========================================================================
// GET /api/analysis (smoke test)
// =========================================================================

describe('GET /api/analysis', () => {
  it('returns 200 with analysis data', async () => {
    const res = await request(server, 'GET', '/api/analysis');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sessions');
    expect(res.body).toHaveProperty('summary');
  });

  it('returns 500 when analyzeAllSessions throws', async () => {
    const { analyzeAllSessions } = await import('../analysis/log-analyzer');
    vi.mocked(analyzeAllSessions).mockRejectedValueOnce(new Error('analysis broke'));

    const res = await request(server, 'GET', '/api/analysis');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Analysis failed');
  });
});

// =========================================================================
// GET /api/analysis/session (smoke test)
// =========================================================================

describe('GET /api/analysis/session', () => {
  it('returns 400 when id is missing', async () => {
    const res = await request(server, 'GET', '/api/analysis/session');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing id');
  });

  it('returns 200 with session score', async () => {
    const res = await request(server, 'GET', '/api/analysis/session?id=test-sess');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('score');
  });
});

// =========================================================================
// GET /api/analysis/trends (smoke test)
// =========================================================================

describe('GET /api/analysis/trends', () => {
  it('returns 200 with trend data', async () => {
    const res = await request(server, 'GET', '/api/analysis/trends');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('entries');
  });
});

// =========================================================================
// GET /api/audit/projects (smoke test)
// =========================================================================

describe('GET /api/audit/projects', () => {
  it('returns 200 with project list', async () => {
    const res = await request(server, 'GET', '/api/audit/projects');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// =========================================================================
// POST /api/deep-audit/cancel (smoke test)
// =========================================================================

describe('POST /api/deep-audit/cancel', () => {
  it('returns 200 with cancelled status', async () => {
    const res = await request(server, 'POST', '/api/deep-audit/cancel');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cancelled');
  });
});

// =========================================================================
// GET /api/logs (smoke test)
// =========================================================================

describe('GET /api/logs', () => {
  it('returns 200 with JSONL content-type', async () => {
    const res = await request(server, 'GET', '/api/logs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    expect(res.headers['content-disposition']).toContain('attachment');
  });
});

// =========================================================================
// Static File Serving
// =========================================================================

describe('Static file serving', () => {
  it('GET / serves index.html', async () => {
    const res = await request(server, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.rawBody).toContain('Test App');
  });

  it('GET /main.js serves JavaScript with correct MIME type', async () => {
    const res = await request(server, 'GET', '/main.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
  });

  it('GET /styles.css serves CSS with correct MIME type', async () => {
    const res = await request(server, 'GET', '/styles.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
  });

  it('GET /nonexistent falls back to index.html (SPA routing)', async () => {
    const res = await request(server, 'GET', '/some/deep/route');
    expect(res.status).toBe(200);
    expect(res.rawBody).toContain('Test App');
  });

  it('sets cache headers: no-cache for HTML, public for assets', async () => {
    const htmlRes = await request(server, 'GET', '/');
    expect(htmlRes.headers['cache-control']).toContain('no-cache');

    const jsRes = await request(server, 'GET', '/main.js');
    expect(jsRes.headers['cache-control']).toContain('public');
  });
});

// =========================================================================
// GET /api/git/branches
// =========================================================================

describe('GET /api/git/branches', () => {
  it('returns 400 when path parameter is missing', async () => {
    const res = await request(server, 'GET', '/api/git/branches');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing path');
  });

  it('returns branches for a valid git repo', async () => {
    const res = await request(server, 'GET', `/api/git/branches?path=${encodeURIComponent(process.cwd())}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('local');
    expect(res.body).toHaveProperty('remote');
    expect(res.body).toHaveProperty('current');
    expect(Array.isArray(res.body.local)).toBe(true);
    expect(Array.isArray(res.body.remote)).toBe(true);
  });

  it('returns empty arrays for non-git directory', async () => {
    const res = await request(server, 'GET', `/api/git/branches?path=${encodeURIComponent(os.tmpdir())}`);
    expect(res.status).toBe(200);
    expect(res.body.local).toEqual([]);
    expect(res.body.remote).toEqual([]);
    expect(res.body.current).toBe('');
  });
});

// =========================================================================
// GET /api/worktrees
// =========================================================================

describe('GET /api/worktrees', () => {
  it('returns 400 when repoPath is missing', async () => {
    const res = await request(server, 'GET', '/api/worktrees');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing repoPath');
  });

  it('returns worktree list for a valid repo', async () => {
    const res = await request(server, 'GET', `/api/worktrees?repoPath=${encodeURIComponent(process.cwd())}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('path');
      expect(res.body[0]).toHaveProperty('branch');
      expect(res.body[0]).toHaveProperty('commit');
      expect(res.body[0]).toHaveProperty('isMain');
      expect(res.body[0]).toHaveProperty('hasSession');
    }
  });
});

// =========================================================================
// GET /api/analysis/session-detail (smoke test)
// =========================================================================

describe('GET /api/analysis/session-detail', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = await request(server, 'GET', '/api/analysis/session-detail');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('sessionId required');
  });

  it('returns 200 with session detail', async () => {
    const res = await request(server, 'GET', '/api/analysis/session-detail?sessionId=test-sess');
    expect(res.status).toBe(200);
  });
});

// =========================================================================
// GET /api/audit/run (smoke test)
// =========================================================================

describe('GET /api/audit/run', () => {
  it('returns 400 when path is missing', async () => {
    const res = await request(server, 'GET', '/api/audit/run');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('path parameter required');
  });

  it('returns 200 with audit results', async () => {
    const res = await request(server, 'GET', `/api/audit/run?path=${encodeURIComponent('/some/project')}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('findings');
  });
});

// =========================================================================
// GET /api/review/diff
// =========================================================================

describe('GET /api/review/diff', () => {
  it('returns 400 when cwd is missing', async () => {
    const res = await request(server, 'GET', '/api/review/diff');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing cwd');
  });

  it('returns diff for a valid git repo', async () => {
    const res = await request(server, 'GET', `/api/review/diff?cwd=${encodeURIComponent(process.cwd())}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('diff');
    expect(typeof res.body.diff).toBe('string');
  });
});

// =========================================================================
// Unknown API routes fall through to static serving
// =========================================================================

describe('Unknown routes', () => {
  it('GET /api/nonexistent falls through to SPA fallback', async () => {
    // Since there is no /api/nonexistent handler, it falls to static serving
    const res = await request(server, 'GET', '/api/nonexistent');
    expect(res.status).toBe(200);
    // Falls back to index.html
    expect(res.rawBody).toContain('Test App');
  });

  it('PUT method is not handled by API routes, falls to static', async () => {
    const res = await request(server, 'PUT', '/api/sessions');
    expect(res.status).toBe(200);
    // Falls through to SPA fallback
    expect(res.rawBody).toContain('Test App');
  });
});
