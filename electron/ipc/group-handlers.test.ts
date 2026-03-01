/**
 * Tests for group persistence (save/load groups.json).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadGroupsFromFile, saveGroupsToFile } from './group-handlers';
import { SessionGroup } from '../../src/shared/group-types';

let tmpDir: string;
let groupsFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-handlers-test-'));
  groupsFile = path.join(tmpDir, 'groups.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadGroupsFromFile', () => {
  it('should return empty array when file does not exist', () => {
    const result = loadGroupsFromFile(groupsFile);
    expect(result).toEqual([]);
  });

  it('should return empty array for invalid JSON', () => {
    fs.writeFileSync(groupsFile, '{not valid json!!!', 'utf-8');
    const result = loadGroupsFromFile(groupsFile);
    expect(result).toEqual([]);
  });

  it('should load saved groups with all fields', () => {
    const groups: SessionGroup[] = [
      { name: 'Frontend', color: '#89b4fa', sessionIds: ['sess-1', 'sess-2'] },
      { name: 'Backend', color: '#a6e3a1', sessionIds: [] },
    ];
    fs.writeFileSync(groupsFile, JSON.stringify(groups), 'utf-8');

    const result = loadGroupsFromFile(groupsFile);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Frontend');
    expect(result[0].color).toBe('#89b4fa');
    expect(result[0].sessionIds).toEqual(['sess-1', 'sess-2']);
    expect(result[1].name).toBe('Backend');
    expect(result[1].sessionIds).toEqual([]);
  });
});

describe('saveGroupsToFile', () => {
  it('should create file and parent directories', () => {
    const nested = path.join(tmpDir, 'sub', 'dir', 'groups.json');
    const groups: SessionGroup[] = [
      { name: 'Test', color: '#f38ba8', sessionIds: ['a'] },
    ];

    saveGroupsToFile(nested, groups);

    expect(fs.existsSync(nested)).toBe(true);
    const loaded = JSON.parse(fs.readFileSync(nested, 'utf-8'));
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Test');
  });

  it('should overwrite existing file', () => {
    const v1: SessionGroup[] = [{ name: 'Old', color: '#ccc', sessionIds: [] }];
    const v2: SessionGroup[] = [{ name: 'New', color: '#fff', sessionIds: ['x'] }];

    saveGroupsToFile(groupsFile, v1);
    saveGroupsToFile(groupsFile, v2);

    const loaded = loadGroupsFromFile(groupsFile);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('New');
    expect(loaded[0].sessionIds).toEqual(['x']);
  });

  it('should save empty array', () => {
    saveGroupsToFile(groupsFile, []);
    const loaded = loadGroupsFromFile(groupsFile);
    expect(loaded).toEqual([]);
  });
});

describe('round-trip persistence', () => {
  it('should preserve sessionIds across save and load', () => {
    const groups: SessionGroup[] = [
      { name: 'Coredinate', color: '#89b4fa', sessionIds: ['s1', 's2', 's3'] },
      { name: 'PowerTerminal', color: '#a6e3a1', sessionIds: ['s4'] },
    ];

    saveGroupsToFile(groupsFile, groups);
    const loaded = loadGroupsFromFile(groupsFile);

    expect(loaded).toEqual(groups);
  });

  it('should handle special characters in group names', () => {
    const groups: SessionGroup[] = [
      { name: 'Über-Group & Co.', color: '#cba6f7', sessionIds: [] },
      { name: '日本語グループ', color: '#f9e2af', sessionIds: ['s1'] },
    ];

    saveGroupsToFile(groupsFile, groups);
    const loaded = loadGroupsFromFile(groupsFile);

    expect(loaded[0].name).toBe('Über-Group & Co.');
    expect(loaded[1].name).toBe('日本語グループ');
  });
});
