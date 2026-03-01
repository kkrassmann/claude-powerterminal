#!/usr/bin/env node

/**
 * Pre-release check: verify all require() paths in dist/electron/
 * resolve to files included in electron-builder's files list.
 *
 * Included directories: dist/electron/, dist/src/shared/
 * Everything else will cause a runtime crash in the packaged app.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function walk(dir) {
  let results = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) results = results.concat(walk(full));
    else if (f.endsWith('.js')) results.push(full);
  }
  return results;
}

const distDir = path.resolve(__dirname, '..', 'dist');
const electronDir = path.join(distDir, 'electron');

if (!fs.existsSync(electronDir)) {
  console.error('ERROR: dist/electron/ does not exist. Run npm run build:electron first.');
  process.exit(1);
}

const files = walk(electronDir);
const issues = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const requirePattern = /require\(["']([^"']+)["']\)/g;
  let match;
  while ((match = requirePattern.exec(content)) !== null) {
    const mod = match[1];
    if (!mod.startsWith('.')) continue; // skip node_modules

    const resolved = path.resolve(path.dirname(file), mod);
    const relFromDist = path.relative(distDir, resolved).split(path.sep).join('/');

    // Allowed: electron/**, src/shared/**
    if (!relFromDist.startsWith('electron/') && !relFromDist.startsWith('src/shared/')) {
      issues.push({
        file: path.relative(distDir, file).split(path.sep).join('/'),
        requires: mod,
        resolvedTo: relFromDist,
      });
    }
  }
}

if (issues.length === 0) {
  console.log('OK: All require() paths resolve within packaged directories.');
  process.exit(0);
} else {
  console.error(`FAIL: ${issues.length} require() path(s) resolve outside packaged directories:\n`);
  for (const issue of issues) {
    console.error(`  ${issue.file}`);
    console.error(`    requires: ${issue.requires}`);
    console.error(`    resolves to: ${issue.resolvedTo}\n`);
  }
  console.error('These modules will NOT be found in the packaged app.');
  console.error('Fix: Move them to src/shared/ or electron/.');
  process.exit(1);
}
