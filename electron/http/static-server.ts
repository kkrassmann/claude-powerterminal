/**
 * HTTP static file server for serving Angular build output to remote browsers.
 *
 * Serves files from the Angular dist directory on all network interfaces (0.0.0.0),
 * enabling LAN access from phones/tablets. Implements SPA fallback for Angular routing.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as pty from 'node-pty';
import { getPtyProcesses } from '../ipc/pty-handlers';
import { app } from 'electron';
import { getScrollbackBuffers, getStatusDetectors, broadcastStatus } from '../websocket/ws-server';
import { ScrollbackBuffer } from '../../src/src/app/services/scrollback-buffer.service';
import { StatusDetector } from '../status/status-detector';
import { deleteSessionFromDisk } from '../ipc/session-handlers';
import { sanitizeEnvForClaude } from '../utils/env-sanitize';

/**
 * SessionMetadata interface (matches src/app/models/session.model.ts)
 */
interface SessionMetadata {
  sessionId: string;
  workingDirectory: string;
  cliFlags: string[];
  createdAt: string;
}

/**
 * Load sessions from disk.
 * Returns empty array if file doesn't exist or is invalid.
 */
function loadSessionsFromDisk(): SessionMetadata[] {
  try {
    const userDataPath = app.getPath('userData');
    const filePath = path.join(userDataPath, 'sessions.json');
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    const sessions = JSON.parse(data);
    return sessions;
  } catch (error: any) {
    console.error('[Static Server] Error loading sessions:', error.message);
    return [];
  }
}

/**
 * Save a new session to disk (append to sessions.json).
 */
function saveSessionToDisk(session: SessionMetadata): void {
  try {
    const sessions = loadSessionsFromDisk();
    sessions.push(session);
    const userDataPath = app.getPath('userData');
    const filePath = path.join(userDataPath, 'sessions.json');
    fs.writeFileSync(filePath, JSON.stringify(sessions, null, 2), 'utf-8');
    console.log(`[Static Server] Saved session ${session.sessionId} to disk`);
  } catch (error: any) {
    console.error('[Static Server] Error saving session:', error.message);
  }
}

/**
 * MIME type mapping for common file extensions.
 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

/**
 * Start HTTP static file server.
 *
 * Serves files from the Angular build output directory with SPA fallback:
 * - Files with extensions are served directly if they exist
 * - Requests without extensions or 404s serve index.html (Angular routing)
 *
 * @param port - Port to listen on (e.g., 9801)
 * @returns http.Server instance
 */
export function startStaticServer(port: number): http.Server {
  const buildDir = path.join(__dirname, '../../../src/dist/claude-powerterminal-angular/browser');

  // CORS headers for API endpoints
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    // POST /api/sessions - Create new session via HTTP API
    if (req.method === 'POST' && pathname === '/api/sessions') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { sessionId, cwd, flags, resume } = JSON.parse(body);

          // Validate inputs
          if (!sessionId || !cwd) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: 'Missing sessionId or cwd' }));
            return;
          }

          const resolvedCwd = path.resolve(cwd);
          if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: `Directory does not exist: ${resolvedCwd}` }));
            return;
          }

          // Check for duplicate cwd (multiple CLI instances in same dir corrupt .claude.json)
          const activePtys = getPtyProcesses();
          const savedSessions = loadSessionsFromDisk();
          for (const [existingId] of activePtys) {
            const existing = savedSessions.find(s => s.sessionId === existingId);
            if (existing && path.resolve(existing.workingDirectory) === resolvedCwd) {
              res.writeHead(409, corsHeaders);
              res.end(JSON.stringify({ error: 'Directory already has an active session' }));
              return;
            }
          }

          const env = sanitizeEnvForClaude();

          // Spawn PTY (mirrors IPC PTY_SPAWN handler logic)
          const claudeExe = process.platform === 'win32' ? 'claude.exe' : 'claude';
          const sessionFlag = resume ? '--resume' : '--session-id';
          const claudeArgs = [sessionFlag, sessionId, ...(flags || [])];

          const ptyProcess = pty.spawn(claudeExe, claudeArgs, {
            name: 'xterm-256color',
            cols: 80,
            rows: 30,
            cwd: resolvedCwd,
            env,
            useConpty: true,
          });

          // Register in PTY processes map
          activePtys.set(sessionId, ptyProcess);

          // Create scrollback buffer for WebSocket replay
          getScrollbackBuffers().set(sessionId, new ScrollbackBuffer(10000));

          // Create status detector
          const statusDetector = new StatusDetector(sessionId, (sid, status) => {
            broadcastStatus(sid, status);
          });
          getStatusDetectors().set(sessionId, statusDetector);

          // Wire up PTY event handlers
          ptyProcess.onData((data) => {
            const buffer = getScrollbackBuffers().get(sessionId);
            if (buffer) buffer.append(data);
            const detector = getStatusDetectors().get(sessionId);
            if (detector) detector.processOutput(data);
          });

          ptyProcess.onExit(({ exitCode }) => {
            console.log(`[HTTP] Session ${sessionId} exited (code ${exitCode})`);
            const detector = getStatusDetectors().get(sessionId);
            if (detector) {
              detector.processExit();
              detector.destroy();
              getStatusDetectors().delete(sessionId);
            }
            getPtyProcesses().delete(sessionId);
            getScrollbackBuffers().delete(sessionId);
            deleteSessionFromDisk(sessionId);
          });

          // Save session metadata to disk
          saveSessionToDisk({
            sessionId,
            workingDirectory: cwd,
            cliFlags: flags || [],
            createdAt: new Date().toISOString()
          });

          console.log(`[HTTP] Session ${sessionId} spawned (PID ${ptyProcess.pid})`);
          res.writeHead(201, corsHeaders);
          res.end(JSON.stringify({ success: true, pid: ptyProcess.pid, sessionId }));
        } catch (error) {
          console.error('[HTTP] POST /api/sessions error:', error);
          res.writeHead(500, corsHeaders);
          res.end(JSON.stringify({ success: false, error: String(error) }));
        }
      });
      return;
    }

    // GET /api/sessions - Return saved sessions for remote browsers
    if (req.method === 'GET' && pathname === '/api/sessions') {
      const savedSessions = loadSessionsFromDisk();
      const ptyProcesses = getPtyProcesses();

      // Cross-reference: only return sessions that have active PTY processes
      const activeSessions = savedSessions
        .filter(session => ptyProcesses.has(session.sessionId))
        .map(session => ({
          sessionId: session.sessionId,
          pid: ptyProcesses.get(session.sessionId)!.pid,
        }));

      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify(activeSessions));
      return;
    }

    // Default to index.html for root requests
    let filePath = req.url === '/' ? '/index.html' : req.url || '/index.html';

    // Remove query strings
    const queryIndex = filePath.indexOf('?');
    if (queryIndex !== -1) {
      filePath = filePath.substring(0, queryIndex);
    }

    const fullPath = path.join(buildDir, filePath);
    const ext = path.extname(filePath);

    // Read and serve file
    fs.readFile(fullPath, (err, data) => {
      if (err) {
        // SPA fallback: serve index.html for 404s (Angular routing handles URLs)
        const indexPath = path.join(buildDir, 'index.html');
        fs.readFile(indexPath, (indexErr, indexData) => {
          if (indexErr) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('500 Internal Server Error');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(indexData);
        });
        return;
      }

      // Determine MIME type
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(data);
    });
  });

  // Bind to 0.0.0.0 (all network interfaces) for LAN access
  server.listen(port, '0.0.0.0', () => {
    console.log(`[HTTP] Static server listening on 0.0.0.0:${port}`);
  });

  return server;
}
