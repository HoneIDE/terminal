//! Win32 window (HWND) for the terminal: HoneTerminalView.
//!
//! Creates a Win32 window class that handles:
//! - Drawing (WM_PAINT → TerminalView::draw via Direct2D)
//! - Keyboard input (WM_KEYDOWN, WM_CHAR)
//! - Mouse input (WM_LBUTTONDOWN, WM_MOUSEWHEEL)
//! - Window resizing (WM_SIZE → render target resize)
//!
//! Input events are dispatched via registered C callbacks.

use std::os::raw::c_char;

use windows::core::{HSTRING, Interface};
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Direct2D::Common::*;
use windows::Win32::Graphics::Direct2D::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::*;

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

/// Per-window state stored in GWLP_USERDATA.
pub struct WindowState {
    pub terminal_view: *mut TerminalView,
    pub render_target: Option<ID2D1HwndRenderTarget>,
    pub d2d_factory: ID2D1Factory,
    pub callbacks: InputCallbacks,
}

static REGISTER_CLASS: std::sync::Once = std::sync::Once::new();

/// Register the HoneTerminalView Win32 window class.
pub fn register_class() {
    REGISTER_CLASS.call_once(|| {
        unsafe {
            let instance = GetModuleHandleW(None).unwrap_or_default();
            let class_name = HSTRING::from("HoneTerminalView");

            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(wnd_proc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: instance.into(),
                hIcon: HICON::default(),
                hCursor: LoadCursorW(None, IDC_IBEAM).unwrap_or_default(),
                hbrBackground: HBRUSH::default(),
                lpszMenuName: windows::core::PCWSTR::null(),
                lpszClassName: windows::core::PCWSTR(class_name.as_ptr()),
                hIconSm: HICON::default(),
            };

            RegisterClassExW(&wc);
        }
    });
}

/// Create a new HoneTerminalView HWND and associate it with a TerminalView.
pub fn create_hwnd(
    terminal_view: &mut TerminalView,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    parent: Option<HWND>,
) -> HWND {
    register_class();

    unsafe {
        // Create Direct2D factory
        let d2d_factory: ID2D1Factory = D2D1CreateFactory(
            D2D1_FACTORY_TYPE_SINGLE_THREADED,
            None,
        ).expect("Failed to create D2D1 factory");

        // Allocate window state
        let state = Box::new(WindowState {
            terminal_view: terminal_view as *mut TerminalView,
            render_target: None,
            d2d_factory,
            callbacks: InputCallbacks {
                text_input: None,
                action: None,
                mouse_down: None,
                scroll: None,
            },
        });
        let state_ptr = Box::into_raw(state);

        let instance = GetModuleHandleW(None).unwrap_or_default();
        let class_name = HSTRING::from("HoneTerminalView");

        let style = if parent.is_some() {
            WS_CHILD | WS_VISIBLE
        } else {
            WS_OVERLAPPEDWINDOW
        };

        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            &class_name,
            &HSTRING::from("Hone Terminal"),
            style,
            x,
            y,
            width,
            height,
            parent.unwrap_or(HWND::default()),
            None,
            instance,
            Some(state_ptr as *const std::ffi::c_void),
        )
        .expect("Failed to create window");

        terminal_view.hwnd = Some(hwnd);
        hwnd
    }
}

/// Ensure the render target exists for the given HWND.
fn ensure_render_target(state: &mut WindowState, hwnd: HWND) {
    if state.render_target.is_some() {
        return;
    }
    unsafe {
        let mut rc = RECT::default();
        let _ = GetClientRect(hwnd, &mut rc);
        let size = D2D_SIZE_U {
            width: (rc.right - rc.left) as u32,
            height: (rc.bottom - rc.top) as u32,
        };

        let props = D2D1_RENDER_TARGET_PROPERTIES {
            r#type: D2D1_RENDER_TARGET_TYPE_DEFAULT,
            pixelFormat: D2D1_PIXEL_FORMAT {
                format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
                alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
            },
            dpiX: 0.0,
            dpiY: 0.0,
            usage: D2D1_RENDER_TARGET_USAGE_NONE,
            minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
        };

        let hwnd_props = D2D1_HWND_RENDER_TARGET_PROPERTIES {
            hwnd,
            pixelSize: size,
            presentOptions: D2D1_PRESENT_OPTIONS_NONE,
        };

        let rt = state.d2d_factory.CreateHwndRenderTarget(&props, &hwnd_props);
        if let Ok(rt) = rt {
            state.render_target = Some(rt);
        }
    }
}

// ============================================================================
// Window procedure
// ============================================================================

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_CREATE => {
            let cs = &*(lparam.0 as *const CREATESTRUCTW);
            if !cs.lpCreateParams.is_null() {
                let _ = SetWindowLongPtrW(hwnd, GWLP_USERDATA, cs.lpCreateParams as isize);
            }
            LRESULT(0)
        }

        WM_PAINT => {
            let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut WindowState;
            if !state_ptr.is_null() {
                let state = &mut *state_ptr;
                ensure_render_target(state, hwnd);

                // Use a separate scope to avoid borrow issues
                let should_discard = if let Some(ref hwnd_rt) = state.render_target {
                    let terminal_view = &*state.terminal_view;
                    // Cast ID2D1HwndRenderTarget → ID2D1RenderTarget for drawing methods
                    if let Ok(rt) = hwnd_rt.cast::<ID2D1RenderTarget>() {
                        rt.BeginDraw();
                        terminal_view.draw(&rt);
                        rt.EndDraw(None, None).is_err()
                    } else {
                        false
                    }
                } else {
                    false
                };
                if should_discard {
                    // D2DERR_RECREATE_TARGET — discard and recreate on next paint
                    state.render_target = None;
                }
            }
            // Must call BeginPaint/EndPaint to validate the region,
            // otherwise WM_PAINT re-posts infinitely.
            let mut ps = PAINTSTRUCT::default();
            let _ = BeginPaint(hwnd, &mut ps);
            let _ = EndPaint(hwnd, &ps);
            LRESULT(0)
        }

        WM_SIZE => {
            let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut WindowState;
            if !state_ptr.is_null() {
                let state = &mut *state_ptr;
                let width = (lparam.0 & 0xFFFF) as u32;
                let height = ((lparam.0 >> 16) & 0xFFFF) as u32;
                if let Some(ref rt) = state.render_target {
                    let size = D2D_SIZE_U { width, height };
                    let _ = rt.Resize(&size);
                }
            }
            LRESULT(0)
        }

        WM_CHAR => {
            let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut WindowState;
            if !state_ptr.is_null() {
                let state = &*state_ptr;
                if let Some(callback) = state.callbacks.text_input {
                    // wparam contains the UTF-16 character
                    let ch = char::from_u32(wparam.0 as u32).unwrap_or('\0');
                    if !ch.is_control() || ch == '\r' || ch == '\t' || ch == '\x08' {
                        let mut buf = [0u8; 4];
                        let s = ch.encode_utf8(&mut buf);
                        let c_str = std::ffi::CString::new(s.as_bytes()).unwrap_or_default();
                        callback(state.terminal_view, c_str.as_ptr());
                    }
                }
            }
            LRESULT(0)
        }

        WM_KEYDOWN => {
            let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut WindowState;
            if !state_ptr.is_null() {
                let state = &*state_ptr;
                if let Some(callback) = state.callbacks.action {
                    let vk = VIRTUAL_KEY(wparam.0 as u16);
                    let key_name = virtual_key_name(vk);
                    if !key_name.is_empty() {
                        let c_str = std::ffi::CString::new(key_name).unwrap_or_default();
                        callback(state.terminal_view, c_str.as_ptr());
                    }
                }
            }
            // Let DefWindowProc generate WM_CHAR for printable keys
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }

        WM_LBUTTONDOWN => {
            let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut WindowState;
            if !state_ptr.is_null() {
                let state = &*state_ptr;
                if let Some(callback) = state.callbacks.mouse_down {
                    let x = (lparam.0 & 0xFFFF) as i16 as f64;
                    let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as f64;
                    callback(state.terminal_view, x, y);
                }
            }
            LRESULT(0)
        }

        WM_MOUSEWHEEL => {
            let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut WindowState;
            if !state_ptr.is_null() {
                let state = &*state_ptr;
                if let Some(callback) = state.callbacks.scroll {
                    let delta = ((wparam.0 >> 16) & 0xFFFF) as i16 as f64;
                    // WHEEL_DELTA is 120; normalize to line-like units
                    let dy = delta / 120.0 * 3.0;
                    callback(state.terminal_view, 0.0, dy);
                }
            }
            LRESULT(0)
        }

        WM_DESTROY => {
            // Clean up WindowState
            let state_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut WindowState;
            if !state_ptr.is_null() {
                let _ = SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                let _ = Box::from_raw(state_ptr);
            }
            PostQuitMessage(0);
            LRESULT(0)
        }

        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

/// Map a virtual key code to a readable name for the action callback.
fn virtual_key_name(vk: VIRTUAL_KEY) -> &'static str {
    match vk {
        VK_RETURN => "enter",
        VK_ESCAPE => "escape",
        VK_TAB => "tab",
        VK_BACK => "backspace",
        VK_DELETE => "delete",
        VK_UP => "moveUp:",
        VK_DOWN => "moveDown:",
        VK_LEFT => "moveLeft:",
        VK_RIGHT => "moveRight:",
        VK_HOME => "moveToBeginningOfLine:",
        VK_END => "moveToEndOfLine:",
        VK_PRIOR => "pageUp:",
        VK_NEXT => "pageDown:",
        VK_F1 => "f1",
        VK_F2 => "f2",
        VK_F3 => "f3",
        VK_F4 => "f4",
        VK_F5 => "f5",
        VK_F6 => "f6",
        VK_F7 => "f7",
        VK_F8 => "f8",
        VK_F9 => "f9",
        VK_F10 => "f10",
        VK_F11 => "f11",
        VK_F12 => "f12",
        _ => "",
    }
}
