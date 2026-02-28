//! Grid renderer — Pango character-level rendering for the terminal grid.
//!
//! Manages font sets (normal, bold, italic) and provides character drawing
//! into a Cairo context. Uses Pango for high-quality glyph rendering on Linux.
//! Font fallback is handled automatically by Pango + fontconfig.

use cairo::Context as CairoContext;
use pango::FontDescription;

/// Font set for terminal rendering: normal, bold, italic, and bold-italic.
pub struct FontSet {
    pub normal: FontDescription,
    pub bold: FontDescription,
    pub italic: FontDescription,
    pub bold_italic: FontDescription,
    pub char_width: f64,
    pub ascent: f64,
    pub descent: f64,
    pub leading: f64,
    pub line_height: f64,
}

impl FontSet {
    /// Create a new font set from a family name and point size.
    pub fn new(family: &str, size: f64) -> Self {
        let normal = create_font_desc(family, size, false, false);
        let bold = create_font_desc(family, size, true, false);
        let italic = create_font_desc(family, size, false, true);
        let bold_italic = create_font_desc(family, size, true, true);

        // Measure metrics using a temporary Cairo image surface + PangoLayout
        let (ascent, descent, leading, char_width) = measure_metrics(&normal);

        FontSet {
            normal,
            bold,
            italic,
            bold_italic,
            char_width,
            ascent,
            descent,
            leading,
            line_height: (ascent + descent + leading).ceil(),
        }
    }

    /// Select the appropriate font variant for the given style flags.
    pub fn select(&self, bold: bool, italic: bool) -> &FontDescription {
        match (bold, italic) {
            (true, true) => &self.bold_italic,
            (true, false) => &self.bold,
            (false, true) => &self.italic,
            (false, false) => &self.normal,
        }
    }
}

/// Grid renderer wrapping a FontSet with character drawing methods.
pub struct GridRenderer {
    pub font_set: FontSet,
}

impl GridRenderer {
    pub fn new(family: &str, size: f64) -> Self {
        GridRenderer {
            font_set: FontSet::new(family, size),
        }
    }

    /// Draw a single character at (x, y) with the given foreground color and style.
    /// The y coordinate is the top of the cell (top-left origin, y-down).
    pub fn draw_char(
        &self,
        cr: &CairoContext,
        ch: &str,
        x: f64,
        y: f64,
        fg: (f64, f64, f64),
        bold: bool,
        italic: bool,
    ) {
        if ch.is_empty() || ch == " " {
            return;
        }

        let font_desc = self.font_set.select(bold, italic);

        let layout = pangocairo::functions::create_layout(cr);
        layout.set_font_description(Some(font_desc));
        layout.set_text(ch);

        cr.set_source_rgb(fg.0, fg.1, fg.2);
        cr.move_to(x, y);
        pangocairo::functions::show_layout(cr, &layout);
    }
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Create a Pango FontDescription with the given style flags.
/// Falls back through DejaVu Sans Mono -> Liberation Mono -> monospace.
fn create_font_desc(family: &str, size: f64, bold: bool, italic: bool) -> FontDescription {
    let mut desc = FontDescription::new();
    desc.set_family(family);
    // Pango uses absolute size in Pango units (points * SCALE).
    // set_size() takes size in 1/1024 of a point (i.e., Pango units).
    desc.set_size((size * pango::SCALE as f64) as i32);
    if bold {
        desc.set_weight(pango::Weight::Bold);
    }
    if italic {
        desc.set_style(pango::Style::Italic);
    }
    desc
}

/// Measure font metrics (ascent, descent, leading, char_width) using a
/// temporary Cairo image surface and PangoLayout.
fn measure_metrics(font_desc: &FontDescription) -> (f64, f64, f64, f64) {
    // Create a small image surface just for measuring
    let surface = cairo::ImageSurface::create(cairo::Format::ARgb32, 1, 1)
        .expect("Failed to create measurement surface");
    let cr = cairo::Context::new(&surface).expect("Failed to create measurement context");

    let layout = pangocairo::functions::create_layout(&cr);
    layout.set_font_description(Some(font_desc));

    // Get font metrics from the layout's context
    let pango_ctx = layout.context();
    let metrics = pango_ctx.metrics(Some(font_desc), None);

    let ascent = metrics.ascent() as f64 / pango::SCALE as f64;
    let descent = metrics.descent() as f64 / pango::SCALE as f64;
    // Pango doesn't expose leading directly; use a small fraction
    let leading = 1.0;

    // Measure 'M' width for monospace cell width
    layout.set_text("M");
    let (ink_w, _ink_h) = layout.pixel_size();
    let char_width = ink_w as f64;

    (ascent, descent, leading, char_width)
}
