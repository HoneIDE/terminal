//! macOS FFI entry point for hone-terminal.
//!
//! All functions are `#[no_mangle] extern "C"` for Perry codegen compatibility.
//! String parameters from Perry are NaN-boxed pointers decoded via str_from_header().

pub mod terminal_view;
pub mod grid_renderer;
pub mod view;
pub mod string_header;
pub mod pty;
pub mod terminal_state;

use std::ffi::CStr;
use std::os::raw::c_char;
use terminal_view::TerminalView;
use string_header::str_from_header;
use terminal_state::TerminalState;

use cocoa::base::id;
use cocoa::foundation::{NSPoint, NSRect, NSSize};

// ============================================================================
// LiveTerminal — PTY-backed interactive terminal
// ============================================================================

pub struct LiveTerminal {
    state: TerminalState,
    parser: vte::Parser,
    master_fd: i32,
    child_pid: i32,
    view: id,                          // HoneTerminalView NSView
    terminal_view: Box<TerminalView>,  // rendering state (heap-allocated, pointer in NSView)
    read_buf: Vec<u8>,                 // reusable read buffer
}

// ============================================================================
// LiveTerminal FFI — Perry calls these
// ============================================================================

/// Open a new live terminal with a PTY-backed shell.
/// Returns an opaque pointer to LiveTerminal, or 0 on failure.
#[no_mangle]
pub extern "C" fn hone_terminal_open(
    rows: f64,
    cols: f64,
    shell_ptr: *const u8,
    cwd_ptr: *const u8,
) -> *mut LiveTerminal {
    let rows = (rows as i64).max(1) as usize;
    let cols = (cols as i64).max(1) as usize;

    let shell = str_from_header(shell_ptr);
    let shell = if shell.is_empty() { "/bin/zsh" } else { shell };

    let cwd = str_from_header(cwd_ptr);
    let cwd = if cwd.is_empty() {
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
    } else {
        cwd.to_string()
    };

    // Open PTY
    let (master_fd, child_pid) = pty::open_pty(shell, rows as u16, cols as u16, &cwd);
    if master_fd < 0 {
        return std::ptr::null_mut();
    }

    // Create terminal state
    let state = TerminalState::new(rows, cols);
    let parser = vte::Parser::new();

    // Create rendering view (heap-allocated so NSView callbacks can access it)
    let mut terminal_view = Box::new(TerminalView::new(rows, cols));
    let cell_w = terminal_view.renderer.font_set.char_width;
    let cell_h = terminal_view.renderer.font_set.line_height;

    // Create NSView
    let frame = NSRect::new(
        NSPoint::new(0.0, 0.0),
        NSSize::new(cols as f64 * cell_w, rows as f64 * cell_h),
    );
    let nsview = view::create_nsview(&mut terminal_view, frame);

    // Set PTY fd on the NSView for direct keyboard input routing
    view::set_pty_fd(nsview, master_fd);

    let live = LiveTerminal {
        state,
        parser,
        master_fd,
        child_pid,
        view: nsview,
        terminal_view,
        read_buf: vec![0u8; 65536],
    };

    Box::into_raw(Box::new(live))
}

/// Get the NSView pointer for embedNSView().
#[no_mangle]
pub extern "C" fn hone_terminal_nsview(handle: *mut LiveTerminal) -> *mut objc::runtime::Object {
    if handle.is_null() {
        return std::ptr::null_mut();
    }
    let live = unsafe { &*handle };
    live.view as *mut objc::runtime::Object
}

/// Poll the terminal: read PTY output, parse VT sequences, update display.
/// Returns 1 if alive, 0 if shell exited.
#[no_mangle]
pub extern "C" fn hone_terminal_poll(handle: *mut LiveTerminal) -> i64 {
    if handle.is_null() {
        return 0;
    }
    let live = unsafe { &mut *handle };

    // Check if child is still alive
    if !pty::pty_child_alive(live.child_pid) {
        // Do one final read to get any remaining output
        loop {
            let n = pty::pty_read(live.master_fd, &mut live.read_buf);
            if n <= 0 {
                break;
            }
            for byte in &live.read_buf[..n as usize] {
                live.parser.advance(&mut live.state, *byte);
            }
        }
        if live.state.dirty {
            sync_render(live);
        }
        return 0;
    }

    // Non-blocking read from PTY
    loop {
        let n = pty::pty_read(live.master_fd, &mut live.read_buf);
        if n <= 0 {
            break;
        }
        for byte in &live.read_buf[..n as usize] {
            live.parser.advance(&mut live.state, *byte);
        }
    }

    // Write any pending DSR response back to PTY
    if let Some(response) = live.state.pending_response.take() {
        pty::pty_write(live.master_fd, &response);
    }

    // Update app cursor keys mode on the NSView
    view::set_app_cursor_keys(live.view, live.state.cursor_keys_application);

    // If state is dirty, update the TerminalView cells and trigger redraw
    if live.state.dirty {
        sync_render(live);
    }

    1
}

/// Write data to the PTY (for paste operations, etc.)
#[no_mangle]
pub extern "C" fn hone_terminal_write(
    handle: *mut LiveTerminal,
    data_ptr: *const u8,
) -> i64 {
    if handle.is_null() {
        return 0;
    }
    let live = unsafe { &mut *handle };
    let data = str_from_header(data_ptr);
    if data.is_empty() {
        return 0;
    }

    // Bracketed paste mode
    if live.state.bracketed_paste {
        pty::pty_write(live.master_fd, b"\x1b[200~");
        pty::pty_write(live.master_fd, data.as_bytes());
        pty::pty_write(live.master_fd, b"\x1b[201~");
    } else {
        pty::pty_write(live.master_fd, data.as_bytes());
    }
    1
}

/// Resize the terminal.
#[no_mangle]
pub extern "C" fn hone_terminal_resize(
    handle: *mut LiveTerminal,
    rows: f64,
    cols: f64,
) -> i64 {
    if handle.is_null() {
        return 0;
    }
    let live = unsafe { &mut *handle };
    let rows = (rows as i64).max(1) as usize;
    let cols = (cols as i64).max(1) as usize;

    // Resize PTY
    pty::pty_resize(live.master_fd, rows as u16, cols as u16);

    // Resize state
    live.state.resize(rows, cols);

    // Resize rendering view
    live.terminal_view.resize(rows, cols);

    // Force redraw
    sync_render(live);
    1
}

/// Set the color theme on a live terminal.
/// theme_json is a Perry NaN-boxed string pointer to JSON: {"background":"#hex","foreground":"#hex","cursor":"#hex","selection_background":"#hex"}
#[no_mangle]
pub extern "C" fn hone_terminal_live_set_theme(
    handle: *mut LiveTerminal,
    theme_json_ptr: *const u8,
) {
    if handle.is_null() { return; }
    let live = unsafe { &mut *handle };
    let json_str = str_from_header(theme_json_ptr);
    if json_str.is_empty() { return; }
    live.terminal_view.set_theme(json_str);
    // Trigger redraw
    unsafe {
        use objc::msg_send;
        use objc::sel;
        use objc::sel_impl;
        let _: () = msg_send![live.view, setNeedsDisplay: true];
    }
}

/// Set terminal background and foreground colors directly (no JSON).
#[no_mangle]
pub extern "C" fn hone_terminal_set_bg_fg(
    handle: *mut LiveTerminal,
    bg_r: f64, bg_g: f64, bg_b: f64,
    fg_r: f64, fg_g: f64, fg_b: f64,
) {
    if handle.is_null() { return; }
    let live = unsafe { &mut *handle };

    // Update the TerminalView's rendering colors
    live.terminal_view.set_bg_fg(bg_r, bg_g, bg_b, fg_r, fg_g, fg_b);

    // Update the TerminalState's default colors so Color::Default resolves to theme colors
    live.state.default_bg = [(bg_r * 255.0) as u8, (bg_g * 255.0) as u8, (bg_b * 255.0) as u8];
    live.state.default_fg = [(fg_r * 255.0) as u8, (fg_g * 255.0) as u8, (fg_b * 255.0) as u8];
    live.state.dirty = true;

    // Also set the NSView layer background as a belt-and-suspenders approach
    unsafe {
        use objc::{class, msg_send, sel, sel_impl};
        let _: () = msg_send![live.view, setWantsLayer: cocoa::base::YES];
        let layer: id = msg_send![live.view, layer];
        if layer != cocoa::base::nil {
            let ns_color: id = msg_send![class!(NSColor), colorWithRed:bg_r green:bg_g blue:bg_b alpha:1.0f64];
            let cg_color: *const std::os::raw::c_void = msg_send![ns_color, CGColor];
            let _: () = msg_send![layer, setBackgroundColor: cg_color];
        }
    }

    // Force a full re-render so cells pick up new default colors
    sync_render(live);
}

/// Close the terminal: kill shell, close PTY, free resources.
#[no_mangle]
pub extern "C" fn hone_terminal_close(handle: *mut LiveTerminal) -> i64 {
    if handle.is_null() {
        return 0;
    }
    let live = unsafe { Box::from_raw(handle) };
    pty::pty_close(live.master_fd, live.child_pid);
    // live drops here, freeing all resources
    1
}

// ============================================================================
// Perry codegen wrappers — Perry calls __wrapper_<name> for FFI functions
// ============================================================================

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_open(
    rows: f64, cols: f64, shell_ptr: *const u8, cwd_ptr: *const u8,
) -> *mut LiveTerminal {
    hone_terminal_open(rows, cols, shell_ptr, cwd_ptr)
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_nsview(
    handle: *mut LiveTerminal,
) -> *mut objc::runtime::Object {
    hone_terminal_nsview(handle)
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_poll(handle: *mut LiveTerminal) -> i64 {
    hone_terminal_poll(handle)
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_write(
    handle: *mut LiveTerminal, data_ptr: *const u8,
) -> i64 {
    hone_terminal_write(handle, data_ptr)
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_resize(
    handle: *mut LiveTerminal, rows: f64, cols: f64,
) -> i64 {
    hone_terminal_resize(handle, rows, cols)
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_close(handle: *mut LiveTerminal) -> i64 {
    hone_terminal_close(handle)
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_live_set_theme(
    handle: *mut LiveTerminal, theme_json_ptr: *const u8,
) {
    hone_terminal_live_set_theme(handle, theme_json_ptr)
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_set_bg_fg(
    handle: *mut LiveTerminal,
    bg_r: f64, bg_g: f64, bg_b: f64,
    fg_r: f64, fg_g: f64, fg_b: f64,
) {
    hone_terminal_set_bg_fg(handle, bg_r, bg_g, bg_b, fg_r, fg_g, fg_b)
}

/// Sync TerminalState → TerminalView cells + cursor, then invalidate.
fn sync_render(live: &mut LiveTerminal) {
    let render_cells = live.state.to_render_cells();

    // Update cells directly (avoid JSON serialization)
    live.terminal_view.cells = render_cells;
    live.terminal_view.rows = live.state.rows;
    live.terminal_view.cols = live.state.cols;

    // Update cursor
    live.terminal_view.set_cursor(
        live.state.cursor_row,
        live.state.cursor_col,
        live.state.cursor_style,
        live.state.cursor_visible,
    );

    live.state.dirty = false;

    // Trigger NSView redraw
    unsafe {
        use objc::msg_send;
        use objc::sel;
        use objc::sel_impl;
        let _: () = msg_send![live.view, setNeedsDisplay: true];
    }
}

// ============================================================================
// Legacy FFI — existing TerminalView API (unchanged)
// ============================================================================

/// Create a new terminal view with the given grid dimensions.
#[no_mangle]
pub extern "C" fn hone_terminal_create(rows: i32, cols: i32) -> *mut TerminalView {
    let view = TerminalView::new(rows as usize, cols as usize);
    Box::into_raw(Box::new(view))
}

/// Destroy a terminal view and free all resources.
#[no_mangle]
pub extern "C" fn hone_terminal_destroy(view: *mut TerminalView) {
    if view.is_null() {
        return;
    }
    unsafe {
        let _ = Box::from_raw(view);
    }
}

/// Set the font family and size for the terminal view.
#[no_mangle]
pub extern "C" fn hone_terminal_set_font(
    view: *mut TerminalView,
    family: *const c_char,
    size: f64,
) {
    let view = unsafe { &mut *view };
    let family_str = unsafe { CStr::from_ptr(family) }
        .to_str()
        .unwrap_or("Menlo");
    view.set_font(family_str, size);
}

/// Set the terminal color theme from a JSON string.
#[no_mangle]
pub extern "C" fn hone_terminal_set_theme(
    view: *mut TerminalView,
    theme_json: *const c_char,
) {
    let view = unsafe { &mut *view };
    let json_str = unsafe { CStr::from_ptr(theme_json) }
        .to_str()
        .unwrap_or("{}");
    view.set_theme(json_str);
}

/// Render cell data for rows [start_row, end_row).
#[no_mangle]
pub extern "C" fn hone_terminal_render_cells(
    view: *mut TerminalView,
    cells_json: *const c_char,
    start_row: i32,
    end_row: i32,
) {
    let view = unsafe { &mut *view };
    let json_str = unsafe { CStr::from_ptr(cells_json) }
        .to_str()
        .unwrap_or("[]");
    view.render_cells(json_str, start_row as usize, end_row as usize);
}

/// Update the cursor position and style.
#[no_mangle]
pub extern "C" fn hone_terminal_set_cursor(
    view: *mut TerminalView,
    row: i32,
    col: i32,
    style: i32,
    visible: i32,
) {
    let view = unsafe { &mut *view };
    view.set_cursor(row as usize, col as usize, style, visible != 0);
}

/// Set selection highlight regions from a JSON string.
#[no_mangle]
pub extern "C" fn hone_terminal_set_selection(
    view: *mut TerminalView,
    regions_json: *const c_char,
) {
    let view = unsafe { &mut *view };
    let json_str = unsafe { CStr::from_ptr(regions_json) }
        .to_str()
        .unwrap_or("[]");
    view.set_selection(json_str);
}

/// Scroll the terminal view by the given offset.
#[no_mangle]
pub extern "C" fn hone_terminal_scroll(
    view: *mut TerminalView,
    offset: i32,
) {
    let view = unsafe { &mut *view };
    view.scroll(offset);
}

/// Get the cell pixel dimensions for the current font.
#[no_mangle]
pub extern "C" fn hone_terminal_get_cell_size(
    view: *mut TerminalView,
    out_width: *mut f64,
    out_height: *mut f64,
) {
    let view = unsafe { &*view };
    let (w, h) = view.cell_size();
    unsafe {
        *out_width = w;
        *out_height = h;
    }
}

/// Show a standalone demo window with sample terminal content.
#[no_mangle]
pub extern "C" fn hone_terminal_show_demo() {
    hone_terminal_show_demo_impl();
}

/// Perry codegen wrapper.
#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_show_demo() {
    hone_terminal_show_demo_impl();
}

fn hone_terminal_show_demo_impl() {
    use cocoa::appkit::{
        NSBackingStoreBuffered, NSWindow, NSWindowStyleMask,
    };
    use cocoa::base::{id, nil};
    use cocoa::foundation::{NSPoint, NSRect, NSSize, NSString};
    use objc::{class, msg_send, sel, sel_impl};

    let cols: usize = 80;
    let rows: usize = 24;

    let terminal_view = Box::leak(Box::new(TerminalView::new(rows, cols)));
    let cell_w = terminal_view.renderer.font_set.char_width;
    let cell_h = terminal_view.renderer.font_set.line_height;
    let win_width = cols as f64 * cell_w + 20.0;
    let win_height = rows as f64 * cell_h + 40.0;

    populate_demo_cells(terminal_view, cols);

    unsafe {
        let style = NSWindowStyleMask::NSTitledWindowMask
            | NSWindowStyleMask::NSClosableWindowMask
            | NSWindowStyleMask::NSResizableWindowMask
            | NSWindowStyleMask::NSMiniaturizableWindowMask;

        let screen: id = msg_send![class!(NSScreen), mainScreen];
        let screen_frame: NSRect = msg_send![screen, visibleFrame];
        let origin_x = screen_frame.origin.x + 40.0;
        let origin_y = screen_frame.origin.y + screen_frame.size.height - win_height - 60.0;

        let window = NSWindow::alloc(nil).initWithContentRect_styleMask_backing_defer_(
            NSRect::new(
                NSPoint::new(origin_x, origin_y),
                NSSize::new(win_width, win_height),
            ),
            style,
            NSBackingStoreBuffered,
            false,
        );

        let title = NSString::alloc(nil).init_str("Hone Terminal \u{2014} Native Rendering");
        window.setTitle_(title);

        let content_frame = NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(cols as f64 * cell_w, rows as f64 * cell_h),
        );
        let nsview = view::create_nsview(terminal_view, content_frame);

        let content_view: id = msg_send![window, contentView];
        let _: () = msg_send![content_view, addSubview: nsview];

        window.makeKeyAndOrderFront_(nil);
    }
}

fn populate_demo_cells(view: &mut TerminalView, cols: usize) {
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

    write_text(view, 0, 2, "Hone Terminal \u{2014} Native Rendering Demo", yellow, bg, true, false);
    let sep: String = "\u{2500}".repeat(cols - 4);
    write_text(view, 1, 2, &sep, dim_white, bg, false, false);
    write_text(view, 3, 2, "Colors:", white, bg, true, false);
    write_text(view, 3, 12, "Red", red, bg, false, false);
    write_text(view, 3, 18, "Green", green, bg, false, false);
    write_text(view, 3, 26, "Blue", blue, bg, false, false);
    write_text(view, 3, 34, "Yellow", yellow, bg, false, false);
    write_text(view, 3, 43, "Magenta", magenta, bg, false, false);
    write_text(view, 3, 53, "Cyan", cyan, bg, false, false);
    write_text(view, 5, 2, "Attributes:", white, bg, true, false);
    write_text(view, 5, 15, "Bold", white, bg, true, false);
    write_text(view, 5, 22, "Italic", white, bg, false, true);
    write_text(view, 5, 31, "Bold+Italic", white, bg, true, true);
    let ul_col = 45;
    write_text(view, 5, ul_col, "Underline", white, bg, false, false);
    for i in 0..9 { view.cells[5][ul_col + i].u = true; }
    let st_col = 57;
    write_text(view, 5, st_col, "Strikethrough", white, bg, false, false);
    for i in 0..13 { view.cells[5][st_col + i].s = true; }
    write_text(view, 7, 2, "Backgrounds:", white, bg, true, false);
    write_text(view, 7, 16, " Red ", [30, 30, 46], [243, 139, 168], false, false);
    write_text(view, 7, 23, " Green ", [30, 30, 46], [166, 227, 161], false, false);
    write_text(view, 7, 32, " Blue ", [30, 30, 46], [137, 180, 250], false, false);
    write_text(view, 7, 40, " Yellow ", [30, 30, 46], [249, 226, 175], false, false);
    write_text(view, 9, 2, &sep, dim_white, bg, false, false);
    write_text(view, 11, 2, "user@hone", green, bg, true, false);
    write_text(view, 11, 11, ":", white, bg, false, false);
    write_text(view, 11, 12, "~/projects/terminal", blue, bg, true, false);
    write_text(view, 11, 31, "$ ", white, bg, false, false);
    write_text(view, 11, 33, "ls -la", white, bg, false, false);
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
    write_text(view, 20, 2, "user@hone", green, bg, true, false);
    write_text(view, 20, 11, ":", white, bg, false, false);
    write_text(view, 20, 12, "~/projects/terminal", blue, bg, true, false);
    write_text(view, 20, 31, "$ ", white, bg, false, false);
    view.cursor = terminal_view::CursorState { row: 20, col: 33, style: 0, visible: true };
    write_text(view, 23, 2, " NORMAL ", [30, 30, 46], [166, 227, 161], true, false);
    write_text(view, 23, 12, " 80\u{00d7}24 ", [30, 30, 46], [137, 180, 250], false, false);
    write_text(view, 23, 21, " xterm-256color ", dim_white, bg, false, false);
}
