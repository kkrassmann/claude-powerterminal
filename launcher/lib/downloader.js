'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { ensureCacheDir, getCachedBinaryPath } = require('./cache');

const GITHUB_OWNER = 'kkrassmann';
const GITHUB_REPO = 'claude-powerterminal';

/**
 * Build the GitHub Releases download URL for an artifact.
 * @param {string} version - e.g. "1.0.0"
 * @param {string} artifactName - e.g. "claude-powerterminal-1.0.0-win-x64.exe"
 * @returns {string}
 */
function getDownloadUrl(version, artifactName) {
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/v${version}/${artifactName}`;
}

/**
 * Follow redirects and download a file with progress display.
 * GitHub Releases redirects to S3, so we need to handle 302s.
 *
 * @param {string} url
 * @param {string} destPath
 * @param {number} [maxRedirects=5]
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects'));
    }

    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { 'User-Agent': 'claude-powerterminal-launcher' },
    };

    https.get(options, (res) => {
      // Handle redirects (GitHub → S3)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(res.headers.location, destPath, maxRedirects - 1)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`));
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;
      let lastPercent = -1;

      const tmpPath = destPath + '.tmp';
      const file = fs.createWriteStream(tmpPath);

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const percent = Math.floor((downloadedBytes / totalBytes) * 100);
          if (percent !== lastPercent) {
            lastPercent = percent;
            const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
            const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
            process.stdout.write(`\r  Downloading: ${percent}% (${mb}/${totalMb} MB)`);
          }
        } else {
          const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
          process.stdout.write(`\r  Downloading: ${mb} MB`);
        }
      });

      res.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          process.stdout.write('\n');
          // Rename tmp to final (atomic on most filesystems)
          fs.renameSync(tmpPath, destPath);
          resolve();
        });
      });

      file.on('error', (err) => {
        fs.unlink(tmpPath, () => {});
        reject(err);
      });
    }).on('error', reject);
  });
}

/**
 * Download the binary for the given version and platform.
 * @param {string} version
 * @param {string} artifactName
 * @returns {Promise<string>} Path to the downloaded binary
 */
async function downloadBinary(version, artifactName) {
  ensureCacheDir(version);
  const destPath = getCachedBinaryPath(version, artifactName);
  const url = getDownloadUrl(version, artifactName);

  console.log(`  Downloading Claude PowerTerminal v${version}...`);
  console.log(`  From: ${url}`);

  await downloadFile(url, destPath);

  // Make executable on Linux
  if (process.platform !== 'win32') {
    fs.chmodSync(destPath, 0o755);
  }

  return destPath;
}

module.exports = { downloadBinary, getDownloadUrl };
