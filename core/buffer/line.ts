/**
 * TerminalLine — a single row in the terminal grid.
 *
 * Wraps an array of cells with metadata for dirty tracking and
 * soft-wrap detection.
 */

import { type TerminalCell, defaultCell, cloneCell } from './cell';

export class TerminalLine {
  cells: TerminalCell[];
  dirty: boolean;
  wrapped: boolean;

  constructor(cols: number) {
    this.cells = Array.from({ length: cols }, () => defaultCell());
    this.dirty = true;
    this.wrapped = false;
  }

  /** Insert blank cells at position, shifting existing cells right. */
  insertCells(col: number, count: number): void {
    const blanks = Array.from({ length: count }, () => defaultCell());
    this.cells.splice(col, 0, ...blanks);
    // Truncate to original length
    this.cells.length = this.cells.length - count;
    this.dirty = true;
  }

  /** Delete cells at position, shifting remaining cells left (filling with blanks). */
  deleteCells(col: number, count: number): void {
    const cols = this.cells.length;
    this.cells.splice(col, count);
    // Fill deleted positions at the end with blanks
    while (this.cells.length < cols) {
      this.cells.push(defaultCell());
    }
    this.dirty = true;
  }

  /** Resize line (add blanks or truncate). */
  resize(cols: number): void {
    if (cols > this.cells.length) {
      while (this.cells.length < cols) {
        this.cells.push(defaultCell());
      }
    } else {
      this.cells.length = cols;
    }
    this.dirty = true;
  }

  /** Clear all cells to defaults. */
  clear(): void {
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = defaultCell();
    }
    this.dirty = true;
  }

  /** Deep-clone this line. */
  clone(): TerminalLine {
    const line = new TerminalLine(0);
    line.cells = this.cells.map(cloneCell);
    line.dirty = this.dirty;
    line.wrapped = this.wrapped;
    return line;
  }

  /** Extract text content, trimming trailing whitespace. */
  trimmedText(): string {
    let end = this.cells.length;
    while (end > 0 && this.cells[end - 1].char === ' ') {
      end--;
    }
    let text = '';
    for (let i = 0; i < end; i++) {
      const c = this.cells[i].char;
      if (c !== '') text += c;
    }
    return text;
  }

  /** Extract full text content (including trailing spaces). */
  text(): string {
    let text = '';
    for (const cell of this.cells) {
      if (cell.char !== '') text += cell.char;
    }
    return text;
  }
}
