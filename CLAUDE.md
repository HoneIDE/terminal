# CLAUDE.md — hone-terminal

## Project overview

`hone-terminal` (`@honeide/terminal`) is a cross-platform terminal emulator component for Perry applications. It follows the same architecture as `../hone-editor` — TypeScript core logic with platform-native rendering via Rust FFI crates.

## Commands

```bash
bun test                    # Run all 163 tests (10 files, ~44ms)
bun test --watch            # Watch mode
npx tsc --noEmit            # Type check

# Rust FFI crate (macOS)
cd native/macos
cargo check                 # Type check Rust
cargo build --release       # Build libhone_terminal_macos.a
cargo run --example demo_terminal  # Standalone Rust demo

# Rust FFI crate (Windows)
cd native/windows
cargo check                 # Type check Rust
cargo build --release       # Build hone_terminal_windows.lib
cargo run --example demo_terminal  # Standalone Rust demo

# Perry demo app (macOS)
./examples/standalone-terminal/build.sh   # Full build (Rust + Perry + link)
./examples/standalone-terminal/hone-terminal-demo  # Run

# Rust FFI crate (Linux)
cd native/linux
cargo check                 # Type check Rust
cargo build --release       # Build libhone_terminal_linux.a
cargo run --example demo_terminal  # Standalone Rust demo

# Perry demo app (Windows)
examples\standalone-terminal\build-windows.bat
examples\standalone-terminal\hone-terminal-demo.exe

# Perry demo app (Linux)
./examples/standalone-terminal/build-linux.sh   # Full build (Rust + Perry + link)
./examples/standalone-terminal/hone-terminal-demo  # Run
```

## Architecture

### TypeScript layers

- **`core/`** — Terminal engine. `TerminalEmulator` orchestrates VT parser, screen buffer, scrollback, PTY, and input encoding. Zero external dependencies for parsing.
- **`core/vt-parser/`** — 14-state VT100/xterm parser. Uses plain numeric constants (not `const enum`) for Perry compatibility.
- **`core/buffer/`** — `ScreenBuffer` (active grid) + `Scrollback` (ring buffer). Dirty-line tracking for incremental rendering.
- **`core/input/`** — Key encoder (xterm sequences) and mouse encoder (SGR mode).
- **`view-model/`** — `CellGrid` translates buffer state to `RenderCell` JSON for FFI. Theme, cursor, selection, search state.
- **`perry/`** — Perry component API. `Terminal` class wraps emulator + render coordinator. `declare function` FFI bindings resolved by Perry codegen.
- **`native/`** — `NativeTerminalFFI` interface contract + `NativeRenderCoordinator` (dirty-tracking bridge from emulator to FFI calls). `NoOpFFI` for testing.

### Rust FFI (macOS)

- **`native/macos/src/lib.rs`** — 10 `#[no_mangle] extern "C"` functions + `hone_terminal_show_demo` demo function. Perry expects `__wrapper_<name>` symbol convention.
- **`native/macos/src/terminal_view.rs`** — `TerminalView` struct: cell grid, cursor, selection, theme. `draw()` renders via Core Graphics (backgrounds → selection → text → cursor).
- **`native/macos/src/grid_renderer.rs`** — Core Text font rendering. `FontSet` with normal/bold/italic/bold-italic variants via `clone_with_symbolic_traits`.
- **`native/macos/src/view.rs`** — `HoneTerminalView` NSView subclass registered via objc runtime. Handles drawRect, keyboard, mouse, scroll input.

### Rust FFI (Windows)

- **`native/windows/src/lib.rs`** — 10 `#[no_mangle] extern "C"` functions + `hone_terminal_show_demo` demo function. Same FFI contract as macOS. Default font: Consolas.
- **`native/windows/src/terminal_view.rs`** — `TerminalView` struct: same data model as macOS. `draw()` renders via `ID2D1RenderTarget` (Direct2D). Uses `InvalidateRect` for redraw.
- **`native/windows/src/grid_renderer.rs`** — DirectWrite font rendering. `FontSet` with 4 `IDWriteTextFormat` variants (weight/style params). Fallback: Consolas → Courier New.
- **`native/windows/src/view.rs`** — `HoneTerminalView` Win32 `WNDCLASSEXW` + `WndProc`. Handles WM_PAINT (Direct2D), WM_SIZE (render target resize), WM_CHAR/KEYDOWN, WM_LBUTTONDOWN, WM_MOUSEWHEEL.

### Rust FFI (Linux)

- **`native/linux/src/lib.rs`** — 10 `#[no_mangle] extern "C"` functions + `hone_terminal_show_demo` demo function. Same FFI contract as macOS/Windows. Default font: DejaVu Sans Mono.
- **`native/linux/src/terminal_view.rs`** — `TerminalView` struct: same data model as macOS/Windows. `draw()` renders via Cairo context (backgrounds → selection → text → cursor). Uses `XSendEvent` Expose for redraw.
- **`native/linux/src/grid_renderer.rs`** — Pango font rendering. `FontSet` with 4 `pango::FontDescription` variants (weight/style). Font fallback handled by Pango + fontconfig automatically.
- **`native/linux/src/view.rs`** — X11 window via `XCreateSimpleWindow`. Blocking event loop handles Expose (Cairo XlibSurface), ConfigureNotify, KeyPress, ButtonPress, ClientMessage (WM_DELETE_WINDOW).

## Key conventions

- **No `const enum`** — Perry doesn't support TypeScript `const enum`. Use plain numeric constants with a companion object (`State_Ground = 0; const State = { Ground: State_Ground } as const`).
- **Perry closure limitations** — Perry has codegen bugs with many closures/callbacks. The emulator's `setupParser()` uses `.bind(this)` methods instead of arrow functions. Some modules can't be imported in Perry demos due to closure ID off-by-one errors.
- **FFI string passing** — Perry passes strings as `i64` pointers. In `declare function`, string params use `number` type and are cast with `as any`. Rust receives `*const c_char`.
- **FFI wrapper symbols** — Perry calls `__wrapper_<function_name>` (double underscore prefix). The Rust crate must export both `<function_name>` and `__wrapper_<function_name>`.
- **Heap allocation for FFI views** — When creating NSView-backed objects in FFI functions, use `Box::leak(Box::new(...))` to keep the allocation alive. Stack-allocated views cause use-after-free in draw callbacks.
- **JSON for complex data** — Cell grids, selections, themes, and tokens are serialized as JSON strings across the FFI boundary. Rust uses `serde_json` to deserialize.

## Perry demo build process

Perry doesn't yet auto-link FFI crates. The manual process is:

**macOS:**
1. `cargo build --release` in `native/macos/` → produces `libhone_terminal_macos.a`
2. `perry compile main.ts --no-link --keep-intermediates` → produces `main_ts.o`
3. `clang++ main_ts.o -lhone_terminal_macos -lperry_runtime -lperry_stdlib -lperry_ui_macos -framework AppKit ...` → linked binary

The `examples/standalone-terminal/build.sh` script automates this.

**Windows:**
1. `cargo build --release` in `native/windows/` → produces `hone_terminal_windows.lib`
2. `perry compile main.ts --no-link --keep-intermediates` → produces `main_ts.obj`
3. `link.exe main_ts.obj hone_terminal_windows.lib perry_runtime.lib ... d2d1.lib dwrite.lib user32.lib ...` → linked binary

The `examples/standalone-terminal/build-windows.bat` script automates this.

**Linux:**
1. `cargo build --release` in `native/linux/` → produces `libhone_terminal_linux.a`
2. `perry compile main.ts --no-link --keep-intermediates` → produces `main_ts.o`
3. `clang++ main_ts.o -lhone_terminal_linux -lperry_runtime -lperry_stdlib -lperry_ui_linux $(pkg-config --libs pango pangocairo cairo x11) ...` → linked binary

The `examples/standalone-terminal/build-linux.sh` script automates this.

## Test structure

Tests use Bun's built-in test runner. All tests are in `tests/` mirroring `core/` structure:

- `tests/buffer/` — cell, screen-buffer, scrollback
- `tests/vt-parser/` — parser state machine, CSI dispatch, OSC dispatch, SGR attributes
- `tests/input/` — key encoding, mouse encoding
- `tests/emulator.test.ts` — integration tests for the full emulator

## Windows-specific notes

- **COM initialization** — Direct2D/DirectWrite require `CoInitializeEx(COINIT_APARTMENTTHREADED)` before use.
- **`windows` crate features** — `Foundation_Numerics` is required for `CreateSolidColorBrush` and other D2D rendering methods. Parent interface methods (e.g. `ID2D1RenderTarget` methods) are not inherited via Deref in v0.58; use `Interface::cast()` to access them from `ID2D1HwndRenderTarget`.
- **Render target recreation** — Handle `D2DERR_RECREATE_TARGET` from `EndDraw()` by discarding and recreating on next WM_PAINT.
- **`BeginPaint`/`EndPaint`** — Must call in WM_PAINT even though D2D renders independently, otherwise WM_PAINT re-posts infinitely.

## Linux-specific notes

- **System libraries** — Requires cairo, pango, and X11 development headers. Install: `libcairo2-dev libpango1.0-dev libx11-dev` (Debian/Ubuntu), `cairo-devel pango-devel libX11-devel` (Fedora), `cairo pango libx11` (Arch).
- **Cairo XlibSurface** — Created per-Expose event from the X11 display/window/visual. Surface size updated on ConfigureNotify.
- **Pango font metrics** — Use `pango::SCALE` (1024) when setting font sizes. Metrics from `Context::metrics()` are in Pango units; divide by `SCALE` for pixels.
- **Font fallback** — Pango delegates to fontconfig, which handles system-wide font substitution. No manual fallback chain needed.
- **Coordinate system** — Cairo + X11 both use top-left origin with Y-down, so no coordinate flipping is needed (unlike macOS Core Graphics).

## Dependencies

- **TypeScript**: zero runtime dependencies (Bun for testing only)
- **Rust (macOS)**: core-text, core-graphics, cocoa, objc, serde_json, core-foundation-sys
- **Rust (Windows)**: windows (v0.58, Direct2D + DirectWrite + Win32), serde_json
- **Rust (Linux)**: cairo-rs (0.20, xlib feature), pango (0.20), pangocairo (0.20), x11 (2.21, xlib feature), serde_json
