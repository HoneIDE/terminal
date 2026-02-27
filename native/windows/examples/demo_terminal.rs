//! demo_terminal — standalone Windows window with a terminal character grid.
//!
//! This demonstrates the native rendering layer without Perry or a PTY.
//! It creates a Win32 window, populates the grid with sample content
//! (colored text, cursor styles, attributes), and renders via Direct2D.
//!
//! Run:
//!   cargo run --example demo_terminal
//!
//! This is the Rust-side equivalent of the Perry demo app, useful for
//! testing the FFI crate in isolation before Perry integration.

use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::InvalidateRect;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::WindowsAndMessaging::*;

use hone_terminal_windows::terminal_view::TerminalView;

fn main() {
    unsafe {
        // Initialize COM for Direct2D/DirectWrite
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let cols: usize = 80;
        let rows: usize = 24;

        let mut terminal_view = TerminalView::new(rows, cols);
        let cell_w = terminal_view.renderer.font_set.char_width;
        let cell_h = terminal_view.renderer.font_set.line_height;

        // Calculate client area size
        let client_width = (cols as f64 * cell_w) as i32 + 20;
        let client_height = (rows as f64 * cell_h) as i32 + 20;

        // Adjust for window chrome (title bar, borders)
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: client_width,
            bottom: client_height,
        };
        let _ = AdjustWindowRectEx(
            &mut rect,
            WS_OVERLAPPEDWINDOW,
            false,
            WINDOW_EX_STYLE::default(),
        );
        let win_width = rect.right - rect.left;
        let win_height = rect.bottom - rect.top;

        // Populate sample content
        hone_terminal_windows::populate_demo_cells(&mut terminal_view, cols);

        // Create window
        let hwnd = hone_terminal_windows::view::create_hwnd(
            &mut terminal_view,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            win_width,
            win_height,
            None,
        );

        // Set window title
        let title = windows::core::HSTRING::from("Hone Terminal \u{2014} Native Demo");
        let _ = SetWindowTextW(hwnd, &title);

        let _ = ShowWindow(hwnd, SW_SHOW);
        let _ = InvalidateRect(hwnd, None, false);

        // Message loop
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).into() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        CoUninitialize();
    }
}
