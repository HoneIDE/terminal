/**
 * Render Coordinator — bridges TerminalEmulator state to FFI calls.
 *
 * Translates dirty tracking, cursor state, and selection into
 * the appropriate FFI calls for the native renderer.
 */

import { type TerminalEmulator } from '../core/emulator';
import { type NativeTerminalFFI, type NativeViewHandle, cursorStyleToCode } from './ffi-bridge';
import { CellGrid } from '../view-model/cell-grid';
import { type TerminalTheme, DARK_THEME } from '../view-model/theme';

export interface RenderCoordinatorConfig {
  fontFamily: string;
  fontSize: number;
  theme: TerminalTheme;
}

export class NativeRenderCoordinator {
  private ffi: NativeTerminalFFI;
  private handle: NativeViewHandle | null = null;
  private emulator: TerminalEmulator | null = null;
  private cellGrid: CellGrid | null = null;
  private config: RenderCoordinatorConfig;

  constructor(ffi: NativeTerminalFFI, config?: Partial<RenderCoordinatorConfig>) {
    this.ffi = ffi;
    this.config = {
      fontFamily: config?.fontFamily ?? 'JetBrains Mono',
      fontSize: config?.fontSize ?? 14,
      theme: config?.theme ?? DARK_THEME,
    };
  }

  /** Create the native terminal view. */
  create(rows: number, cols: number): void {
    this.handle = this.ffi.create(rows, cols);
    this.ffi.setFont(this.handle, this.config.fontFamily, this.config.fontSize);
    this.ffi.setTheme(this.handle, JSON.stringify(this.config.theme));
  }

  /** Attach to a TerminalEmulator and begin rendering. */
  attach(emulator: TerminalEmulator): void {
    this.emulator = emulator;
    this.cellGrid = new CellGrid(
      emulator.buffer,
      emulator.scrollback,
      this.config.theme,
      emulator.modes,
    );

    // Listen for render events
    emulator.onRender((dirtyRows) => {
      this.renderDirtyRows(dirtyRows);
    });
  }

  /** Render only the dirty rows. */
  renderDirtyRows(dirtyRows: number[]): void {
    if (!this.handle || !this.cellGrid || !this.emulator) return;
    if (dirtyRows.length === 0) return;

    const startRow = Math.min(...dirtyRows);
    const endRow = Math.max(...dirtyRows) + 1;

    const json = this.cellGrid.getCellsJSON(startRow, endRow);
    this.ffi.renderCells(this.handle, json, startRow, endRow);

    // Update cursor
    this.ffi.setCursor(
      this.handle,
      this.cellGrid.cursorRow,
      this.cellGrid.cursorCol,
      cursorStyleToCode(this.cellGrid.cursorStyle),
      this.cellGrid.cursorVisible,
    );

    // Update selection
    const selectionRanges = this.cellGrid.getSelectionRanges();
    if (selectionRanges.length > 0) {
      this.ffi.setSelection(this.handle, JSON.stringify(selectionRanges));
    }

    this.cellGrid.markClean();
  }

  /** Full render of all rows. */
  renderFull(): void {
    if (!this.emulator || !this.cellGrid) return;
    const allRows = Array.from({ length: this.emulator.rows }, (_, i) => i);
    this.renderDirtyRows(allRows);
  }

  /** Resize the native view. */
  resize(rows: number, cols: number): void {
    if (this.handle) {
      this.ffi.resize(this.handle, rows, cols);
    }
  }

  /** Update the font. */
  setFont(family: string, size: number): void {
    this.config.fontFamily = family;
    this.config.fontSize = size;
    if (this.handle) {
      this.ffi.setFont(this.handle, family, size);
    }
  }

  /** Update the theme. */
  setTheme(theme: TerminalTheme): void {
    this.config.theme = theme;
    if (this.handle) {
      this.ffi.setTheme(this.handle, JSON.stringify(theme));
    }
  }

  /** Get the cell pixel dimensions from the native renderer. */
  getCellSize(): [number, number] {
    if (!this.handle) return [8, 16];
    return this.ffi.getCellSize(this.handle);
  }

  /** Detach from the emulator. */
  detach(): void {
    this.emulator = null;
    this.cellGrid = null;
  }

  /** Destroy the native view and free resources. */
  destroy(): void {
    if (this.handle) {
      this.ffi.destroy(this.handle);
      this.handle = null;
    }
  }

  /** Get the native view handle. */
  getHandle(): NativeViewHandle | null {
    return this.handle;
  }
}
