import { describe, it, expect, beforeEach } from 'vitest';
import { ScrollbackBuffer } from './scrollback-buffer';

describe('ScrollbackBuffer', () => {
  let buf: ScrollbackBuffer;

  beforeEach(() => {
    buf = new ScrollbackBuffer(5); // small max for easy testing
  });

  // ---- Basic append / read ----

  it('starts empty', () => {
    expect(buf.getLines()).toEqual([]);
    expect(buf.getLineCount()).toBe(0);
  });

  it('append() adds a single line', () => {
    buf.append('hello\n');
    expect(buf.getLines()).toEqual(['hello\n']);
    expect(buf.getLineCount()).toBe(1);
  });

  it('append() adds multiple lines in order', () => {
    buf.append('a\n');
    buf.append('b\n');
    buf.append('c\n');
    expect(buf.getLines()).toEqual(['a\n', 'b\n', 'c\n']);
  });

  it('getLineCount() tracks count accurately up to capacity', () => {
    for (let i = 0; i < 5; i++) buf.append(`line${i}\n`);
    expect(buf.getLineCount()).toBe(5);
  });

  // ---- isBufferFull ----

  it('isBufferFull() is false while under capacity', () => {
    buf.append('x\n');
    expect(buf.isBufferFull()).toBe(false);
  });

  it('isBufferFull() becomes true when capacity is reached', () => {
    for (let i = 0; i < 5; i++) buf.append(`line${i}\n`);
    expect(buf.isBufferFull()).toBe(true);
  });

  // ---- Circular wrap behaviour ----

  it('wraps and overwrites oldest line when capacity exceeded', () => {
    for (let i = 0; i < 5; i++) buf.append(`line${i}\n`);
    buf.append('line5\n'); // pushes out 'line0\n'
    const lines = buf.getLines();
    expect(lines).not.toContain('line0\n');
    expect(lines).toContain('line5\n');
    expect(lines.length).toBe(5);
  });

  it('returns lines in chronological order after wrap', () => {
    for (let i = 0; i < 5; i++) buf.append(`${i}\n`);
    buf.append('5\n'); // wraps: oldest is '1\n' ... '5\n'
    buf.append('6\n'); // oldest is '2\n' ... '6\n'
    const lines = buf.getLines();
    // Chronological: 2,3,4,5,6
    expect(lines).toEqual(['2\n', '3\n', '4\n', '5\n', '6\n']);
  });

  it('getLineCount() stays at maxLines after overflow', () => {
    for (let i = 0; i < 10; i++) buf.append(`line${i}\n`); // 10 > maxLines(5)
    expect(buf.getLineCount()).toBe(5);
  });

  // ---- clear() ----

  it('clear() empties the buffer', () => {
    buf.append('a\n');
    buf.append('b\n');
    buf.clear();
    expect(buf.getLines()).toEqual([]);
    expect(buf.getLineCount()).toBe(0);
  });

  it('clear() resets isFull flag', () => {
    for (let i = 0; i < 5; i++) buf.append(`${i}\n`);
    expect(buf.isBufferFull()).toBe(true);
    buf.clear();
    expect(buf.isBufferFull()).toBe(false);
  });

  it('allows normal appending after clear()', () => {
    for (let i = 0; i < 5; i++) buf.append(`${i}\n`);
    buf.clear();
    buf.append('fresh\n');
    expect(buf.getLines()).toEqual(['fresh\n']);
  });

  // ---- getContent() — not explicitly exported but can be derived; test via getLines().join ----

  it('getLines().join("") reconstructs full content', () => {
    buf.append('foo\n');
    buf.append('bar\n');
    expect(buf.getLines().join('')).toBe('foo\nbar\n');
  });

  // ---- Edge cases ----

  it('handles appending empty string', () => {
    buf.append('');
    expect(buf.getLineCount()).toBe(1);
    expect(buf.getLines()).toEqual(['']);
  });

  it('default maxLines is 10000', () => {
    const defaultBuf = new ScrollbackBuffer();
    for (let i = 0; i < 100; i++) defaultBuf.append(`line${i}\n`);
    expect(defaultBuf.isBufferFull()).toBe(false);
    expect(defaultBuf.getLineCount()).toBe(100);
  });

  it('buffer with maxLines=1 always keeps only the last line', () => {
    const tiny = new ScrollbackBuffer(1);
    tiny.append('first\n');
    tiny.append('second\n');
    expect(tiny.getLines()).toEqual(['second\n']);
    expect(tiny.getLineCount()).toBe(1);
  });
});
