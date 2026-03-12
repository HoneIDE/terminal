//! Windows FFI entry point for hone-terminal.
//!
//! All functions are `#[no_mangle] extern "C"` for Perry codegen compatibility.
//! String parameters are received as C string pointers (Perry handles allocation).

pub mod terminal_view;
pub mod grid_renderer;
pub mod view;

use std::ffi::CStr;
use std::os::raw::c_char;
use terminal_view::TerminalView;

// ============================================================================
// Lifecycle
// ============================================================================

/// Create a new terminal view with the given grid dimensions.
/// Returns an opaque pointer to the TerminalView.
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

// ============================================================================
// Configuration
// ============================================================================

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
        .unwrap_or("Consolas");
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

// ============================================================================
// Rendering
// ============================================================================

/// Render cell data for rows [start_row, end_row).
/// cells_json is a JSON array of row arrays, each containing RenderCell objects.
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
/// style: 0=block, 1=beam, 2=underline.
/// visible: 0=hidden, 1=visible.
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

/// Resize the terminal grid.
#[no_mangle]
pub extern "C" fn hone_terminal_resize(
    view: *mut TerminalView,
    rows: i32,
    cols: i32,
) {
    let view = unsafe { &mut *view };
    view.resize(rows as usize, cols as usize);
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

/// Scroll the terminal view by the given offset (positive = up into scrollback).
#[no_mangle]
pub extern "C" fn hone_terminal_scroll(
    view: *mut TerminalView,
    offset: i32,
) {
    let view = unsafe { &mut *view };
    view.scroll(offset);
}

/// Get the cell pixel dimensions for the current font.
/// Writes width to *out_width and height to *out_height.
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

// ============================================================================
// Demo
// ============================================================================

/// Show a standalone demo window with sample terminal content.
/// Creates its own HWND, populates the grid, and displays it.
/// Does NOT block — the window stays open and the caller's message pump handles the rest.
#[no_mangle]
pub extern "C" fn hone_terminal_show_demo() {
    hone_terminal_show_demo_impl();
}

// ============================================================================
// LiveTerminal theme support
// ============================================================================

/// Set theme via JSON on a live terminal view.
/// handle is a *mut TerminalView (or null if no live terminal).
#[no_mangle]
pub extern "C" fn hone_terminal_live_set_theme(handle: i64, theme_json: *const c_char) {
    if handle == 0 { return; }
    let view = unsafe { &mut *(handle as *mut TerminalView) };
    let json_str = unsafe { CStr::from_ptr(theme_json) }
        .to_str()
        .unwrap_or("{}");
    view.set_theme(json_str);
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_live_set_theme(handle: i64, theme_json: *const c_char) {
    hone_terminal_live_set_theme(handle, theme_json);
}

/// Set terminal background and foreground colors directly.
#[no_mangle]
pub extern "C" fn hone_terminal_set_bg_fg(
    handle: i64,
    bg_r: f64, bg_g: f64, bg_b: f64,
    fg_r: f64, fg_g: f64, fg_b: f64,
) {
    if handle == 0 { return; }
    let view = unsafe { &mut *(handle as *mut TerminalView) };
    view.set_bg_fg(bg_r, bg_g, bg_b, fg_r, fg_g, fg_b);
}

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_set_bg_fg(
    handle: i64,
    bg_r: f64, bg_g: f64, bg_b: f64,
    fg_r: f64, fg_g: f64, fg_b: f64,
) {
    hone_terminal_set_bg_fg(handle, bg_r, bg_g, bg_b, fg_r, fg_g, fg_b);
}

// ============================================================================
// LiveTerminal PTY stubs (not yet implemented on Windows)
// ============================================================================

#[no_mangle]
pub extern "C" fn hone_terminal_open(_rows: f64, _cols: f64, _shell: i64, _cwd: i64) -> i64 { 0 }

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_open(_rows: f64, _cols: f64, _shell: i64, _cwd: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn hone_terminal_nsview(_handle: i64) -> i64 { 0 }

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_nsview(_handle: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn hone_terminal_poll(_handle: i64) -> i64 { 0 }

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_poll(_handle: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn hone_terminal_write(_handle: i64, _data: i64) -> i64 { 0 }

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_write(_handle: i64, _data: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn hone_terminal_close(_handle: i64) -> i64 { 0 }

#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_close(_handle: i64) -> i64 { 0 }

/// Perry codegen wrapper — Perry calls `__wrapper_<name>` for FFI functions.
#[no_mangle]
#[allow(non_snake_case)]
pub extern "C" fn __wrapper_hone_terminal_show_demo() {
    hone_terminal_show_demo_impl();
}

fn hone_terminal_show_demo_impl() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::WindowsAndMessaging::*;

    let cols: usize = 80;
    let rows: usize = 24;

    unsafe {
        // Ensure COM is initialized for Direct2D/DirectWrite
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }

    // Heap-allocate so the pointer stays valid after this function returns.
    // The HWND's draw callback accesses TerminalView through a raw pointer.
    let terminal_view = Box::leak(Box::new(TerminalView::new(rows, cols)));
    let cell_w = terminal_view.renderer.font_set.char_width;
    let cell_h = terminal_view.renderer.font_set.line_height;

    // Calculate client area size
    let client_width = (cols as f64 * cell_w) as i32 + 20;
    let client_height = (rows as f64 * cell_h) as i32 + 20;

    // Adjust for window chrome (title bar, borders)
    let mut rect = windows::Win32::Foundation::RECT {
        left: 0,
        top: 0,
        right: client_width,
        bottom: client_height,
    };
    unsafe {
        let _ = AdjustWindowRectEx(
            &mut rect,
            WS_OVERLAPPEDWINDOW,
            false,
            WINDOW_EX_STYLE::default(),
        );
    }
    let win_width = rect.right - rect.left;
    let win_height = rect.bottom - rect.top;

    // Populate demo content
    populate_demo_cells(terminal_view, cols);

    // Create the window (create_hwnd handles D2D factory + WindowState)
    let hwnd = view::create_hwnd(
        terminal_view,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        win_width,
        win_height,
        None,
    );

    unsafe {
        // Set window title
        let title = windows::core::HSTRING::from("Hone Terminal \u{2014} Native Rendering");
        let _ = SetWindowTextW(hwnd, &title);

        let _ = ShowWindow(hwnd, SW_SHOW);
        let _ = windows::Win32::Graphics::Gdi::InvalidateRect(hwnd, None, false);
    }
}

/// Populate a TerminalView with demo content for showcasing.
pub fn populate_demo_cells(view: &mut TerminalView, cols: usize) {
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
    write_text(view, 0, 2, "Hone Terminal \u{2014} Native Rendering Demo", yellow, bg, true, false);

    // Separator
    let sep: String = "\u{2500}".repeat(cols - 4);
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

    // ls output
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

    // Block cursor
    view.cursor = terminal_view::CursorState {
        row: 20,
        col: 33,
        style: 0,
        visible: true,
    };

    // Status line
    write_text(view, 23, 2, " NORMAL ", [30, 30, 46], [166, 227, 161], true, false);
    write_text(view, 23, 12, " 80\u{00d7}24 ", [30, 30, 46], [137, 180, 250], false, false);
    write_text(view, 23, 21, " xterm-256color ", dim_white, bg, false, false);
}
