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

# Perry demo app
./examples/standalone-terminal/build.sh   # Full build (Rust + Perry + link)
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

## Key conventions

- **No `const enum`** — Perry doesn't support TypeScript `const enum`. Use plain numeric constants with a companion object (`State_Ground = 0; const State = { Ground: State_Ground } as const`).
- **Perry closure limitations** — Perry has codegen bugs with many closures/callbacks. The emulator's `setupParser()` uses `.bind(this)` methods instead of arrow functions. Some modules can't be imported in Perry demos due to closure ID off-by-one errors.
- **FFI string passing** — Perry passes strings as `i64` pointers. In `declare function`, string params use `number` type and are cast with `as any`. Rust receives `*const c_char`.
- **FFI wrapper symbols** — Perry calls `__wrapper_<function_name>` (double underscore prefix). The Rust crate must export both `<function_name>` and `__wrapper_<function_name>`.
- **Heap allocation for FFI views** — When creating NSView-backed objects in FFI functions, use `Box::leak(Box::new(...))` to keep the allocation alive. Stack-allocated views cause use-after-free in draw callbacks.
- **JSON for complex data** — Cell grids, selections, themes, and tokens are serialized as JSON strings across the FFI boundary. Rust uses `serde_json` to deserialize.

## Perry demo build process

Perry doesn't yet auto-link FFI crates. The manual process is:

1. `cargo build --release` in `native/macos/` → produces `libhone_terminal_macos.a`
2. `perry compile main.ts --no-link --keep-intermediates` → produces `main_ts.o`
3. `clang++ main_ts.o -lhone_terminal_macos -lperry_runtime -lperry_stdlib -lperry_ui_macos -framework AppKit ...` → linked binary

The `examples/standalone-terminal/build.sh` script automates this.

## Test structure

Tests use Bun's built-in test runner. All tests are in `tests/` mirroring `core/` structure:

- `tests/buffer/` — cell, screen-buffer, scrollback
- `tests/vt-parser/` — parser state machine, CSI dispatch, OSC dispatch, SGR attributes
- `tests/input/` — key encoding, mouse encoding
- `tests/emulator.test.ts` — integration tests for the full emulator

## Dependencies

- **TypeScript**: zero runtime dependencies (Bun for testing only)
- **Rust (macOS)**: core-text, core-graphics, cocoa, objc, serde_json, core-foundation-sys
