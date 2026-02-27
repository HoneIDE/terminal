/**
 * Perry Terminal Component: embeddable terminal emulator for Perry apps.
 *
 * Wraps TerminalEmulator + CellGrid + NativeRenderCoordinator
 * behind a simple API. FFI functions are declared as extern and resolved
 * by Perry's codegen from the perry.nativeLibrary manifest in package.json.
 */

import { TerminalEmulator, type TerminalOptions } from '../core/emulator';
import { type KeyEvent } from '../core/input/key-encoder';
import { NativeRenderCoordinator } from '../native/render-coordinator';
import { DARK_THEME, LIGHT_THEME, type TerminalTheme } from '../view-model/theme';
import type { NativeTerminalFFI, NativeViewHandle } from '../native/ffi-bridge';

// ============================================================
// FFI function declarations — resolved by Perry's codegen from
// the perry.nativeLibrary manifest in package.json.
// These compile to extern "C" function references.
// ============================================================

declare function hone_terminal_create(rows: number, cols: number): number;
declare function hone_terminal_destroy(handle: number): void;
declare function hone_terminal_set_font(handle: number, family: number, size: number): void;
declare function hone_terminal_render_cells(handle: number, cellsJson: number, startRow: number, endRow: number): void;
declare function hone_terminal_set_cursor(handle: number, row: number, col: number, style: number, visible: number): void;
declare function hone_terminal_resize(handle: number, rows: number, cols: number): void;
declare function hone_terminal_set_selection(handle: number, regionsJson: number): void;
declare function hone_terminal_scroll(handle: number, offset: number): void;
declare function hone_terminal_set_theme(handle: number, themeJson: number): void;
declare function hone_terminal_get_cell_size(handle: number, outWidth: number, outHeight: number): void;

/**
 * FFI implementation that delegates to Perry's extern FFI functions.
 * String parameters use i64 pointers (Perry handles string allocation).
 */
class PerryTerminalFFI implements NativeTerminalFFI {
  create(rows: number, cols: number): NativeViewHandle {
    return hone_terminal_create(rows, cols);
  }

  destroy(handle: NativeViewHandle): void {
    hone_terminal_destroy(handle);
  }

  setFont(handle: NativeViewHandle, family: string, size: number): void {
    hone_terminal_set_font(handle, family as any, size);
  }

  renderCells(handle: NativeViewHandle, cellsJson: string, startRow: number, endRow: number): void {
    hone_terminal_render_cells(handle, cellsJson as any, startRow, endRow);
  }

  setCursor(handle: NativeViewHandle, row: number, col: number, style: number, visible: boolean): void {
    hone_terminal_set_cursor(handle, row, col, style, visible ? 1 : 0);
  }

  resize(handle: NativeViewHandle, rows: number, cols: number): void {
    hone_terminal_resize(handle, rows, cols);
  }

  setSelection(handle: NativeViewHandle, regionsJson: string): void {
    hone_terminal_set_selection(handle, regionsJson as any);
  }

  scroll(handle: NativeViewHandle, offset: number): void {
    hone_terminal_scroll(handle, offset);
  }

  setTheme(handle: NativeViewHandle, themeJson: string): void {
    hone_terminal_set_theme(handle, themeJson as any);
  }

  getCellSize(handle: NativeViewHandle): [number, number] {
    // Perry FFI writes to output pointers; we simulate with a wrapper
    const out = new Float64Array(2);
    hone_terminal_get_cell_size(handle, out as any, (out as any) + 8);
    return [out[0], out[1]];
  }
}

/**
 * Options for creating a Terminal instance.
 */
export interface TerminalComponentOptions extends TerminalOptions {
  /** Color theme: 'dark' or 'light', or a custom TerminalTheme. */
  theme?: 'dark' | 'light' | TerminalTheme;
  /** Font size in points. */
  fontSize?: number;
  /** Font family name. */
  fontFamily?: string;
  /** Custom FFI implementation (e.g., NoOpFFI for testing). */
  ffi?: NativeTerminalFFI;
}

/**
 * Perry-embeddable terminal emulator component.
 *
 * Usage in a Perry app:
 * ```typescript
 * import { Terminal } from '@honeide/terminal/perry';
 *
 * const terminal = new Terminal(80, 24, {
 *   theme: 'dark',
 *   fontFamily: 'JetBrains Mono',
 *   fontSize: 14,
 * });
 *
 * await terminal.open({ shell: '/bin/zsh' });
 * ```
 */
export class Terminal {
  private _emulator: TerminalEmulator;
  private _coordinator: NativeRenderCoordinator;
  private _ffi: NativeTerminalFFI;
  private _theme: TerminalTheme;
  private _disposed = false;

  constructor(cols: number = 80, rows: number = 24, options?: TerminalComponentOptions) {
    const opts = options ?? {};

    // Resolve theme
    if (typeof opts.theme === 'object') {
      this._theme = opts.theme;
    } else if (opts.theme === 'light') {
      this._theme = LIGHT_THEME;
    } else {
      this._theme = DARK_THEME;
    }

    this._ffi = opts.ffi ?? new PerryTerminalFFI();
    this._emulator = new TerminalEmulator(rows, cols, opts.scrollbackSize ?? 10000);

    this._coordinator = new NativeRenderCoordinator(this._ffi, {
      fontFamily: opts.fontFamily ?? 'JetBrains Mono',
      fontSize: opts.fontSize ?? 14,
      theme: this._theme,
    });

    this._coordinator.create(rows, cols);
    this._coordinator.attach(this._emulator);
  }

  /** Get the underlying TerminalEmulator. */
  get emulator(): TerminalEmulator { return this._emulator; }

  /** Get the current terminal title. */
  get title(): string { return this._emulator.title; }

  /** Whether the shell is still running. */
  get isRunning(): boolean { return this._emulator.isRunning; }

  /** Terminal dimensions. */
  get rows(): number { return this._emulator.rows; }
  get cols(): number { return this._emulator.cols; }

  /** Get the native view handle (opaque pointer). */
  get nativeHandle(): NativeViewHandle | null {
    return this._coordinator.getHandle();
  }

  /** Open a PTY and start the terminal session. */
  async open(options?: TerminalOptions): Promise<void> {
    await this._emulator.open(options);
  }

  /** Handle a key down event. */
  keyDown(event: KeyEvent): void {
    this._emulator.keyDown(event);
  }

  /** Paste text into the terminal. */
  paste(text: string): void {
    this._emulator.paste(text);
  }

  /** Resize the terminal. */
  resize(cols: number, rows: number): void {
    this._emulator.resize(rows, cols);
    this._coordinator.resize(rows, cols);
  }

  /** Resize from pixel dimensions (uses cell size to compute rows/cols). */
  resizeFromPixels(widthPx: number, heightPx: number): void {
    const [cellW, cellH] = this._coordinator.getCellSize();
    const cols = Math.max(1, Math.floor(widthPx / cellW));
    const rows = Math.max(1, Math.floor(heightPx / cellH));
    this.resize(cols, rows);
  }

  /** Set the font. */
  setFont(family: string, size: number): void {
    this._coordinator.setFont(family, size);
  }

  /** Set the theme. */
  setTheme(theme: 'dark' | 'light' | TerminalTheme): void {
    if (typeof theme === 'string') {
      this._theme = theme === 'light' ? LIGHT_THEME : DARK_THEME;
    } else {
      this._theme = theme;
    }
    this._coordinator.setTheme(this._theme);
  }

  /** Scroll by n lines (positive = up into scrollback). */
  scrollBy(lines: number): void {
    this._emulator.scrollBy(lines);
  }

  /** Scroll to the top of scrollback. */
  scrollToTop(): void {
    this._emulator.scrollToTop();
  }

  /** Scroll to the bottom (live output). */
  scrollToBottom(): void {
    this._emulator.scrollToBottom();
  }

  /** Get selected text. */
  getSelectedText(): string {
    return this._emulator.getSelectedText();
  }

  /** Clear selection. */
  clearSelection(): void {
    this._emulator.clearSelection();
  }

  // --- Events ---

  onTitleChange(handler: (title: string) => void): void {
    this._emulator.onTitleChange(handler);
  }

  onBell(handler: () => void): void {
    this._emulator.onBell(handler);
  }

  onExit(handler: (code: number) => void): void {
    this._emulator.onExit(handler);
  }

  /** Close the terminal and free all resources. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._emulator.close();
    this._coordinator.detach();
    this._coordinator.destroy();
  }
}
