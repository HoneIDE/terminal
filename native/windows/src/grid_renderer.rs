//! Grid renderer — DirectWrite character-level rendering for the terminal grid.
//!
//! Manages font sets (normal, bold, italic) and provides character drawing
//! into a Direct2D render target. Uses DirectWrite for high-quality glyph
//! rendering on Windows.

use windows::core::HSTRING;
use windows::Win32::Graphics::Direct2D::Common::D2D_POINT_2F;
use windows::Win32::Graphics::Direct2D::{D2D1_DRAW_TEXT_OPTIONS, ID2D1RenderTarget};
use windows::Win32::Graphics::DirectWrite::*;

use crate::terminal_view::color_f;

/// Font set for terminal rendering: normal, bold, italic, and bold-italic.
pub struct FontSet {
    pub normal: IDWriteTextFormat,
    pub bold: IDWriteTextFormat,
    pub italic: IDWriteTextFormat,
    pub bold_italic: IDWriteTextFormat,
    pub char_width: f64,
    pub ascent: f64,
    pub descent: f64,
    pub leading: f64,
    pub line_height: f64,
}

impl FontSet {
    /// Create a new font set from a family name and point size.
    pub fn new(dwrite_factory: &IDWriteFactory, family: &str, size: f64) -> Self {
        let normal = create_text_format(
            dwrite_factory,
            family,
            size,
            DWRITE_FONT_WEIGHT_NORMAL,
            DWRITE_FONT_STYLE_NORMAL,
        );
        let bold = create_text_format(
            dwrite_factory,
            family,
            size,
            DWRITE_FONT_WEIGHT_BOLD,
            DWRITE_FONT_STYLE_NORMAL,
        );
        let italic = create_text_format(
            dwrite_factory,
            family,
            size,
            DWRITE_FONT_WEIGHT_NORMAL,
            DWRITE_FONT_STYLE_ITALIC,
        );
        let bold_italic = create_text_format(
            dwrite_factory,
            family,
            size,
            DWRITE_FONT_WEIGHT_BOLD,
            DWRITE_FONT_STYLE_ITALIC,
        );

        let (ascent, descent, leading) = get_font_metrics(dwrite_factory, family, size);
        let line_height = (ascent + descent + leading).ceil();
        let char_width = measure_char_width(dwrite_factory, &normal);

        FontSet {
            normal,
            bold,
            italic,
            bold_italic,
            char_width,
            ascent,
            descent,
            leading,
            line_height,
        }
    }

    /// Select the appropriate font variant for the given style flags.
    pub fn select(&self, bold: bool, italic: bool) -> &IDWriteTextFormat {
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
    pub dwrite_factory: IDWriteFactory,
}

impl GridRenderer {
    pub fn new(family: &str, size: f64) -> Self {
        let dwrite_factory: IDWriteFactory = unsafe {
            DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).expect("Failed to create DirectWrite factory")
        };

        let font_set = FontSet::new(&dwrite_factory, family, size);

        GridRenderer {
            font_set,
            dwrite_factory,
        }
    }

    /// Draw a single character at (x, y) with the given foreground color and style.
    /// The y coordinate is the top of the cell (top-left origin, y-down).
    pub fn draw_char(
        &self,
        rt: &ID2D1RenderTarget,
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

        let format = self.font_set.select(bold, italic);
        let wide: Vec<u16> = ch.encode_utf16().collect();

        unsafe {
            let layout = self.dwrite_factory.CreateTextLayout(
                &wide,
                format,
                self.font_set.char_width as f32 * 2.0, // max width
                self.font_set.line_height as f32,        // max height
            );
            let layout = match layout {
                Ok(l) => l,
                Err(_) => return,
            };

            let brush = rt.CreateSolidColorBrush(
                &color_f(fg.0, fg.1, fg.2, 1.0),
                None,
            );
            if let Ok(brush) = brush {
                rt.DrawTextLayout(
                    D2D_POINT_2F {
                        x: x as f32,
                        y: y as f32,
                    },
                    &layout,
                    &brush,
                    D2D1_DRAW_TEXT_OPTIONS(0),
                );
            }
        }
    }
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Create a DirectWrite text format with fallback: try requested family → Consolas → Courier New.
fn create_text_format(
    factory: &IDWriteFactory,
    family: &str,
    size: f64,
    weight: DWRITE_FONT_WEIGHT,
    style: DWRITE_FONT_STYLE,
) -> IDWriteTextFormat {
    for fam in &[family, "Consolas", "Courier New"] {
        let family_name = HSTRING::from(*fam);
        let result = unsafe {
            factory.CreateTextFormat(
                &family_name,
                None,
                weight,
                style,
                DWRITE_FONT_STRETCH_NORMAL,
                size as f32,
                &HSTRING::from("en-us"),
            )
        };
        if let Ok(format) = result {
            return format;
        }
    }
    // Last resort — this should not fail for Courier New
    unsafe {
        factory
            .CreateTextFormat(
                &HSTRING::from("Courier New"),
                None,
                weight,
                style,
                DWRITE_FONT_STRETCH_NORMAL,
                size as f32,
                &HSTRING::from("en-us"),
            )
            .expect("Failed to create any text format")
    }
}

/// Get font metrics (ascent, descent, leading) for a given font family and size.
fn get_font_metrics(factory: &IDWriteFactory, family: &str, size: f64) -> (f64, f64, f64) {
    unsafe {
        // Get the system font collection
        let mut collection: Option<IDWriteFontCollection> = None;
        if factory.GetSystemFontCollection(&mut collection, false).is_err() {
            return fallback_metrics(size);
        }
        let collection = match collection {
            Some(c) => c,
            None => return fallback_metrics(size),
        };

        // Find the font family
        let family_name = HSTRING::from(family);
        let mut index: u32 = 0;
        let mut exists = false.into();
        if collection.FindFamilyName(&family_name, &mut index, &mut exists).is_err() || !exists.as_bool() {
            return fallback_metrics(size);
        }

        let font_family = match collection.GetFontFamily(index) {
            Ok(f) => f,
            Err(_) => return fallback_metrics(size),
        };

        let font = match font_family.GetFirstMatchingFont(
            DWRITE_FONT_WEIGHT_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            DWRITE_FONT_STYLE_NORMAL,
        ) {
            Ok(f) => f,
            Err(_) => return fallback_metrics(size),
        };

        let mut metrics = DWRITE_FONT_METRICS::default();
        font.GetMetrics(&mut metrics);

        let design_units = metrics.designUnitsPerEm as f64;
        let scale = size / design_units;

        let ascent = metrics.ascent as f64 * scale;
        let descent = metrics.descent as f64 * scale;
        let leading = metrics.lineGap as f64 * scale;

        (ascent, descent, leading)
    }
}

/// Fallback metrics when font lookup fails.
fn fallback_metrics(size: f64) -> (f64, f64, f64) {
    // Approximate metrics for typical monospace fonts
    (size * 0.8, size * 0.2, size * 0.1)
}

/// Measure the width of 'M' to determine monospace cell width.
fn measure_char_width(factory: &IDWriteFactory, format: &IDWriteTextFormat) -> f64 {
    let wide: Vec<u16> = "M".encode_utf16().collect();
    unsafe {
        let layout = factory.CreateTextLayout(
            &wide,
            format,
            1000.0, // large max width
            1000.0, // large max height
        );
        match layout {
            Ok(layout) => {
                let mut metrics = DWRITE_TEXT_METRICS::default();
                if layout.GetMetrics(&mut metrics).is_ok() {
                    (metrics.widthIncludingTrailingWhitespace as f64).ceil()
                } else {
                    8.0 // fallback
                }
            }
            Err(_) => 8.0, // fallback
        }
    }
}
