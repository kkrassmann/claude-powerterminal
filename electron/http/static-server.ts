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
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getPtyProcesses } from '../ipc/pty-handlers';
import { app } from 'electron';
import { getScrollbackBuffers, getStatusDetectors, broadcastStatus } from '../websocket/ws-server';
import { ScrollbackBuffer } from '../../src/shared/scrollback-buffer';
import { StatusDetector } from '../status/status-detector';
import { deleteSessionFromDisk } from '../ipc/session-handlers';
import { sanitizeEnvForClaude } from '../utils/env-sanitize';
import { getMainWindow } from '../utils/window-ref';
import { parseGitStatus } from '../utils/git-status-parser';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { analyzeAllSessions, computeSessionScore } from '../analysis/log-analyzer';
import { getTrends, HistoryEntry } from '../analysis/score-history';
import { getAngularBuildDir } from '../utils/paths';
import { exportAsJsonl } from '../utils/log-service';

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

const execFileAsync = promisify(execFile);

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
  const buildDir = getAngularBuildDir();

  // CORS headers for API endpoints
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Handle CORS preflight for API endpoints
    if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

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

            // Notify Electron renderer to remove the exited session
            const win = getMainWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send(IPC_CHANNELS.PTY_EXIT, { sessionId, exitCode });
            }
          });

          // Save session metadata to disk
          saveSessionToDisk({
            sessionId,
            workingDirectory: cwd,
            cliFlags: flags || [],
            createdAt: new Date().toISOString()
          });

          console.log(`[HTTP] Session ${sessionId} spawned (PID ${ptyProcess.pid})`);

          // Notify Electron renderer so it picks up the new session
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.SESSION_RESTORE_COMPLETE);
          }

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
          workingDirectory: session.workingDirectory,
        }));

      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify(activeSessions));
      return;
    }

    // GET /api/git-context?cwd=<path> - Get git context for a directory
    if (req.method === 'GET' && pathname === '/api/git-context') {
      const cwd = url.searchParams.get('cwd');
      if (!cwd) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'Missing cwd parameter' }));
        return;
      }

      try {
        const [branchResult, statusResult] = await Promise.all([
          execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd,
            timeout: 5000,
            windowsHide: true,
          }),
          execFileAsync('git', ['status', '--porcelain'], {
            cwd,
            timeout: 5000,
            windowsHide: true,
          }),
        ]);

        const branch = branchResult.stdout.trim();
        const { added, modified, deleted } = parseGitStatus(statusResult.stdout);

        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ branch: branch || null, added, modified, deleted, isGitRepo: true }));
      } catch (error: any) {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ branch: null, added: 0, modified: 0, deleted: 0, isGitRepo: false }));
      }
      return;
    }

    // GET /api/analysis - Full session analysis (tool usage, recommendations, scores)
    if (req.method === 'GET' && pathname === '/api/analysis') {
      try {
        const analysis = await analyzeAllSessions();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(analysis));
      } catch (error: any) {
        console.error('[HTTP] GET /api/analysis error:', error.message);
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: 'Analysis failed' }));
      }
      return;
    }

    // GET /api/analysis/session?id=<sessionId> - Per-session practice score
    if (req.method === 'GET' && pathname === '/api/analysis/session') {
      const id = url.searchParams.get('id');
      if (!id) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'Missing id parameter' }));
        return;
      }
      try {
        const score = await computeSessionScore(id);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(score));
      } catch (error: any) {
        console.error(`[HTTP] GET /api/analysis/session error for ${id}:`, error.message);
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: 'Session score computation failed' }));
      }
      return;
    }

    // GET /api/analysis/session-detail?sessionId=<sessionId> - Full per-session score detail
    if (req.method === 'GET' && pathname === '/api/analysis/session-detail') {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      if (!sessionId) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'sessionId required' }));
        return;
      }
      try {
        const result = await computeSessionScore(sessionId);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(result ?? null));
      } catch (err) {
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // GET /api/analysis/trends - Score trend data for last 10 sessions
    if (req.method === 'GET' && pathname === '/api/analysis/trends') {
      try {
        const entries = getTrends(10);
        const trends = {
          entries,
          totalScore: entries.map((e: HistoryEntry) => e.score),
          toolNativeness: entries.map((e: HistoryEntry) => e.toolNativenessScore),
          subagent: entries.map((e: HistoryEntry) => e.subagentScore),
          readBeforeWrite: entries.map((e: HistoryEntry) => e.readBeforeWriteScore),
          contextEfficiency: entries.map((e: HistoryEntry) => e.contextEfficiencyScore),
          errorScore: entries.map((e: HistoryEntry) => e.errorScore),
          antiPatternCount: entries.map((e: HistoryEntry) => e.antiPatternCount),
        };
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(trends));
      } catch (err) {
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // GET /api/logs - Export internal logs as JSONL download
    if (req.method === 'GET' && pathname === '/api/logs') {
      const jsonl = exportAsJsonl();
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': `attachment; filename="cpt-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl"`,
      });
      res.end(jsonl);
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
