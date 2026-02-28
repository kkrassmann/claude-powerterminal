'use strict';

const { spawn } = require('child_process');

/**
 * Launch the binary and forward stdio.
 * Exits the launcher process with the same exit code as the app.
 *
 * @param {string} binaryPath - Absolute path to the executable
 * @param {string[]} args - Extra arguments to pass through
 */
function launchBinary(binaryPath, args = []) {
  const child = spawn(binaryPath, args, {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });

  child.on('error', (err) => {
    console.error(`Failed to start Claude PowerTerminal: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // Forward SIGINT/SIGTERM to child
  const forwardSignal = (signal) => {
    if (child.pid) {
      process.kill(child.pid, signal);
    }
  };
  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
}

module.exports = { launchBinary };
