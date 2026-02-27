/**
 * Terminal cell types and factory functions.
 *
 * Every position in the terminal grid holds one TerminalCell.
 * Wide (CJK) characters occupy 2 cells: the first has width=2 and
 * the character; the continuation cell has char='' and width=1.
 */

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

/** Discriminated union for all terminal color modes. */
export type Color =
  | { type: 'default' }
  | { type: 'indexed'; index: number }
  | { type: 'rgb'; r: number; g: number; b: number };

export const DEFAULT_COLOR: Color = { type: 'default' };

// ---------------------------------------------------------------------------
// CellAttributes
// ---------------------------------------------------------------------------

/** Text decoration and style attributes for a terminal cell. */
export interface CellAttributes {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  blink: boolean;
  inverse: boolean;
  invisible: boolean;
  dim: boolean;
  underlineStyle: 'single' | 'double' | 'curly' | 'dotted' | 'dashed';
}

export function defaultAttrs(): CellAttributes {
  return {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    blink: false,
    inverse: false,
    invisible: false,
    dim: false,
    underlineStyle: 'single',
  };
}

export function cloneAttrs(a: CellAttributes): CellAttributes {
  return {
    bold: a.bold,
    italic: a.italic,
    underline: a.underline,
    strikethrough: a.strikethrough,
    blink: a.blink,
    inverse: a.inverse,
    invisible: a.invisible,
    dim: a.dim,
    underlineStyle: a.underlineStyle,
  };
}

// ---------------------------------------------------------------------------
// TerminalCell
// ---------------------------------------------------------------------------

/** The fundamental unit of the terminal grid. */
export interface TerminalCell {
  char: string;
  width: 1 | 2;
  fg: Color;
  bg: Color;
  attrs: CellAttributes;
  hyperlink?: string;
}

/** Create a blank cell with default attributes. */
export function defaultCell(): TerminalCell {
  return {
    char: ' ',
    width: 1,
    fg: { type: 'default' },
    bg: { type: 'default' },
    attrs: defaultAttrs(),
    hyperlink: undefined,
  };
}

/** Deep-clone a cell. */
export function cloneCell(c: TerminalCell): TerminalCell {
  return {
    char: c.char,
    width: c.width,
    fg: { ...c.fg } as Color,
    bg: { ...c.bg } as Color,
    attrs: cloneAttrs(c.attrs),
    hyperlink: c.hyperlink,
  };
}

// ---------------------------------------------------------------------------
// Unicode width detection
// ---------------------------------------------------------------------------

/**
 * Returns the display width of a Unicode code point.
 * Characters with East Asian Width property W or F occupy 2 cells.
 */
export function charWidth(codePoint: number): 1 | 2 {
  // C0/C1 controls
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 1;

  // CJK ranges — derived from Unicode 15.0 East Asian Width W/F
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK Radicals .. CJK Symbols
    (codePoint >= 0x3040 && codePoint <= 0x33bf) || // Hiragana .. CJK Compatibility
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK Unified Ext A
    (codePoint >= 0x4e00 && codePoint <= 0xa4cf) || // CJK Unified .. Yi Radicals
    (codePoint >= 0xa960 && codePoint <= 0xa97c) || // Hangul Jamo Extended-A
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul Syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) || // Vertical Forms
    (codePoint >= 0xfe30 && codePoint <= 0xfe6b) || // CJK Compatibility Forms
    (codePoint >= 0xff01 && codePoint <= 0xff60) || // Fullwidth Forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) || // Fullwidth Signs
    (codePoint >= 0x1f000 && codePoint <= 0x1fbff) || // Mahjong, Dominos, Emoji
    (codePoint >= 0x20000 && codePoint <= 0x2fffd) || // CJK Unified Ext B..
    (codePoint >= 0x30000 && codePoint <= 0x3fffd)    // CJK Unified Ext G..
  ) {
    return 2;
  }

  return 1;
}
