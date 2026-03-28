/**
 * Tests for ws-protocol.ts
 *
 * The module reads `window` at call time (not import time), so we can safely
 * set/unset globalThis.window before each call. The module-level `_authToken`
 * variable is reset via setAuthToken(null-ish workaround) — we re-import a
 * fresh module per describe block using vi.resetModules().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Constants pulled from the module (kept in sync manually to avoid circular import issues)
const HTTP_PORT = 9821;
const WS_PORT = 9820;
const DEV_OFFSET = 10;

// Helper to set a fake window object
function setWindow(obj: Record<string, any> | undefined) {
  if (obj === undefined) {
    // @ts-ignore
    delete (globalThis as any).window;
  } else {
    (globalThis as any).window = obj;
  }
}

describe('ws-protocol', () => {
  // We re-import the module fresh for each test group to get a clean _authToken state.
  // Within a group we rely on setAuthToken(null) workaround via direct calls.

  beforeEach(() => {
    vi.resetModules();
    setWindow(undefined); // no window by default
  });

  afterEach(() => {
    setWindow(undefined);
  });

  // ---- getHttpBaseUrl ----

  describe('getHttpBaseUrl()', () => {
    it('returns localhost:HTTP_PORT when window is undefined', async () => {
      const { getHttpBaseUrl } = await import('./ws-protocol');
      setWindow(undefined);
      expect(getHttpBaseUrl()).toBe(`http://localhost:${HTTP_PORT}`);
    });

    it('returns localhost:HTTP_PORT when window has no electronAPI', async () => {
      const { getHttpBaseUrl } = await import('./ws-protocol');
      setWindow({ location: { hostname: 'localhost', port: String(HTTP_PORT) } });
      expect(getHttpBaseUrl()).toBe(`http://localhost:${HTTP_PORT}`);
    });

    it('returns localhost:9821 when electronAPI.isDev=false', async () => {
      const { getHttpBaseUrl } = await import('./ws-protocol');
      setWindow({ electronAPI: { isDev: false } });
      expect(getHttpBaseUrl()).toBe(`http://localhost:${HTTP_PORT}`);
    });

    it('returns localhost:9831 when electronAPI.isDev=true', async () => {
      const { getHttpBaseUrl } = await import('./ws-protocol');
      setWindow({ electronAPI: { isDev: true } });
      expect(getHttpBaseUrl()).toBe(`http://localhost:${HTTP_PORT + DEV_OFFSET}`);
    });

    it('uses window.location.hostname and port for remote browser', async () => {
      const { getHttpBaseUrl } = await import('./ws-protocol');
      setWindow({ location: { hostname: '192.168.1.10', port: '9831' } });
      expect(getHttpBaseUrl()).toBe('http://192.168.1.10:9831');
    });

    it('falls back to HTTP_PORT when window.location.port is empty', async () => {
      const { getHttpBaseUrl } = await import('./ws-protocol');
      setWindow({ location: { hostname: 'myhost', port: '' } });
      expect(getHttpBaseUrl()).toBe(`http://myhost:${HTTP_PORT}`);
    });
  });

  // ---- getWsPort ----

  describe('getWsPort()', () => {
    it('returns WS_PORT when window is undefined', async () => {
      const { getWsPort } = await import('./ws-protocol');
      setWindow(undefined);
      expect(getWsPort()).toBe(WS_PORT);
    });

    it('returns WS_PORT when electronAPI.isDev=false', async () => {
      const { getWsPort } = await import('./ws-protocol');
      setWindow({ electronAPI: { isDev: false } });
      expect(getWsPort()).toBe(WS_PORT);
    });

    it('returns WS_PORT + DEV_OFFSET when electronAPI.isDev=true', async () => {
      const { getWsPort } = await import('./ws-protocol');
      setWindow({ electronAPI: { isDev: true } });
      expect(getWsPort()).toBe(WS_PORT + DEV_OFFSET);
    });

    it('derives WS port from window.location.port (HTTP port - 1) for remote browser', async () => {
      const { getWsPort } = await import('./ws-protocol');
      // Remote browser loaded via HTTP port 9831 → WS = 9830
      setWindow({ location: { hostname: '192.168.1.10', port: '9831' } });
      expect(getWsPort()).toBe(9830);
    });

    it('returns WS_PORT when window has no electronAPI and no location.port', async () => {
      const { getWsPort } = await import('./ws-protocol');
      setWindow({ location: { hostname: 'host', port: '' } });
      expect(getWsPort()).toBe(WS_PORT);
    });
  });

  // ---- setAuthToken / getAuthToken ----

  describe('setAuthToken() / getAuthToken()', () => {
    it('getAuthToken() returns null before any token is set', async () => {
      const { getAuthToken } = await import('./ws-protocol');
      expect(getAuthToken()).toBeNull();
    });

    it('setAuthToken() stores the token and getAuthToken() returns it', async () => {
      const { setAuthToken, getAuthToken } = await import('./ws-protocol');
      setAuthToken('my-secret-token');
      expect(getAuthToken()).toBe('my-secret-token');
    });

    it('setAuthToken() overwrites previous token', async () => {
      const { setAuthToken, getAuthToken } = await import('./ws-protocol');
      setAuthToken('first');
      setAuthToken('second');
      expect(getAuthToken()).toBe('second');
    });
  });

  // ---- apiFetch ----

  describe('apiFetch()', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
      (globalThis as any).fetch = fetchMock;
    });

    afterEach(() => {
      delete (globalThis as any).fetch;
    });

    it('calls fetch with the provided URL when no token is set', async () => {
      const { apiFetch } = await import('./ws-protocol');
      await apiFetch('http://localhost:9821/api/sessions');
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:9821/api/sessions');
    });

    it('does not add Authorization header when token is null', async () => {
      const { apiFetch } = await import('./ws-protocol');
      await apiFetch('http://localhost:9821/api/sessions');
      const [, init] = fetchMock.mock.calls[0];
      const authHeader = (init.headers as Headers).get('Authorization');
      expect(authHeader).toBeNull();
    });

    it('adds Bearer Authorization header when token is set', async () => {
      const { apiFetch, setAuthToken } = await import('./ws-protocol');
      setAuthToken('tok-abc123');
      await apiFetch('http://localhost:9821/api/sessions');
      const [, init] = fetchMock.mock.calls[0];
      const authHeader = (init.headers as Headers).get('Authorization');
      expect(authHeader).toBe('Bearer tok-abc123');
    });

    it('passes through additional RequestInit options', async () => {
      const { apiFetch } = await import('./ws-protocol');
      await apiFetch('http://localhost:9821/api/sessions', { method: 'POST', body: 'data' });
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(init.body).toBe('data');
    });

    it('preserves caller-supplied headers alongside Authorization', async () => {
      const { apiFetch, setAuthToken } = await import('./ws-protocol');
      setAuthToken('my-token');
      await apiFetch('http://localhost:9821/api/sessions', {
        headers: { 'X-Custom': 'value' },
      });
      const [, init] = fetchMock.mock.calls[0];
      const headers = init.headers as Headers;
      expect(headers.get('X-Custom')).toBe('value');
      expect(headers.get('Authorization')).toBe('Bearer my-token');
    });
  });
});
