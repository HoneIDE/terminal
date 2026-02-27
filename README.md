# hone-terminal

Cross-platform terminal emulator component for the Hone ecosystem. Published as `@honeide/terminal` — any Perry application can embed a fully functional terminal with minimal integration effort.

**Compatibility target:** `xterm-256color`

## Features

- **VT100/xterm parser** — 14-state machine handling CSI, OSC, DCS, ESC sequences
- **256-color + truecolor** — ANSI 16, indexed 0–255, and 24-bit RGB via SGR
- **Text attributes** — bold, italic, underline (single/double/curly), strikethrough, dim, inverse, invisible
- **Mouse tracking** — X10, normal/button, SGR/1006 extended modes
- **Alternate screen buffer** — DECSET 1049 for vim, less, htop, etc.
- **Bracketed paste** — DECSET 2004
- **Hyperlinks** — OSC 8 inline hyperlinks
- **Wide characters** — CJK double-width support
- **Scrollback** — configurable ring buffer (default 10,000 lines)
- **Shell integration** — OSC 133 prompt/command/output markers
- **Selection, copy, search** — across visible buffer and scrollback
- **Native rendering** — Core Text (macOS), Direct2D + DirectWrite (Windows), with FFI bridge for all 6 platforms

## Architecture

```
core/                   TypeScript terminal engine
  buffer/               Cell, Line, ScreenBuffer, Scrollback
  vt-parser/            14-state VT parser + CSI/OSC/DCS handlers
  input/                Key encoder, Mouse encoder
  pty/                  PTY abstraction (Unix, ConPTY)
  emulator.ts           TerminalEmulator — orchestrates everything

view-model/             Rendering bridge
  cell-grid.ts          Translates buffer state → RenderCell JSON for FFI
  theme.ts              DARK_THEME, LIGHT_THEME, 256-color palette
  cursor.ts             Cursor blink controller
  selection.ts          Selection state + range computation
  search.ts             Search state + match tracking

native/                 FFI bridge layer
  ffi-bridge.ts         NativeTerminalFFI interface contract
  render-coordinator.ts Dirty-tracking coordinator: emulator → FFI calls
  macos/                Rust crate: Core Text + Core Graphics renderer
    src/lib.rs          10 #[no_mangle] extern "C" FFI functions
    src/terminal_view.rs TerminalView state + draw() method
    src/grid_renderer.rs CTFont rendering with bold/italic variants
    src/view.rs         HoneTerminalView NSView subclass
  windows/              Rust crate: Direct2D + DirectWrite renderer
    src/lib.rs          10 #[no_mangle] extern "C" FFI functions
    src/terminal_view.rs TerminalView state + draw() via ID2D1RenderTarget
    src/grid_renderer.rs IDWriteTextFormat rendering with bold/italic variants
    src/view.rs         HoneTerminalView Win32 HWND + WndProc

perry/                  Perry component API
  terminal-component.ts declare function FFI bindings + Terminal class
  index.ts              Public exports

examples/
  standalone-terminal/  Perry demo app with native rendering
```

## Usage in a Perry app

```typescript
import { Terminal } from '@honeide/terminal/perry';

const terminal = new Terminal(80, 24, {
  theme: 'dark',
  fontFamily: 'JetBrains Mono',
  fontSize: 14,
});

await terminal.open({ shell: '/bin/zsh' });
```

## Usage in TypeScript (without Perry)

```typescript
import { TerminalEmulator } from '@honeide/terminal';
import { NoOpFFI } from '@honeide/terminal/perry';

const emulator = new TerminalEmulator(24, 80, 10000);
emulator.write('\x1b[32mHello\x1b[0m world');
```

## Building the demo

Prerequisites: [Perry](https://perry.dev) v0.2.162+, Rust toolchain, Bun

### macOS

```bash
./examples/standalone-terminal/build.sh
./examples/standalone-terminal/hone-terminal-demo
```

### Windows

```bat
examples\standalone-terminal\build-windows.bat
examples\standalone-terminal\hone-terminal-demo.exe
```

The demo opens two windows:
1. **Perry UI** — info panel with a "Show Terminal" button
2. **Native rendering** — 80x24 terminal grid rendered via Core Text (macOS) or Direct2D (Windows), showing colors, attributes, cursor, and a simulated shell session

You can also run the Rust-only demo (no Perry needed):

```bash
# macOS
cd native/macos
cargo run --example demo_terminal

# Windows
cd native/windows
cargo run --example demo_terminal
```

## Testing

```bash
bun test           # 163 tests across 10 files
bun test --watch   # Watch mode
```

## FFI Contract

The native rendering layer exposes 10 `extern "C"` functions (plus `hone_terminal_show_demo` for the demo). Every platform implements the same `NativeTerminalFFI` interface:

| Function | Description |
|----------|-------------|
| `hone_terminal_create(rows, cols)` | Create view, return opaque handle |
| `hone_terminal_destroy(handle)` | Free all resources |
| `hone_terminal_set_font(handle, family, size)` | Set font family + size |
| `hone_terminal_render_cells(handle, json, start, end)` | Render cell grid rows |
| `hone_terminal_set_cursor(handle, row, col, style, visible)` | Update cursor |
| `hone_terminal_resize(handle, rows, cols)` | Resize grid |
| `hone_terminal_set_selection(handle, json)` | Set selection highlights |
| `hone_terminal_scroll(handle, offset)` | Scroll into scrollback |
| `hone_terminal_set_theme(handle, json)` | Set color theme |
| `hone_terminal_get_cell_size(handle, *w, *h)` | Get cell pixel dimensions |

Cell data is passed as JSON arrays of `RenderCell` objects:

```json
{"c":"A","fg":[205,214,244],"bg":[30,30,46],"b":true,"i":false,"u":false,"s":false,"d":false,"v":false,"w":1}
```

## License

MIT
