//! TerminalView — core state and rendering logic for the terminal grid.
//!
//! Holds the frame buffer (cell grid), cursor state, selection, theme,
//! and font metrics. Drawing is delegated to grid_renderer via Cairo + Pango.

use serde::Deserialize;
use cairo::Context as CairoContext;

use crate::grid_renderer::GridRenderer;

// ============================================================================
// Data types matching the TypeScript RenderCell JSON format
// ============================================================================

#[derive(Debug, Deserialize, Clone)]
pub struct RenderCell {
    /// Character to display.
    pub c: String,
    /// Foreground RGB.
    pub fg: [u8; 3],
    /// Background RGB.
    pub bg: [u8; 3],
    /// Bold.
    pub b: bool,
    /// Italic.
    pub i: bool,
    /// Underline.
    pub u: bool,
    /// Strikethrough.
    pub s: bool,
    /// Dim.
    pub d: bool,
    /// Invisible.
    pub v: bool,
    /// Cell width (1 or 2).
    pub w: u8,
    /// Underline style (optional).
    #[serde(default)]
    pub us: Option<String>,
    /// Hyperlink URL (optional).
    #[serde(default)]
    pub hl: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CursorState {
    pub row: usize,
    pub col: usize,
    /// 0=block, 1=beam, 2=underline
    pub style: i32,
    pub visible: bool,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SelectionRange {
    #[serde(rename = "startRow")]
    pub start_row: usize,
    #[serde(rename = "startCol")]
    pub start_col: usize,
    #[serde(rename = "endRow")]
    pub end_row: usize,
    #[serde(rename = "endCol")]
    pub end_col: usize,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ThemeColors {
    pub foreground: String,
    pub background: String,
    pub cursor: Option<String>,
    #[serde(rename = "selectionBackground")]
    pub selection_background: Option<String>,
}

// ============================================================================
// TerminalView
// ============================================================================

/// Handle to an X11 window for invalidation.
pub struct X11WindowHandle {
    pub display: *mut x11::xlib::Display,
    pub window: x11::xlib::Window,
}

pub struct TerminalView {
    pub rows: usize,
    pub cols: usize,

    // Frame buffer: cells[row][col]
    pub cells: Vec<Vec<RenderCell>>,

    // Cursor
    pub cursor: CursorState,

    // Selection highlight
    pub selections: Vec<SelectionRange>,

    // Scroll offset (lines scrolled into history)
    pub scroll_offset: i32,

    // Rendering
    pub renderer: GridRenderer,

    // Theme colors (parsed from JSON)
    pub bg_color: (f64, f64, f64),
    pub fg_color: (f64, f64, f64),
    pub cursor_color: (f64, f64, f64),
    pub selection_color: (f64, f64, f64, f64),

    // X11 window handle (set by view.rs when attached)
    pub x11_window: Option<X11WindowHandle>,
}

impl TerminalView {
    pub fn new(rows: usize, cols: usize) -> Self {
        let default_cell = default_render_cell();
        let cells = vec![vec![default_cell; cols]; rows];

        let renderer = GridRenderer::new("DejaVu Sans Mono", 14.0);

        TerminalView {
            rows,
            cols,
            cells,
            cursor: CursorState {
                row: 0,
                col: 0,
                style: 0,
                visible: true,
            },
            selections: Vec::new(),
            scroll_offset: 0,
            renderer,
            // Default dark theme colors
            bg_color: hex_to_f64("#1e1e2e"),
            fg_color: hex_to_f64("#cdd6f4"),
            cursor_color: hex_to_f64("#f5e0dc"),
            selection_color: (0.31, 0.42, 0.67, 0.4),
            x11_window: None,
        }
    }

    pub fn set_font(&mut self, family: &str, size: f64) {
        self.renderer = GridRenderer::new(family, size);
        self.invalidate();
    }

    pub fn set_theme(&mut self, json: &str) {
        if let Ok(theme) = serde_json::from_str::<ThemeColors>(json) {
            self.bg_color = hex_to_f64(&theme.background);
            self.fg_color = hex_to_f64(&theme.foreground);
            if let Some(ref cursor) = theme.cursor {
                self.cursor_color = hex_to_f64(cursor);
            }
            if let Some(ref sel) = theme.selection_background {
                let (r, g, b) = hex_to_f64(sel);
                self.selection_color = (r, g, b, 0.4);
            }
            self.invalidate();
        }
    }

    /// Set background and foreground colors directly (no JSON parsing).
    pub fn set_bg_fg(&mut self, bg_r: f64, bg_g: f64, bg_b: f64, fg_r: f64, fg_g: f64, fg_b: f64) {
        self.bg_color = (bg_r, bg_g, bg_b);
        self.fg_color = (fg_r, fg_g, fg_b);
        self.cursor_color = (fg_r, fg_g, fg_b);
        self.invalidate();
    }

    pub fn render_cells(&mut self, json: &str, start_row: usize, _end_row: usize) {
        if let Ok(rows) = serde_json::from_str::<Vec<Vec<RenderCell>>>(json) {
            for (i, row_cells) in rows.into_iter().enumerate() {
                let target_row = start_row + i;
                if target_row < self.rows {
                    self.cells[target_row] = row_cells;
                }
            }
            self.invalidate();
        }
    }

    pub fn set_cursor(&mut self, row: usize, col: usize, style: i32, visible: bool) {
        self.cursor = CursorState { row, col, style, visible };
        self.invalidate();
    }

    pub fn resize(&mut self, rows: usize, cols: usize) {
        self.rows = rows;
        self.cols = cols;
        let default_cell = default_render_cell();
        self.cells.resize(rows, vec![default_cell.clone(); cols]);
        for row in &mut self.cells {
            row.resize(cols, default_cell.clone());
        }
        self.invalidate();
    }

    pub fn set_selection(&mut self, json: &str) {
        if let Ok(ranges) = serde_json::from_str::<Vec<SelectionRange>>(json) {
            self.selections = ranges;
            self.invalidate();
        }
    }

    pub fn scroll(&mut self, offset: i32) {
        self.scroll_offset = offset;
        self.invalidate();
    }

    pub fn cell_size(&self) -> (f64, f64) {
        (self.renderer.font_set.char_width, self.renderer.font_set.line_height)
    }

    /// Draw the entire terminal grid into a Cairo context.
    pub fn draw(&self, cr: &CairoContext) {
        let font = &self.renderer.font_set;
        let cell_w = font.char_width;
        let cell_h = font.line_height;

        // 1. Draw background
        cr.set_source_rgb(self.bg_color.0, self.bg_color.1, self.bg_color.2);
        cr.rectangle(
            0.0,
            0.0,
            self.cols as f64 * cell_w,
            self.rows as f64 * cell_h,
        );
        let _ = cr.fill();

        // 2. Draw cell backgrounds (only non-default)
        for row in 0..self.rows {
            if row >= self.cells.len() { break; }
            let y = row as f64 * cell_h;

            for col in 0..self.cols {
                if col >= self.cells[row].len() { break; }
                let cell = &self.cells[row][col];
                let x = col as f64 * cell_w;

                let bg = (
                    cell.bg[0] as f64 / 255.0,
                    cell.bg[1] as f64 / 255.0,
                    cell.bg[2] as f64 / 255.0,
                );
                if (bg.0 - self.bg_color.0).abs() > 0.01
                    || (bg.1 - self.bg_color.1).abs() > 0.01
                    || (bg.2 - self.bg_color.2).abs() > 0.01
                {
                    cr.set_source_rgb(bg.0, bg.1, bg.2);
                    let w = if cell.w == 2 { cell_w * 2.0 } else { cell_w };
                    cr.rectangle(x, y, w, cell_h);
                    let _ = cr.fill();
                }
            }
        }

        // 3. Draw selection highlights
        for sel in &self.selections {
            cr.set_source_rgba(
                self.selection_color.0,
                self.selection_color.1,
                self.selection_color.2,
                self.selection_color.3,
            );
            for row in sel.start_row..=sel.end_row {
                if row >= self.rows { break; }
                let y = row as f64 * cell_h;
                let col_start = if row == sel.start_row { sel.start_col } else { 0 };
                let col_end = if row == sel.end_row { sel.end_col } else { self.cols };
                let x = col_start as f64 * cell_w;
                let w = (col_end - col_start) as f64 * cell_w;
                cr.rectangle(x, y, w, cell_h);
                let _ = cr.fill();
            }
        }

        // 4. Draw text (character by character with per-cell colors)
        for row in 0..self.rows {
            if row >= self.cells.len() { break; }
            let y = row as f64 * cell_h;

            for col in 0..self.cols {
                if col >= self.cells[row].len() { break; }
                let cell = &self.cells[row][col];

                // Skip empty/invisible cells and continuation cells
                if cell.c.is_empty() || cell.v { continue; }

                let x = col as f64 * cell_w;
                let fg = (
                    cell.fg[0] as f64 / 255.0,
                    cell.fg[1] as f64 / 255.0,
                    cell.fg[2] as f64 / 255.0,
                );

                // Apply dim
                let fg = if cell.d {
                    (fg.0 * 0.5, fg.1 * 0.5, fg.2 * 0.5)
                } else {
                    fg
                };

                self.renderer.draw_char(cr, &cell.c, x, y, fg, cell.b, cell.i);

                // Draw underline
                if cell.u {
                    let underline_y = y + font.ascent + 2.0;
                    cr.set_source_rgb(fg.0, fg.1, fg.2);
                    cr.set_line_width(1.0);

                    match cell.us.as_deref() {
                        Some("double") => {
                            cr.move_to(x, underline_y);
                            cr.line_to(x + cell_w, underline_y);
                            cr.move_to(x, underline_y + 2.0);
                            cr.line_to(x + cell_w, underline_y + 2.0);
                        }
                        Some("curly") => {
                            // Approximate wavy underline with short line segments
                            let segments = 4;
                            let seg_w = cell_w / segments as f64;
                            cr.move_to(x, underline_y);
                            for s in 0..segments {
                                let sx = x + (s as f64 + 0.5) * seg_w;
                                let sy = underline_y + if s % 2 == 0 { -1.5 } else { 1.5 };
                                cr.line_to(sx, sy);
                            }
                            cr.line_to(x + cell_w, underline_y);
                        }
                        _ => {
                            // Single underline
                            cr.move_to(x, underline_y);
                            cr.line_to(x + cell_w, underline_y);
                        }
                    }
                    let _ = cr.stroke();
                }

                // Draw strikethrough
                if cell.s {
                    let strike_y = y + font.ascent * 0.5;
                    cr.set_source_rgb(fg.0, fg.1, fg.2);
                    cr.set_line_width(1.0);
                    cr.move_to(x, strike_y);
                    cr.line_to(x + cell_w, strike_y);
                    let _ = cr.stroke();
                }
            }
        }

        // 5. Draw cursor
        if self.cursor.visible && self.cursor.row < self.rows && self.cursor.col < self.cols {
            let cx = self.cursor.col as f64 * cell_w;
            let cy = self.cursor.row as f64 * cell_h;

            match self.cursor.style {
                0 => {
                    // Block cursor
                    cr.set_source_rgba(
                        self.cursor_color.0,
                        self.cursor_color.1,
                        self.cursor_color.2,
                        0.7,
                    );
                    cr.rectangle(cx, cy, cell_w, cell_h);
                    let _ = cr.fill();

                    // Draw the character under the cursor in the background color
                    if self.cursor.row < self.cells.len()
                        && self.cursor.col < self.cells[self.cursor.row].len()
                    {
                        let cell = &self.cells[self.cursor.row][self.cursor.col];
                        if !cell.c.is_empty() {
                            self.renderer.draw_char(
                                cr,
                                &cell.c,
                                cx,
                                cy,
                                self.bg_color,
                                cell.b,
                                cell.i,
                            );
                        }
                    }
                }
                1 => {
                    // Beam cursor (vertical line)
                    cr.set_source_rgb(
                        self.cursor_color.0,
                        self.cursor_color.1,
                        self.cursor_color.2,
                    );
                    cr.rectangle(cx, cy, 2.0, cell_h);
                    let _ = cr.fill();
                }
                2 => {
                    // Underline cursor
                    cr.set_source_rgb(
                        self.cursor_color.0,
                        self.cursor_color.1,
                        self.cursor_color.2,
                    );
                    cr.rectangle(cx, cy + cell_h - 2.0, cell_w, 2.0);
                    let _ = cr.fill();
                }
                _ => {}
            }
        }
    }

    /// Request a redraw of the X11 window by sending an Expose event.
    fn invalidate(&self) {
        if let Some(ref handle) = self.x11_window {
            unsafe {
                let mut event: x11::xlib::XEvent = std::mem::zeroed();
                event.expose = x11::xlib::XExposeEvent {
                    type_: x11::xlib::Expose,
                    serial: 0,
                    send_event: x11::xlib::True,
                    display: handle.display,
                    window: handle.window,
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                    count: 0,
                };
                x11::xlib::XSendEvent(
                    handle.display,
                    handle.window,
                    x11::xlib::False,
                    x11::xlib::ExposureMask,
                    &mut event,
                );
                x11::xlib::XFlush(handle.display);
            }
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

pub fn default_render_cell() -> RenderCell {
    RenderCell {
        c: " ".to_string(),
        fg: [205, 214, 244],  // #cdd6f4
        bg: [30, 30, 46],     // #1e1e2e
        b: false,
        i: false,
        u: false,
        s: false,
        d: false,
        v: false,
        w: 1,
        us: None,
        hl: None,
    }
}

/// Parse a hex color string like "#rrggbb" into normalized f64 (0.0-1.0) RGB.
pub fn hex_to_f64(hex: &str) -> (f64, f64, f64) {
    let h = hex.trim_start_matches('#');
    let r = u8::from_str_radix(&h[0..2], 16).unwrap_or(0) as f64 / 255.0;
    let g = u8::from_str_radix(&h[2..4], 16).unwrap_or(0) as f64 / 255.0;
    let b = u8::from_str_radix(&h[4..6], 16).unwrap_or(0) as f64 / 255.0;
    (r, g, b)
}
