'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

const APP_NAME = 'claude-powerterminal';

/**
 * Get the cache directory for the current platform.
 * - Windows: %LOCALAPPDATA%/claude-powerterminal/cache/
 * - Linux:   ~/.cache/claude-powerterminal/
 */
function getCacheDir() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, APP_NAME, 'cache');
  }
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, APP_NAME);
}

/**
 * Get the full path to the cached binary for a given version.
 * @param {string} version
 * @param {string} filename
 * @returns {string}
 */
function getCachedBinaryPath(version, filename) {
  return path.join(getCacheDir(), version, filename);
}

/**
 * Check if a binary is already cached for the given version.
 * @param {string} version
 * @param {string} filename
 * @returns {boolean}
 */
function isCached(version, filename) {
  return fs.existsSync(getCachedBinaryPath(version, filename));
}

/**
 * Ensure the cache directory for a version exists.
 * @param {string} version
 */
function ensureCacheDir(version) {
  const dir = path.join(getCacheDir(), version);
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Remove the entire cache directory.
 */
function clearCache() {
  const dir = getCacheDir();
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`Cache cleared: ${dir}`);
  } else {
    console.log('Cache is already empty.');
  }
}

module.exports = { getCacheDir, getCachedBinaryPath, isCached, ensureCacheDir, clearCache };
