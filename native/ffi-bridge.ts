/**
 * FFI Bridge: TypeScript abstraction over the native terminal rendering contract.
 *
 * All 6 platforms implement the same set of FFI functions. This bridge
 * provides typed wrappers and allows swapping implementations at runtime
 * (e.g., no-op for testing, DOM for web, Core Text for macOS).
 *
 * In production, Perry auto-generates bindings from the Rust crate's
 * #[no_mangle] functions and injects them via `perry/ffi`.
 */

/**
 * Opaque handle to a native terminal view.
 * In Rust, this is a *mut TerminalView pointer.
 * In TypeScript, we treat it as an opaque number (pointer value).
 */
export type NativeViewHandle = number;

/**
 * The FFI contract that every platform must implement.
 */
export interface NativeTerminalFFI {
  /** Create a new terminal rendering view with dimensions. Returns opaque handle. */
  create(rows: number, cols: number): NativeViewHandle;

  /** Destroy a terminal rendering view and free all resources. */
  destroy(handle: NativeViewHandle): void;

  /** Set the font family and size for the terminal view. */
  setFont(handle: NativeViewHandle, family: string, size: number): void;

  /**
   * Render a range of rows from the cell grid.
   * @param cellsJson - JSON string encoding cell data for rows [startRow, endRow).
   * @param startRow - First row index (inclusive).
   * @param endRow - Last row index (exclusive).
   */
  renderCells(handle: NativeViewHandle, cellsJson: string, startRow: number, endRow: number): void;

  /**
   * Update the cursor position and style.
   * @param style - 0=block, 1=beam, 2=underline.
   * @param visible - Whether the cursor is visible.
   */
  setCursor(handle: NativeViewHandle, row: number, col: number, style: number, visible: boolean): void;

  /** Resize the terminal view (recalculate layout, font metrics). */
  resize(handle: NativeViewHandle, rows: number, cols: number): void;

  /**
   * Set the selection highlight regions.
   * @param regionsJson - JSON string encoding selection ranges.
   */
  setSelection(handle: NativeViewHandle, regionsJson: string): void;

  /**
   * Scroll the terminal view by the given number of lines.
   * Positive = up (into scrollback), negative = down.
   */
  scroll(handle: NativeViewHandle, offset: number): void;

  /**
   * Set the terminal color theme.
   * @param themeJson - JSON string encoding the TerminalTheme.
   */
  setTheme(handle: NativeViewHandle, themeJson: string): void;

  /**
   * Get the cell dimensions (width, height in pixels) for the current font.
   * Returns [width, height].
   */
  getCellSize(handle: NativeViewHandle): [number, number];
}

/**
 * Cursor style constants for FFI.
 */
export const CursorStyleCode = {
  Block: 0,
  Beam: 1,
  Underline: 2,
} as const;

export function cursorStyleToCode(style: 'block' | 'beam' | 'underline'): number {
  switch (style) {
    case 'block': return CursorStyleCode.Block;
    case 'beam': return CursorStyleCode.Beam;
    case 'underline': return CursorStyleCode.Underline;
  }
}

/**
 * No-op FFI implementation for testing.
 * Records all calls for verification.
 */
export class NoOpFFI implements NativeTerminalFFI {
  private _nextHandle = 1;
  readonly calls: { method: string; args: any[] }[] = [];

  create(rows: number, cols: number): NativeViewHandle {
    this.calls.push({ method: 'create', args: [rows, cols] });
    return this._nextHandle++;
  }

  destroy(handle: NativeViewHandle): void {
    this.calls.push({ method: 'destroy', args: [handle] });
  }

  setFont(handle: NativeViewHandle, family: string, size: number): void {
    this.calls.push({ method: 'setFont', args: [handle, family, size] });
  }

  renderCells(handle: NativeViewHandle, cellsJson: string, startRow: number, endRow: number): void {
    this.calls.push({ method: 'renderCells', args: [handle, cellsJson, startRow, endRow] });
  }

  setCursor(handle: NativeViewHandle, row: number, col: number, style: number, visible: boolean): void {
    this.calls.push({ method: 'setCursor', args: [handle, row, col, style, visible] });
  }

  resize(handle: NativeViewHandle, rows: number, cols: number): void {
    this.calls.push({ method: 'resize', args: [handle, rows, cols] });
  }

  setSelection(handle: NativeViewHandle, regionsJson: string): void {
    this.calls.push({ method: 'setSelection', args: [handle, regionsJson] });
  }

  scroll(handle: NativeViewHandle, offset: number): void {
    this.calls.push({ method: 'scroll', args: [handle, offset] });
  }

  setTheme(handle: NativeViewHandle, themeJson: string): void {
    this.calls.push({ method: 'setTheme', args: [handle, themeJson] });
  }

  getCellSize(_handle: NativeViewHandle): [number, number] {
    this.calls.push({ method: 'getCellSize', args: [_handle] });
    // Return fixed 8x16 cell size for testing
    return [8, 16];
  }

  /** Clear recorded calls. */
  reset(): void {
    this.calls.length = 0;
  }

  /** Get calls for a specific method. */
  getCalls(method: string): any[][] {
    return this.calls.filter(c => c.method === method).map(c => c.args);
  }
}
