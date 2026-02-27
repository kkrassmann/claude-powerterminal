/**
 * Parse git status --porcelain output to count changes.
 * Format: XY PATH, where X is index status, Y is working tree status.
 *
 * Shared between IPC git-handlers and HTTP static-server.
 */
export function parseGitStatus(porcelain: string): { added: number; modified: number; deleted: number } {
  const lines = porcelain.trim().split('\n').filter(line => line.length > 0);
  let added = 0, modified = 0, deleted = 0;
  for (const line of lines) {
    if (line.length < 2) continue;
    const x = line[0], y = line[1];
    if (x === '?' || y === '?' || x === 'A' || y === 'A') added++;
    else if (x === 'M' || y === 'M') modified++;
    else if (x === 'D' || y === 'D') deleted++;
  }
  return { added, modified, deleted };
}
