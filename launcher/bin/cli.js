#!/usr/bin/env node
'use strict';

const { getPlatform } = require('../lib/platform');
const { isCached, getCachedBinaryPath, clearCache } = require('../lib/cache');
const { downloadBinary } = require('../lib/downloader');
const { launchBinary } = require('../lib/launcher');

// Read version from launcher's own package.json
const pkg = require('../package.json');
const VERSION = pkg.version;

async function main() {
  const args = process.argv.slice(2);

  // Handle --version
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`claude-powerterminal v${VERSION}`);
    return;
  }

  // Handle --clear-cache
  if (args.includes('--clear-cache')) {
    clearCache();
    return;
  }

  // Detect platform
  let platform;
  try {
    platform = getPlatform();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const artifactName = platform.artifactName(VERSION);
  const executableName = platform.executable(VERSION);

  // Check cache
  if (isCached(VERSION, executableName)) {
    const binaryPath = getCachedBinaryPath(VERSION, executableName);
    console.log(`Claude PowerTerminal v${VERSION} (cached)`);
    launchBinary(binaryPath, args);
    return;
  }

  // Download
  console.log(`Claude PowerTerminal v${VERSION}`);
  console.log(`  Platform: ${platform.key}`);
  console.log('');

  try {
    const binaryPath = await downloadBinary(VERSION, artifactName);
    console.log('');
    launchBinary(binaryPath, args);
  } catch (err) {
    console.error(`\nDownload failed: ${err.message}`);
    console.error(`\nYou can download manually from:`);
    console.error(`  https://github.com/kkrassmann/claude-powerterminal/releases/tag/v${VERSION}`);
    process.exit(1);
  }
}

main();
