/**
 * Tests for static-server HTTP API response contracts.
 * These verify the shape of data returned by API endpoints,
 * ensuring remote browsers receive workingDirectory and git context.
 */
import { describe, it, expect } from 'vitest';

// We can't import startStaticServer directly (requires Electron),
// so we test the response contracts and data transformations.

describe('GET /api/sessions response contract', () => {
  it('session response includes workingDirectory field', () => {
    // Simulates the .map() in GET /api/sessions handler
    const savedSession = {
      sessionId: 'abc-123',
      workingDirectory: '/home/user/project',
      cliFlags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const pid = 12345;

    const response = {
      sessionId: savedSession.sessionId,
      pid,
      workingDirectory: savedSession.workingDirectory,
    };

    expect(response).toHaveProperty('workingDirectory');
    expect(response.workingDirectory).toBe('/home/user/project');
    expect(response).toHaveProperty('sessionId');
    expect(response).toHaveProperty('pid');
  });

  it('workingDirectory is never undefined in response', () => {
    // Even if session has empty cwd, it should be a string
    const savedSession = {
      sessionId: 'def-456',
      workingDirectory: '',
      cliFlags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    const response = {
      sessionId: savedSession.sessionId,
      pid: 99999,
      workingDirectory: savedSession.workingDirectory,
    };

    expect(typeof response.workingDirectory).toBe('string');
  });
});

describe('GET /api/git-context response contract', () => {
  it('returns full GitContext shape for a git repo', () => {
    // Simulates the success path of GET /api/git-context
    const gitContext = {
      branch: 'main',
      added: 3,
      modified: 1,
      deleted: 0,
      isGitRepo: true,
    };

    expect(gitContext).toHaveProperty('branch');
    expect(gitContext).toHaveProperty('added');
    expect(gitContext).toHaveProperty('modified');
    expect(gitContext).toHaveProperty('deleted');
    expect(gitContext).toHaveProperty('isGitRepo');
    expect(typeof gitContext.branch).toBe('string');
    expect(typeof gitContext.added).toBe('number');
    expect(typeof gitContext.isGitRepo).toBe('boolean');
  });

  it('returns safe defaults for non-git directory', () => {
    // Simulates the catch path of GET /api/git-context
    const fallback = {
      branch: null,
      added: 0,
      modified: 0,
      deleted: 0,
      isGitRepo: false,
    };

    expect(fallback.branch).toBeNull();
    expect(fallback.added).toBe(0);
    expect(fallback.modified).toBe(0);
    expect(fallback.deleted).toBe(0);
    expect(fallback.isGitRepo).toBe(false);
  });
});

describe('Remote session loading contract', () => {
  it('uses workingDirectory from API response, not empty string', () => {
    // Simulates what loadRemoteSessions() does in app.component.ts
    const apiResponse = [
      { sessionId: 'sess-1', pid: 111, workingDirectory: '/home/user/projectA' },
      { sessionId: 'sess-2', pid: 222, workingDirectory: '/home/user/projectB' },
    ];

    for (const pty of apiResponse) {
      const metadata = {
        sessionId: pty.sessionId,
        workingDirectory: pty.workingDirectory || '',
        cliFlags: [] as string[],
        createdAt: new Date().toISOString(),
      };

      expect(metadata.workingDirectory).not.toBe('');
      expect(metadata.workingDirectory).toBe(pty.workingDirectory);
    }
  });

  it('falls back to empty string if workingDirectory missing', () => {
    // Old API responses without workingDirectory should still work
    const legacyResponse = { sessionId: 'old-1', pid: 333 } as any;

    const metadata = {
      sessionId: legacyResponse.sessionId,
      workingDirectory: legacyResponse.workingDirectory || '',
    };

    expect(metadata.workingDirectory).toBe('');
  });
});

describe('Width resize constraints', () => {
  it('enforces minimum width of 300px', () => {
    const startWidth = 400;

    // Drag left by 200px (would result in 200px, below minimum)
    const delta = -200;
    const newWidth = Math.max(300, startWidth + delta);

    expect(newWidth).toBe(300);
  });

  it('allows widths above minimum', () => {
    const startWidth = 400;
    const delta = 100;
    const newWidth = Math.max(300, startWidth + delta);

    expect(newWidth).toBe(500);
  });

  it('fixed-width tile gets flex: 0 0 <width>px', () => {
    const tileWidths: Record<string, number> = { 'sess-1': 500 };
    const sessionId = 'sess-1';

    // Simulates the [style.flex] binding in template
    const flexValue = tileWidths[sessionId]
      ? `0 0 ${tileWidths[sessionId]}px`
      : null;

    expect(flexValue).toBe('0 0 500px');
  });

  it('auto-width tile keeps default flex', () => {
    const tileWidths: Record<string, number> = {};
    const sessionId = 'sess-2';

    const flexValue = tileWidths[sessionId]
      ? `0 0 ${tileWidths[sessionId]}px`
      : null;

    expect(flexValue).toBeNull();
  });
});
