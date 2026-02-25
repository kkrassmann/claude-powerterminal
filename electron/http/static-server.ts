/**
 * HTTP static file server for serving Angular build output to remote browsers.
 *
 * Serves files from the Angular dist directory on all network interfaces (0.0.0.0),
 * enabling LAN access from phones/tablets. Implements SPA fallback for Angular routing.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { getPtyProcesses } from '../ipc/pty-handlers';
import { app } from 'electron';
import { ptyManager } from '../managers/pty-manager';
import { sessionManager } from '../managers/session-manager';

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

          // Spawn PTY (same logic as IPC handler)
          const ptyProcess = ptyManager.spawnPty(sessionId, cwd, flags || [], resume || false);

          // Save session metadata
          sessionManager.saveSession({
            sessionId,
            workingDirectory: cwd,
            cliFlags: flags || [],
            createdAt: new Date().toISOString()
          });

          // Return success with PID
          res.writeHead(201, corsHeaders);
          res.end(JSON.stringify({
            success: true,
            pid: ptyProcess.pid,
            sessionId
          }));
        } catch (error) {
          console.error('[HTTP] POST /api/sessions error:', error);
          res.writeHead(500, corsHeaders);
          res.end(JSON.stringify({ success: false, error: String(error) }));
        }
      });
      return; // Important: prevent fallthrough to GET handler
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
