//! NSView subclass for the terminal: HoneTerminalView.
//!
//! For LiveTerminal mode: keyboard input is written directly to the PTY fd.
//! For legacy mode: input dispatched via registered C callbacks.

use std::os::raw::{c_char, c_void};
use std::sync::Once;

use cocoa::base::{id, nil, YES, NO};
use cocoa::foundation::{NSPoint, NSRect, NSString};
use objc::declare::ClassDecl;
use objc::runtime::{Object, Sel, BOOL};
use objc::{class, msg_send, sel, sel_impl};

use crate::terminal_view::TerminalView;

/// Callback types for dispatching input events to TypeScript (legacy mode).
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

static REGISTER_CLASS: Once = Once::new();

/// Register the HoneTerminalView Objective-C class.
/// Must be called once before creating any instances.
pub fn register_class() {
    REGISTER_CLASS.call_once(|| {
        let superclass = class!(NSView);
        let mut decl = ClassDecl::new("HoneTerminalView", superclass).unwrap();

        // Instance variables
        decl.add_ivar::<*mut c_void>("honeTerminalState");
        decl.add_ivar::<*mut c_void>("honeInputCallbacks");
        decl.add_ivar::<i64>("honePtyFd");          // PTY master fd (-1 = legacy mode)
        decl.add_ivar::<i64>("honeAppCursorKeys");   // 1 = application cursor mode
        decl.add_ivar::<f64>("honeIntrinsicW");      // intrinsic width in pixels
        decl.add_ivar::<f64>("honeIntrinsicH");      // intrinsic height in pixels

        // Required overrides
        unsafe {
            decl.add_method(sel!(isFlipped), is_flipped as extern "C" fn(&Object, Sel) -> BOOL);
            decl.add_method(
                sel!(acceptsFirstResponder),
                accepts_first_responder as extern "C" fn(&Object, Sel) -> BOOL,
            );
            decl.add_method(
                sel!(drawRect:),
                draw_rect as extern "C" fn(&Object, Sel, NSRect),
            );
            decl.add_method(
                sel!(keyDown:),
                key_down as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                sel!(insertText:),
                insert_text as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                sel!(doCommandBySelector:),
                do_command_by_selector as extern "C" fn(&Object, Sel, Sel),
            );
            decl.add_method(
                sel!(mouseDown:),
                mouse_down as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                sel!(scrollWheel:),
                scroll_wheel as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                sel!(resetCursorRects),
                reset_cursor_rects as extern "C" fn(&Object, Sel),
            );
            decl.add_method(
                sel!(flagsChanged:),
                flags_changed as extern "C" fn(&Object, Sel, id),
            );
            decl.add_method(
                sel!(intrinsicContentSize),
                intrinsic_content_size as extern "C" fn(&Object, Sel) -> cocoa::foundation::NSSize,
            );
            decl.add_method(
                sel!(viewDidMoveToWindow),
                view_did_move_to_window as extern "C" fn(&Object, Sel),
            );
        }

        decl.register();
    });
}

/// Create a new HoneTerminalView NSView and associate it with a TerminalView.
pub fn create_nsview(terminal_view: &mut TerminalView, frame: NSRect) -> id {
    register_class();

    unsafe {
        let cls = class!(HoneTerminalView);
        let view: id = msg_send![cls, alloc];
        let view: id = msg_send![view, initWithFrame: frame];

        // Store pointer to TerminalView in the ivar
        let state_ptr = terminal_view as *mut TerminalView as *mut c_void;
        (*view).set_ivar("honeTerminalState", state_ptr);

        // Allocate input callbacks (legacy mode)
        let callbacks = Box::new(InputCallbacks {
            text_input: None,
            action: None,
            mouse_down: None,
            scroll: None,
        });
        (*view).set_ivar("honeInputCallbacks", Box::into_raw(callbacks) as *mut c_void);

        // No PTY by default (legacy mode)
        (*view).set_ivar::<i64>("honePtyFd", -1);
        (*view).set_ivar::<i64>("honeAppCursorKeys", 0);
        (*view).set_ivar::<f64>("honeIntrinsicW", frame.size.width);
        (*view).set_ivar::<f64>("honeIntrinsicH", frame.size.height);

        terminal_view.nsview = Some(view);
        view
    }
}

/// Set the PTY file descriptor for direct keyboard → PTY routing.
pub fn set_pty_fd(nsview: id, fd: i32) {
    unsafe {
        (*nsview).set_ivar::<i64>("honePtyFd", fd as i64);
    }
}

/// Update the application cursor keys mode flag on the NSView.
pub fn set_app_cursor_keys(nsview: id, enabled: bool) {
    unsafe {
        (*nsview).set_ivar::<i64>("honeAppCursorKeys", if enabled { 1 } else { 0 });
    }
}

/// Write raw bytes to the PTY fd.
fn write_to_pty(fd: i32, data: &[u8]) {
    if fd < 0 || data.is_empty() {
        return;
    }
    unsafe {
        libc::write(fd, data.as_ptr() as *const libc::c_void, data.len());
    }
}

// ============================================================================
// Objective-C method implementations
// ============================================================================

extern "C" fn is_flipped(_this: &Object, _sel: Sel) -> BOOL {
    YES
}

extern "C" fn accepts_first_responder(_this: &Object, _sel: Sel) -> BOOL {
    YES
}

extern "C" fn draw_rect(this: &Object, _sel: Sel, _dirty_rect: NSRect) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar("honeTerminalState");
        if state_ptr.is_null() {
            return;
        }
        let terminal_view = &*(state_ptr as *const TerminalView);

        // Get the current CGContext from NSGraphicsContext
        let ns_ctx: id = msg_send![class!(NSGraphicsContext), currentContext];
        if ns_ctx == nil {
            return;
        }
        let cg_ctx_ptr: *mut core_graphics::sys::CGContext = msg_send![ns_ctx, CGContext];
        if cg_ctx_ptr.is_null() {
            return;
        }

        let cg_ctx = core_graphics::context::CGContext::from_existing_context_ptr(cg_ctx_ptr);
        terminal_view.draw(&cg_ctx);
    }
}

extern "C" fn key_down(this: &Object, _sel: Sel, event: id) {
    unsafe {
        let pty_fd: i64 = *this.get_ivar("honePtyFd");

        if pty_fd >= 0 {
            // Live terminal mode: handle special keys directly
            let key_code: u16 = msg_send![event, keyCode];
            let modifier_flags: u64 = msg_send![event, modifierFlags];
            let has_ctrl = (modifier_flags & (1 << 18)) != 0;  // NSEventModifierFlagControl
            let has_alt = (modifier_flags & (1 << 19)) != 0;   // NSEventModifierFlagOption
            let has_cmd = (modifier_flags & (1 << 20)) != 0;   // NSEventModifierFlagCommand

            // Let Cmd+key combos pass through to the app (for Cmd+C copy, Cmd+V paste, etc.)
            if has_cmd {
                // For Cmd+V (paste), we could intercept, but let the system handle it
                // Forward to super for standard menu handling
                let superclass = class!(NSView);
                let _: () = msg_send![super(this, superclass), keyDown: event];
                return;
            }

            let app_cursor: i64 = *this.get_ivar("honeAppCursorKeys");
            let fd = pty_fd as i32;

            // Handle special key codes
            let escape_seq: Option<&[u8]> = match key_code {
                0x7B => Some(if app_cursor != 0 { b"\x1bOD" } else { b"\x1b[D" }), // Left
                0x7C => Some(if app_cursor != 0 { b"\x1bOC" } else { b"\x1b[C" }), // Right
                0x7E => Some(if app_cursor != 0 { b"\x1bOA" } else { b"\x1b[A" }), // Up
                0x7D => Some(if app_cursor != 0 { b"\x1bOB" } else { b"\x1b[B" }), // Down
                0x24 => Some(b"\r"),         // Return
                0x33 => Some(b"\x7f"),       // Backspace → DEL
                0x30 => Some(b"\t"),         // Tab
                0x35 => Some(b"\x1b"),       // Escape
                0x73 => Some(if app_cursor != 0 { b"\x1bOH" } else { b"\x1b[H" }), // Home
                0x77 => Some(if app_cursor != 0 { b"\x1bOF" } else { b"\x1b[F" }), // End
                0x74 => Some(b"\x1b[5~"),    // PageUp
                0x79 => Some(b"\x1b[6~"),    // PageDown
                0x75 => Some(b"\x1b[3~"),    // Forward Delete
                0x72 => Some(b"\x1b[2~"),    // Insert (Help key on Mac)
                _ => None,
            };

            if let Some(seq) = escape_seq {
                write_to_pty(fd, seq);
                return;
            }

            // For Ctrl+key, compute control character
            if has_ctrl {
                let chars_ns: id = msg_send![event, charactersIgnoringModifiers];
                if chars_ns != nil {
                    let chars_ptr: *const c_char = msg_send![chars_ns, UTF8String];
                    if !chars_ptr.is_null() {
                        let chars = std::ffi::CStr::from_ptr(chars_ptr).to_bytes();
                        if !chars.is_empty() {
                            let ch = chars[0];
                            if ch >= b'a' && ch <= b'z' {
                                // Ctrl+a..z → 0x01..0x1a
                                write_to_pty(fd, &[ch - b'a' + 1]);
                                return;
                            }
                            if ch >= b'A' && ch <= b'Z' {
                                write_to_pty(fd, &[ch - b'A' + 1]);
                                return;
                            }
                            match ch {
                                b'[' | b'3' => write_to_pty(fd, &[0x1b]), // Ctrl+[ = ESC
                                b'\\' | b'4' => write_to_pty(fd, &[0x1c]),
                                b']' | b'5' => write_to_pty(fd, &[0x1d]),
                                b'^' | b'6' => write_to_pty(fd, &[0x1e]),
                                b'/' | b'7' => write_to_pty(fd, &[0x1f]),
                                b' ' | b'2' => write_to_pty(fd, &[0x00]), // Ctrl+Space = NUL
                                _ => {}
                            }
                            return;
                        }
                    }
                }
            }

            // For Alt+key, prefix with ESC
            if has_alt {
                let chars_ns: id = msg_send![event, charactersIgnoringModifiers];
                if chars_ns != nil {
                    let chars_ptr: *const c_char = msg_send![chars_ns, UTF8String];
                    if !chars_ptr.is_null() {
                        let chars = std::ffi::CStr::from_ptr(chars_ptr).to_bytes();
                        if !chars.is_empty() {
                            let mut buf = vec![0x1bu8]; // ESC prefix
                            buf.extend_from_slice(chars);
                            write_to_pty(fd, &buf);
                            return;
                        }
                    }
                }
            }

            // Regular text input — use interpretKeyEvents for IME support
            let events: id = msg_send![class!(NSArray), arrayWithObject: event];
            let _: () = msg_send![this, interpretKeyEvents: events];
        } else {
            // Legacy callback mode
            let events: id = msg_send![class!(NSArray), arrayWithObject: event];
            let _: () = msg_send![this, interpretKeyEvents: events];
        }
    }
}

extern "C" fn insert_text(this: &Object, _sel: Sel, string: id) {
    unsafe {
        let pty_fd: i64 = *this.get_ivar("honePtyFd");

        if pty_fd >= 0 {
            // Live terminal mode: write text directly to PTY
            let c_str: *const c_char = msg_send![string, UTF8String];
            if !c_str.is_null() {
                let bytes = std::ffi::CStr::from_ptr(c_str).to_bytes();
                write_to_pty(pty_fd as i32, bytes);
            }
        } else {
            // Legacy callback mode
            let state_ptr: *mut c_void = *this.get_ivar("honeTerminalState");
            let callbacks_ptr: *mut c_void = *this.get_ivar("honeInputCallbacks");
            if state_ptr.is_null() || callbacks_ptr.is_null() {
                return;
            }

            let callbacks = &*(callbacks_ptr as *const InputCallbacks);
            if let Some(callback) = callbacks.text_input {
                let c_str: *const c_char = msg_send![string, UTF8String];
                callback(state_ptr as *mut TerminalView, c_str);
            }
        }
    }
}

extern "C" fn do_command_by_selector(this: &Object, _sel: Sel, a_selector: Sel) {
    unsafe {
        let pty_fd: i64 = *this.get_ivar("honePtyFd");

        if pty_fd >= 0 {
            // Live terminal mode: handle common actions
            let fd = pty_fd as i32;
            let sel_name = a_selector.name();
            let app_cursor: i64 = *this.get_ivar("honeAppCursorKeys");

            match sel_name {
                "deleteBackward:" => write_to_pty(fd, b"\x7f"),
                "deleteForward:" => write_to_pty(fd, b"\x1b[3~"),
                "insertNewline:" => write_to_pty(fd, b"\r"),
                "insertTab:" => write_to_pty(fd, b"\t"),
                "insertBacktab:" => write_to_pty(fd, b"\x1b[Z"),
                "cancelOperation:" => write_to_pty(fd, b"\x1b"),
                "moveUp:" => write_to_pty(fd, if app_cursor != 0 { b"\x1bOA" } else { b"\x1b[A" }),
                "moveDown:" => write_to_pty(fd, if app_cursor != 0 { b"\x1bOB" } else { b"\x1b[B" }),
                "moveLeft:" => write_to_pty(fd, if app_cursor != 0 { b"\x1bOD" } else { b"\x1b[D" }),
                "moveRight:" => write_to_pty(fd, if app_cursor != 0 { b"\x1bOC" } else { b"\x1b[C" }),
                "moveToBeginningOfLine:" => write_to_pty(fd, b"\x01"), // Ctrl+A
                "moveToEndOfLine:" => write_to_pty(fd, b"\x05"),       // Ctrl+E
                "moveToBeginningOfDocument:" => write_to_pty(fd, if app_cursor != 0 { b"\x1bOH" } else { b"\x1b[H" }),
                "moveToEndOfDocument:" => write_to_pty(fd, if app_cursor != 0 { b"\x1bOF" } else { b"\x1b[F" }),
                "pageUp:" => write_to_pty(fd, b"\x1b[5~"),
                "pageDown:" => write_to_pty(fd, b"\x1b[6~"),
                "noop:" => {} // Ignore noop
                _ => {}
            }
        } else {
            // Legacy callback mode
            let state_ptr: *mut c_void = *this.get_ivar("honeTerminalState");
            let callbacks_ptr: *mut c_void = *this.get_ivar("honeInputCallbacks");
            if state_ptr.is_null() || callbacks_ptr.is_null() {
                return;
            }

            let callbacks = &*(callbacks_ptr as *const InputCallbacks);
            if let Some(callback) = callbacks.action {
                let sel_name = a_selector.name();
                let c_str = std::ffi::CString::new(sel_name).unwrap();
                callback(state_ptr as *mut TerminalView, c_str.as_ptr());
            }
        }
    }
}

extern "C" fn mouse_down(this: &Object, _sel: Sel, event: id) {
    unsafe {
        // Make first responder (grab keyboard focus)
        let window: id = msg_send![this, window];
        if window != nil {
            let _: () = msg_send![window, makeFirstResponder: this];
        }

        let state_ptr: *mut c_void = *this.get_ivar("honeTerminalState");
        let callbacks_ptr: *mut c_void = *this.get_ivar("honeInputCallbacks");
        if state_ptr.is_null() || callbacks_ptr.is_null() {
            return;
        }

        let callbacks = &*(callbacks_ptr as *const InputCallbacks);
        if let Some(callback) = callbacks.mouse_down {
            // Convert window coordinates to view coordinates
            let window_point: NSPoint = msg_send![event, locationInWindow];
            let local_point: NSPoint = msg_send![this, convertPoint:window_point fromView:nil];
            callback(state_ptr as *mut TerminalView, local_point.x, local_point.y);
        }
    }
}

extern "C" fn scroll_wheel(this: &Object, _sel: Sel, event: id) {
    unsafe {
        let state_ptr: *mut c_void = *this.get_ivar("honeTerminalState");
        let callbacks_ptr: *mut c_void = *this.get_ivar("honeInputCallbacks");
        if state_ptr.is_null() || callbacks_ptr.is_null() {
            return;
        }

        let callbacks = &*(callbacks_ptr as *const InputCallbacks);
        if let Some(callback) = callbacks.scroll {
            let dx: f64 = msg_send![event, scrollingDeltaX];
            let dy: f64 = msg_send![event, scrollingDeltaY];

            // Check if this is a precise (trackpad) scroll
            let is_precise: BOOL = msg_send![event, hasPreciseScrollingDeltas];
            let scale = if is_precise == YES { 1.0 } else { 3.0 };

            callback(state_ptr as *mut TerminalView, dx * scale, dy * scale);
        }
    }
}

extern "C" fn reset_cursor_rects(this: &Object, _sel: Sel) {
    unsafe {
        let bounds: NSRect = msg_send![this, bounds];
        let ibeam: id = msg_send![class!(NSCursor), IBeamCursor];
        let _: () = msg_send![this, addCursorRect:bounds cursor:ibeam];
    }
}

extern "C" fn flags_changed(_this: &Object, _sel: Sel, _event: id) {
    // Handle modifier key changes (needed for proper key event processing)
    // No action needed — we read modifier flags in keyDown:
}

/// Return intrinsic content size so Auto Layout (NSStackView Fill distribution)
/// gives this view non-zero space.
extern "C" fn intrinsic_content_size(this: &Object, _sel: Sel) -> cocoa::foundation::NSSize {
    unsafe {
        let w: f64 = *this.get_ivar("honeIntrinsicW");
        let h: f64 = *this.get_ivar("honeIntrinsicH");
        cocoa::foundation::NSSize::new(w, h)
    }
}

/// Auto-become first responder when added to a window so the terminal
/// receives keyboard input immediately (no click required).
extern "C" fn view_did_move_to_window(this: &Object, _sel: Sel) {
    unsafe {
        let window: id = msg_send![this, window];
        if window != nil {
            let _: () = msg_send![window, makeFirstResponder: this];
        }
    }
}
