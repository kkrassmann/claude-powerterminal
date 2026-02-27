import { describe, it, expect } from 'vitest';
import { parseGitStatus } from './git-status-parser';

describe('parseGitStatus', () => {
  it('returns zeros for empty input', () => {
    expect(parseGitStatus('')).toEqual({ added: 0, modified: 0, deleted: 0 });
  });

  it('returns zeros for whitespace-only input', () => {
    expect(parseGitStatus('  \n  ')).toEqual({ added: 0, modified: 0, deleted: 0 });
  });

  it('counts untracked files as added', () => {
    const input = '?? file.txt\n?? another.txt';
    expect(parseGitStatus(input)).toEqual({ added: 2, modified: 0, deleted: 0 });
  });

  it('counts staged new files as added', () => {
    const input = 'A  newfile.ts';
    expect(parseGitStatus(input)).toEqual({ added: 1, modified: 0, deleted: 0 });
  });

  it('counts modified files in index', () => {
    const input = 'M  changed.ts';
    expect(parseGitStatus(input)).toEqual({ added: 0, modified: 1, deleted: 0 });
  });

  it('counts modified files in working tree', () => {
    const input = ' M changed.ts';
    expect(parseGitStatus(input)).toEqual({ added: 0, modified: 1, deleted: 0 });
  });

  it('counts deleted files', () => {
    const input = ' D removed.ts\nD  also-gone.ts';
    expect(parseGitStatus(input)).toEqual({ added: 0, modified: 0, deleted: 2 });
  });

  it('handles mixed status output', () => {
    const input = [
      '?? untracked.txt',
      'M  staged-modified.ts',
      ' M unstaged-modified.ts',
      'A  new-file.ts',
      ' D deleted.ts',
    ].join('\n');
    expect(parseGitStatus(input)).toEqual({ added: 2, modified: 2, deleted: 1 });
  });

  it('skips lines shorter than 2 chars', () => {
    const input = 'X\n?? valid.txt';
    expect(parseGitStatus(input)).toEqual({ added: 1, modified: 0, deleted: 0 });
  });

  it('ignores rename/copy and other statuses', () => {
    // R = rename, C = copy — not counted in any category
    const input = 'R  old.ts -> new.ts\nC  src.ts -> dst.ts';
    expect(parseGitStatus(input)).toEqual({ added: 0, modified: 0, deleted: 0 });
  });
});
