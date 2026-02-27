//! Grid renderer — Core Text character-level rendering for the terminal grid.
//!
//! Manages font sets (normal, bold, italic) and provides character drawing
//! into a CGContext. Uses Core Text for high-quality glyph rendering on macOS.

use core_foundation::attributed_string::CFMutableAttributedString;
use core_foundation::base::TCFType;
use core_foundation::string::CFString;
use core_foundation_sys::base::CFRange;
use core_graphics::context::CGContext;
use core_graphics::geometry::CGAffineTransform;
use core_text::font::{self as ct_font, CTFont};
use core_text::font_descriptor::{kCTFontBoldTrait, kCTFontItalicTrait};
use core_text::line::CTLine;

/// Font set for terminal rendering: normal, bold, italic, and bold-italic.
pub struct FontSet {
    pub normal: CTFont,
    pub bold: CTFont,
    pub italic: CTFont,
    pub bold_italic: CTFont,
    pub char_width: f64,
    pub ascent: f64,
    pub descent: f64,
    pub leading: f64,
    pub line_height: f64,
}

impl FontSet {
    /// Create a new font set from a family name and point size.
    pub fn new(family: &str, size: f64) -> Self {
        let normal = create_font_with_fallback(family, size);
        let bold = create_variant(&normal, size, kCTFontBoldTrait);
        let italic = create_variant(&normal, size, kCTFontItalicTrait);
        let bold_italic = create_variant(
            &normal,
            size,
            kCTFontBoldTrait | kCTFontItalicTrait,
        );

        let ascent = normal.ascent();
        let descent = normal.descent();
        let leading = normal.leading();
        let line_height = (ascent + descent + leading).ceil();

        let char_width = measure_char_width(&normal);

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
    pub fn select(&self, bold: bool, italic: bool) -> &CTFont {
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
    /// The y coordinate is the top of the cell (NSView flipped coordinates).
    pub fn draw_char(
        &self,
        ctx: &CGContext,
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

        let font = self.font_set.select(bold, italic);
        let cf_string = CFString::new(ch);

        // Create attributed string with the character
        let mut attr_string = CFMutableAttributedString::new();
        attr_string.replace_str(&cf_string, CFRange::init(0, 0));

        let len = attr_string.char_len();
        let range = CFRange::init(0, len);

        // Set font attribute
        unsafe {
            use core_text::string_attributes::kCTFontAttributeName;
            attr_string.set_attribute(range, kCTFontAttributeName, font);
        }

        // Set foreground color
        let cg_color = core_graphics::color::CGColor::rgb(fg.0, fg.1, fg.2, 1.0);

        unsafe {
            use core_text::string_attributes::kCTForegroundColorAttributeName;
            attr_string.set_attribute(range, kCTForegroundColorAttributeName, &cg_color);
        }

        // Create CTLine from the attributed string
        let line = CTLine::new_with_attributed_string(attr_string.as_concrete_TypeRef());

        // Set text position — flip text matrix for NSView's flipped coordinate system.
        let text_y = y + self.font_set.ascent;
        let transform = CGAffineTransform {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: -1.0,
            tx: 0.0,
            ty: 0.0,
        };
        ctx.set_text_matrix(&transform);
        ctx.set_text_position(x, text_y);

        line.draw(ctx);
    }
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Create a font with fallback: try requested family → Menlo → Monaco.
fn create_font_with_fallback(family: &str, size: f64) -> CTFont {
    for fam in &[family, "Menlo", "Monaco"] {
        if let Ok(font) = ct_font::new_from_name(fam, size) {
            return font;
        }
    }
    ct_font::new_from_name("Menlo", size).unwrap()
}

/// Create a bold/italic variant of a font using symbolic traits.
fn create_variant(base: &CTFont, _size: f64, traits: u32) -> CTFont {
    match base.clone_with_symbolic_traits(traits, traits) {
        Some(variant) => variant,
        None => base.clone(),
    }
}

/// Measure the width of 'M' to determine monospace cell width.
fn measure_char_width(font: &CTFont) -> f64 {
    let cf_string = CFString::new("M");
    let mut attr_string = CFMutableAttributedString::new();
    attr_string.replace_str(&cf_string, CFRange::init(0, 0));

    let len = attr_string.char_len();
    let range = CFRange::init(0, len);

    unsafe {
        use core_text::string_attributes::kCTFontAttributeName;
        attr_string.set_attribute(range, kCTFontAttributeName, font);
    }

    let line = CTLine::new_with_attributed_string(attr_string.as_concrete_TypeRef());
    let bounds = line.get_typographic_bounds();
    bounds.width.ceil()
}
