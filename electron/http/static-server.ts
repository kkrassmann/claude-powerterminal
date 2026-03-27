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
import { execFile, spawn } from 'child_process';
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
import { discoverClaudeProjects, runProjectAudit } from '../analysis/audit-engine';
import { runDeepAudit, cancelDeepAudit } from '../analysis/deep-audit-engine';
import { getTrends, HistoryEntry } from '../analysis/score-history';
import { getAngularBuildDir } from '../utils/paths';
import { exportAsJsonl } from '../utils/log-service';
import { loadTemplatesFromDisk, saveTemplatesToDisk } from '../ipc/template-handlers';
import { loadGroupsFromFile, saveGroupsToFile } from '../ipc/group-handlers';
import { appendSessionLog, loadSessionLog, deleteSessionLog } from '../utils/session-log';
import { SessionTemplate } from '../../src/shared/template-types';
import { WorktreeInfo, WorktreeCreateOptions } from '../../src/shared/worktree-types';

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
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

          // Log if another session already runs in this directory (not blocking —
          // Claude CLI sessions are isolated via --session-id)
          const activePtys = getPtyProcesses();
          const savedSessions = loadSessionsFromDisk();
          for (const [existingId] of activePtys) {
            const existing = savedSessions.find(s => s.sessionId === existingId);
            if (existing && path.resolve(existing.workingDirectory) === resolvedCwd) {
              console.log(`[HTTP] Directory ${resolvedCwd} already has session ${existingId} — spawning anyway`);
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

          // Load saved scrollback from disk when resuming
          if (resume) {
            const savedData = loadSessionLog(sessionId);
            if (savedData) {
              getScrollbackBuffers().get(sessionId)!.append(savedData);
            }
          }

          // Create status detector
          const statusDetector = new StatusDetector(sessionId, (sid, status) => {
            broadcastStatus(sid, status);
          });
          getStatusDetectors().set(sessionId, statusDetector);

          // Wire up PTY event handlers
          ptyProcess.onData((data) => {
            const buffer = getScrollbackBuffers().get(sessionId);
            if (buffer) buffer.append(data);
            appendSessionLog(sessionId, data);
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
            deleteSessionLog(sessionId);

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

    // GET /api/app/git-branch - Get git branch of the app's working directory
    if (req.method === 'GET' && pathname === '/api/app/git-branch') {
      const cwd = process.cwd();
      try {
        const result = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd,
          timeout: 5000,
          windowsHide: true,
        });
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ branch: result.stdout.trim() || null, cwd }));
      } catch {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ branch: null, cwd }));
      }
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

    // GET /api/git/branches?path=... - List local and remote branches for a repository
    if (req.method === 'GET' && pathname === '/api/git/branches') {
      const gitPath = url.searchParams.get('path');
      if (!gitPath) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'Missing path parameter' }));
        return;
      }

      try {
        const [localResult, remoteResult, currentResult] = await Promise.all([
          execFileAsync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], {
            cwd: gitPath,
            timeout: 5000,
            windowsHide: true,
          }),
          execFileAsync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/'], {
            cwd: gitPath,
            timeout: 5000,
            windowsHide: true,
          }),
          execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: gitPath,
            timeout: 5000,
            windowsHide: true,
          }),
        ]);

        const local = localResult.stdout.trim().split('\n').filter(Boolean);
        const remote = remoteResult.stdout.trim().split('\n').filter(Boolean);
        const current = currentResult.stdout.trim();

        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ local, remote, current }));
      } catch (error: any) {
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ local: [], remote: [], current: '' }));
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

    // GET /api/worktrees?repoPath=... - List worktrees
    if (req.method === 'GET' && pathname === '/api/worktrees') {
      const repoPath = url.searchParams.get('repoPath');
      if (!repoPath) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'Missing repoPath parameter' }));
        return;
      }

      try {
        const output = execFileAsync('git', ['worktree', 'list', '--porcelain'], {
          cwd: repoPath,
          timeout: 5000,
          windowsHide: true,
        });

        const result = await output;
        const rawOutput = result.stdout;

        // Build active session CWDs
        const activeCwds = new Set<string>();
        const savedSessions = loadSessionsFromDisk();
        const activePtys = getPtyProcesses();
        for (const [sessionId] of activePtys) {
          const session = savedSessions.find(s => s.sessionId === sessionId);
          if (session) {
            activeCwds.add(path.resolve(session.workingDirectory));
          }
        }

        // Parse porcelain output
        const worktrees: WorktreeInfo[] = [];
        const blocks = rawOutput.trim().split('\n\n');
        for (const block of blocks) {
          if (!block.trim()) continue;
          const lines = block.trim().split('\n');
          let wtPath = '';
          let commit = '';
          let branch = '';

          for (const line of lines) {
            if (line.startsWith('worktree ')) {
              wtPath = line.substring('worktree '.length).trim();
            } else if (line.startsWith('HEAD ')) {
              commit = line.substring('HEAD '.length).trim().substring(0, 7);
            } else if (line.startsWith('branch ')) {
              branch = line.substring('branch '.length).trim().replace('refs/heads/', '');
            } else if (line.trim() === 'detached') {
              branch = '(detached)';
            }
          }
          if (!wtPath) continue;

          const normalized = path.resolve(wtPath);
          worktrees.push({
            path: normalized,
            branch: branch || '(unknown)',
            commit,
            isMain: worktrees.length === 0,
            hasSession: activeCwds.has(normalized),
          });
        }

        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(worktrees));
      } catch (error: any) {
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: error.message || 'Failed to list worktrees' }));
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

    // GET /api/audit/projects - Discover Claude project paths from ~/.claude/projects/
    if (req.method === 'GET' && pathname === '/api/audit/projects') {
      try {
        const projects = discoverClaudeProjects();
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(projects));
      } catch (err) {
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // GET /api/audit/run?path=<encoded> - Run heuristic audit for a project path
    if (req.method === 'GET' && pathname === '/api/audit/run') {
      const projectPath = url.searchParams.get('path') ?? '';
      if (!projectPath) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'path parameter required' }));
        return;
      }
      try {
        const result = runProjectAudit(projectPath);
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // GET /api/deep-audit/run?path=<encoded> - Run LLM-based deep audit with SSE progress
    if (req.method === 'GET' && pathname === '/api/deep-audit/run') {
      const projectPath = url.searchParams.get('path') ?? '';
      if (!projectPath) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'path parameter required' }));
        return;
      }

      // SSE headers for streaming progress
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      try {
        const result = await runDeepAudit(projectPath, (progress) => {
          res.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
        });
        res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
      } catch (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
      }
      res.end();
      return;
    }

    // POST /api/deep-audit/cancel - Cancel a running deep audit
    if (req.method === 'POST' && pathname === '/api/deep-audit/cancel') {
      const cancelled = cancelDeepAudit();
      res.writeHead(200, corsHeaders);
      res.end(JSON.stringify({ cancelled }));
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

    // GET /api/groups - Load session groups
    if (req.method === 'GET' && pathname === '/api/groups') {
      try {
        const filePath = path.join(app.getPath('userData'), 'groups.json');
        const groups = loadGroupsFromFile(filePath);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(groups));
      } catch (error) {
        console.error('[HTTP] GET /api/groups error:', error);
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // POST /api/groups - Save session groups
    if (req.method === 'POST' && pathname === '/api/groups') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const groups = JSON.parse(body);
          const filePath = path.join(app.getPath('userData'), 'groups.json');
          saveGroupsToFile(filePath, groups);
          res.writeHead(200, corsHeaders);
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          console.error('[HTTP] POST /api/groups error:', error);
          res.writeHead(500, corsHeaders);
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
      return;
    }

    // GET /api/templates - List all session templates
    if (req.method === 'GET' && pathname === '/api/templates') {
      try {
        const templates = loadTemplatesFromDisk();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify(templates));
      } catch (error) {
        console.error('[HTTP] GET /api/templates error:', error);
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    // POST /api/templates - Save (create/update) a session template
    if (req.method === 'POST' && pathname === '/api/templates') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const template: SessionTemplate = JSON.parse(body);

          if (!template.id || !template.name) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: 'Missing required fields: id, name' }));
            return;
          }

          const templates = loadTemplatesFromDisk();
          const existingIndex = templates.findIndex(t => t.id === template.id);

          if (existingIndex >= 0) {
            templates[existingIndex] = template;
          } else {
            templates.push(template);
          }

          saveTemplatesToDisk(templates);

          res.writeHead(200, corsHeaders);
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          console.error('[HTTP] POST /api/templates error:', error);
          res.writeHead(500, corsHeaders);
          res.end(JSON.stringify({ success: false, error: String(error) }));
        }
      });
      return;
    }

    // POST /api/worktrees - Create a new worktree
    if (req.method === 'POST' && pathname === '/api/worktrees') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const options: WorktreeCreateOptions = JSON.parse(body);

          if (!options.repoPath || !options.branchName) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: 'Missing repoPath or branchName' }));
            return;
          }

          // Find the main worktree root
          const listResult = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
            cwd: options.repoPath,
            timeout: 5000,
            windowsHide: true,
          });
          const mainRoot = listResult.stdout.split('\n')[0].replace('worktree ', '').trim();
          const worktreeDir = path.join(mainRoot, '.worktrees');

          if (!fs.existsSync(worktreeDir)) {
            fs.mkdirSync(worktreeDir, { recursive: true });
          }

          const dirName = options.branchName.replace(/\//g, '-');
          const worktreePath = path.join(worktreeDir, dirName);

          let args: string[];
          if (options.useExistingBranch) {
            args = ['worktree', 'add', worktreePath, options.branchName];
          } else {
            args = ['worktree', 'add', '-b', options.branchName, worktreePath];
            if (options.baseBranch) {
              args.push(options.baseBranch);
            }
          }

          await execFileAsync('git', args, {
            cwd: options.repoPath,
            timeout: 10000,
            windowsHide: true,
          });

          const commitResult = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: worktreePath,
            timeout: 5000,
            windowsHide: true,
          });

          const info: WorktreeInfo = {
            path: path.resolve(worktreePath),
            branch: options.branchName,
            commit: commitResult.stdout.trim(),
            isMain: false,
            hasSession: false,
          };

          res.writeHead(201, corsHeaders);
          res.end(JSON.stringify(info));
        } catch (error: any) {
          res.writeHead(500, corsHeaders);
          res.end(JSON.stringify({ error: error.message || 'Failed to create worktree' }));
        }
      });
      return;
    }

    // DELETE /api/templates?id=... - Delete a session template
    if (req.method === 'DELETE' && pathname === '/api/templates') {
      const templateId = url.searchParams.get('id');
      if (!templateId) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'Missing id query parameter' }));
        return;
      }

      try {
        const templates = loadTemplatesFromDisk();
        const filtered = templates.filter(t => t.id !== templateId);
        saveTemplatesToDisk(filtered);

        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        console.error('[HTTP] DELETE /api/templates error:', error);
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ success: false, error: String(error) }));
      }
      return;
    }

    // DELETE /api/worktrees?path=... - Delete a worktree
    if (req.method === 'DELETE' && pathname === '/api/worktrees') {
      const wtPath = url.searchParams.get('path');
      if (!wtPath) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'Missing path parameter' }));
        return;
      }

      const repoParam = url.searchParams.get('repoPath');

      // Determine repo root: prefer explicit param, fall back to path walking
      let repoRoot: string | null = repoParam || null;
      if (!repoRoot) {
        let dir = path.dirname(wtPath);
        while (dir !== path.dirname(dir)) {
          if (fs.existsSync(path.join(dir, '.git'))) {
            repoRoot = dir;
            break;
          }
          dir = path.dirname(dir);
        }
      }

      try {
        await execFileAsync('git', ['worktree', 'remove', wtPath, '--force'], {
          cwd: repoRoot || undefined,
          timeout: 10000,
          windowsHide: true,
        });

        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
      } catch (error: any) {
        // Stale worktree (directory gone) — prune instead
        if (repoRoot && (error.message?.includes('is not a working tree') || error.message?.includes('does not exist'))) {
          try {
            await execFileAsync('git', ['worktree', 'prune'], { cwd: repoRoot, timeout: 10000, windowsHide: true });
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify({ success: true }));
            return;
          } catch { /* fall through */ }
        }
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ error: error.message || 'Failed to delete worktree' }));
      }
      return;
    }

    // GET /api/review/diff?cwd=<path> - Get full unified diff of all uncommitted changes
    if (req.method === 'GET' && pathname === '/api/review/diff') {
      const cwd = url.searchParams.get('cwd');
      if (!cwd) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ diff: '', error: 'Missing cwd parameter' }));
        return;
      }
      try {
        const result = await execFileAsync(
          'git',
          ['diff', 'HEAD', '--unified=3'],
          {
            cwd,
            timeout: 15000,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
          }
        );

        let diff = result.stdout;

        if (!diff.trim()) {
          // Fallback: check staged-only changes (repo with no prior commits)
          const cached = await execFileAsync(
            'git',
            ['diff', '--cached', '--unified=3'],
            {
              cwd,
              timeout: 15000,
              windowsHide: true,
              maxBuffer: 10 * 1024 * 1024,
            }
          );
          diff = cached.stdout;
        }

        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ diff }));
      } catch (error: any) {
        console.warn(`[HTTP] GET /api/review/diff failed for ${cwd}: ${error.message}`);
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ diff: '', error: error.message }));
      }
      return;
    }

    // POST /api/review/reject-hunk - Revert a single hunk via git apply --reverse
    if (req.method === 'POST' && pathname === '/api/review/reject-hunk') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { cwd, patchContent } = JSON.parse(body);

          if (!cwd || !patchContent) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ success: false, error: 'Missing cwd or patchContent' }));
            return;
          }

          const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
            const proc = spawn(
              'git',
              ['apply', '--reverse', '--unidiff-zero'],
              { cwd, windowsHide: true }
            );

            let stderr = '';
            proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            proc.on('close', (code: number | null) => {
              if (code === 0) {
                resolve({ success: true });
              } else {
                resolve({ success: false, error: stderr.trim() || `Exit code ${code}` });
              }
            });

            proc.on('error', (err: Error) => {
              resolve({ success: false, error: err.message });
            });

            proc.stdin.write(patchContent);
            proc.stdin.end();
          });

          res.writeHead(200, corsHeaders);
          res.end(JSON.stringify(result));
        } catch (error: any) {
          console.error('[HTTP] POST /api/review/reject-hunk error:', error.message);
          res.writeHead(500, corsHeaders);
          res.end(JSON.stringify({ success: false, error: String(error) }));
        }
      });
      return;
    }

    // POST /api/review/reject-file - Revert all changes to a file via git checkout HEAD
    if (req.method === 'POST' && pathname === '/api/review/reject-file') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { cwd, filePath: fileToRevert } = JSON.parse(body);

          if (!cwd || !fileToRevert) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ success: false, error: 'Missing cwd or filePath' }));
            return;
          }

          await execFileAsync(
            'git',
            ['checkout', 'HEAD', '--', fileToRevert],
            { cwd, timeout: 5000, windowsHide: true }
          );

          res.writeHead(200, corsHeaders);
          res.end(JSON.stringify({ success: true }));
        } catch (error: any) {
          console.error('[HTTP] POST /api/review/reject-file error:', error.message);
          res.writeHead(500, corsHeaders);
          res.end(JSON.stringify({ success: false, error: error.message }));
        }
      });
      return;
    }

    // POST /api/review/apply-patch - Apply a patch directly (forward, used for undo)
    if (req.method === 'POST' && pathname === '/api/review/apply-patch') {
      let body = '';
      req.on('data', (chunk: string) => body += chunk);
      req.on('end', async () => {
        try {
          const { cwd, patchContent } = JSON.parse(body);

          if (!cwd || !patchContent) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ success: false, error: 'Missing cwd or patchContent' }));
            return;
          }

          const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
            const proc = spawn(
              'git',
              ['apply', '--unidiff-zero'],
              { cwd, windowsHide: true }
            );

            let stderr = '';
            proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            proc.on('close', (code: number | null) => {
              if (code === 0) {
                resolve({ success: true });
              } else {
                resolve({ success: false, error: stderr.trim() || `Exit code ${code}` });
              }
            });

            proc.on('error', (err: Error) => {
              resolve({ success: false, error: err.message });
            });

            proc.stdin.write(patchContent);
            proc.stdin.end();
          });

          res.writeHead(200, corsHeaders);
          res.end(JSON.stringify(result));
        } catch (error: any) {
          console.error('[HTTP] POST /api/review/apply-patch error:', error.message);
          res.writeHead(500, corsHeaders);
          res.end(JSON.stringify({ success: false, error: String(error) }));
        }
      });
      return;
    }

    // DELETE /api/sessions?id=<sessionId> - Kill/remove a session
    if (req.method === 'DELETE' && pathname === '/api/sessions') {
      const sessionId = url.searchParams.get('id') ?? '';
      if (!sessionId) {
        res.writeHead(400, corsHeaders);
        res.end(JSON.stringify({ error: 'Missing session id' }));
        return;
      }

      const ptyProcess = getPtyProcesses().get(sessionId);
      if (!ptyProcess) {
        res.writeHead(404, corsHeaders);
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      try {
        ptyProcess.kill();
        res.writeHead(200, corsHeaders);
        res.end(JSON.stringify({ success: true }));
      } catch (error: any) {
        res.writeHead(500, corsHeaders);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // POST /api/pty/write - Write data to a PTY session
    if (req.method === 'POST' && pathname === '/api/pty/write') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { sessionId, data } = JSON.parse(body);
          if (!sessionId || data === undefined) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: 'Missing sessionId or data' }));
            return;
          }

          const ptyProcess = getPtyProcesses().get(sessionId);
          if (!ptyProcess) {
            res.writeHead(404, corsHeaders);
            res.end(JSON.stringify({ error: 'Session not found' }));
            return;
          }

          ptyProcess.write(data);
          res.writeHead(200, corsHeaders);
          res.end(JSON.stringify({ success: true }));
        } catch (error: any) {
          res.writeHead(500, corsHeaders);
          res.end(JSON.stringify({ error: error.message }));
        }
      });
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
