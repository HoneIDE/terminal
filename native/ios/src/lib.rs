//! iOS stub for Hone Terminal — all functions are no-ops.
//! Terminal emulation on iOS is not yet implemented.

use std::ffi::c_char;

#[no_mangle]
pub extern "C" fn hone_terminal_create(_rows: i32, _cols: i32) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_create(_rows: i32, _cols: i32) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn hone_terminal_destroy(_handle: i64) {}

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_destroy(_handle: i64) {}

#[no_mangle]
pub extern "C" fn hone_terminal_set_font(_handle: i64, _font_name: i64, _size: f64) {}

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_set_font(_handle: i64, _font_name: i64, _size: f64) {}

#[no_mangle]
pub extern "C" fn hone_terminal_render_cells(_handle: i64, _json: i64, _rows: i32, _cols: i32) {}

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_render_cells(_handle: i64, _json: i64, _rows: i32, _cols: i32) {}

#[no_mangle]
pub extern "C" fn hone_terminal_set_cursor(_handle: i64, _row: i32, _col: i32, _visible: i32, _style: i32) {}

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_set_cursor(_handle: i64, _row: i32, _col: i32, _visible: i32, _style: i32) {}

#[no_mangle]
pub extern "C" fn hone_terminal_resize(_handle: i64, _width: f64, _height: f64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_resize(_handle: i64, _width: f64, _height: f64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn hone_terminal_set_selection(_handle: i64, _json: i64) {}

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_set_selection(_handle: i64, _json: i64) {}

#[no_mangle]
pub extern "C" fn hone_terminal_scroll(_handle: i64, _delta: i32) {}

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_scroll(_handle: i64, _delta: i32) {}

#[no_mangle]
pub extern "C" fn hone_terminal_set_theme(_handle: i64, _json: i64) {}

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_set_theme(_handle: i64, _json: i64) {}

#[no_mangle]
pub extern "C" fn hone_terminal_get_cell_size(_handle: i64, _w_out: i64, _h_out: i64) {}

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_get_cell_size(_handle: i64, _w_out: i64, _h_out: i64) {}

#[no_mangle]
pub extern "C" fn hone_terminal_show_demo() {}

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_show_demo() {}

#[no_mangle]
pub extern "C" fn hone_terminal_open(_rows: f64, _cols: f64, _font_name: i64, _font_size: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_open(_rows: f64, _cols: f64, _font_name: i64, _font_size: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn hone_terminal_nsview(_handle: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_nsview(_handle: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn hone_terminal_poll(_handle: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_poll(_handle: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn hone_terminal_write(_handle: i64, _data: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_write(_handle: i64, _data: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn hone_terminal_close(_handle: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_close(_handle: i64) -> i64 { 0 }

#[no_mangle]
pub extern "C" fn hone_terminal_live_set_theme(_handle: i64, _theme_json: i64) {}

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_live_set_theme(_handle: i64, _theme_json: i64) {}

#[no_mangle]
pub extern "C" fn hone_terminal_set_bg_fg(_handle: i64, _bg_r: f64, _bg_g: f64, _bg_b: f64, _fg_r: f64, _fg_g: f64, _fg_b: f64) {}

#[no_mangle]
pub extern "C" fn __wrapper_hone_terminal_set_bg_fg(_handle: i64, _bg_r: f64, _bg_g: f64, _bg_b: f64, _fg_r: f64, _fg_g: f64, _fg_b: f64) {}
