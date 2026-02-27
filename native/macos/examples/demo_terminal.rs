//! demo_terminal — standalone macOS window with a terminal character grid.
//!
//! This demonstrates the native rendering layer without Perry or a PTY.
//! It creates an NSWindow, populates the grid with sample content
//! (colored text, cursor styles, attributes), and renders via Core Text.
//!
//! Run:
//!   cargo run --example demo_terminal
//!
//! This is the Rust-side equivalent of the Perry demo app, useful for
//! testing the FFI crate in isolation before Perry integration.

use std::ffi::CString;

use cocoa::appkit::{
    NSApp, NSApplication, NSApplicationActivationPolicyRegular, NSBackingStoreBuffered, NSWindow,
    NSWindowStyleMask,
};
use cocoa::base::{id, nil};
use cocoa::foundation::{NSAutoreleasePool, NSPoint, NSRect, NSSize, NSString};
use objc::{class, msg_send, sel, sel_impl};

use hone_terminal_macos::terminal_view::TerminalView;

fn main() {
    unsafe {
        let _pool = NSAutoreleasePool::new(nil);

        // Initialize NSApplication
        let app = NSApp();
        app.setActivationPolicy_(NSApplicationActivationPolicyRegular);

        // Create window
        let cols: usize = 80;
        let rows: usize = 24;

        let mut terminal_view = TerminalView::new(rows, cols);
        let cell_w = terminal_view.renderer.font_set.char_width;
        let cell_h = terminal_view.renderer.font_set.line_height;
        let win_width = cols as f64 * cell_w + 20.0;  // 10px padding each side
        let win_height = rows as f64 * cell_h + 40.0; // title bar + padding

        let style = NSWindowStyleMask::NSTitledWindowMask
            | NSWindowStyleMask::NSClosableWindowMask
            | NSWindowStyleMask::NSResizableWindowMask
            | NSWindowStyleMask::NSMiniaturizableWindowMask;

        let window = NSWindow::alloc(nil).initWithContentRect_styleMask_backing_defer_(
            NSRect::new(
                NSPoint::new(200.0, 200.0),
                NSSize::new(win_width, win_height),
            ),
            style,
            NSBackingStoreBuffered,
            false,
        );

        let title = NSString::alloc(nil).init_str("Hone Terminal — Native Demo");
        window.setTitle_(title);
        window.makeKeyAndOrderFront_(nil);
        window.center();

        // Populate sample content
        populate_demo_content(&mut terminal_view, cols);

        // Create NSView and attach to window
        let content_frame = NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(cols as f64 * cell_w, rows as f64 * cell_h),
        );
        let nsview = hone_terminal_macos::view::create_nsview(&mut terminal_view, content_frame);

        let content_view: id = msg_send![window, contentView];
        let _: () = msg_send![content_view, addSubview: nsview];

        // Activate and run
        let _: () = msg_send![app, activateIgnoringOtherApps: true];
        app.run();
    }
}

/// Populate the terminal grid with demo content showcasing various features.
fn populate_demo_content(view: &mut TerminalView, cols: usize) {
    // Helper to write a string to a row starting at a column
    fn write_text(
        view: &mut TerminalView,
        row: usize,
        col: usize,
        text: &str,
        fg: [u8; 3],
        bg: [u8; 3],
        bold: bool,
        italic: bool,
    ) {
        for (i, ch) in text.chars().enumerate() {
            let c = col + i;
            if c < view.cols && row < view.rows {
                view.cells[row][c].c = ch.to_string();
                view.cells[row][c].fg = fg;
                view.cells[row][c].bg = bg;
                view.cells[row][c].b = bold;
                view.cells[row][c].i = italic;
            }
        }
    }

    let white = [205, 214, 244];
    let bg = [30, 30, 46];
    let red = [243, 139, 168];
    let green = [166, 227, 161];
    let blue = [137, 180, 250];
    let yellow = [249, 226, 175];
    let magenta = [203, 166, 247];
    let cyan = [148, 226, 213];
    let dim_white = [108, 112, 134];

    // Title
    write_text(view, 0, 2, "Hone Terminal — Native Rendering Demo", yellow, bg, true, false);

    // Separator
    let sep: String = "─".repeat(cols - 4);
    write_text(view, 1, 2, &sep, dim_white, bg, false, false);

    // Color showcase
    write_text(view, 3, 2, "Colors:", white, bg, true, false);
    write_text(view, 3, 12, "Red", red, bg, false, false);
    write_text(view, 3, 18, "Green", green, bg, false, false);
    write_text(view, 3, 26, "Blue", blue, bg, false, false);
    write_text(view, 3, 34, "Yellow", yellow, bg, false, false);
    write_text(view, 3, 43, "Magenta", magenta, bg, false, false);
    write_text(view, 3, 53, "Cyan", cyan, bg, false, false);

    // Attributes
    write_text(view, 5, 2, "Attributes:", white, bg, true, false);
    write_text(view, 5, 15, "Bold", white, bg, true, false);
    write_text(view, 5, 22, "Italic", white, bg, false, true);
    write_text(view, 5, 31, "Bold+Italic", white, bg, true, true);

    // Underline
    let ul_col = 45;
    write_text(view, 5, ul_col, "Underline", white, bg, false, false);
    for i in 0..9 {
        view.cells[5][ul_col + i].u = true;
    }

    // Strikethrough
    let st_col = 57;
    write_text(view, 5, st_col, "Strikethrough", white, bg, false, false);
    for i in 0..13 {
        view.cells[5][st_col + i].s = true;
    }

    // Background colors
    write_text(view, 7, 2, "Backgrounds:", white, bg, true, false);
    write_text(view, 7, 16, " Red ", [30, 30, 46], [243, 139, 168], false, false);
    write_text(view, 7, 23, " Green ", [30, 30, 46], [166, 227, 161], false, false);
    write_text(view, 7, 32, " Blue ", [30, 30, 46], [137, 180, 250], false, false);
    write_text(view, 7, 40, " Yellow ", [30, 30, 46], [249, 226, 175], false, false);

    // Simulated shell prompt
    write_text(view, 9, 2, &sep, dim_white, bg, false, false);
    write_text(view, 11, 2, "user@hone", green, bg, true, false);
    write_text(view, 11, 11, ":", white, bg, false, false);
    write_text(view, 11, 12, "~/projects/terminal", blue, bg, true, false);
    write_text(view, 11, 31, "$ ", white, bg, false, false);
    write_text(view, 11, 33, "ls -la", white, bg, false, false);

    // Simulated ls output
    write_text(view, 12, 2, "drwxr-xr-x  12 user  staff    384 Feb 27 16:24 ", dim_white, bg, false, false);
    write_text(view, 12, 48, ".", blue, bg, true, false);
    write_text(view, 13, 2, "drwxr-xr-x   6 user  staff    192 Feb 27 12:13 ", dim_white, bg, false, false);
    write_text(view, 13, 48, "..", blue, bg, true, false);
    write_text(view, 14, 2, "-rw-r--r--   1 user  staff   1247 Feb 27 16:34 ", dim_white, bg, false, false);
    write_text(view, 14, 48, "package.json", white, bg, false, false);
    write_text(view, 15, 2, "-rw-r--r--   1 user  staff    524 Feb 27 16:34 ", dim_white, bg, false, false);
    write_text(view, 15, 48, "tsconfig.json", white, bg, false, false);
    write_text(view, 16, 2, "drwxr-xr-x   8 user  staff    256 Feb 27 16:34 ", dim_white, bg, false, false);
    write_text(view, 16, 48, "core/", cyan, bg, true, false);
    write_text(view, 17, 2, "drwxr-xr-x   5 user  staff    160 Feb 27 16:34 ", dim_white, bg, false, false);
    write_text(view, 17, 48, "native/", cyan, bg, true, false);
    write_text(view, 18, 2, "drwxr-xr-x   3 user  staff     96 Feb 27 16:34 ", dim_white, bg, false, false);
    write_text(view, 18, 48, "perry/", cyan, bg, true, false);

    // Next prompt
    write_text(view, 20, 2, "user@hone", green, bg, true, false);
    write_text(view, 20, 11, ":", white, bg, false, false);
    write_text(view, 20, 12, "~/projects/terminal", blue, bg, true, false);
    write_text(view, 20, 31, "$ ", white, bg, false, false);

    // Block cursor at the prompt
    view.cursor = hone_terminal_macos::terminal_view::CursorState {
        row: 20,
        col: 33,
        style: 0, // Block
        visible: true,
    };

    // Status line
    write_text(view, 23, 2, " NORMAL ", [30, 30, 46], [166, 227, 161], true, false);
    write_text(view, 23, 12, " 80×24 ", [30, 30, 46], [137, 180, 250], false, false);
    write_text(view, 23, 21, " xterm-256color ", dim_white, bg, false, false);
}
