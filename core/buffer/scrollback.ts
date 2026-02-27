/**
 * Scrollback — ring buffer of scrolled-off terminal lines.
 *
 * Provides O(1) push and O(1) random access. When the buffer
 * exceeds maxSize, the oldest line is overwritten.
 */

import { TerminalLine } from './line';

export interface SearchMatch {
  lineIndex: number;
  startCol: number;
  endCol: number;
}

export class Scrollback {
  private buffer: (TerminalLine | undefined)[];
  private head: number;
  private count: number;
  private maxSize: number;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
    this.buffer = new Array(maxSize);
    this.head = 0;
    this.count = 0;
  }

  /** Push a line to the scrollback (called when a line scrolls off the top). */
  push(line: TerminalLine): void {
    this.buffer[this.head] = line.clone();
    this.head = (this.head + 1) % this.maxSize;
    if (this.count < this.maxSize) {
      this.count++;
    }
  }

  /** Get a line from scrollback (0 = most recent, count-1 = oldest). */
  getLine(index: number): TerminalLine {
    if (index < 0 || index >= this.count) {
      throw new RangeError(`Scrollback index ${index} out of range [0, ${this.count})`);
    }
    // head points to the next write position, so the most recent line is at head-1
    const bufIndex = ((this.head - 1 - index) % this.maxSize + this.maxSize) % this.maxSize;
    return this.buffer[bufIndex]!;
  }

  /** Total number of lines in scrollback. */
  get length(): number {
    return this.count;
  }

  /** Clear all scrollback. */
  clear(): void {
    this.buffer = new Array(this.maxSize);
    this.head = 0;
    this.count = 0;
  }

  /** Search scrollback for text. Returns matches with line indices and column ranges. */
  search(query: string, caseSensitive: boolean): SearchMatch[] {
    const matches: SearchMatch[] = [];
    const q = caseSensitive ? query : query.toLowerCase();

    for (let i = 0; i < this.count; i++) {
      const line = this.getLine(i);
      let text = line.trimmedText();
      if (!caseSensitive) text = text.toLowerCase();

      let pos = 0;
      while (pos < text.length) {
        const idx = text.indexOf(q, pos);
        if (idx === -1) break;
        matches.push({
          lineIndex: i,
          startCol: idx,
          endCol: idx + query.length,
        });
        pos = idx + 1;
      }
    }

    return matches;
  }
}
