/**
 * ScreenBuffer — the active visible area of the terminal.
 *
 * Maintains a grid of TerminalLines, cursor position, scroll region,
 * mode flags, alternate buffer support, and dirty tracking.
 */

import {
  type TerminalCell,
  type Color,
  type CellAttributes,
  defaultCell,
  defaultAttrs,
  cloneAttrs,
  charWidth,
} from './cell';
import { TerminalLine } from './line';
import { Scrollback } from './scrollback';

export interface SavedCursorState {
  row: number;
  col: number;
  attrs: CellAttributes;
  fg: Color;
  bg: Color;
  originMode: boolean;
  autoWrapMode: boolean;
}

export class ScreenBuffer {
  private _rows: number;
  private _cols: number;
  private lines: TerminalLine[];
  private scrollback: Scrollback;

  // Cursor
  cursorRow: number = 0;
  cursorCol: number = 0;
  pendingWrap: boolean = false;

  // Current text attributes (applied to new cells)
  cursorAttrs: CellAttributes = defaultAttrs();
  cursorFg: Color = { type: 'default' };
  cursorBg: Color = { type: 'default' };
  cursorHyperlink: string | undefined = undefined;

  // Scroll region (DECSTBM)
  scrollTop: number = 0;
  scrollBottom: number;

  // Mode flags
  originMode: boolean = false;
  autoWrapMode: boolean = true;
  insertMode: boolean = false;
  lineFeedMode: boolean = false;

  // Tab stops
  tabStops: Set<number>;

  // Saved cursor state (DECSC/DECRC)
  private savedCursor: SavedCursorState | null = null;

  // Alternate buffer
  private mainBuffer: TerminalLine[] | null = null;
  private mainScrollback: Scrollback | null = null;
  private mainSavedCursor: SavedCursorState | null = null;
  private _isAlternate: boolean = false;

  constructor(rows: number, cols: number, scrollback: Scrollback) {
    this._rows = rows;
    this._cols = cols;
    this.scrollback = scrollback;
    this.scrollBottom = rows - 1;
    this.lines = Array.from({ length: rows }, () => new TerminalLine(cols));
    this.tabStops = new Set<number>();
    this.resetTabStops();
  }

  get rows(): number { return this._rows; }
  get cols(): number { return this._cols; }
  get isAlternate(): boolean { return this._isAlternate; }

  // -----------------------------------------------------------------------
  // Cell access
  // -----------------------------------------------------------------------

  getCell(row: number, col: number): TerminalCell {
    if (row < 0 || row >= this._rows || col < 0 || col >= this._cols) {
      return defaultCell();
    }
    return this.lines[row].cells[col];
  }

  setCell(row: number, col: number, cell: TerminalCell): void {
    if (row < 0 || row >= this._rows || col < 0 || col >= this._cols) return;
    this.lines[row].cells[col] = cell;
    this.lines[row].dirty = true;
  }

  getLine(row: number): TerminalLine {
    return this.lines[row];
  }

  // -----------------------------------------------------------------------
  // Print character at cursor
  // -----------------------------------------------------------------------

  /** Print a character at the current cursor position, advancing the cursor. */
  printChar(char: string): void {
    const width = charWidth(char.codePointAt(0)!);

    // Handle pending wrap
    if (this.pendingWrap) {
      if (this.autoWrapMode) {
        this.lines[this.cursorRow].wrapped = true;
        this.lineFeed();
        this.cursorCol = 0;
      }
      this.pendingWrap = false;
    }

    // Handle wide character at last column: wrap to next line
    if (width === 2 && this.cursorCol >= this._cols - 1) {
      if (this.autoWrapMode) {
        // Fill current last column with a space
        this.setCellAtCursor(' ', 1);
        this.lines[this.cursorRow].wrapped = true;
        this.lineFeed();
        this.cursorCol = 0;
      } else {
        // Can't fit, place at last column (will be truncated)
        this.cursorCol = this._cols - 2;
      }
    }

    // Insert mode: shift existing chars right
    if (this.insertMode) {
      this.lines[this.cursorRow].insertCells(this.cursorCol, width);
    }

    // Handle overwriting a wide character
    this.clearWideCharAt(this.cursorRow, this.cursorCol);
    if (width === 2 && this.cursorCol + 1 < this._cols) {
      this.clearWideCharAt(this.cursorRow, this.cursorCol + 1);
    }

    // Write the cell
    this.setCellAtCursor(char, width);

    // For wide characters, write continuation cell
    if (width === 2 && this.cursorCol + 1 < this._cols) {
      const contCell = defaultCell();
      contCell.char = '';
      contCell.fg = { ...this.cursorFg } as Color;
      contCell.bg = { ...this.cursorBg } as Color;
      contCell.attrs = cloneAttrs(this.cursorAttrs);
      this.lines[this.cursorRow].cells[this.cursorCol + 1] = contCell;
    }

    // Advance cursor
    const advance = width;
    if (this.cursorCol + advance >= this._cols) {
      this.cursorCol = this._cols - 1;
      this.pendingWrap = true;
    } else {
      this.cursorCol += advance;
    }
  }

  private setCellAtCursor(char: string, width: 1 | 2): void {
    const cell: TerminalCell = {
      char,
      width,
      fg: { ...this.cursorFg } as Color,
      bg: { ...this.cursorBg } as Color,
      attrs: cloneAttrs(this.cursorAttrs),
      hyperlink: this.cursorHyperlink,
    };
    this.lines[this.cursorRow].cells[this.cursorCol] = cell;
    this.lines[this.cursorRow].dirty = true;
  }

  /** Clear both cells of a wide character when overwriting one half. */
  private clearWideCharAt(row: number, col: number): void {
    if (col < 0 || col >= this._cols) return;
    const cell = this.lines[row].cells[col];
    if (cell.width === 2) {
      // This is the first cell of a wide character — clear continuation
      if (col + 1 < this._cols) {
        this.lines[row].cells[col + 1] = defaultCell();
      }
      this.lines[row].cells[col] = defaultCell();
      this.lines[row].dirty = true;
    } else if (cell.char === '' && col > 0) {
      // This is a continuation cell — clear the wide character before it
      const prev = this.lines[row].cells[col - 1];
      if (prev.width === 2) {
        this.lines[row].cells[col - 1] = defaultCell();
        this.lines[row].cells[col] = defaultCell();
        this.lines[row].dirty = true;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Scroll operations
  // -----------------------------------------------------------------------

  /** Scroll up within the scroll region. Lines scrolled off go to scrollback. */
  scrollUp(count: number): void {
    for (let i = 0; i < count; i++) {
      // Push top line to scrollback (only for main buffer, not alternate)
      if (!this._isAlternate && this.scrollTop === 0) {
        this.scrollback.push(this.lines[this.scrollTop]);
      }
      // Shift lines up within scroll region
      for (let row = this.scrollTop; row < this.scrollBottom; row++) {
        this.lines[row] = this.lines[row + 1];
        this.lines[row].dirty = true;
      }
      // New blank line at bottom of scroll region
      this.lines[this.scrollBottom] = new TerminalLine(this._cols);
    }
  }

  /** Scroll down within the scroll region. */
  scrollDown(count: number): void {
    for (let i = 0; i < count; i++) {
      // Shift lines down within scroll region (bottom line is discarded)
      for (let row = this.scrollBottom; row > this.scrollTop; row--) {
        this.lines[row] = this.lines[row - 1];
        this.lines[row].dirty = true;
      }
      // New blank line at top of scroll region
      this.lines[this.scrollTop] = new TerminalLine(this._cols);
    }
  }

  // -----------------------------------------------------------------------
  // Line feed
  // -----------------------------------------------------------------------

  /** Perform a line feed. If at the bottom of the scroll region, scroll up. */
  lineFeed(): void {
    if (this.cursorRow === this.scrollBottom) {
      this.scrollUp(1);
    } else if (this.cursorRow < this._rows - 1) {
      this.cursorRow++;
    }
  }

  /** Reverse index: move cursor up; scroll down if at top of scroll region. */
  reverseIndex(): void {
    if (this.cursorRow === this.scrollTop) {
      this.scrollDown(1);
    } else if (this.cursorRow > 0) {
      this.cursorRow--;
    }
  }

  // -----------------------------------------------------------------------
  // Erase
  // -----------------------------------------------------------------------

  /** Erase in display. */
  eraseInDisplay(mode: number): void {
    switch (mode) {
      case 0: // Below cursor
        this.eraseLine(this.cursorRow, this.cursorCol, this._cols);
        for (let row = this.cursorRow + 1; row < this._rows; row++) {
          this.lines[row].clear();
        }
        break;
      case 1: // Above cursor
        for (let row = 0; row < this.cursorRow; row++) {
          this.lines[row].clear();
        }
        this.eraseLine(this.cursorRow, 0, this.cursorCol + 1);
        break;
      case 2: // Entire screen
        for (let row = 0; row < this._rows; row++) {
          this.lines[row].clear();
        }
        break;
      case 3: // Entire screen + scrollback
        for (let row = 0; row < this._rows; row++) {
          this.lines[row].clear();
        }
        this.scrollback.clear();
        break;
    }
  }

  /** Erase in line. */
  eraseInLine(mode: number): void {
    switch (mode) {
      case 0: // Right of cursor
        this.eraseLine(this.cursorRow, this.cursorCol, this._cols);
        break;
      case 1: // Left of cursor
        this.eraseLine(this.cursorRow, 0, this.cursorCol + 1);
        break;
      case 2: // Entire line
        this.lines[this.cursorRow].clear();
        break;
    }
  }

  private eraseLine(row: number, startCol: number, endCol: number): void {
    const line = this.lines[row];
    for (let col = startCol; col < endCol && col < this._cols; col++) {
      line.cells[col] = defaultCell();
    }
    line.dirty = true;
  }

  /** Erase n characters at cursor (replace with blanks, no shift). */
  eraseCharacters(count: number): void {
    const line = this.lines[this.cursorRow];
    for (let i = 0; i < count && this.cursorCol + i < this._cols; i++) {
      line.cells[this.cursorCol + i] = defaultCell();
    }
    line.dirty = true;
  }

  // -----------------------------------------------------------------------
  // Insert / Delete lines and characters
  // -----------------------------------------------------------------------

  /** Insert n blank lines at cursor row (within scroll region). */
  insertLines(count: number): void {
    const row = this.cursorRow;
    if (row < this.scrollTop || row > this.scrollBottom) return;

    for (let i = 0; i < count; i++) {
      // Shift lines down, discard the one at scrollBottom
      for (let r = this.scrollBottom; r > row; r--) {
        this.lines[r] = this.lines[r - 1];
        this.lines[r].dirty = true;
      }
      this.lines[row] = new TerminalLine(this._cols);
    }
  }

  /** Delete n lines at cursor row (within scroll region). */
  deleteLines(count: number): void {
    const row = this.cursorRow;
    if (row < this.scrollTop || row > this.scrollBottom) return;

    for (let i = 0; i < count; i++) {
      // Shift lines up, insert blank at scrollBottom
      for (let r = row; r < this.scrollBottom; r++) {
        this.lines[r] = this.lines[r + 1];
        this.lines[r].dirty = true;
      }
      this.lines[this.scrollBottom] = new TerminalLine(this._cols);
    }
  }

  /** Insert n blank characters at cursor position. */
  insertCharacters(count: number): void {
    this.lines[this.cursorRow].insertCells(this.cursorCol, count);
  }

  /** Delete n characters at cursor position. */
  deleteCharacters(count: number): void {
    this.lines[this.cursorRow].deleteCells(this.cursorCol, count);
  }

  // -----------------------------------------------------------------------
  // Tab stops
  // -----------------------------------------------------------------------

  private resetTabStops(): void {
    this.tabStops.clear();
    for (let i = 8; i < this._cols; i += 8) {
      this.tabStops.add(i);
    }
  }

  /** Move cursor to the next tab stop. */
  tabForward(count: number = 1): void {
    for (let i = 0; i < count; i++) {
      let nextTab = this.cursorCol + 1;
      while (nextTab < this._cols && !this.tabStops.has(nextTab)) {
        nextTab++;
      }
      this.cursorCol = Math.min(nextTab, this._cols - 1);
    }
    this.pendingWrap = false;
  }

  /** Move cursor to the previous tab stop. */
  tabBackward(count: number = 1): void {
    for (let i = 0; i < count; i++) {
      let prevTab = this.cursorCol - 1;
      while (prevTab > 0 && !this.tabStops.has(prevTab)) {
        prevTab--;
      }
      this.cursorCol = Math.max(prevTab, 0);
    }
    this.pendingWrap = false;
  }

  /** Set a tab stop at the cursor column. */
  setTabStop(): void {
    this.tabStops.add(this.cursorCol);
  }

  /** Clear tab stop at cursor or all tab stops. */
  clearTabStop(mode: number): void {
    if (mode === 0) {
      this.tabStops.delete(this.cursorCol);
    } else if (mode === 3) {
      this.tabStops.clear();
    }
  }

  // -----------------------------------------------------------------------
  // Cursor save/restore (DECSC/DECRC)
  // -----------------------------------------------------------------------

  saveCursor(): void {
    this.savedCursor = {
      row: this.cursorRow,
      col: this.cursorCol,
      attrs: cloneAttrs(this.cursorAttrs),
      fg: { ...this.cursorFg } as Color,
      bg: { ...this.cursorBg } as Color,
      originMode: this.originMode,
      autoWrapMode: this.autoWrapMode,
    };
  }

  restoreCursor(): void {
    if (this.savedCursor) {
      this.cursorRow = this.savedCursor.row;
      this.cursorCol = this.savedCursor.col;
      this.cursorAttrs = cloneAttrs(this.savedCursor.attrs);
      this.cursorFg = { ...this.savedCursor.fg } as Color;
      this.cursorBg = { ...this.savedCursor.bg } as Color;
      this.originMode = this.savedCursor.originMode;
      this.autoWrapMode = this.savedCursor.autoWrapMode;
      this.pendingWrap = false;
    }
  }

  // -----------------------------------------------------------------------
  // Alternate screen buffer
  // -----------------------------------------------------------------------

  switchToAlternate(): void {
    if (this._isAlternate) return;
    this.saveCursor();
    this.mainBuffer = this.lines;
    this.mainScrollback = this.scrollback;
    this.mainSavedCursor = this.savedCursor;
    this._isAlternate = true;
    // Create fresh alternate buffer (no scrollback)
    this.lines = Array.from({ length: this._rows }, () => new TerminalLine(this._cols));
    this.scrollback = new Scrollback(0);
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.pendingWrap = false;
    this.scrollTop = 0;
    this.scrollBottom = this._rows - 1;
  }

  switchToMain(): void {
    if (!this._isAlternate) return;
    this._isAlternate = false;
    this.lines = this.mainBuffer!;
    this.scrollback = this.mainScrollback!;
    this.savedCursor = this.mainSavedCursor;
    this.mainBuffer = null;
    this.mainScrollback = null;
    this.mainSavedCursor = null;
    this.restoreCursor();
    this.scrollTop = 0;
    this.scrollBottom = this._rows - 1;
    // Mark all lines dirty for re-render
    for (const line of this.lines) {
      line.dirty = true;
    }
  }

  // -----------------------------------------------------------------------
  // Resize
  // -----------------------------------------------------------------------

  resize(rows: number, cols: number): void {
    // Resize columns on existing lines
    if (cols !== this._cols) {
      for (const line of this.lines) {
        line.resize(cols);
      }
    }

    // Adjust row count
    if (rows < this._rows) {
      // Shrink: lines scrolled off top go to scrollback
      const overflow = this._rows - rows;
      for (let i = 0; i < overflow; i++) {
        if (!this._isAlternate) {
          this.scrollback.push(this.lines[0]);
        }
        this.lines.shift();
      }
    } else if (rows > this._rows) {
      // Grow: pull lines from scrollback if available
      const needed = rows - this._rows;
      for (let i = 0; i < needed; i++) {
        if (!this._isAlternate && this.scrollback.length > 0) {
          const line = this.scrollback.getLine(0);
          line.resize(cols);
          // Remove from scrollback (pop most recent)
          // Note: scrollback doesn't have a pop, so we create a new one from remaining
          this.lines.unshift(line);
        } else {
          this.lines.push(new TerminalLine(cols));
        }
      }
    }

    this._rows = rows;
    this._cols = cols;

    // Clamp cursor
    this.cursorRow = Math.min(this.cursorRow, rows - 1);
    this.cursorCol = Math.min(this.cursorCol, cols - 1);

    // Reset scroll region
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;

    // Reset tab stops
    this.resetTabStops();

    this.pendingWrap = false;

    // Mark all dirty
    for (const line of this.lines) {
      line.dirty = true;
    }
  }

  // -----------------------------------------------------------------------
  // Clear
  // -----------------------------------------------------------------------

  clear(): void {
    for (let i = 0; i < this._rows; i++) {
      this.lines[i] = new TerminalLine(this._cols);
    }
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.pendingWrap = false;
  }

  // -----------------------------------------------------------------------
  // Full reset (RIS)
  // -----------------------------------------------------------------------

  fullReset(): void {
    if (this._isAlternate) {
      this.switchToMain();
    }
    this.clear();
    this.scrollback.clear();
    this.cursorAttrs = defaultAttrs();
    this.cursorFg = { type: 'default' };
    this.cursorBg = { type: 'default' };
    this.cursorHyperlink = undefined;
    this.scrollTop = 0;
    this.scrollBottom = this._rows - 1;
    this.originMode = false;
    this.autoWrapMode = true;
    this.insertMode = false;
    this.lineFeedMode = false;
    this.savedCursor = null;
    this.resetTabStops();
  }

  // -----------------------------------------------------------------------
  // Dirty tracking
  // -----------------------------------------------------------------------

  getDirtyLines(): number[] {
    const dirty: number[] = [];
    for (let i = 0; i < this._rows; i++) {
      if (this.lines[i].dirty) dirty.push(i);
    }
    return dirty;
  }

  clearDirty(): void {
    for (const line of this.lines) {
      line.dirty = false;
    }
  }

  /** Mark all lines as dirty (for full re-render). */
  markAllDirty(): void {
    for (const line of this.lines) {
      line.dirty = true;
    }
  }

  // -----------------------------------------------------------------------
  // Cursor position helpers
  // -----------------------------------------------------------------------

  /** Clamp cursor to valid range. */
  clampCursor(): void {
    this.cursorRow = Math.max(0, Math.min(this.cursorRow, this._rows - 1));
    this.cursorCol = Math.max(0, Math.min(this.cursorCol, this._cols - 1));
  }

  /** Set scroll region (DECSTBM). */
  setScrollRegion(top: number, bottom: number): void {
    this.scrollTop = Math.max(0, Math.min(top, this._rows - 1));
    this.scrollBottom = Math.max(this.scrollTop, Math.min(bottom, this._rows - 1));
    // Move cursor to home position
    this.cursorRow = this.originMode ? this.scrollTop : 0;
    this.cursorCol = 0;
    this.pendingWrap = false;
  }
}
