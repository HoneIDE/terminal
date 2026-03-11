//! Terminal state machine implementing `vte::Perform`.
//!
//! Manages the terminal grid, cursor, scroll region, modes, colors,
//! scrollback, and alternate screen buffer.

use std::collections::VecDeque;
use crate::terminal_view::RenderCell;

// ============================================================================
// Color types
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Color {
    Default,
    Indexed(u8),
    Rgb(u8, u8, u8),
}

impl Color {
    /// Convert to RGB tuple. Uses xterm-256 color palette for Indexed.
    /// `default_fg` and `default_bg` are used when the color is `Color::Default`.
    pub fn to_rgb(&self, is_fg: bool, default_fg: [u8; 3], default_bg: [u8; 3]) -> [u8; 3] {
        match *self {
            Color::Default => {
                if is_fg { default_fg } else { default_bg }
            }
            Color::Indexed(idx) => index_to_rgb(idx),
            Color::Rgb(r, g, b) => [r, g, b],
        }
    }
}

/// Standard xterm-256 color palette.
fn index_to_rgb(idx: u8) -> [u8; 3] {
    match idx {
        0 => [0, 0, 0],         // Black
        1 => [205, 49, 49],     // Red
        2 => [13, 188, 121],    // Green
        3 => [229, 229, 16],    // Yellow
        4 => [36, 114, 200],    // Blue
        5 => [188, 63, 188],    // Magenta
        6 => [17, 168, 205],    // Cyan
        7 => [229, 229, 229],   // White
        8 => [102, 102, 102],   // Bright Black
        9 => [241, 76, 76],     // Bright Red
        10 => [35, 209, 139],   // Bright Green
        11 => [245, 245, 67],   // Bright Yellow
        12 => [59, 142, 234],   // Bright Blue
        13 => [214, 112, 214],  // Bright Magenta
        14 => [41, 184, 219],   // Bright Cyan
        15 => [229, 229, 229],  // Bright White
        16..=231 => {
            // 6x6x6 color cube
            let n = idx - 16;
            let b = n % 6;
            let g = (n / 6) % 6;
            let r = n / 36;
            let map = |v: u8| if v == 0 { 0 } else { 55 + 40 * v };
            [map(r), map(g), map(b)]
        }
        232..=255 => {
            // Grayscale ramp
            let v = 8 + 10 * (idx - 232);
            [v, v, v]
        }
    }
}

// ============================================================================
// Cell
// ============================================================================

#[derive(Debug, Clone)]
pub struct Cell {
    pub ch: char,
    pub fg: Color,
    pub bg: Color,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strikethrough: bool,
    pub dim: bool,
    pub inverse: bool,
    pub hidden: bool,
}

impl Cell {
    pub fn blank() -> Self {
        Cell {
            ch: ' ',
            fg: Color::Default,
            bg: Color::Default,
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false,
            dim: false,
            inverse: false,
            hidden: false,
        }
    }
}

// ============================================================================
// SGR attributes (current pen)
// ============================================================================

#[derive(Debug, Clone)]
struct Attrs {
    fg: Color,
    bg: Color,
    bold: bool,
    italic: bool,
    underline: bool,
    strikethrough: bool,
    dim: bool,
    inverse: bool,
    hidden: bool,
}

impl Attrs {
    fn new() -> Self {
        Attrs {
            fg: Color::Default,
            bg: Color::Default,
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false,
            dim: false,
            inverse: false,
            hidden: false,
        }
    }

    fn reset(&mut self) {
        *self = Attrs::new();
    }

    fn apply_to_cell(&self, cell: &mut Cell) {
        cell.fg = self.fg;
        cell.bg = self.bg;
        cell.bold = self.bold;
        cell.italic = self.italic;
        cell.underline = self.underline;
        cell.strikethrough = self.strikethrough;
        cell.dim = self.dim;
        cell.inverse = self.inverse;
        cell.hidden = self.hidden;
    }
}

// ============================================================================
// TerminalState
// ============================================================================

pub struct TerminalState {
    // Grid
    pub rows: usize,
    pub cols: usize,
    pub grid: Vec<Vec<Cell>>,

    // Cursor
    pub cursor_row: usize,
    pub cursor_col: usize,
    pub cursor_visible: bool,
    pub cursor_style: i32, // 0=block, 1=beam, 2=underline
    saved_cursor_row: usize,
    saved_cursor_col: usize,
    saved_attrs: Attrs,

    // Scroll region
    scroll_top: usize,
    scroll_bottom: usize,

    // Current text attributes
    attrs: Attrs,

    // Modes
    pub autowrap: bool,
    origin_mode: bool,
    insert_mode: bool,
    pub cursor_keys_application: bool, // application mode for arrow keys
    pub bracketed_paste: bool,
    linefeed_mode: bool, // LNM: LF also does CR

    // Alternate screen
    alt_grid: Vec<Vec<Cell>>,
    alt_cursor_row: usize,
    alt_cursor_col: usize,
    alt_saved_cursor_row: usize,
    alt_saved_cursor_col: usize,
    alt_saved_attrs: Attrs,
    pub using_alt_screen: bool,

    // Scrollback (only for main screen)
    pub scrollback: VecDeque<Vec<Cell>>,
    pub max_scrollback: usize,

    // Tab stops
    tab_stops: Vec<bool>,

    // Wrap-pending flag (cursor at right margin, next char wraps)
    wrap_pending: bool,

    // Dirty flag for polling
    pub dirty: bool,

    // Window title
    pub title: String,

    // Pending DSR response to write back to PTY
    pub pending_response: Option<Vec<u8>>,

    // Configurable default colors (updated via theme/set_bg_fg)
    pub default_fg: [u8; 3],
    pub default_bg: [u8; 3],
}

impl TerminalState {
    pub fn new(rows: usize, cols: usize) -> Self {
        let blank_row = || vec![Cell::blank(); cols];
        let grid: Vec<Vec<Cell>> = (0..rows).map(|_| blank_row()).collect();
        let alt_grid: Vec<Vec<Cell>> = (0..rows).map(|_| blank_row()).collect();

        let mut tab_stops = vec![false; cols];
        for i in (0..cols).step_by(8) {
            tab_stops[i] = true;
        }

        TerminalState {
            rows,
            cols,
            grid,
            cursor_row: 0,
            cursor_col: 0,
            cursor_visible: true,
            cursor_style: 0,
            saved_cursor_row: 0,
            saved_cursor_col: 0,
            saved_attrs: Attrs::new(),
            scroll_top: 0,
            scroll_bottom: rows - 1,
            attrs: Attrs::new(),
            autowrap: true,
            origin_mode: false,
            insert_mode: false,
            cursor_keys_application: false,
            bracketed_paste: false,
            linefeed_mode: false,
            alt_grid,
            alt_cursor_row: 0,
            alt_cursor_col: 0,
            alt_saved_cursor_row: 0,
            alt_saved_cursor_col: 0,
            alt_saved_attrs: Attrs::new(),
            using_alt_screen: false,
            scrollback: VecDeque::new(),
            max_scrollback: 10000,
            tab_stops,
            wrap_pending: false,
            dirty: false,
            title: String::new(),
            pending_response: None,
            default_fg: [205, 214, 244], // #cdd6f4
            default_bg: [30, 30, 46],    // #1e1e2e
        }
    }

    /// Resize the terminal grid.
    pub fn resize(&mut self, new_rows: usize, new_cols: usize) {
        let old_rows = self.rows;
        self.rows = new_rows;
        self.cols = new_cols;

        // Resize main grid
        resize_grid(&mut self.grid, new_rows, new_cols);
        // Resize alt grid
        resize_grid(&mut self.alt_grid, new_rows, new_cols);

        // Fix scroll region
        if self.scroll_bottom >= old_rows || self.scroll_bottom == old_rows - 1 {
            self.scroll_bottom = new_rows - 1;
        }
        if self.scroll_top >= new_rows {
            self.scroll_top = 0;
        }
        if self.scroll_bottom >= new_rows {
            self.scroll_bottom = new_rows - 1;
        }

        // Clamp cursor
        if self.cursor_row >= new_rows {
            self.cursor_row = new_rows - 1;
        }
        if self.cursor_col >= new_cols {
            self.cursor_col = new_cols - 1;
        }

        // Resize tab stops
        self.tab_stops.resize(new_cols, false);
        for i in (0..new_cols).step_by(8) {
            self.tab_stops[i] = true;
        }

        self.dirty = true;
    }

    /// Convert grid to RenderCell format for TerminalView::draw().
    pub fn to_render_cells(&self) -> Vec<Vec<RenderCell>> {
        let mut result = Vec::with_capacity(self.rows);
        for row in 0..self.rows {
            let mut render_row = Vec::with_capacity(self.cols);
            for col in 0..self.cols {
                let cell = &self.grid[row][col];
                let (fg, bg) = if cell.inverse {
                    (cell.bg.to_rgb(false, self.default_fg, self.default_bg), cell.fg.to_rgb(true, self.default_fg, self.default_bg))
                } else {
                    (cell.fg.to_rgb(true, self.default_fg, self.default_bg), cell.bg.to_rgb(false, self.default_fg, self.default_bg))
                };
                render_row.push(RenderCell {
                    c: if cell.hidden {
                        " ".to_string()
                    } else {
                        cell.ch.to_string()
                    },
                    fg,
                    bg,
                    b: cell.bold,
                    i: cell.italic,
                    u: cell.underline,
                    s: cell.strikethrough,
                    d: cell.dim,
                    v: false,
                    w: 1,
                    us: None,
                    hl: None,
                });
            }
            result.push(render_row);
        }
        result
    }

    // ========================================================================
    // Private helpers
    // ========================================================================

    fn scroll_up(&mut self, count: usize) {
        for _ in 0..count {
            // Save top line to scrollback (only for main screen)
            if !self.using_alt_screen && self.scroll_top == 0 {
                let line = self.grid[self.scroll_top].clone();
                self.scrollback.push_back(line);
                if self.scrollback.len() > self.max_scrollback {
                    self.scrollback.pop_front();
                }
            }

            // Shift lines up within scroll region
            for r in self.scroll_top..self.scroll_bottom {
                self.grid[r] = self.grid[r + 1].clone();
            }
            // Clear bottom line
            self.grid[self.scroll_bottom] = vec![Cell::blank(); self.cols];
        }
    }

    fn scroll_down(&mut self, count: usize) {
        for _ in 0..count {
            // Shift lines down within scroll region
            for r in (self.scroll_top + 1..=self.scroll_bottom).rev() {
                self.grid[r] = self.grid[r - 1].clone();
            }
            // Clear top line
            self.grid[self.scroll_top] = vec![Cell::blank(); self.cols];
        }
    }

    fn erase_in_line(&mut self, mode: u16) {
        let row = self.cursor_row;
        if row >= self.rows {
            return;
        }
        match mode {
            0 => {
                // Erase from cursor to end of line
                for c in self.cursor_col..self.cols {
                    self.grid[row][c] = Cell::blank();
                }
            }
            1 => {
                // Erase from start of line to cursor
                for c in 0..=self.cursor_col.min(self.cols - 1) {
                    self.grid[row][c] = Cell::blank();
                }
            }
            2 => {
                // Erase entire line
                self.grid[row] = vec![Cell::blank(); self.cols];
            }
            _ => {}
        }
    }

    fn erase_in_display(&mut self, mode: u16) {
        match mode {
            0 => {
                // Erase from cursor to end of display
                self.erase_in_line(0);
                for r in (self.cursor_row + 1)..self.rows {
                    self.grid[r] = vec![Cell::blank(); self.cols];
                }
            }
            1 => {
                // Erase from start to cursor
                for r in 0..self.cursor_row {
                    self.grid[r] = vec![Cell::blank(); self.cols];
                }
                self.erase_in_line(1);
            }
            2 => {
                // Erase entire display
                for r in 0..self.rows {
                    self.grid[r] = vec![Cell::blank(); self.cols];
                }
            }
            3 => {
                // Erase display + scrollback
                for r in 0..self.rows {
                    self.grid[r] = vec![Cell::blank(); self.cols];
                }
                self.scrollback.clear();
            }
            _ => {}
        }
    }

    fn switch_to_alt_screen(&mut self) {
        if self.using_alt_screen {
            return;
        }
        // Save main screen state
        std::mem::swap(&mut self.grid, &mut self.alt_grid);
        self.alt_cursor_row = self.cursor_row;
        self.alt_cursor_col = self.cursor_col;
        self.alt_saved_cursor_row = self.saved_cursor_row;
        self.alt_saved_cursor_col = self.saved_cursor_col;
        self.alt_saved_attrs = self.saved_attrs.clone();

        // Clear alt screen
        for r in 0..self.rows {
            self.grid[r] = vec![Cell::blank(); self.cols];
        }
        self.cursor_row = 0;
        self.cursor_col = 0;
        self.using_alt_screen = true;
    }

    fn switch_to_main_screen(&mut self) {
        if !self.using_alt_screen {
            return;
        }
        // Restore main screen state
        std::mem::swap(&mut self.grid, &mut self.alt_grid);
        self.cursor_row = self.alt_cursor_row;
        self.cursor_col = self.alt_cursor_col;
        self.saved_cursor_row = self.alt_saved_cursor_row;
        self.saved_cursor_col = self.alt_saved_cursor_col;
        self.saved_attrs = self.alt_saved_attrs.clone();
        self.using_alt_screen = false;
    }

    fn process_sgr(&mut self, params: &[u16]) {
        if params.is_empty() {
            self.attrs.reset();
            return;
        }

        let mut i = 0;
        while i < params.len() {
            match params[i] {
                0 => self.attrs.reset(),
                1 => self.attrs.bold = true,
                2 => self.attrs.dim = true,
                3 => self.attrs.italic = true,
                4 => self.attrs.underline = true,
                5 | 6 => {} // Blink (ignore)
                7 => self.attrs.inverse = true,
                8 => self.attrs.hidden = true,
                9 => self.attrs.strikethrough = true,
                21 => self.attrs.underline = true, // double underline → underline
                22 => {
                    self.attrs.bold = false;
                    self.attrs.dim = false;
                }
                23 => self.attrs.italic = false,
                24 => self.attrs.underline = false,
                25 => {} // No blink
                27 => self.attrs.inverse = false,
                28 => self.attrs.hidden = false,
                29 => self.attrs.strikethrough = false,
                // Foreground colors
                30..=37 => self.attrs.fg = Color::Indexed(params[i] as u8 - 30),
                38 => {
                    i += 1;
                    if i < params.len() {
                        match params[i] {
                            5 => {
                                // 256-color: 38;5;n
                                i += 1;
                                if i < params.len() {
                                    self.attrs.fg = Color::Indexed(params[i] as u8);
                                }
                            }
                            2 => {
                                // 24-bit: 38;2;r;g;b
                                if i + 3 < params.len() {
                                    let r = params[i + 1] as u8;
                                    let g = params[i + 2] as u8;
                                    let b = params[i + 3] as u8;
                                    self.attrs.fg = Color::Rgb(r, g, b);
                                    i += 3;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                39 => self.attrs.fg = Color::Default,
                // Background colors
                40..=47 => self.attrs.bg = Color::Indexed(params[i] as u8 - 40),
                48 => {
                    i += 1;
                    if i < params.len() {
                        match params[i] {
                            5 => {
                                i += 1;
                                if i < params.len() {
                                    self.attrs.bg = Color::Indexed(params[i] as u8);
                                }
                            }
                            2 => {
                                if i + 3 < params.len() {
                                    let r = params[i + 1] as u8;
                                    let g = params[i + 2] as u8;
                                    let b = params[i + 3] as u8;
                                    self.attrs.bg = Color::Rgb(r, g, b);
                                    i += 3;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                49 => self.attrs.bg = Color::Default,
                // Bright foreground
                90..=97 => self.attrs.fg = Color::Indexed(params[i] as u8 - 90 + 8),
                // Bright background
                100..=107 => self.attrs.bg = Color::Indexed(params[i] as u8 - 100 + 8),
                _ => {}
            }
            i += 1;
        }
    }
}

// ============================================================================
// vte::Perform implementation
// ============================================================================

impl vte::Perform for TerminalState {
    fn print(&mut self, ch: char) {
        // Handle autowrap
        if self.wrap_pending {
            self.cursor_col = 0;
            if self.cursor_row == self.scroll_bottom {
                self.scroll_up(1);
            } else if self.cursor_row < self.rows - 1 {
                self.cursor_row += 1;
            }
            self.wrap_pending = false;
        }

        if self.cursor_row < self.rows && self.cursor_col < self.cols {
            if self.insert_mode {
                // Shift cells right
                let row = self.cursor_row;
                for c in (self.cursor_col + 1..self.cols).rev() {
                    self.grid[row][c] = self.grid[row][c - 1].clone();
                }
            }

            let cell = &mut self.grid[self.cursor_row][self.cursor_col];
            cell.ch = ch;
            self.attrs.apply_to_cell(cell);
        }

        self.cursor_col += 1;
        if self.cursor_col >= self.cols {
            if self.autowrap {
                self.cursor_col = self.cols - 1;
                self.wrap_pending = true;
            } else {
                self.cursor_col = self.cols - 1;
            }
        }

        self.dirty = true;
    }

    fn execute(&mut self, byte: u8) {
        match byte {
            0x07 => {} // BEL — ignore (no audio)
            0x08 => {
                // BS — backspace
                if self.cursor_col > 0 {
                    self.cursor_col -= 1;
                }
                self.wrap_pending = false;
            }
            0x09 => {
                // HT — horizontal tab
                loop {
                    self.cursor_col += 1;
                    if self.cursor_col >= self.cols {
                        self.cursor_col = self.cols - 1;
                        break;
                    }
                    if self.tab_stops[self.cursor_col] {
                        break;
                    }
                }
                self.wrap_pending = false;
            }
            0x0A | 0x0B | 0x0C => {
                // LF, VT, FF — line feed
                if self.linefeed_mode {
                    self.cursor_col = 0;
                }
                if self.cursor_row == self.scroll_bottom {
                    self.scroll_up(1);
                } else if self.cursor_row < self.rows - 1 {
                    self.cursor_row += 1;
                }
                self.wrap_pending = false;
            }
            0x0D => {
                // CR — carriage return
                self.cursor_col = 0;
                self.wrap_pending = false;
            }
            0x0E => {} // SO — shift out (ignore)
            0x0F => {} // SI — shift in (ignore)
            _ => {}
        }
        self.dirty = true;
    }

    fn hook(&mut self, _params: &vte::Params, _intermediates: &[u8], _ignore: bool, _action: char) {
        // DCS — stub
    }

    fn put(&mut self, _byte: u8) {
        // DCS data — stub
    }

    fn unhook(&mut self) {
        // DCS end — stub
    }

    fn osc_dispatch(&mut self, params: &[&[u8]], bell_terminated: bool) {
        let _ = bell_terminated;
        if params.is_empty() {
            return;
        }
        // First param is the command number as bytes
        let cmd = std::str::from_utf8(params[0]).unwrap_or("");
        match cmd {
            "0" | "1" | "2" => {
                // Set window/icon title
                if params.len() > 1 {
                    if let Ok(title) = std::str::from_utf8(params[1]) {
                        self.title = title.to_string();
                    }
                }
            }
            _ => {}
        }
    }

    fn csi_dispatch(&mut self, params: &vte::Params, intermediates: &[u8], _ignore: bool, action: char) {
        // Flatten Params into a Vec<i64> for easier handling
        let flat_params: Vec<i64> = params.iter()
            .flat_map(|sub| sub.iter().map(|&v| v as i64))
            .collect();
        let params = &flat_params;

        // Convert params to u16 with defaults
        let param = |idx: usize, default: u16| -> u16 {
            params.get(idx).map(|&v| if v <= 0 { default } else { v as u16 }).unwrap_or(default)
        };

        let is_private = intermediates.first() == Some(&b'?');

        match action {
            // Cursor movement
            'A' => {
                // CUU — Cursor Up
                let n = param(0, 1) as usize;
                self.cursor_row = self.cursor_row.saturating_sub(n);
                self.wrap_pending = false;
            }
            'B' => {
                // CUD — Cursor Down
                let n = param(0, 1) as usize;
                self.cursor_row = (self.cursor_row + n).min(self.rows - 1);
                self.wrap_pending = false;
            }
            'C' => {
                // CUF — Cursor Forward
                let n = param(0, 1) as usize;
                self.cursor_col = (self.cursor_col + n).min(self.cols - 1);
                self.wrap_pending = false;
            }
            'D' => {
                // CUB — Cursor Back
                let n = param(0, 1) as usize;
                self.cursor_col = self.cursor_col.saturating_sub(n);
                self.wrap_pending = false;
            }
            'E' => {
                // CNL — Cursor Next Line
                let n = param(0, 1) as usize;
                self.cursor_row = (self.cursor_row + n).min(self.rows - 1);
                self.cursor_col = 0;
                self.wrap_pending = false;
            }
            'F' => {
                // CPL — Cursor Previous Line
                let n = param(0, 1) as usize;
                self.cursor_row = self.cursor_row.saturating_sub(n);
                self.cursor_col = 0;
                self.wrap_pending = false;
            }
            'G' => {
                // CHA — Cursor Horizontal Absolute
                let n = param(0, 1) as usize;
                self.cursor_col = (n - 1).min(self.cols - 1);
                self.wrap_pending = false;
            }
            'H' | 'f' => {
                // CUP — Cursor Position
                let row = param(0, 1) as usize;
                let col = param(1, 1) as usize;
                self.cursor_row = (row - 1).min(self.rows - 1);
                self.cursor_col = (col - 1).min(self.cols - 1);
                self.wrap_pending = false;
            }
            'J' => {
                // ED — Erase in Display
                let mode = param(0, 0);
                self.erase_in_display(mode);
            }
            'K' => {
                // EL — Erase in Line
                let mode = param(0, 0);
                self.erase_in_line(mode);
            }
            'L' => {
                // IL — Insert Lines
                let n = param(0, 1) as usize;
                if self.cursor_row >= self.scroll_top && self.cursor_row <= self.scroll_bottom {
                    for _ in 0..n {
                        if self.scroll_bottom < self.rows {
                            self.grid.remove(self.scroll_bottom);
                        }
                        self.grid.insert(self.cursor_row, vec![Cell::blank(); self.cols]);
                    }
                }
            }
            'M' => {
                // DL — Delete Lines
                let n = param(0, 1) as usize;
                if self.cursor_row >= self.scroll_top && self.cursor_row <= self.scroll_bottom {
                    for _ in 0..n {
                        if self.cursor_row < self.grid.len() {
                            self.grid.remove(self.cursor_row);
                        }
                        let insert_at = self.scroll_bottom.min(self.grid.len());
                        self.grid.insert(insert_at, vec![Cell::blank(); self.cols]);
                    }
                }
            }
            'P' => {
                // DCH — Delete Characters
                let n = param(0, 1) as usize;
                let row = self.cursor_row;
                if row < self.rows {
                    for _ in 0..n {
                        if self.cursor_col < self.cols {
                            self.grid[row].remove(self.cursor_col);
                            self.grid[row].push(Cell::blank());
                        }
                    }
                }
            }
            'S' => {
                // SU — Scroll Up
                let n = param(0, 1) as usize;
                self.scroll_up(n);
            }
            'T' => {
                // SD — Scroll Down
                let n = param(0, 1) as usize;
                self.scroll_down(n);
            }
            'X' => {
                // ECH — Erase Characters
                let n = param(0, 1) as usize;
                let row = self.cursor_row;
                if row < self.rows {
                    for c in self.cursor_col..(self.cursor_col + n).min(self.cols) {
                        self.grid[row][c] = Cell::blank();
                    }
                }
            }
            '@' => {
                // ICH — Insert Characters
                let n = param(0, 1) as usize;
                let row = self.cursor_row;
                if row < self.rows {
                    for _ in 0..n {
                        if self.grid[row].len() > self.cols {
                            self.grid[row].pop();
                        }
                        self.grid[row].insert(self.cursor_col, Cell::blank());
                    }
                    // Trim to cols
                    self.grid[row].truncate(self.cols);
                }
            }
            'd' => {
                // VPA — Vertical Position Absolute
                let n = param(0, 1) as usize;
                self.cursor_row = (n - 1).min(self.rows - 1);
                self.wrap_pending = false;
            }
            'h' => {
                // SM/DECSET — Set Mode
                if is_private {
                    for &p in params {
                        match p {
                            1 => self.cursor_keys_application = true,
                            7 => self.autowrap = true,
                            12 => {} // Cursor blink on (ignore)
                            25 => self.cursor_visible = true,
                            1049 => {
                                // Save cursor + switch to alt screen + clear
                                self.saved_cursor_row = self.cursor_row;
                                self.saved_cursor_col = self.cursor_col;
                                self.saved_attrs = self.attrs.clone();
                                self.switch_to_alt_screen();
                            }
                            47 | 1047 => {
                                self.switch_to_alt_screen();
                            }
                            2004 => self.bracketed_paste = true,
                            _ => {}
                        }
                    }
                } else {
                    for &p in params {
                        match p {
                            4 => self.insert_mode = true,
                            20 => self.linefeed_mode = true,
                            _ => {}
                        }
                    }
                }
            }
            'l' => {
                // RM/DECRST — Reset Mode
                if is_private {
                    for &p in params {
                        match p {
                            1 => self.cursor_keys_application = false,
                            7 => self.autowrap = false,
                            12 => {} // Cursor blink off
                            25 => self.cursor_visible = false,
                            1049 => {
                                // Switch to main screen + restore cursor
                                self.switch_to_main_screen();
                                self.cursor_row = self.saved_cursor_row;
                                self.cursor_col = self.saved_cursor_col;
                                self.attrs = self.saved_attrs.clone();
                            }
                            47 | 1047 => {
                                self.switch_to_main_screen();
                            }
                            2004 => self.bracketed_paste = false,
                            _ => {}
                        }
                    }
                } else {
                    for &p in params {
                        match p {
                            4 => self.insert_mode = false,
                            20 => self.linefeed_mode = false,
                            _ => {}
                        }
                    }
                }
            }
            'm' => {
                // SGR — Select Graphic Rendition
                if params.is_empty() {
                    self.attrs.reset();
                } else {
                    let p16: Vec<u16> = params.iter().map(|&v| v as u16).collect();
                    self.process_sgr(&p16);
                }
            }
            'n' => {
                // DSR — Device Status Report
                if param(0, 0) == 6 {
                    // Report cursor position
                    let response = format!("\x1b[{};{}R", self.cursor_row + 1, self.cursor_col + 1);
                    self.pending_response = Some(response.into_bytes());
                }
            }
            'r' => {
                // DECSTBM — Set Scrolling Region
                let top = param(0, 1) as usize;
                let bottom = param(1, self.rows as u16) as usize;
                if top < bottom && bottom <= self.rows {
                    self.scroll_top = top - 1;
                    self.scroll_bottom = bottom - 1;
                }
                // CUP to home
                self.cursor_row = if self.origin_mode { self.scroll_top } else { 0 };
                self.cursor_col = 0;
                self.wrap_pending = false;
            }
            's' => {
                // SCP — Save Cursor Position
                self.saved_cursor_row = self.cursor_row;
                self.saved_cursor_col = self.cursor_col;
            }
            'u' => {
                // RCP — Restore Cursor Position
                self.cursor_row = self.saved_cursor_row.min(self.rows - 1);
                self.cursor_col = self.saved_cursor_col.min(self.cols - 1);
                self.wrap_pending = false;
            }
            'g' => {
                // TBC — Tab Clear
                match param(0, 0) {
                    0 => {
                        if self.cursor_col < self.cols {
                            self.tab_stops[self.cursor_col] = false;
                        }
                    }
                    3 => {
                        for t in &mut self.tab_stops {
                            *t = false;
                        }
                    }
                    _ => {}
                }
            }
            ' ' => {
                // DECSCUSR — Set Cursor Style (with space intermediate)
                // Actually handled via intermediates
            }
            'q' => {
                // DECSCUSR — Set Cursor Style
                if intermediates.first() == Some(&b' ') {
                    match param(0, 0) {
                        0 | 1 => self.cursor_style = 0, // Block (blinking/default)
                        2 => self.cursor_style = 0,     // Block (steady)
                        3 => self.cursor_style = 2,     // Underline (blinking)
                        4 => self.cursor_style = 2,     // Underline (steady)
                        5 => self.cursor_style = 1,     // Bar (blinking)
                        6 => self.cursor_style = 1,     // Bar (steady)
                        _ => {}
                    }
                }
            }
            _ => {}
        }
        self.dirty = true;
    }

    fn esc_dispatch(&mut self, intermediates: &[u8], _ignore: bool, byte: u8) {
        match byte {
            b'c' => {
                // RIS — Full Reset
                *self = TerminalState::new(self.rows, self.cols);
            }
            b'7' => {
                // DECSC — Save Cursor
                self.saved_cursor_row = self.cursor_row;
                self.saved_cursor_col = self.cursor_col;
                self.saved_attrs = self.attrs.clone();
            }
            b'8' => {
                if intermediates.first() == Some(&b'#') {
                    // DECALN — fill screen with 'E'
                    for r in 0..self.rows {
                        for c in 0..self.cols {
                            self.grid[r][c].ch = 'E';
                        }
                    }
                } else {
                    // DECRC — Restore Cursor
                    self.cursor_row = self.saved_cursor_row.min(self.rows - 1);
                    self.cursor_col = self.saved_cursor_col.min(self.cols - 1);
                    self.attrs = self.saved_attrs.clone();
                }
            }
            b'D' => {
                // IND — Index (move cursor down, scroll if at bottom)
                if self.cursor_row == self.scroll_bottom {
                    self.scroll_up(1);
                } else if self.cursor_row < self.rows - 1 {
                    self.cursor_row += 1;
                }
            }
            b'E' => {
                // NEL — Next Line
                self.cursor_col = 0;
                if self.cursor_row == self.scroll_bottom {
                    self.scroll_up(1);
                } else if self.cursor_row < self.rows - 1 {
                    self.cursor_row += 1;
                }
            }
            b'H' => {
                // HTS — Horizontal Tab Set
                if self.cursor_col < self.cols {
                    self.tab_stops[self.cursor_col] = true;
                }
            }
            b'M' => {
                // RI — Reverse Index (move cursor up, scroll down if at top)
                if self.cursor_row == self.scroll_top {
                    self.scroll_down(1);
                } else if self.cursor_row > 0 {
                    self.cursor_row -= 1;
                }
            }
            b'=' => {
                // DECKPAM — Keypad Application Mode
                // (we don't use this but acknowledge it)
            }
            b'>' => {
                // DECKPNM — Keypad Normal Mode
            }
            _ => {}
        }
        self.dirty = true;
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn resize_grid(grid: &mut Vec<Vec<Cell>>, rows: usize, cols: usize) {
    // Add or remove rows
    while grid.len() < rows {
        grid.push(vec![Cell::blank(); cols]);
    }
    grid.truncate(rows);

    // Resize each row
    for row in grid.iter_mut() {
        row.resize(cols, Cell::blank());
        row.truncate(cols);
    }
}
