/**
 * HTTP static file server for serving Angular build output to remote browsers.
 *
 * Serves files from the Angular dist directory on all network interfaces (0.0.0.0),
 * enabling LAN access from phones/tablets. Implements SPA fallback for Angular routing.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

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
  const buildDir = path.join(__dirname, '../../src/dist/claude-powerterminal-angular/browser');

  const server = http.createServer((req, res) => {
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
