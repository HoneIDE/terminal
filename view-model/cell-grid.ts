/**
 * CellGrid — view-model exposing renderable cell data to FFI.
 *
 * Translates internal buffer state into a format the native
 * rendering layer can consume.
 */

import { type ScreenBuffer } from '../core/buffer/screen-buffer';
import { type Scrollback } from '../core/buffer/scrollback';
import { type TerminalModes } from '../core/vt-parser/csi';
import { type TerminalTheme, resolveIndexedColor } from './theme';
import { type SelectionRange } from '../core/emulator';

export interface RenderCell {
  c: string;      // Character
  fg: [number, number, number]; // RGB foreground
  bg: [number, number, number]; // RGB background
  b: boolean;      // Bold
  i: boolean;      // Italic
  u: boolean;      // Underline
  s: boolean;      // Strikethrough
  d: boolean;      // Dim
  v: boolean;      // Inverse
  w: 1 | 2;       // Width
  us?: string;     // Underline style
  hl?: string;     // Hyperlink URL
}

export interface SearchMatchRange {
  row: number;
  startCol: number;
  endCol: number;
}

export class CellGrid {
  private buffer: ScreenBuffer;
  private scrollback: Scrollback;
  private theme: TerminalTheme;
  private modes: TerminalModes;
  private scrollOffset: number = 0;
  private selectionRanges: SelectionRange[] = [];
  private searchRanges: SearchMatchRange[] = [];
  private dirtyRows: Set<number> = new Set();

  constructor(
    buffer: ScreenBuffer,
    scrollback: Scrollback,
    theme: TerminalTheme,
    modes: TerminalModes,
  ) {
    this.buffer = buffer;
    this.scrollback = scrollback;
    this.theme = theme;
    this.modes = modes;
  }

  get rows(): number { return this.buffer.rows; }
  get cols(): number { return this.buffer.cols; }

  get cursorRow(): number { return this.buffer.cursorRow; }
  get cursorCol(): number { return this.buffer.cursorCol; }
  get cursorStyle(): 'block' | 'beam' | 'underline' { return this.modes.cursorStyle; }
  get cursorVisible(): boolean { return this.modes.cursorVisible; }
  get cursorBlink(): boolean { return this.modes.cursorBlink; }

  updateScrollOffset(offset: number): void { this.scrollOffset = offset; }
  setSelectionRanges(ranges: SelectionRange[]): void { this.selectionRanges = ranges; }
  setSearchMatchRanges(ranges: SearchMatchRange[]): void { this.searchRanges = ranges; }

  /** Get renderable cell data for a row range as a JSON string (for FFI). */
  getCellsJSON(startRow: number, endRow: number): string {
    const rows: RenderCell[][] = [];

    for (let row = startRow; row < endRow; row++) {
      const rowCells: RenderCell[] = [];
      const line = this.buffer.getLine(row);

      for (let col = 0; col < this.buffer.cols; col++) {
        const cell = line.cells[col];

        // Resolve colors
        let fg = this.resolveColor(cell.fg, true);
        let bg = this.resolveColor(cell.bg, false);

        // Handle inverse attribute
        if (cell.attrs.inverse !== this.modes.reverseVideo) {
          [fg, bg] = [bg, fg];
        }

        const renderCell: RenderCell = {
          c: cell.char,
          fg,
          bg,
          b: cell.attrs.bold,
          i: cell.attrs.italic,
          u: cell.attrs.underline,
          s: cell.attrs.strikethrough,
          d: cell.attrs.dim,
          v: cell.attrs.invisible,
          w: cell.width,
        };

        if (cell.attrs.underline && cell.attrs.underlineStyle !== 'single') {
          renderCell.us = cell.attrs.underlineStyle;
        }

        if (cell.hyperlink) {
          renderCell.hl = cell.hyperlink;
        }

        rowCells.push(renderCell);
      }

      rows.push(rowCells);
    }

    return JSON.stringify(rows);
  }

  /** Get dirty row indices since last render. */
  getDirtyRows(): number[] {
    return this.buffer.getDirtyLines();
  }

  /** Mark all rows as clean after render. */
  markClean(): void {
    this.buffer.clearDirty();
  }

  /** Get selection ranges for rendering highlights. */
  getSelectionRanges(): SelectionRange[] {
    return this.selectionRanges;
  }

  /** Get search match ranges for rendering highlights. */
  getSearchMatchRanges(): SearchMatchRange[] {
    return this.searchRanges;
  }

  /** Resolve a Color to an RGB tuple. */
  private resolveColor(
    color: { type: string; index?: number; r?: number; g?: number; b?: number },
    isFg: boolean,
  ): [number, number, number] {
    switch (color.type) {
      case 'default':
        return hexToRgb(isFg ? this.theme.foreground : this.theme.background);
      case 'indexed':
        return hexToRgb(resolveIndexedColor(color.index!, this.theme));
      case 'rgb':
        return [color.r!, color.g!, color.b!];
      default:
        return hexToRgb(isFg ? this.theme.foreground : this.theme.background);
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}
