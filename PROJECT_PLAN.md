# hone-terminal: Project Plan

## 1. Overview

`hone-terminal` is a standalone, reusable terminal emulator component for the Hone ecosystem. It is published as `@honeide/terminal` and designed so that any Perry-based application can embed a fully functional terminal with minimal integration effort.

**Compatibility target:** `xterm-256color`

The terminal emulator provides complete support for:

- **ANSI colors** (8 standard + 8 bright)
- **256-color palette** (indexed colors 0-255 via SGR 38;5;n / 48;5;n)
- **Truecolor / 24-bit color** (arbitrary RGB via SGR 38;2;r;g;b / 48;2;r;g;b)
- **Mouse tracking** (X10, normal/button, SGR/1006 extended)
- **Alternate screen buffer** (DECSET 1049 for full-screen applications like vim, less, htop)
- **Bracketed paste mode** (DECSET 2004, wrapping pasted text in ESC[200~ / ESC[201~)
- **Hyperlinks** (OSC 8 inline hyperlinks with URL and optional ID)
- **Wide character (CJK) support** (characters occupying 2 cells in the grid)
- **Scrollback buffer** (configurable ring buffer, default 10,000 lines)
- **Shell integration** (OSC 133 prompt/command/output markers)
- **Selection, copy, and search** across visible buffer and scrollback

The component is built entirely in TypeScript with custom VT100/xterm escape sequence parsing (no external dependencies for the parser). Platform-native rendering is provided through Perry FFI crates written in Rust, using the same approach as hone-editor: Core Text on macOS/iOS, DirectWrite on Windows, Pango/Cairo on Linux, Canvas on Android, and DOM on Web.

Perry (v0.2.162) compiles the TypeScript source to native binaries for all 6 target platforms (macOS, iOS, Android, Windows, Linux, Web), providing `perry/ui` widgets, `perry/system` APIs (clipboard, keyboard shortcuts), `State()` reactive bindings, and access to native npm packages (`child_process`, `fs`, `net`, etc.).

---

## 2. Dependencies

### Internal

| Package | Purpose |
|---------|---------|
| `@honeide/api` | Shared type definitions: `Terminal`, `TerminalOptions`, `TerminalTheme`, event types |

### External

None. All VT parsing, buffer management, and input encoding is implemented from scratch within this package. This eliminates version conflicts, reduces bundle size, and gives full control over correctness and performance.

### Perry Built-ins

| Module | Purpose |
|--------|---------|
| `child_process` | PTY spawning via `forkpty` (Unix) and ConPTY (Windows) |
| `fs` | Reading shell profile files, terminfo entries, configuration |
| `net` | Future: remote terminal connections (SSH forwarding, serial ports) |

### Perry Platform APIs

| API | Purpose |
|-----|---------|
| `perry/ui` | Widget tree integration, layout, event handling |
| `perry/system` | Clipboard read/write, keyboard shortcut registration |
| `State()` | Reactive bindings that trigger re-render of dirty terminal lines |

### Rust FFI Crates (per-platform)

Each platform has a dedicated Rust crate in `native/` that exposes character grid rendering through platform-native text APIs. These crates are compiled and bundled by Perry during the build step.

---

## 3. Repository Structure

```
hone-terminal/
├── core/
│   ├── vt-parser/
│   │   ├── parser.ts              # Main VT state machine (14 states, transition table)
│   │   ├── csi.ts                 # CSI sequence dispatcher (cursor, erase, scroll, SGR, modes)
│   │   ├── osc.ts                 # OSC sequence handlers (title, colors, hyperlinks, clipboard)
│   │   ├── dcs.ts                 # DCS sequence handlers (DECRQSS, SIXEL stub)
│   │   └── index.ts               # Re-exports parser and all handler modules
│   ├── buffer/
│   │   ├── screen-buffer.ts       # Active screen grid (rows x cols), cursor, scroll region
│   │   ├── scrollback.ts          # Ring buffer of scrolled-off lines
│   │   ├── cell.ts                # TerminalCell definition and default factory
│   │   ├── line.ts                # TerminalLine (cell array + dirty flag + wrapped flag)
│   │   └── index.ts               # Re-exports buffer types
│   ├── pty/
│   │   ├── pty-manager.ts         # Platform-agnostic PTY abstraction
│   │   ├── unix-pty.ts            # Unix forkpty implementation (macOS, Linux, iOS)
│   │   ├── win-conpty.ts          # Windows ConPTY implementation
│   │   └── index.ts               # Re-exports PTY manager
│   ├── input/
│   │   ├── key-encoder.ts         # Keyboard event → VT escape sequence encoder
│   │   ├── mouse-encoder.ts       # Mouse event → VT mouse tracking sequence encoder
│   │   └── index.ts               # Re-exports input encoders
│   ├── emulator.ts                # TerminalEmulator: main class combining parser + buffer + PTY
│   └── index.ts                   # Package entry point, re-exports everything
├── view-model/
│   ├── cell-grid.ts               # CellGrid: view-model exposing renderable cell data to FFI
│   ├── cursor.ts                  # Cursor state (position, style, blink, visibility)
│   ├── selection.ts               # Selection model (rectangular, line-based)
│   ├── search.ts                  # Search-in-scrollback with match highlighting
│   ├── theme.ts                   # Terminal color theme (16 ANSI colors, fg, bg, cursor, selection)
│   └── index.ts                   # Re-exports view-model types
├── native/
│   ├── macos/
│   │   ├── Cargo.toml             # Rust crate: Core Text rendering
│   │   └── src/
│   │       ├── lib.rs             # FFI entry points
│   │       ├── grid_renderer.rs   # Core Text character grid renderer
│   │       ├── font.rs            # Font loading, measurement, fallback chain
│   │       └── cursor.rs          # Cursor rendering (block, beam, underline)
│   ├── windows/
│   │   ├── Cargo.toml             # Rust crate: DirectWrite rendering
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── grid_renderer.rs   # DirectWrite character grid renderer
│   │       ├── font.rs
│   │       └── cursor.rs
│   ├── linux/
│   │   ├── Cargo.toml             # Rust crate: Pango/Cairo rendering
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── grid_renderer.rs   # Pango/Cairo character grid renderer
│   │       ├── font.rs
│   │       └── cursor.rs
│   ├── ios/
│   │   ├── Cargo.toml             # Rust crate: Core Text rendering (shared with macOS)
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── grid_renderer.rs
│   │       ├── font.rs
│   │       └── cursor.rs
│   ├── android/
│   │   ├── Cargo.toml             # Rust crate: Canvas/Skia rendering
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── grid_renderer.rs
│   │       ├── font.rs
│   │       └── cursor.rs
│   └── web/
│       ├── Cargo.toml             # Rust crate: wasm-bindgen + DOM/Canvas rendering
│       └── src/
│           ├── lib.rs
│           ├── grid_renderer.rs
│           ├── font.rs
│           └── cursor.rs
├── tests/
│   ├── vt-parser/
│   │   ├── parser.test.ts         # State machine transition tests
│   │   ├── csi.test.ts            # CSI handler tests (cursor, erase, scroll, modes)
│   │   ├── sgr.test.ts            # SGR attribute parsing (all combinations)
│   │   ├── osc.test.ts            # OSC handler tests (title, hyperlinks, clipboard)
│   │   └── dcs.test.ts            # DCS handler tests
│   ├── buffer/
│   │   ├── screen-buffer.test.ts  # Grid operations, scroll, resize
│   │   ├── scrollback.test.ts     # Ring buffer behavior, overflow
│   │   └── cell.test.ts           # Cell defaults, wide characters
│   ├── pty/
│   │   ├── unix-pty.test.ts       # PTY spawn, I/O, resize, kill
│   │   └── win-conpty.test.ts     # ConPTY integration
│   ├── input/
│   │   ├── key-encoder.test.ts    # Key → escape sequence mapping
│   │   └── mouse-encoder.test.ts  # Mouse → tracking sequence mapping
│   ├── emulator.test.ts           # End-to-end: input → parse → buffer → output
│   └── vttest/
│       └── vttest-runner.ts       # Automated vttest compatibility suite
├── examples/
│   └── standalone-terminal/
│       ├── main.ts                # Minimal standalone terminal app
│       ├── perry.config.ts        # Perry config for the example
│       └── package.json
├── perry.config.ts                # Perry build configuration for hone-terminal
├── package.json                   # npm package: @honeide/terminal
├── tsconfig.json                  # TypeScript configuration
└── LICENSE
```

---

## 4. Core Interfaces & Types

### TerminalCell

The fundamental unit of the terminal grid. Every position in the screen buffer holds one `TerminalCell`.

```typescript
interface TerminalCell {
  char: string;           // Single Unicode character, or empty string for wide char continuation cell
  width: 1 | 2;          // 1 for normal characters, 2 for wide (CJK) characters
  fg: Color;              // Foreground color
  bg: Color;              // Background color
  attrs: CellAttributes;  // Text decoration and style attributes
  hyperlink?: string;     // OSC 8 hyperlink URL (undefined if no hyperlink)
}
```

### CellAttributes

Complete set of text attributes supported by the terminal.

```typescript
interface CellAttributes {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  blink: boolean;
  inverse: boolean;
  invisible: boolean;
  dim: boolean;
  underlineStyle: 'single' | 'double' | 'curly' | 'dotted' | 'dashed';
}
```

Default attributes (all false, underlineStyle = 'single') are used for new cells.

### Color

Discriminated union representing all supported terminal color modes.

```typescript
type Color =
  | { type: 'default' }                                    // Terminal theme default fg/bg
  | { type: 'indexed'; index: number }                     // 0-255 indexed palette
  | { type: 'rgb'; r: number; g: number; b: number };      // 24-bit truecolor (0-255 per channel)
```

The indexed palette layout (0-255):
- 0-7: Standard ANSI colors (black, red, green, yellow, blue, magenta, cyan, white)
- 8-15: Bright ANSI colors
- 16-231: 6x6x6 color cube (r*36 + g*6 + b + 16)
- 232-255: Grayscale ramp (24 shades, excluding black and white)

### TerminalLine

A single row in the terminal, wrapping an array of cells with metadata.

```typescript
interface TerminalLine {
  cells: TerminalCell[];
  dirty: boolean;         // True if line has been modified since last render
  wrapped: boolean;       // True if this line is a continuation of the previous line (soft wrap)
}
```

### ScreenBuffer

The active screen (visible area) of the terminal.

```typescript
interface ScreenBuffer {
  readonly rows: number;
  readonly cols: number;

  // Cell access
  getCell(row: number, col: number): TerminalCell;
  setCell(row: number, col: number, cell: TerminalCell): void;

  // Line access
  getLine(row: number): TerminalLine;

  // Scroll operations (within scroll region)
  scrollUp(count: number): void;
  scrollDown(count: number): void;

  // Resize the grid (reflow content)
  resize(rows: number, cols: number): void;

  // Clear entire screen
  clear(): void;

  // Cursor state
  cursorRow: number;
  cursorCol: number;

  // Scroll region (set by DECSTBM)
  scrollTop: number;
  scrollBottom: number;

  // Mode flags
  originMode: boolean;       // DECOM: cursor addressing relative to scroll region
  autoWrapMode: boolean;     // DECAWM: auto-wrap at end of line
  insertMode: boolean;       // IRM: insert mode vs replace mode
  lineFeedMode: boolean;     // LNM: newline mode (LF also does CR)

  // Alternate buffer
  isAlternate: boolean;
  switchToAlternate(): void;
  switchToMain(): void;

  // Dirty tracking
  getDirtyLines(): number[];
  clearDirty(): void;
}
```

### VTParser

State-machine-based parser for VT100/xterm escape sequences.

```typescript
interface VTParser {
  // Feed raw bytes from PTY output into the parser
  feed(data: Uint8Array): void;

  // Reset parser to ground state
  reset(): void;

  // Event handlers
  onPrint(handler: (char: string) => void): void;
  onExecute(handler: (code: number) => void): void;
  onCsi(handler: (params: number[], intermediates: string, finalByte: string) => void): void;
  onOsc(handler: (params: string[]) => void): void;
  onDcs(handler: (params: number[], intermediates: string, data: string) => void): void;
  onEsc(handler: (intermediates: string, finalByte: string) => void): void;
}
```

### PTY

Platform-agnostic pseudo-terminal interface.

```typescript
interface PTY {
  readonly pid: number;

  // Write data to the PTY (user input)
  write(data: string | Uint8Array): void;

  // Resize the PTY
  resize(rows: number, cols: number): void;

  // Kill the PTY process
  kill(signal?: string): void;

  // Event handlers
  onData(handler: (data: Uint8Array) => void): void;
  onExit(handler: (code: number, signal?: string) => void): void;
}

interface PTYOptions {
  shell?: string;           // Shell executable path (default: auto-detect)
  args?: string[];          // Shell arguments
  cwd?: string;             // Working directory
  env?: Record<string, string>;  // Environment variables (merged with process.env)
  rows?: number;            // Initial rows (default: 24)
  cols?: number;            // Initial cols (default: 80)
}
```

### TerminalEmulator

The main class that wires together the parser, buffer, scrollback, and PTY into a complete terminal emulator.

```typescript
interface TerminalEmulator {
  // Lifecycle
  open(options: TerminalOptions): Promise<void>;
  close(): void;

  // Dimensions
  readonly rows: number;
  readonly cols: number;
  resize(rows: number, cols: number): void;

  // Input
  keyDown(event: KeyboardEvent): void;
  paste(text: string): void;
  mouseEvent(event: TerminalMouseEvent): void;

  // Buffer access
  readonly buffer: ScreenBuffer;
  readonly scrollback: Scrollback;

  // View model
  getCellGrid(): CellGrid;

  // Scrollback navigation
  scrollToTop(): void;
  scrollToBottom(): void;
  scrollBy(lines: number): void;

  // Selection
  selectWord(row: number, col: number): void;
  selectLine(row: number): void;
  selectAll(): void;
  setSelection(start: Position, end: Position): void;
  getSelectedText(): string;
  clearSelection(): void;

  // Search
  search(query: string, options?: SearchOptions): SearchResult[];
  searchNext(): SearchResult | null;
  searchPrevious(): SearchResult | null;
  clearSearch(): void;

  // Events
  onTitleChange(handler: (title: string) => void): void;
  onBell(handler: () => void): void;
  onData(handler: (data: string) => void): void;
  onResize(handler: (rows: number, cols: number) => void): void;
  onExit(handler: (code: number) => void): void;
  onHyperlinkHover(handler: (url: string | null, row: number, col: number) => void): void;

  // State
  readonly title: string;
  readonly cwd: string;        // Current working directory (via OSC 7)
  readonly isRunning: boolean;
}
```

### CellGrid (View Model)

The view model that the native rendering layer consumes. Translates internal buffer state into a renderable format.

```typescript
interface CellGrid {
  readonly rows: number;
  readonly cols: number;

  // Get renderable cell data for a row range (used by FFI render calls)
  getCellsJSON(startRow: number, endRow: number): string;

  // Get dirty row indices since last render
  getDirtyRows(): number[];

  // Mark all rows as clean after render
  markClean(): void;

  // Cursor info
  readonly cursorRow: number;
  readonly cursorCol: number;
  readonly cursorStyle: 'block' | 'beam' | 'underline';
  readonly cursorVisible: boolean;
  readonly cursorBlink: boolean;

  // Selection ranges (for rendering highlights)
  getSelectionRanges(): SelectionRange[];

  // Search match ranges (for rendering highlights)
  getSearchMatchRanges(): SearchMatchRange[];
}
```

### Terminal Theme

Color theme for the terminal, defining all palette colors plus UI colors.

```typescript
interface TerminalTheme {
  // 16 ANSI palette colors (0-15)
  palette: [string, string, string, string, string, string, string, string,
            string, string, string, string, string, string, string, string];

  foreground: string;       // Default foreground (#hex)
  background: string;       // Default background (#hex)
  cursor: string;           // Cursor color (#hex)
  cursorAccent: string;     // Text color under block cursor (#hex)
  selection: string;        // Selection background (#hex with alpha)
  selectionForeground?: string;

  // Extended colors (optional overrides for 256-color palette indices 16-255)
  extendedPalette?: Map<number, string>;
}
```

---

## 5. Implementation Guide

### 5.1 VT Parser (`core/vt-parser/`)

The VT parser is a deterministic state machine based on Paul Flo Williams' state machine for DEC-compatible terminal parsing (derived from the DEC VT500 series documentation). It processes a byte stream and dispatches semantic actions.

#### State Machine States

The parser has 14 states:

| State | Description |
|-------|-------------|
| `Ground` | Default state. Printable characters are printed; C0 controls are executed. |
| `Escape` | After receiving ESC (0x1B). Waiting for the next byte to determine sequence type. |
| `EscapeIntermediate` | Collecting intermediate bytes (0x20-0x2F) after ESC. |
| `CsiEntry` | After ESC [ — entered CSI sequence. Prepare to collect parameters. |
| `CsiParam` | Collecting CSI parameter bytes (0x30-0x3B, digits and semicolons). |
| `CsiIntermediate` | Collecting CSI intermediate bytes (0x20-0x2F) after parameters. |
| `CsiIgnore` | Ignoring a malformed CSI sequence until the final byte. |
| `OscString` | Collecting an OSC string (after ESC ]). Terminated by ST (ESC \\ or BEL). |
| `DcsEntry` | After ESC P — entered DCS sequence. Prepare to collect parameters. |
| `DcsParam` | Collecting DCS parameter bytes. |
| `DcsIntermediate` | Collecting DCS intermediate bytes. |
| `DcsPassthrough` | Receiving DCS payload data. Terminated by ST. |
| `DcsIgnore` | Ignoring a malformed DCS sequence until ST. |
| `SosPmApc` | Consuming SOS, PM, or APC strings (ignored). Terminated by ST. |

#### State Transition Table

The transition table maps (current_state, input_byte) to (action, next_state). Key transitions:

```
Ground + 0x1B           → [none]        → Escape
Ground + 0x20..0x7E     → [print]       → Ground
Ground + 0x00..0x1A     → [execute]     → Ground

Escape + '['            → [none]        → CsiEntry
Escape + ']'            → [osc_start]   → OscString
Escape + 'P'            → [none]        → DcsEntry
Escape + 0x20..0x2F     → [collect]     → EscapeIntermediate
Escape + 0x30..0x7E     → [esc_dispatch]→ Ground

CsiEntry + 0x30..0x39   → [param]       → CsiParam
CsiEntry + 0x3B         → [param]       → CsiParam
CsiEntry + 0x3C..0x3F   → [collect]     → CsiParam    (private mode markers: ? > = !)
CsiEntry + 0x40..0x7E   → [csi_dispatch]→ Ground
CsiEntry + 0x20..0x2F   → [collect]     → CsiIntermediate

CsiParam + 0x30..0x39   → [param]       → CsiParam
CsiParam + 0x3B         → [param]       → CsiParam
CsiParam + 0x40..0x7E   → [csi_dispatch]→ Ground
CsiParam + 0x20..0x2F   → [collect]     → CsiIntermediate
CsiParam + 0x3A         → [none]        → CsiIgnore    (colon = subparameter, ignore)

CsiIntermediate + 0x40..0x7E → [csi_dispatch] → Ground
CsiIntermediate + 0x30..0x3F → [none]         → CsiIgnore

OscString + 0x07        → [osc_end]     → Ground       (BEL terminates OSC)
OscString + 0x1B        → [none]        → Escape       (ESC \ terminates via ST)
OscString + 0x20..0x7E  → [osc_put]     → OscString

DcsEntry + 0x30..0x39   → [param]       → DcsParam
DcsEntry + 0x3B         → [param]       → DcsParam
DcsEntry + 0x40..0x7E   → [dcs_hook]    → DcsPassthrough
DcsEntry + 0x20..0x2F   → [collect]     → DcsIntermediate

DcsPassthrough + 0x1B   → [dcs_unhook]  → Escape       (ST terminates)
DcsPassthrough + 0x00..0x7E → [dcs_put] → DcsPassthrough
```

Any byte in the range 0x18, 0x1A, or 0x80..0x9F triggers an immediate transition back to Ground (or the appropriate C1 control state) regardless of current state.

#### CSI Sequence Handlers (`csi.ts`)

CSI sequences have the form: `ESC [ <params> <intermediates> <final_byte>`

**Cursor Movement:**

| Sequence | Name | Description |
|----------|------|-------------|
| `CSI n A` | CUU | Cursor up n rows |
| `CSI n B` | CUD | Cursor down n rows |
| `CSI n C` | CUF | Cursor forward n columns |
| `CSI n D` | CUB | Cursor backward n columns |
| `CSI n ; m H` | CUP | Cursor position (row n, col m) |
| `CSI n ; m f` | HVP | Horizontal and vertical position (same as CUP) |
| `CSI n E` | CNL | Cursor next line (n lines down, to column 1) |
| `CSI n F` | CPL | Cursor previous line (n lines up, to column 1) |
| `CSI n G` | CHA | Cursor horizontal absolute (column n) |
| `CSI n d` | VPA | Vertical position absolute (row n) |
| `CSI s` | SCP | Save cursor position |
| `CSI u` | RCP | Restore cursor position |

**Erase:**

| Sequence | Name | Description |
|----------|------|-------------|
| `CSI n J` | ED | Erase in display: 0=below, 1=above, 2=all, 3=all+scrollback |
| `CSI n K` | EL | Erase in line: 0=right, 1=left, 2=all |

**Scroll:**

| Sequence | Name | Description |
|----------|------|-------------|
| `CSI n S` | SU | Scroll up n lines (content moves up, new blank lines at bottom) |
| `CSI n T` | SD | Scroll down n lines (content moves down, new blank lines at top) |

**Insert / Delete:**

| Sequence | Name | Description |
|----------|------|-------------|
| `CSI n L` | IL | Insert n blank lines at cursor row (push existing lines down) |
| `CSI n M` | DL | Delete n lines at cursor row (pull lines up) |
| `CSI n @` | ICH | Insert n blank characters at cursor (push existing chars right) |
| `CSI n P` | DCH | Delete n characters at cursor (pull chars left) |
| `CSI n X` | ECH | Erase n characters at cursor (replace with blanks, no shift) |

**Tab Stops:**

| Sequence | Name | Description |
|----------|------|-------------|
| `CSI n I` | CHT | Cursor forward n tab stops |
| `CSI n Z` | CBT | Cursor backward n tab stops |
| `CSI 0 g` | TBC | Clear tab stop at cursor |
| `CSI 3 g` | TBC | Clear all tab stops |

**Scroll Region:**

| Sequence | Name | Description |
|----------|------|-------------|
| `CSI top ; bottom r` | DECSTBM | Set top and bottom margins (scroll region) |

**SGR (Select Graphic Rendition):**

`CSI n ; n ; ... m` — Set text attributes and colors.

| Code | Attribute |
|------|-----------|
| `0` | Reset all attributes to default |
| `1` | Bold (increased intensity) |
| `2` | Dim (decreased intensity) |
| `3` | Italic |
| `4` | Underline (single) |
| `5` | Blink (slow) |
| `7` | Inverse (swap fg/bg) |
| `8` | Invisible (hidden) |
| `9` | Strikethrough (crossed out) |
| `21` | Double underline |
| `22` | Normal intensity (not bold, not dim) |
| `23` | Not italic |
| `24` | Not underlined |
| `25` | Not blinking |
| `27` | Not inverse |
| `28` | Not invisible |
| `29` | Not strikethrough |
| `30-37` | Set foreground color (ANSI 0-7) |
| `38;5;n` | Set foreground to indexed color n (0-255) |
| `38;2;r;g;b` | Set foreground to RGB truecolor |
| `39` | Default foreground color |
| `40-47` | Set background color (ANSI 0-7) |
| `48;5;n` | Set background to indexed color n (0-255) |
| `48;2;r;g;b` | Set background to RGB truecolor |
| `49` | Default background color |
| `90-97` | Set foreground to bright color (ANSI 8-15) |
| `100-107` | Set background to bright color (ANSI 8-15) |

Extended underline styles via `CSI 4 : n m` (colon-separated subparameters):
- `4:0` = no underline
- `4:1` = single underline
- `4:2` = double underline
- `4:3` = curly underline
- `4:4` = dotted underline
- `4:5` = dashed underline

**Private Modes (DECSET/DECRST):**

`CSI ? n h` (set) / `CSI ? n l` (reset):

| Mode | Name | Description |
|------|------|-------------|
| `1` | DECCKM | Application cursor keys (ESC O A vs ESC [ A) |
| `5` | DECSCNM | Reverse video (swap screen fg/bg) |
| `6` | DECOM | Origin mode (cursor relative to scroll region) |
| `7` | DECAWM | Auto-wrap mode |
| `12` | — | Cursor blink (att610) |
| `25` | DECTCEM | Cursor visible |
| `47` | — | Alternate screen buffer (old style) |
| `1000` | — | Mouse tracking: X10 (button press only) |
| `1002` | — | Mouse tracking: button event (press + release + drag) |
| `1003` | — | Mouse tracking: any event (all motion) |
| `1006` | — | SGR mouse mode (extended coordinates) |
| `1049` | — | Alternate screen buffer (save cursor, switch, clear) |
| `2004` | — | Bracketed paste mode |
| `2026` | — | Synchronized output (batch rendering updates) |

**Device Status Reports:**

| Sequence | Description |
|----------|-------------|
| `CSI 5 n` | Device status — respond with `CSI 0 n` (OK) |
| `CSI 6 n` | Cursor position report — respond with `CSI row ; col R` |
| `CSI ? 6 n` | Extended cursor position report |

**Cursor Style:**

`CSI n SP q` — Set cursor style:
- 0, 1 = blinking block
- 2 = steady block
- 3 = blinking underline
- 4 = steady underline
- 5 = blinking beam (bar)
- 6 = steady beam (bar)

#### OSC Sequence Handlers (`osc.ts`)

OSC sequences: `ESC ] <params separated by ;> <ST or BEL>`

| OSC | Description |
|-----|-------------|
| `0` | Set window title and icon name |
| `1` | Set icon name |
| `2` | Set window title |
| `4 ; index ; color` | Set palette color at index |
| `7 ; url` | Set current working directory (file://host/path) |
| `8 ; params ; uri` | Hyperlink — `params` may include `id=value`. Empty URI closes link. |
| `10 ; color` | Set/query default foreground color |
| `11 ; color` | Set/query default background color |
| `12 ; color` | Set/query cursor color |
| `52 ; selection ; data` | Clipboard access (base64-encoded data, selection = c for clipboard) |
| `133 ; type` | Shell integration prompt markers (A=prompt start, B=command start, C=output start, D=command end) |
| `1337 ; key=value` | iTerm2 proprietary sequences (future: inline images) |

#### DCS Sequence Handlers (`dcs.ts`)

DCS sequences: `ESC P <params> <data> <ST>`

| DCS | Description |
|-----|-------------|
| `$ q <string>` | DECRQSS — Request selection or setting. Respond with current value. |
| `q <sixel data>` | SIXEL graphics (basic stub: parse header, ignore pixel data for v0.1) |

---

### 5.2 Buffer (`core/buffer/`)

#### `cell.ts` — TerminalCell

Factory function for creating cells with default values:

```typescript
function defaultCell(): TerminalCell {
  return {
    char: ' ',
    width: 1,
    fg: { type: 'default' },
    bg: { type: 'default' },
    attrs: {
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
      blink: false,
      inverse: false,
      invisible: false,
      dim: false,
      underlineStyle: 'single',
    },
    hyperlink: undefined,
  };
}
```

For wide (CJK) characters, the first cell has `width: 2` and the character. The continuation cell (immediately to the right) has `char: ''`, `width: 1`, and acts as a spacer. When overwriting either cell, both must be cleared.

Unicode width detection: use a lookup table based on the East Asian Width Unicode property. Characters with property `W` (Wide) or `F` (Fullwidth) occupy 2 cells.

#### `line.ts` — TerminalLine

```typescript
class TerminalLine {
  cells: TerminalCell[];
  dirty: boolean;
  wrapped: boolean;

  constructor(cols: number) {
    this.cells = Array.from({ length: cols }, () => defaultCell());
    this.dirty = true;
    this.wrapped = false;
  }

  // Insert blank cells at position, shifting existing cells right
  insertCells(col: number, count: number): void;

  // Delete cells at position, shifting remaining cells left (filling with blanks)
  deleteCells(col: number, count: number): void;

  // Resize line (add blanks or truncate)
  resize(cols: number): void;

  // Clear all cells to defaults
  clear(): void;

  // Copy line contents (for scrollback storage)
  clone(): TerminalLine;

  // Trim trailing whitespace for copy/selection
  trimmedText(): string;
}
```

#### `screen-buffer.ts` — ScreenBuffer

The screen buffer is the active visible area of the terminal. It maintains:

- A grid of `TerminalLine[]` with length equal to `rows`
- Each line has exactly `cols` cells
- Cursor position (`cursorRow`, `cursorCol`) — 0-indexed
- Scroll region defined by `scrollTop` and `scrollBottom` (set by DECSTBM, default 0 and rows-1)
- A pending wrap flag: when the cursor is at the last column after printing a character, the wrap flag is set. The next printable character triggers a line feed and moves to column 0 of the next line.
- Mode flags: `originMode`, `autoWrapMode`, `insertMode`, `lineFeedMode`
- Saved cursor state (position, attributes, origin mode) for DECSC/DECRC

**Scroll region behavior:**

When `scrollUp(1)` is called within the scroll region (top..bottom):
1. The line at `scrollTop` is removed and pushed to the scrollback buffer
2. Lines scrollTop+1..scrollBottom shift up by one
3. A new blank line is inserted at `scrollBottom`

When `scrollDown(1)` is called within the scroll region:
1. The line at `scrollBottom` is discarded (not added to scrollback)
2. Lines scrollTop..scrollBottom-1 shift down by one
3. A new blank line is inserted at `scrollTop`

**Alternate screen buffer:**

The terminal maintains two screen buffers: `main` and `alternate`. Full-screen applications (vim, less, htop) switch to the alternate buffer via DECSET 1049. The alternate buffer:
- Has no scrollback
- Is always cleared when switched to
- Does not affect the main buffer's scrollback
- Cursor position is saved/restored on switch

On DECSET 1049: save cursor, switch to alternate, clear screen.
On DECRST 1049: switch to main, restore cursor.

**Resize behavior:**

When the terminal is resized (rows/cols change):
1. If cols changes: each line is resized (truncated or extended with blanks). Optionally, lines can be reflowed (soft-wrapped lines re-wrapped to new width — see Open Questions).
2. If rows changes: if rows decreases, lines scrolled off the top go to scrollback. If rows increases, lines may be pulled back from scrollback.
3. Cursor position is clamped to the new dimensions.
4. Scroll region is reset to the full screen.
5. The PTY is notified of the new size (SIGWINCH / resize).

**Dirty tracking:**

Each `TerminalLine` has a `dirty` flag. Any mutation (setCell, scroll, clear, resize) marks the affected lines as dirty. The view model reads dirty flags to determine which lines to re-render, then calls `clearDirty()`.

#### `scrollback.ts` — Scrollback Buffer

A ring buffer of `TerminalLine[]` with a configurable maximum size (default: 10,000 lines).

```typescript
class Scrollback {
  private buffer: TerminalLine[];
  private head: number;     // Write position
  private count: number;    // Current number of lines stored
  private maxSize: number;

  constructor(maxSize: number = 10000);

  // Push a line to the scrollback (called when a line scrolls off the top of the screen)
  push(line: TerminalLine): void;

  // Get a line from scrollback (0 = most recent, count-1 = oldest)
  getLine(index: number): TerminalLine;

  // Total number of lines in scrollback
  readonly length: number;

  // Clear all scrollback
  clear(): void;

  // Search scrollback for text (returns matching line indices and column ranges)
  search(query: string, caseSensitive: boolean): SearchMatch[];
}
```

When `push()` is called and the buffer is full, the oldest line is overwritten (ring buffer behavior). This provides O(1) push and O(1) random access.

---

### 5.3 PTY (`core/pty/`)

#### `pty-manager.ts` — PTYManager

Abstracts platform differences for PTY creation:

```typescript
class PTYManager {
  // Detect the current platform and spawn a PTY accordingly
  static spawn(options: PTYOptions): PTY;

  // Detect the default shell for the current platform
  static detectDefaultShell(): string;
}
```

Default shell detection:
- **Unix/macOS/Linux:** Read `$SHELL` environment variable. Fallback: `/bin/sh`.
- **Windows:** Read `%COMSPEC%` environment variable. Fallback: `cmd.exe`. Prefer PowerShell if available.
- **iOS:** Not applicable (no shell spawning — use a remote PTY or web-based shell).
- **Android:** Use `/system/bin/sh` or Termux's shell if available.
- **Web:** Not applicable (connect to a remote PTY via WebSocket).

#### `unix-pty.ts` — UnixPTY

Uses Perry's native `child_process` module which supports `forkpty` on Unix platforms:

```typescript
class UnixPTY implements PTY {
  private process: ChildProcess;

  constructor(options: PTYOptions) {
    const shell = options.shell ?? PTYManager.detectDefaultShell();
    const env = {
      ...process.env,
      ...options.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'hone',
    };

    this.process = child_process.spawn(shell, options.args ?? [], {
      cwd: options.cwd ?? process.env.HOME,
      env,
      // Perry-specific: enable PTY mode
      pty: true,
      rows: options.rows ?? 24,
      cols: options.cols ?? 80,
    });
  }

  write(data: string | Uint8Array): void {
    this.process.stdin.write(data);
  }

  resize(rows: number, cols: number): void {
    // Perry sends SIGWINCH and updates the PTY window size
    this.process.resize(rows, cols);
  }

  kill(signal: string = 'SIGHUP'): void {
    this.process.kill(signal);
  }

  onData(handler: (data: Uint8Array) => void): void {
    this.process.stdout.on('data', handler);
  }

  onExit(handler: (code: number, signal?: string) => void): void {
    this.process.on('exit', handler);
  }
}
```

#### `win-conpty.ts` — WinConPTY

Uses Windows ConPTY API via Perry's Windows-specific `child_process` support:

```typescript
class WinConPTY implements PTY {
  private process: ChildProcess;

  constructor(options: PTYOptions) {
    const shell = options.shell ?? PTYManager.detectDefaultShell();
    const env = {
      ...process.env,
      ...options.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    };

    this.process = child_process.spawn(shell, options.args ?? [], {
      cwd: options.cwd ?? process.env.USERPROFILE,
      env,
      // Perry-specific: enable ConPTY mode on Windows
      conpty: true,
      rows: options.rows ?? 24,
      cols: options.cols ?? 80,
    });
  }

  // Same interface as UnixPTY — write, resize, kill, onData, onExit
}
```

---

### 5.4 Input (`core/input/`)

#### `key-encoder.ts` — KeyEncoder

Translates keyboard events from Perry's `perry/ui` event system into VT escape sequences written to the PTY.

**Normal printable characters:** Sent as UTF-8 bytes.

**Modifier encoding for CSI sequences:**

Modifiers are encoded as a parameter in CSI sequences: `CSI 1 ; modifier code <key>`. Modifier codes:
- 2 = Shift
- 3 = Alt
- 4 = Shift+Alt
- 5 = Ctrl
- 6 = Ctrl+Shift
- 7 = Ctrl+Alt
- 8 = Ctrl+Shift+Alt

**Arrow keys:**

| Key | Normal Mode | Application Mode (DECCKM) | With Modifier |
|-----|-------------|--------------------------|---------------|
| Up | `ESC [ A` | `ESC O A` | `ESC [ 1 ; mod A` |
| Down | `ESC [ B` | `ESC O B` | `ESC [ 1 ; mod B` |
| Right | `ESC [ C` | `ESC O C` | `ESC [ 1 ; mod C` |
| Left | `ESC [ D` | `ESC O D` | `ESC [ 1 ; mod D` |

**Function keys:**

| Key | Sequence |
|-----|----------|
| F1 | `ESC O P` (or `ESC [ 11 ~`) |
| F2 | `ESC O Q` (or `ESC [ 12 ~`) |
| F3 | `ESC O R` (or `ESC [ 13 ~`) |
| F4 | `ESC O S` (or `ESC [ 14 ~`) |
| F5 | `ESC [ 15 ~` |
| F6 | `ESC [ 17 ~` |
| F7 | `ESC [ 18 ~` |
| F8 | `ESC [ 19 ~` |
| F9 | `ESC [ 20 ~` |
| F10 | `ESC [ 21 ~` |
| F11 | `ESC [ 23 ~` |
| F12 | `ESC [ 24 ~` |

**Editing keys:**

| Key | Sequence |
|-----|----------|
| Insert | `ESC [ 2 ~` |
| Delete | `ESC [ 3 ~` |
| Home | `ESC [ H` (or `ESC [ 1 ~`) |
| End | `ESC [ F` (or `ESC [ 4 ~`) |
| Page Up | `ESC [ 5 ~` |
| Page Down | `ESC [ 6 ~` |

**Control keys:**

| Key | Byte Value |
|-----|------------|
| Ctrl+A | `0x01` |
| Ctrl+B | `0x02` |
| ... | ... |
| Ctrl+Z | `0x1A` |
| Ctrl+[ | `0x1B` (ESC) |
| Ctrl+\ | `0x1C` |
| Ctrl+] | `0x1D` |
| Ctrl+^ | `0x1E` |
| Ctrl+_ | `0x1F` |
| Ctrl+? | `0x7F` (DEL, same as Backspace) |

**Special keys:**

| Key | Byte |
|-----|------|
| Enter | `\r` (0x0D) |
| Tab | `\t` (0x09) |
| Backspace | `\x7f` (0x7F, DEL) |
| Escape | `\x1b` (0x1B) |

**Alt+key:** Sends `ESC` (0x1B) followed by the key byte. For example, Alt+A sends `\x1b a`.

**Bracketed paste mode:** When enabled (DECSET 2004), pasted text is wrapped:
```
ESC [ 200 ~   <pasted text>   ESC [ 201 ~
```
This allows programs to distinguish typed input from pasted text.

#### `mouse-encoder.ts` — MouseEncoder

Translates mouse events into VT mouse tracking sequences, depending on the active tracking mode.

**Mouse tracking modes:**

| Mode | DECSET | Tracks |
|------|--------|--------|
| X10 | 9 | Button press only |
| Normal | 1000 | Button press and release |
| Button Event | 1002 | Press, release, and drag (motion while button held) |
| Any Event | 1003 | All mouse motion (even without button) |

**Encoding formats:**

**Legacy format (default):**
```
ESC [ M <button+32> <x+32+1> <y+32+1>
```
- Button byte: 0=left, 1=middle, 2=right, 3=release, 32=motion, 64=scroll-up, 65=scroll-down
- Add 4 for Shift, 8 for Alt, 16 for Ctrl
- x and y are 1-indexed and offset by 32 (limits coordinates to 223)

**SGR format (DECSET 1006, preferred):**
```
ESC [ < button ; x ; y M    (press/motion)
ESC [ < button ; x ; y m    (release)
```
- Button: same encoding but not offset by 32
- x, y: 1-indexed, no offset, no upper limit
- Distinguishes press (M) from release (m)

---

### 5.5 TerminalEmulator (`core/emulator.ts`)

The `TerminalEmulator` class is the main orchestrator. It wires together all subsystems:

```
User Input (keyboard, mouse, paste)
    │
    ▼
KeyEncoder / MouseEncoder / BracketedPaste
    │
    ▼
PTY.write(escape sequences)
    │
    ▼
PTY process (shell)
    │
    ▼
PTY.onData(raw bytes)
    │
    ▼
VTParser.feed(data)
    │
    ▼
Parser dispatches actions:
  ├── onPrint → buffer.setCell(cursor, char)
  ├── onExecute → handle C0 controls (BEL, BS, HT, LF, CR, etc.)
  ├── onCsi → CSI handler (cursor movement, erase, SGR, modes, etc.)
  ├── onOsc → OSC handler (title, hyperlinks, clipboard, etc.)
  ├── onDcs → DCS handler
  └── onEsc → ESC handler (DECSC, DECRC, IND, RI, etc.)
    │
    ▼
ScreenBuffer (cells updated, lines marked dirty)
    │
    ▼
CellGrid view-model (dirty lines exposed for rendering)
    │
    ▼
State() reactive binding triggers FFI render call
    │
    ▼
Native renderer (Core Text / DirectWrite / Pango / Canvas / DOM)
```

**C0 Control character handling (onExecute):**

| Code | Name | Action |
|------|------|--------|
| `0x07` | BEL | Emit bell event |
| `0x08` | BS | Move cursor left one column (backspace) |
| `0x09` | HT | Move to next tab stop |
| `0x0A` | LF | Line feed (scroll if at bottom of scroll region) |
| `0x0B` | VT | Same as LF |
| `0x0C` | FF | Same as LF |
| `0x0D` | CR | Carriage return (move cursor to column 0) |
| `0x0E` | SO | Shift Out (switch to G1 character set — for future) |
| `0x0F` | SI | Shift In (switch to G0 character set — for future) |

**ESC sequence handling (onEsc):**

| Sequence | Name | Action |
|----------|------|--------|
| `ESC 7` | DECSC | Save cursor position and attributes |
| `ESC 8` | DECRC | Restore cursor position and attributes |
| `ESC D` | IND | Index (move cursor down; scroll if at bottom of scroll region) |
| `ESC M` | RI | Reverse Index (move cursor up; scroll down if at top of scroll region) |
| `ESC E` | NEL | Next Line (CR + LF) |
| `ESC c` | RIS | Full reset (clear screen, scrollback, reset all modes) |
| `ESC H` | HTS | Set horizontal tab stop at cursor column |
| `ESC =` | DECKPAM | Application keypad mode |
| `ESC >` | DECKPNM | Normal keypad mode |

**Synchronized output (mode 2026):**

When mode 2026 is set, buffer updates are batched. Dirty line tracking accumulates updates without triggering renders. When mode 2026 is reset, all accumulated dirty lines are rendered in a single pass. This prevents flicker during complex screen updates.

**Performance considerations:**

- The parser operates on raw `Uint8Array` data, avoiding string conversions until a printable character is dispatched.
- Dirty tracking ensures only changed lines are re-rendered.
- The CellGrid serializes only dirty rows to JSON for FFI calls, not the entire screen.
- For high-throughput scenarios (e.g., `cat large-file.txt`), the parser batches output and throttles render calls to 60fps. Data continues to be parsed and buffered, but render calls are coalesced.

---

## 6. Perry Integration

### Build Configuration

The `perry.config.ts` file configures the build for each target platform:

```typescript
// perry.config.ts
export default {
  entry: 'core/index.ts',
  name: '@honeide/terminal',
  targets: ['macos', 'ios', 'android', 'windows', 'linux', 'web'],
  ffi: {
    macos: 'native/macos/',
    ios: 'native/ios/',
    android: 'native/android/',
    windows: 'native/windows/',
    linux: 'native/linux/',
    web: 'native/web/',
  },
};
```

Build command per platform:
```bash
perry compile core/index.ts --target macos --bundle-ffi native/macos/
perry compile core/index.ts --target windows --bundle-ffi native/windows/
perry compile core/index.ts --target linux --bundle-ffi native/linux/
perry compile core/index.ts --target ios --bundle-ffi native/ios/
perry compile core/index.ts --target android --bundle-ffi native/android/
perry compile core/index.ts --target web --bundle-ffi native/web/
```

### FFI Contract

Each platform's Rust crate exports the following C-ABI functions:

```rust
/// Create a new terminal rendering view with the given dimensions.
#[no_mangle]
pub extern "C" fn hone_terminal_create(rows: i32, cols: i32) -> *mut TerminalView;

/// Destroy a terminal rendering view and free all associated resources.
#[no_mangle]
pub extern "C" fn hone_terminal_destroy(view: *mut TerminalView);

/// Set the font family and size for the terminal view.
/// `family` is a null-terminated UTF-8 string (e.g., "JetBrains Mono").
#[no_mangle]
pub extern "C" fn hone_terminal_set_font(
    view: *mut TerminalView,
    family: *const c_char,
    size: f64,
);

/// Render a range of rows from the cell grid.
/// `cells_json` is a null-terminated UTF-8 JSON string encoding the cell data
/// for rows [start_row, end_row).
///
/// JSON format: array of rows, each row is an array of cell objects:
/// [{ "c": "A", "fg": [255,255,255], "bg": [0,0,0], "b": true, "i": false, ... }, ...]
#[no_mangle]
pub extern "C" fn hone_terminal_render_cells(
    view: *mut TerminalView,
    cells_json: *const c_char,
    start_row: i32,
    end_row: i32,
);

/// Update the cursor position and style.
/// `style`: 0=block, 1=beam, 2=underline
#[no_mangle]
pub extern "C" fn hone_terminal_set_cursor(
    view: *mut TerminalView,
    row: i32,
    col: i32,
    style: i32,
    visible: bool,
);

/// Resize the terminal view (recalculate layout, font metrics, etc.).
#[no_mangle]
pub extern "C" fn hone_terminal_resize(view: *mut TerminalView, rows: i32, cols: i32);

/// Set the selection highlight regions.
/// `regions_json` is a null-terminated UTF-8 JSON string encoding selection ranges:
/// [{ "start_row": 0, "start_col": 5, "end_row": 2, "end_col": 10 }, ...]
#[no_mangle]
pub extern "C" fn hone_terminal_set_selection(
    view: *mut TerminalView,
    regions_json: *const c_char,
);

/// Scroll the terminal view by the given number of lines (positive = up, negative = down).
/// This controls the viewport offset into the scrollback buffer.
#[no_mangle]
pub extern "C" fn hone_terminal_scroll(view: *mut TerminalView, offset: i32);

/// Set the terminal color theme.
/// `theme_json` is a null-terminated UTF-8 JSON string encoding the TerminalTheme.
#[no_mangle]
pub extern "C" fn hone_terminal_set_theme(view: *mut TerminalView, theme_json: *const c_char);

/// Get the cell dimensions (width, height in pixels) for the current font.
/// Used by TypeScript to calculate rows/cols from pixel dimensions.
#[no_mangle]
pub extern "C" fn hone_terminal_get_cell_size(
    view: *mut TerminalView,
    out_width: *mut f64,
    out_height: *mut f64,
);
```

### Platform Rendering Details

**macOS (`native/macos/`):**
- Uses Core Text for text shaping and rendering
- CTFontRef for font selection with fallback chain
- CGContext for drawing to a backing layer
- Cell-by-cell rendering: each cell is drawn at its grid position using CTLineDraw or CTFontDrawGlyphs
- Background colors rendered as filled rectangles per cell (batched when adjacent cells share the same color)
- Underline/strikethrough rendered as separate draw calls after text
- Selection highlight as a semi-transparent overlay rectangle

**iOS (`native/ios/`):**
- Same Core Text approach as macOS
- Adapted for UIKit integration (CALayer-backed view)
- Touch handling for scroll and selection gestures

**Windows (`native/windows/`):**
- DirectWrite (IDWriteFactory, IDWriteTextFormat, IDWriteTextLayout) for text shaping
- Direct2D (ID2D1RenderTarget) for rendering
- DWriteCreateFactory → CreateTextFormat → CreateTextLayout per cell run
- Batches runs of cells with identical attributes for efficiency

**Linux (`native/linux/`):**
- Pango for text shaping (pango_layout_set_text, pango_layout_get_pixel_extents)
- Cairo for rendering (cairo_show_layout, cairo_rectangle for backgrounds)
- Font loaded via PangoFontDescription
- GTK integration for widget embedding (or standalone X11/Wayland surface)

**Android (`native/android/`):**
- Android Canvas API via JNI (or Skia directly via NDK)
- android.graphics.Paint for font configuration
- canvas.drawText for character rendering
- canvas.drawRect for backgrounds and selection

**Web (`native/web/`):**
- DOM-based rendering using a `<canvas>` element
- CanvasRenderingContext2D for text and rectangle drawing
- ctx.fillText for character rendering
- ctx.fillRect for backgrounds
- Alternatively: a grid of `<span>` elements (slower but better for accessibility and text selection)
- wasm-bindgen for Rust→JS interop

### State() Reactive Bindings

The TypeScript `TerminalEmulator` exposes reactive state via Perry's `State()`:

```typescript
const terminalState = State({
  dirtyRows: [] as number[],
  cursorRow: 0,
  cursorCol: 0,
  cursorStyle: 'block' as 'block' | 'beam' | 'underline',
  cursorVisible: true,
  title: '',
  scrollOffset: 0,
  selectionRanges: [] as SelectionRange[],
});
```

When the parser processes data and updates the buffer, the dirty rows are pushed into `terminalState.dirtyRows`. Perry's reactivity system detects the state change and triggers a re-render:

```typescript
// Reactive render loop
State.effect(() => {
  const dirty = terminalState.dirtyRows;
  if (dirty.length === 0) return;

  const cellGrid = emulator.getCellGrid();
  const json = cellGrid.getCellsJSON(Math.min(...dirty), Math.max(...dirty) + 1);

  // Call FFI to render only the dirty rows
  ffi.hone_terminal_render_cells(view, json, Math.min(...dirty), Math.max(...dirty) + 1);
  ffi.hone_terminal_set_cursor(
    view,
    terminalState.cursorRow,
    terminalState.cursorCol,
    cursorStyleToInt(terminalState.cursorStyle),
    terminalState.cursorVisible,
  );

  cellGrid.markClean();
  terminalState.dirtyRows = [];
});
```

This ensures that:
1. Only dirty rows are serialized and sent to the native renderer
2. Re-renders are batched by Perry's reactive system (no redundant renders within a single frame)
3. The 60fps cap is achieved naturally through frame-aligned state updates

---

## 7. Test Strategy

### VT Parser Unit Tests (`tests/vt-parser/`)

**parser.test.ts — State machine transitions:**
- Feed individual bytes and verify the parser transitions through correct states
- Verify that incomplete sequences are held in the parser state and completed when the rest arrives
- Test that malformed sequences are properly discarded (transition to Ground or CsiIgnore)
- Test C0 controls in the middle of escape sequences (they should be executed immediately)
- Test UTF-8 multi-byte characters are correctly assembled and dispatched to onPrint
- Verify that the parser handles split input (data arriving in arbitrary chunks)

**csi.test.ts — CSI handler tests:**
- **Cursor movement:** CUU, CUD, CUF, CUB, CUP, HVP — verify cursor position after each
- **Erase:** ED 0/1/2/3, EL 0/1/2 — verify correct cells are cleared
- **Scroll:** SU, SD — verify lines shift within scroll region, scrollback receives lines
- **Insert/delete:** IL, DL, ICH, DCH — verify line/cell shifting
- **DECSTBM:** Set scroll region, verify scrolling is constrained
- **DECSET/DECRST:** Toggle modes, verify mode flags on buffer
- **DSR:** Feed CSI 6 n, verify PTY receives cursor position report
- **Cursor style:** CSI n SP q, verify cursor style changes

**sgr.test.ts — SGR attribute tests:**
- Reset (0): all attributes cleared
- Individual attributes (1, 2, 3, 4, 5, 7, 8, 9): each flag set correctly
- Attribute removal (22, 23, 24, 25, 27, 28, 29): flags cleared
- Foreground ANSI (30-37, 90-97): correct indexed color
- Background ANSI (40-47, 100-107): correct indexed color
- 256-color foreground (38;5;n): correct indexed color for n=0..255
- 256-color background (48;5;n): correct indexed color for n=0..255
- Truecolor foreground (38;2;r;g;b): correct RGB values
- Truecolor background (48;2;r;g;b): correct RGB values
- Default colors (39, 49): reset to default
- Combined: `CSI 1;3;38;2;255;100;0m` — bold + italic + orange fg
- Extended underline styles: `CSI 4:3 m` — curly underline

**osc.test.ts — OSC handler tests:**
- OSC 0/1/2: title change events fired with correct title string
- OSC 4: palette color set at correct index
- OSC 7: current directory parsed from file:// URL
- OSC 8: hyperlink start and end, verify cells have correct hyperlink URL
- OSC 8 with id parameter: `ESC ] 8 ; id=foo ; https://example.com ST`
- OSC 52: clipboard read/write with base64 encoding
- OSC 10/11: foreground/background color query responses
- OSC 133: shell integration markers
- BEL termination vs ST termination

**dcs.test.ts — DCS handler tests:**
- DECRQSS: query current SGR, verify response

### Buffer Tests (`tests/buffer/`)

**screen-buffer.test.ts:**
- Initialize buffer, verify dimensions and default cells
- Write characters at cursor, verify cell contents
- Cursor movement and wrapping at line end
- Scroll region: set DECSTBM, scroll within region, verify lines outside region are unaffected
- Alternate buffer: switch to alternate, write, switch back, verify main buffer unchanged
- Resize: shrink cols (truncation), grow cols (blank fill), shrink rows (overflow to scrollback), grow rows (pull from scrollback)
- Origin mode: cursor positioning relative to scroll region
- Insert mode: characters push existing content right
- Tab stops: default every 8 columns, custom tab stops via HTS/TBC
- Dirty tracking: write cell, verify dirty flag, clear dirty, verify clean

**scrollback.test.ts:**
- Push lines, verify retrieval order (most recent first)
- Fill beyond max size, verify oldest lines are overwritten
- Verify ring buffer wraps correctly
- Search in scrollback: case-sensitive and case-insensitive
- Clear scrollback

**cell.test.ts:**
- Default cell values
- Wide character: set 2-wide cell, verify continuation cell
- Overwrite wide character: both cells cleared
- Overwrite continuation cell: original wide cell replaced

### PTY Integration Tests (`tests/pty/`)

**unix-pty.test.ts:**
- Spawn a shell, verify PID is valid
- Write `echo hello\n`, verify output contains "hello"
- Resize PTY, verify no crash
- Kill PTY, verify exit event fires
- Environment variables: verify TERM=xterm-256color is set

**win-conpty.test.ts:**
- Same tests adapted for Windows (ConPTY)
- Spawn cmd.exe, send `echo hello`, verify output

### Emulator Integration Tests (`tests/emulator.test.ts`)

End-to-end tests that feed raw VT data and verify the resulting buffer state:

- Feed `\x1b[31mHello\x1b[0m` → verify "Hello" in red, followed by reset
- Feed `\x1b[2J\x1b[H` → verify screen cleared, cursor at 0,0
- Feed `\x1b[?1049h` → verify alternate buffer active
- Feed `\x1b[?2004h` then paste event → verify bracketed paste sequences sent to PTY
- Feed a full `top` or `htop` screen capture → verify buffer state matches expected
- Feed rapid data (simulate `cat /dev/urandom | xxd`) → verify no crash, no memory leak

### Vttest Compatibility (`tests/vttest/`)

Automated runner for the vttest suite (standard VT100 compatibility test):

1. Spawn a PTY running vttest
2. Navigate through vttest menus programmatically
3. Capture the resulting screen buffer after each test
4. Compare against expected reference screenshots/buffers
5. Report pass/fail for each vttest section

Target: pass all vttest sections for VT100, VT102, and xterm extensions.

### Performance Tests

- **Throughput:** Feed 100MB of random printable data through the parser. Measure time. Target: >100MB/s.
- **Render latency:** Feed data that updates the entire screen. Measure time from data arrival to CellGrid dirty notification. Target: <2ms for a full 80x24 screen update.
- **Render fps:** Continuously feed data, measure actual render frame rate. Target: 60fps sustained.
- **Memory:** Monitor memory usage during `cat large-file.txt` (100K+ lines). Verify scrollback ring buffer caps memory at expected limit.
- **Resize:** Resize terminal during active output. Verify no visual glitches, no lost data, no crash.

---

## 8. Phased Milestones

### Phase 0: Foundation (Weeks 1-3)

**Goal:** Functional VT parser, screen buffer, and macOS native rendering. A terminal that can display static escape-sequence-encoded content.

**Week 1:**
- Implement VTParser state machine (all 14 states, transition table)
- Implement TerminalCell, CellAttributes, Color types
- Implement TerminalLine with dirty tracking
- Implement ScreenBuffer (grid, cursor, basic cell writes)
- Unit tests: parser state transitions, cell defaults

**Week 2:**
- Implement CSI handlers: cursor movement (CUU/CUD/CUF/CUB/CUP), erase (ED/EL), SGR (all attributes, 256-color, truecolor)
- Implement scroll region (DECSTBM) and scroll operations (SU/SD)
- Implement tab stops, insert/delete lines/characters
- Unit tests: all CSI handlers, SGR combinations

**Week 3:**
- Implement macOS FFI crate (Core Text grid renderer)
- Implement CellGrid view-model
- Implement Perry State() reactive rendering bridge
- Wire up: static data → parser → buffer → CellGrid → FFI render
- Integration test: render colored text on macOS

**Deliverable:** A macOS window displaying a static terminal screen rendered from VT escape sequences.

### Phase 1: Interactive Terminal (Weeks 4-6)

**Goal:** Full interactive terminal on macOS/Linux with PTY, keyboard input, scrollback, and mouse support.

**Week 4:**
- Implement UnixPTY (forkpty via Perry child_process)
- Implement KeyEncoder (all key mappings)
- Wire up: keyboard events → KeyEncoder → PTY.write
- Wire up: PTY.onData → VTParser.feed → buffer → render
- First interactive shell session

**Week 5:**
- Implement Scrollback ring buffer
- Implement scrollback navigation (scroll viewport up/down)
- Implement alternate screen buffer (DECSET 1049)
- Implement bracketed paste mode (DECSET 2004)
- Implement DECSET/DECRST for all listed private modes
- Tests: scrollback overflow, alternate buffer switch, bracketed paste

**Week 6:**
- Implement MouseEncoder (X10, normal, SGR modes)
- Implement mouse tracking mode toggling
- Implement selection model (click-drag, double-click word, triple-click line)
- Implement copy-to-clipboard via perry/system
- Implement C0 controls (BEL, BS, HT, LF, CR)
- Implement ESC sequences (DECSC/DECRC, IND, RI, NEL, RIS)
- Tests: mouse encoding, selection, end-to-end emulator tests

**Deliverable:** Fully interactive terminal on macOS and Linux. Can run bash, vim, htop, top. Mouse and keyboard input works. Scrollback with copy support.

### Phase 2: Feature Complete (Weeks 7-9)

**Goal:** Windows support, OSC handlers, search, and advanced features.

**Week 7:**
- Implement WinConPTY (Windows ConPTY via Perry child_process)
- Implement Windows FFI crate (DirectWrite grid renderer)
- Implement OSC handlers: title (0/1/2), current directory (7), hyperlinks (8)
- Tests: Windows PTY, OSC title/hyperlinks

**Week 8:**
- Implement OSC handlers: clipboard (52), shell integration (133), fg/bg query (10/11), palette (4)
- Implement DCS handlers: DECRQSS
- Implement search in scrollback (forward/backward, case-sensitive/insensitive, regex)
- Implement search match highlighting in CellGrid
- Tests: OSC clipboard, search

**Week 9:**
- Implement resize reflow (soft-wrapped lines re-wrap to new width)
- Implement synchronized output (mode 2026)
- Implement cursor style changes (CSI n SP q)
- Implement device status reports (DSR)
- Performance optimization: throttle renders during high throughput, batch dirty rows
- Run vttest suite, fix any failures
- Tests: resize reflow, synchronized output, vttest

**Deliverable:** Feature-complete terminal on macOS, Linux, and Windows. OSC hyperlinks, clipboard integration, search, and shell integration all working.

### Phase 3: All Platforms & Polish (Weeks 10-12)

**Goal:** iOS, Android, and Web rendering. Performance polish. Publish v0.1.0.

**Week 10:**
- Implement Linux FFI crate (Pango/Cairo grid renderer)
- Implement iOS FFI crate (Core Text, adapted for UIKit)
- Implement iOS touch gestures (scroll, select, zoom)
- Tests: Linux and iOS rendering

**Week 11:**
- Implement Android FFI crate (Canvas/Skia grid renderer)
- Implement Web FFI crate (Canvas + wasm-bindgen)
- Implement Web-specific features: WebSocket PTY proxy, DOM accessibility
- Tests: Android and Web rendering

**Week 12:**
- Performance profiling and optimization across all platforms
- Memory leak auditing (long-running terminal sessions)
- Accessibility: screen reader support on Web (ARIA), VoiceOver hints on macOS/iOS
- Documentation: API reference, integration guide, examples
- Publish `@honeide/terminal` v0.1.0 to Perry package registry
- Create standalone-terminal example app

**Deliverable:** `@honeide/terminal` v0.1.0 published. All 6 platforms supported. Passes vttest. Performance targets met (60fps, <2ms render latency).

---

## 9. Open Questions / Risks

### PTY Support in Perry's `child_process`

**Risk: High**

Perry's `child_process` module needs to support `forkpty` (Unix) or ConPTY (Windows) for proper PTY spawning. Standard `child_process.spawn` with piped stdio is not sufficient because:
- The child process needs a controlling terminal (for `isatty()` checks)
- Terminal dimensions (rows, cols) must be communicated to the child via the PTY
- SIGWINCH must be delivered on resize
- Raw mode I/O is required (no line buffering)

If Perry does not currently support this, a Perry contribution (or a custom FFI crate wrapping `forkpty`/`openpty` on Unix and `CreatePseudoConsole` on Windows) will be needed. This is a **blocking dependency** for Phase 1.

**Mitigation:** Investigate Perry's current `child_process` capabilities early. If PTY support is missing, implement a Rust FFI crate (`native/pty-ffi/`) that wraps the platform PTY APIs and exposes them to TypeScript.

### SIXEL Graphics Support

**Risk: Low**

SIXEL is a legacy graphics protocol that allows inline images in the terminal. Support is complex (pixel-level rendering within the character grid, palette management, scrolling behavior) and rarely used by modern applications.

**Decision:** Defer SIXEL to post-v1.0. For v0.1.0, the DCS handler will parse the SIXEL header but discard pixel data. This prevents the parser from breaking on SIXEL input while avoiding the implementation cost.

### Wide Character (CJK) Handling

**Risk: Medium**

CJK characters (Chinese, Japanese, Korean) occupy 2 cells in the terminal grid. This requires:
- Accurate Unicode East Asian Width detection (lookup table or library)
- Correct handling when overwriting a wide character (both cells must be cleared)
- Correct cursor advancement (cursor moves 2 columns for a wide character)
- Correct selection handling (selecting a wide character selects both cells)
- Correct rendering (the native FFI crate must render the character spanning 2 cell widths)

**Mitigation:** Implement a lookup table based on Unicode 15.0 East Asian Width property. Test with CJK text extensively. Handle edge cases: wide character at last column (should wrap to next line), overwriting half of a wide character.

### Ligature Support in Terminal Fonts

**Risk: Low**

Some terminal fonts (Fira Code, JetBrains Mono) support programming ligatures (e.g., `->` renders as an arrow). In a terminal, ligatures are problematic because:
- Each cell is independently addressable — a ligature spanning multiple cells breaks this model
- Cursor positioning within a ligature is ambiguous
- Overwriting one character of a ligature should break the ligature

**Decision:** Disable ligatures in the terminal renderer by default. Individual characters are rendered independently. Optionally, ligatures could be supported as a "visual-only" feature where the renderer detects ligature-forming sequences and renders them as a single glyph spanning multiple cells, but the underlying cell model remains unchanged. This is a post-v1.0 feature.

### Windows ConPTY vs winpty Compatibility

**Risk: Medium**

ConPTY is the modern Windows pseudo-console API (Windows 10 1809+). Older systems may need `winpty` as a fallback. ConPTY has known issues:
- Early versions had bugs with cursor positioning and VT sequence passthrough
- Some applications detect ConPTY and alter their behavior
- ConPTY adds its own VT translation layer, which can interfere with raw VT sequences

**Mitigation:** Target ConPTY as the primary implementation (modern Windows). If issues arise, consider adding a `winpty` fallback for older systems. Require Windows 10 1809+ as the minimum Windows version.

### Reflow on Resize

**Risk: Medium**

When the terminal is resized (cols change), soft-wrapped lines should ideally be reflowed (re-wrapped to the new width). This is complex because:
- Lines in the scrollback and screen buffer need to be joined and re-split
- Cursor position must be recalculated relative to the reflowed content
- Applications running in the terminal may also respond to the resize (sending new output), creating a race condition
- Some lines should not be reflowed (hard-wrapped lines, i.e., lines ending with an explicit newline)

**Mitigation:** Implement basic reflow in Phase 2 (Week 9). Use the `wrapped` flag on TerminalLine to distinguish soft-wrapped from hard-wrapped lines. Only reflow soft-wrapped lines. Accept that some edge cases (cursor in the middle of a reflowed paragraph) may not be perfect in v0.1.0.

### Performance Under High Throughput

**Risk: Medium**

Commands like `cat very-large-file.txt` or `yes` can produce output faster than the terminal can render. Without throttling:
- The render loop could consume 100% CPU trying to keep up
- The UI could become unresponsive
- Memory could grow if data queues faster than it is processed

**Mitigation:**
1. Decouple parsing from rendering: the parser always processes incoming data immediately (keeping the buffer up to date), but render calls are throttled to 60fps via requestAnimationFrame or a frame timer.
2. During high throughput, skip intermediate renders — only render the latest buffer state each frame.
3. Implement back-pressure: if the render queue exceeds a threshold, pause PTY reads briefly to let the renderer catch up.
4. Measure and optimize the hot path: VTParser.feed → buffer updates → dirty tracking. Target <1ms for processing a 4KB chunk.

### iOS and Android Shell Access

**Risk: Medium**

iOS does not allow spawning shell processes due to sandboxing restrictions. Android has limited shell access (requires root or Termux-like environments).

**Mitigation:**
- On iOS: the terminal component connects to a remote PTY via WebSocket (e.g., SSH to a server). No local shell.
- On Android: support local shell if available (`/system/bin/sh`), otherwise fall back to remote PTY.
- The PTYManager abstraction already accounts for this — platforms without local PTY support use a `RemotePTY` implementation that communicates over `net` (WebSocket/TCP).

### Web Platform Rendering Performance

**Risk: Low-Medium**

Canvas-based rendering on the Web may be slower than native rendering on other platforms, especially for large terminal grids or rapid updates.

**Mitigation:**
- Use `CanvasRenderingContext2D` with pre-measured font metrics to avoid layout thrashing.
- Cache glyph renders in an off-screen canvas (glyph atlas) to avoid re-shaping text each frame.
- Consider WebGL for hardware-accelerated rendering (post-v1.0).
- As a fallback, offer a DOM-based renderer using a grid of pre-styled `<span>` elements, which can leverage browser text rendering optimizations but may be slower for full-screen updates.
