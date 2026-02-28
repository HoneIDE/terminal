//! demo_terminal — standalone X11 window with a terminal character grid.
//!
//! This demonstrates the native rendering layer without Perry or a PTY.
//! It creates an X11 window, populates the grid with sample content
//! (colored text, cursor styles, attributes), and renders via Cairo + Pango.
//!
//! Run:
//!   cargo run --example demo_terminal
//!
//! This is the Rust-side equivalent of the Perry demo app, useful for
//! testing the FFI crate in isolation before Perry integration.

use hone_terminal_linux::terminal_view::TerminalView;

fn main() {
    let cols: usize = 80;
    let rows: usize = 24;

    let mut terminal_view = TerminalView::new(rows, cols);

    // Populate sample content
    hone_terminal_linux::populate_demo_cells(&mut terminal_view, cols);

    // Run the demo window (blocking X11 event loop)
    hone_terminal_linux::view::run_demo_window(terminal_view);
}
