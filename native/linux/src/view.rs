//! X11 window for the terminal: HoneTerminalView.
//!
//! Creates an X11 window that handles:
//! - Drawing (Expose -> TerminalView::draw via Cairo XlibSurface)
//! - Keyboard input (KeyPress -> XLookupString)
//! - Mouse input (ButtonPress for clicks and scroll)
//! - Window resizing (ConfigureNotify)
//! - I-beam cursor shape
//!
//! Input events are dispatched via registered C callbacks.

use std::os::raw::c_char;

use crate::terminal_view::{TerminalView, X11WindowHandle};

/// Callback types for dispatching input events to TypeScript.
pub type TextInputCallback = extern "C" fn(view: *mut TerminalView, text: *const c_char);
pub type ActionCallback = extern "C" fn(view: *mut TerminalView, selector: *const c_char);
pub type MouseDownCallback = extern "C" fn(view: *mut TerminalView, x: f64, y: f64);
pub type ScrollCallback = extern "C" fn(view: *mut TerminalView, dx: f64, dy: f64);

/// Input callbacks stored alongside the view.
pub struct InputCallbacks {
    pub text_input: Option<TextInputCallback>,
    pub action: Option<ActionCallback>,
    pub mouse_down: Option<MouseDownCallback>,
    pub scroll: Option<ScrollCallback>,
}

/// Run a blocking demo window with the given TerminalView.
/// Creates an X11 window, renders via Cairo, and handles input events
/// until the window is closed.
pub fn run_demo_window(mut terminal_view: TerminalView) {
    unsafe {
        let display = x11::xlib::XOpenDisplay(std::ptr::null());
        if display.is_null() {
            eprintln!("hone-terminal: failed to open X11 display");
            return;
        }

        let screen = x11::xlib::XDefaultScreen(display);
        let root = x11::xlib::XRootWindow(display, screen);

        let cell_w = terminal_view.renderer.font_set.char_width;
        let cell_h = terminal_view.renderer.font_set.line_height;
        let win_width = (terminal_view.cols as f64 * cell_w) as u32 + 20;
        let win_height = (terminal_view.rows as f64 * cell_h) as u32 + 20;

        // Create window
        let window = x11::xlib::XCreateSimpleWindow(
            display,
            root,
            40,  // x
            40,  // y
            win_width,
            win_height,
            0,   // border width
            x11::xlib::XBlackPixel(display, screen),
            x11::xlib::XBlackPixel(display, screen),
        );

        // Set window title
        let title = std::ffi::CString::new("Hone Terminal \u{2014} Native Demo").unwrap();
        x11::xlib::XStoreName(display, window, title.as_ptr() as *mut _);

        // Select input events
        x11::xlib::XSelectInput(
            display,
            window,
            x11::xlib::ExposureMask
                | x11::xlib::KeyPressMask
                | x11::xlib::ButtonPressMask
                | x11::xlib::StructureNotifyMask,
        );

        // Set I-beam cursor (XC_xterm = 152)
        let cursor = x11::xlib::XCreateFontCursor(display, 152);
        x11::xlib::XDefineCursor(display, window, cursor);

        // Register WM_DELETE_WINDOW protocol
        let mut wm_delete = x11::xlib::XInternAtom(
            display,
            b"WM_DELETE_WINDOW\0".as_ptr() as *const _,
            x11::xlib::False,
        );
        x11::xlib::XSetWMProtocols(display, window, &mut wm_delete, 1);

        // Map (show) the window
        x11::xlib::XMapWindow(display, window);
        x11::xlib::XFlush(display);

        // Store X11 handle in the terminal view for invalidation
        terminal_view.x11_window = Some(X11WindowHandle { display, window });

        // Get visual info for Cairo surface
        let visual = x11::xlib::XDefaultVisual(display, screen);

        // Event loop
        let mut event: x11::xlib::XEvent = std::mem::zeroed();
        let mut surface_width = win_width as i32;
        let mut surface_height = win_height as i32;

        loop {
            x11::xlib::XNextEvent(display, &mut event);

            match event.type_ {
                x11::xlib::Expose => {
                    // Only redraw on the last Expose in a batch
                    if event.expose.count != 0 {
                        continue;
                    }

                    // Create Cairo XlibSurface for this window
                    let surface = cairo::ffi::cairo_xlib_surface_create(
                        display as *mut _,
                        window,
                        visual as *mut _,
                        surface_width,
                        surface_height,
                    );
                    let cr_raw = cairo::ffi::cairo_create(surface);

                    // Wrap in safe Cairo types
                    let cr = cairo::Context::from_raw_full(cr_raw);
                    terminal_view.draw(&cr);

                    cairo::ffi::cairo_surface_destroy(surface);
                }

                x11::xlib::ConfigureNotify => {
                    let configure = event.configure;
                    surface_width = configure.width;
                    surface_height = configure.height;
                }

                x11::xlib::KeyPress => {
                    let mut buf = [0u8; 32];
                    let mut keysym: x11::xlib::KeySym = 0;
                    let len = x11::xlib::XLookupString(
                        &mut event.key,
                        buf.as_mut_ptr() as *mut _,
                        buf.len() as i32,
                        &mut keysym,
                        std::ptr::null_mut(),
                    );

                    if len > 0 {
                        // Text input
                        if let Ok(text) = std::str::from_utf8(&buf[..len as usize]) {
                            let _ = text; // In demo mode, just consume
                        }
                    }

                    // Handle special keys for demo
                    match keysym as u32 {
                        0xff1b => break, // Escape — close window
                        _ => {}
                    }
                }

                x11::xlib::ButtonPress => {
                    let button = event.button;
                    match button.button {
                        1 => {
                            // Left click
                            let _x = button.x as f64;
                            let _y = button.y as f64;
                            // In demo mode, just consume
                        }
                        4 => {
                            // Scroll up
                        }
                        5 => {
                            // Scroll down
                        }
                        _ => {}
                    }
                }

                x11::xlib::ClientMessage => {
                    let client = event.client_message;
                    if client.data.get_long(0) as x11::xlib::Atom == wm_delete {
                        break; // Window close button
                    }
                }

                _ => {}
            }
        }

        // Cleanup
        x11::xlib::XFreeCursor(display, cursor);
        x11::xlib::XDestroyWindow(display, window);
        x11::xlib::XCloseDisplay(display);
    }
}
