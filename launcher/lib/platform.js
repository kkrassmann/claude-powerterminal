'use strict';

const os = require('os');

/**
 * Map of supported platform+arch combinations to artifact details.
 */
const PLATFORMS = {
  'win32-x64': {
    artifactName: (version) => `claude-powerterminal-${version}-win-x64.exe`,
    executable: (version) => `claude-powerterminal-${version}-win-x64.exe`,
  },
  'linux-x64': {
    artifactName: (version) => `claude-powerterminal-${version}-linux-x64.AppImage`,
    executable: (version) => `claude-powerterminal-${version}-linux-x64.AppImage`,
  },
  'darwin-x64': {
    artifactName: (version) => `claude-powerterminal-${version}-mac-x64.zip`,
    executable: () => `Claude PowerTerminal.app/Contents/MacOS/Claude PowerTerminal`,
    extract: true,
  },
  'darwin-arm64': {
    artifactName: (version) => `claude-powerterminal-${version}-mac-arm64.zip`,
    executable: () => `Claude PowerTerminal.app/Contents/MacOS/Claude PowerTerminal`,
    extract: true,
  },
};

/**
 * Get platform info for the current system.
 * @returns {{ key: string, artifactName: function, executable: function }}
 * @throws {Error} if platform is not supported
 */
function getPlatform() {
  const platform = os.platform();
  const arch = os.arch();
  const key = `${platform}-${arch}`;
  const info = PLATFORMS[key];

  if (!info) {
    const supported = Object.keys(PLATFORMS).map(k => k.replace('-', ' ')).join(', ');
    throw new Error(
      `Unsupported platform: ${platform} ${arch}\n` +
      `Supported: ${supported}`
    );
  }

  return { key, ...info };
}

module.exports = { getPlatform };
