/**
 * TerminalEmulator — main class combining parser + buffer + PTY.
 *
 * Orchestrates the full data flow:
 *   Input (keyboard, mouse, paste) → Encoder → PTY
 *   PTY output → VT Parser → Screen Buffer → Dirty tracking
 */

import { VTParser } from './vt-parser/parser';
import {
  dispatchCsi,
  type CsiContext,
  type TerminalModes,
  defaultModes,
} from './vt-parser/csi';
import { dispatchOsc, type OscContext } from './vt-parser/osc';
import { dispatchDcs, type DcsContext } from './vt-parser/dcs';
import { ScreenBuffer } from './buffer/screen-buffer';
import { Scrollback } from './buffer/scrollback';
import { type PTY, type PTYOptions, PTYManager } from './pty/pty-manager';
import { encodeKey, encodePaste, type KeyEvent } from './input/key-encoder';
import { encodeMouse, type MouseTrackingState, type MouseEvent as TerminalMouseEvent } from './input/mouse-encoder';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalOptions extends PTYOptions {
  scrollbackSize?: number;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
}

export interface SearchResult {
  row: number;         // Row index (negative for scrollback)
  startCol: number;
  endCol: number;
}

export interface Position {
  row: number;
  col: number;
}

export interface SelectionRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

// ---------------------------------------------------------------------------
// Event handler types
// ---------------------------------------------------------------------------

type TitleHandler = (title: string) => void;
type BellHandler = () => void;
type DataHandler = (data: string) => void;
type ResizeHandler = (rows: number, cols: number) => void;
type ExitHandler = (code: number) => void;
type HyperlinkHandler = (url: string | null, row: number, col: number) => void;
type RenderHandler = (dirtyRows: number[]) => void;

// ---------------------------------------------------------------------------
// TerminalEmulator
// ---------------------------------------------------------------------------

export class TerminalEmulator {
  private parser: VTParser;
  private _buffer: ScreenBuffer;
  private _scrollback: Scrollback;
  private pty: PTY | null = null;
  private _modes: TerminalModes;

  // Viewport scroll offset (0 = at bottom / live, >0 = scrolled into history)
  private _scrollOffset: number = 0;

  // Selection
  private _selection: SelectionRange | null = null;

  // Search
  private searchQuery: string = '';
  private searchResults: SearchResult[] = [];
  private searchIndex: number = -1;

  // State
  private _title: string = '';
  private _cwd: string = '';
  private _isRunning: boolean = false;

  // Event handlers
  private titleHandlers: TitleHandler[] = [];
  private bellHandlers: BellHandler[] = [];
  private dataHandlers: DataHandler[] = [];
  private resizeHandlers: ResizeHandler[] = [];
  private exitHandlers: ExitHandler[] = [];
  private hyperlinkHandlers: HyperlinkHandler[] = [];
  private renderHandlers: RenderHandler[] = [];

  // Synchronized output batching
  private syncBatchedDirty: number[] = [];

  constructor(rows: number = 24, cols: number = 80, scrollbackSize: number = 10000) {
    this._scrollback = new Scrollback(scrollbackSize);
    this._buffer = new ScreenBuffer(rows, cols, this._scrollback);
    this._modes = defaultModes();
    this.parser = new VTParser();
    this.setupParser();
  }

  // -----------------------------------------------------------------------
  // Properties
  // -----------------------------------------------------------------------

  get rows(): number { return this._buffer.rows; }
  get cols(): number { return this._buffer.cols; }
  get buffer(): ScreenBuffer { return this._buffer; }
  get scrollback(): Scrollback { return this._scrollback; }
  get modes(): TerminalModes { return this._modes; }
  get title(): string { return this._title; }
  get cwd(): string { return this._cwd; }
  get isRunning(): boolean { return this._isRunning; }
  get scrollOffset(): number { return this._scrollOffset; }
  get selection(): SelectionRange | null { return this._selection; }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Open a PTY and start the terminal session. */
  async open(options: TerminalOptions = {}): Promise<void> {
    const ptyOpts: PTYOptions = {
      ...options,
      rows: this._buffer.rows,
      cols: this._buffer.cols,
    };

    this.pty = PTYManager.spawn(ptyOpts);
    this._isRunning = true;

    this.pty.onData(this.handlePtyData.bind(this));
    this.pty.onExit(this.handlePtyExit.bind(this));
  }

  private handlePtyData(data: Uint8Array): void {
    this.parser.feed(data);
    this.flushRender();
  }

  private handlePtyExit(code: number): void {
    this._isRunning = false;
    for (const handler of this.exitHandlers) handler(code);
  }

  /** Feed raw data directly (without PTY, for testing). */
  feedData(data: Uint8Array | string): void {
    if (typeof data === 'string') {
      this.parser.feed(new TextEncoder().encode(data));
    } else {
      this.parser.feed(data);
    }
    this.flushRender();
  }

  /** Close the terminal session. */
  close(): void {
    if (this.pty) {
      this.pty.kill();
      this.pty = null;
    }
    this._isRunning = false;
  }

  // -----------------------------------------------------------------------
  // Dimensions
  // -----------------------------------------------------------------------

  resize(rows: number, cols: number): void {
    this._buffer.resize(rows, cols);
    if (this.pty) {
      this.pty.resize(rows, cols);
    }
    for (const handler of this.resizeHandlers) handler(rows, cols);
    this.flushRender();
  }

  // -----------------------------------------------------------------------
  // Input
  // -----------------------------------------------------------------------

  keyDown(event: KeyEvent): void {
    const encoded = encodeKey(event, {
      applicationCursorKeys: this._modes.applicationCursorKeys,
      applicationKeypad: false,
      bracketedPaste: this._modes.bracketedPaste,
    });

    if (encoded !== null) {
      this.writeToPty(encoded);
      // Scroll to bottom on keyboard input
      if (this._scrollOffset > 0) {
        this._scrollOffset = 0;
      }
    }
  }

  paste(text: string): void {
    const encoded = encodePaste(text, this._modes.bracketedPaste);
    this.writeToPty(encoded);
    if (this._scrollOffset > 0) {
      this._scrollOffset = 0;
    }
  }

  mouseEvent(event: TerminalMouseEvent): void {
    const state: MouseTrackingState = {
      x10: this._modes.mouseTrackingX10,
      normal: this._modes.mouseTrackingNormal,
      buttonEvent: this._modes.mouseTrackingButton,
      anyEvent: this._modes.mouseTrackingAny,
      sgrFormat: this._modes.mouseFormatSGR,
    };

    const encoded = encodeMouse(event, state);
    if (encoded !== null) {
      this.writeToPty(encoded);
    }
  }

  // -----------------------------------------------------------------------
  // Scrollback navigation
  // -----------------------------------------------------------------------

  scrollToTop(): void {
    this._scrollOffset = this._scrollback.length;
  }

  scrollToBottom(): void {
    this._scrollOffset = 0;
  }

  scrollBy(lines: number): void {
    this._scrollOffset = Math.max(
      0,
      Math.min(this._scrollOffset + lines, this._scrollback.length)
    );
  }

  // -----------------------------------------------------------------------
  // Selection
  // -----------------------------------------------------------------------

  setSelection(start: Position, end: Position): void {
    // Normalize so start is before end
    if (start.row > end.row || (start.row === end.row && start.col > end.col)) {
      [start, end] = [end, start];
    }
    this._selection = {
      startRow: start.row,
      startCol: start.col,
      endRow: end.row,
      endCol: end.col,
    };
  }

  selectWord(row: number, col: number): void {
    const line = this._buffer.getLine(row);
    if (!line) return;

    // Find word boundaries
    let startCol = col;
    let endCol = col;

    while (startCol > 0 && isWordChar(line.cells[startCol - 1].char)) {
      startCol--;
    }
    while (endCol < this._buffer.cols - 1 && isWordChar(line.cells[endCol + 1].char)) {
      endCol++;
    }

    this._selection = {
      startRow: row,
      startCol,
      endRow: row,
      endCol: endCol + 1,
    };
  }

  selectLine(row: number): void {
    this._selection = {
      startRow: row,
      startCol: 0,
      endRow: row,
      endCol: this._buffer.cols,
    };
  }

  selectAll(): void {
    this._selection = {
      startRow: 0,
      startCol: 0,
      endRow: this._buffer.rows - 1,
      endCol: this._buffer.cols,
    };
  }

  getSelectedText(): string {
    if (!this._selection) return '';

    const { startRow, startCol, endRow, endCol } = this._selection;
    const lines: string[] = [];

    for (let row = startRow; row <= endRow; row++) {
      const line = this._buffer.getLine(row);
      if (!line) continue;

      const colStart = row === startRow ? startCol : 0;
      const colEnd = row === endRow ? endCol : this._buffer.cols;

      let text = '';
      for (let col = colStart; col < colEnd; col++) {
        const c = line.cells[col].char;
        if (c !== '') text += c;
      }

      // Trim trailing whitespace for non-wrapped lines
      if (row < endRow && !line.wrapped) {
        text = text.trimEnd();
      }
      lines.push(text);
    }

    return lines.join(lines.length > 1 ? '\n' : '');
  }

  clearSelection(): void {
    this._selection = null;
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    this.searchQuery = query;
    this.searchResults = [];
    this.searchIndex = -1;

    if (!query) return [];

    const caseSensitive = options.caseSensitive ?? false;
    const q = caseSensitive ? query : query.toLowerCase();

    // Search visible buffer
    for (let row = 0; row < this._buffer.rows; row++) {
      const line = this._buffer.getLine(row);
      let text = line.trimmedText();
      if (!caseSensitive) text = text.toLowerCase();

      let pos = 0;
      while (pos < text.length) {
        const idx = text.indexOf(q, pos);
        if (idx === -1) break;
        this.searchResults.push({ row, startCol: idx, endCol: idx + query.length });
        pos = idx + 1;
      }
    }

    // Search scrollback
    const scrollbackMatches = this._scrollback.search(query, caseSensitive);
    for (const match of scrollbackMatches) {
      this.searchResults.push({
        row: -(match.lineIndex + 1), // Negative row for scrollback
        startCol: match.startCol,
        endCol: match.endCol,
      });
    }

    return this.searchResults;
  }

  searchNext(): SearchResult | null {
    if (this.searchResults.length === 0) return null;
    this.searchIndex = (this.searchIndex + 1) % this.searchResults.length;
    return this.searchResults[this.searchIndex];
  }

  searchPrevious(): SearchResult | null {
    if (this.searchResults.length === 0) return null;
    this.searchIndex = (this.searchIndex - 1 + this.searchResults.length) % this.searchResults.length;
    return this.searchResults[this.searchIndex];
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchResults = [];
    this.searchIndex = -1;
  }

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  onTitleChange(handler: TitleHandler): void { this.titleHandlers.push(handler); }
  onBell(handler: BellHandler): void { this.bellHandlers.push(handler); }
  onData(handler: DataHandler): void { this.dataHandlers.push(handler); }
  onResize(handler: ResizeHandler): void { this.resizeHandlers.push(handler); }
  onExit(handler: ExitHandler): void { this.exitHandlers.push(handler); }
  onHyperlinkHover(handler: HyperlinkHandler): void { this.hyperlinkHandlers.push(handler); }
  onRender(handler: RenderHandler): void { this.renderHandlers.push(handler); }

  // -----------------------------------------------------------------------
  // Parser setup — uses bound methods to avoid nested closures (Perry compat)
  // -----------------------------------------------------------------------

  private setupParser(): void {
    this.parser.onPrint(this.handlePrint.bind(this));
    this.parser.onExecute(this.handleExecute.bind(this));
    this.parser.onCsi(this.handleCsi.bind(this));
    this.parser.onOsc(this.handleOsc.bind(this));
    this.parser.onDcs(this.handleDcs.bind(this));
    this.parser.onEsc(this.handleEsc.bind(this));
  }

  private handlePrint(char: string): void {
    this._buffer.printChar(char);
  }

  private handleExecute(code: number): void {
    switch (code) {
      case 0x07: // BEL
        for (const handler of this.bellHandlers) handler();
        break;
      case 0x08: // BS — Backspace
        if (this._buffer.cursorCol > 0) {
          this._buffer.cursorCol--;
          this._buffer.pendingWrap = false;
        }
        break;
      case 0x09: // HT — Horizontal Tab
        this._buffer.tabForward();
        break;
      case 0x0a: // LF — Line Feed
      case 0x0b: // VT — Vertical Tab
      case 0x0c: // FF — Form Feed
        this._buffer.lineFeed();
        if (this._buffer.lineFeedMode) {
          this._buffer.cursorCol = 0;
        }
        break;
      case 0x0d: // CR — Carriage Return
        this._buffer.cursorCol = 0;
        this._buffer.pendingWrap = false;
        break;
      case 0x0e: // SO — Shift Out (G1 character set)
        break; // Stub — character set switching not implemented
      case 0x0f: // SI — Shift In (G0 character set)
        break; // Stub
      // 8-bit C1 controls
      case 0x84: // IND — Index
        this._buffer.lineFeed();
        break;
      case 0x85: // NEL — Next Line
        this._buffer.lineFeed();
        this._buffer.cursorCol = 0;
        break;
      case 0x88: // HTS — Horizontal Tab Set
        this._buffer.setTabStop();
        break;
      case 0x8d: // RI — Reverse Index
        this._buffer.reverseIndex();
        break;
    }
  }

  private handleCsi(params: number[], intermediates: string, finalByte: string): void {
    const ctx: CsiContext = {
      buffer: this._buffer,
      modes: this._modes,
      writeBack: this.writeToPty.bind(this),
      onAlternateBuffer: this.handleAlternateBuffer.bind(this),
    };
    dispatchCsi(params, intermediates, finalByte, ctx);
  }

  private handleAlternateBuffer(_enabled: boolean): void {
    this._scrollOffset = 0;
  }

  private handleOsc(params: string[]): void {
    const ctx: OscContext = {
      buffer: this._buffer,
      writeBack: this.writeToPty.bind(this),
      onTitle: this.handleTitle.bind(this),
      onCwd: this.handleCwd.bind(this),
      onClipboard: this.handleClipboard.bind(this),
      onShellIntegration: this.handleShellIntegration.bind(this),
      onBell: this.handleOscBell.bind(this),
    };
    dispatchOsc(params, ctx);
  }

  private handleTitle(title: string): void {
    this._title = title;
    for (const handler of this.titleHandlers) handler(title);
  }

  private handleCwd(cwd: string): void {
    this._cwd = cwd;
  }

  private handleClipboard(_selection: string, data: string | null): void {
    for (const handler of this.dataHandlers) {
      handler(data ?? '');
    }
  }

  private handleShellIntegration(_type: string): void {
    // Shell integration markers — can be used for smart selection
  }

  private handleOscBell(): void {
    for (const handler of this.bellHandlers) handler();
  }

  private handleDcs(params: number[], intermediates: string, data: string): void {
    const ctx: DcsContext = {
      buffer: this._buffer,
      writeBack: this.writeToPty.bind(this),
    };
    dispatchDcs(params, intermediates, data, ctx);
  }

  private handleEsc(intermediates: string, finalByte: string): void {
    switch (finalByte) {
      case '7': // DECSC — Save cursor
        this._buffer.saveCursor();
        break;
      case '8': // DECRC — Restore cursor
        this._buffer.restoreCursor();
        break;
      case 'D': // IND — Index
        this._buffer.lineFeed();
        break;
      case 'M': // RI — Reverse Index
        this._buffer.reverseIndex();
        break;
      case 'E': // NEL — Next Line
        this._buffer.lineFeed();
        this._buffer.cursorCol = 0;
        break;
      case 'c': // RIS — Full reset
        this._buffer.fullReset();
        this._modes = defaultModes();
        this._title = '';
        this._scrollOffset = 0;
        break;
      case 'H': // HTS — Set tab stop
        this._buffer.setTabStop();
        break;
      case '=': // DECKPAM — Application keypad mode
        // Stub — keypad mode not fully implemented
        break;
      case '>': // DECKPNM — Normal keypad mode
        break;
      case '\\': // ST — String Terminator
        // This is handled by the OSC/DCS parsers
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private writeToPty(data: string): void {
    if (this.pty) {
      this.pty.write(data);
    }
  }

  private flushRender(): void {
    const dirty = this._buffer.getDirtyLines();
    if (dirty.length === 0) return;

    if (this._modes.synchronizedOutput) {
      // Batch dirty lines during synchronized output
      for (const row of dirty) {
        if (!this.syncBatchedDirty.includes(row)) {
          this.syncBatchedDirty.push(row);
        }
      }
    } else {
      // Flush any batched lines from synchronized output
      if (this.syncBatchedDirty.length > 0) {
        const allDirty = [...new Set([...this.syncBatchedDirty, ...dirty])];
        this.syncBatchedDirty = [];
        for (const handler of this.renderHandlers) handler(allDirty);
      } else {
        for (const handler of this.renderHandlers) handler(dirty);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isWordChar(ch: string): boolean {
  return /[\w]/.test(ch);
}
