/**
 * Circular buffer for terminal scrollback management.
 *
 * Implements a fixed-size circular buffer to prevent unbounded memory growth
 * from terminal output. When the buffer reaches capacity, oldest lines are
 * overwritten automatically.
 *
 * Per RESEARCH.md Pattern 5 (Circular Buffer for Scrollback).
 *
 * @example
 * const buffer = new ScrollbackBuffer(10000);
 * buffer.append('First line\n');
 * buffer.append('Second line\n');
 * const lines = buffer.getLines(); // ['First line\n', 'Second line\n']
 */
export class ScrollbackBuffer {
  /**
   * Internal buffer array storing terminal output lines.
   */
  private buffer: string[] = [];

  /**
   * Maximum number of lines to store before wrapping.
   */
  private readonly maxLines: number;

  /**
   * Current write position in the circular buffer.
   * When buffer is full, this points to the oldest line (next to overwrite).
   */
  private head = 0;

  /**
   * Flag indicating whether the buffer has reached capacity.
   * Once true, buffer operates in circular mode (overwrites oldest).
   */
  private isFull = false;

  /**
   * Create a new scrollback buffer with a maximum line limit.
   *
   * @param maxLines - Maximum number of lines to store (default: 10000)
   *
   * @example
   * const buffer = new ScrollbackBuffer(5000); // 5k line limit
   */
  constructor(maxLines = 10000) {
    this.maxLines = maxLines;
  }

  /**
   * Append a line to the buffer.
   *
   * If buffer is not full, line is pushed to the end.
   * If buffer is full, line overwrites the oldest entry at head position,
   * and head advances with modulo arithmetic.
   *
   * @param line - Terminal output line to append (typically includes newline)
   *
   * @example
   * buffer.append('user@host:~$ ls\n');
   * buffer.append('file1.txt  file2.txt\n');
   */
  append(line: string): void {
    if (!this.isFull) {
      // Buffer still has space - push to end
      this.buffer.push(line);

      // Check if we've reached capacity
      if (this.buffer.length >= this.maxLines) {
        this.isFull = true;
        this.head = 0; // Start overwriting from the beginning
      }
    } else {
      // Buffer is full - overwrite oldest line at head position
      this.buffer[this.head] = line;

      // Advance head with modulo (circular wrap)
      this.head = (this.head + 1) % this.maxLines;
    }
  }

  /**
   * Get all buffered lines in chronological order.
   *
   * If buffer is not full, returns lines in insertion order.
   * If buffer is full, returns lines starting from oldest (head position)
   * to newest, reconstructing chronological order.
   *
   * @returns Array of buffered lines in chronological order
   *
   * @example
   * const lines = buffer.getLines();
   * // Render lines to terminal UI
   * terminalElement.textContent = lines.join('');
   */
  getLines(): string[] {
    if (!this.isFull) {
      // Buffer not full - return as-is
      return this.buffer;
    } else {
      // Buffer full - reconstruct chronological order
      // Start from head (oldest) to end, then beginning to head-1 (newest)
      return [
        ...this.buffer.slice(this.head),
        ...this.buffer.slice(0, this.head)
      ];
    }
  }

  /**
   * Clear all buffered content and reset to empty state.
   *
   * @example
   * buffer.clear();
   * console.log(buffer.getLines()); // []
   */
  clear(): void {
    this.buffer = [];
    this.head = 0;
    this.isFull = false;
  }

  /**
   * Get the current number of lines stored in the buffer.
   *
   * @returns Number of lines currently buffered (0 to maxLines)
   */
  getLineCount(): number {
    return this.buffer.length;
  }

  /**
   * Check if the buffer has reached capacity.
   *
   * @returns True if buffer is full and operating in circular mode
   */
  isBufferFull(): boolean {
    return this.isFull;
  }
}
