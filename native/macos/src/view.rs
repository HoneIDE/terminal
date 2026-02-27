//! NSView subclass for the terminal: HoneTerminalView.
//!
//! Registers a custom Objective-C class that handles:
//! - Drawing (drawRect: → TerminalView::draw)
//! - Keyboard input (keyDown:, insertText:, doCommandBySelector:)
//! - Mouse input (mouseDown:, scrollWheel:)
//! - Cursor shape (I-beam)
//!
//! Input events are dispatched via registered C callbacks.

use std::os::raw::{c_char, c_void};
use std::sync::Once;

use cocoa::base::{id, nil, YES};
use cocoa::foundation::{NSPoint, NSRect};
use objc::declare::ClassDecl;
use objc::runtime::{Object, Sel, BOOL};
use objc::{class, msg_send, sel, sel_impl};

use crate::terminal_view::TerminalView;

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

        // Allocate input callbacks
        let callbacks = Box::new(InputCallbacks {
            text_input: None,
            action: None,
            mouse_down: None,
            scroll: None,
        });
        (*view).set_ivar("honeInputCallbacks", Box::into_raw(callbacks) as *mut c_void);

        terminal_view.nsview = Some(view);
        view
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
        // Route through interpretKeyEvents: for standard macOS text input handling
        let events: id = msg_send![class!(NSArray), arrayWithObject: event];
        let _: () = msg_send![this, interpretKeyEvents: events];
    }
}

extern "C" fn insert_text(this: &Object, _sel: Sel, string: id) {
    unsafe {
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

extern "C" fn do_command_by_selector(this: &Object, _sel: Sel, a_selector: Sel) {
    unsafe {
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

extern "C" fn mouse_down(this: &Object, _sel: Sel, event: id) {
    unsafe {
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
