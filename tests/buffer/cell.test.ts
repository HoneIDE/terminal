/**
 * Cell tests.
 *
 * Tests default values, wide characters, and Unicode width detection.
 */

import { describe, test, expect } from 'bun:test';
import { defaultCell, cloneCell, charWidth } from '../../core/buffer/cell';

describe('defaultCell', () => {
  test('returns blank space with default colors', () => {
    const cell = defaultCell();
    expect(cell.char).toBe(' ');
    expect(cell.width).toBe(1);
    expect(cell.fg).toEqual({ type: 'default' });
    expect(cell.bg).toEqual({ type: 'default' });
    expect(cell.attrs.bold).toBe(false);
    expect(cell.hyperlink).toBeUndefined();
  });

  test('each call returns a new object', () => {
    const a = defaultCell();
    const b = defaultCell();
    expect(a).not.toBe(b);
  });
});

describe('cloneCell', () => {
  test('deep clones all fields', () => {
    const original = defaultCell();
    original.char = 'A';
    original.attrs.bold = true;
    original.fg = { type: 'rgb', r: 255, g: 0, b: 0 };

    const clone = cloneCell(original);
    expect(clone.char).toBe('A');
    expect(clone.attrs.bold).toBe(true);
    expect(clone.fg).toEqual({ type: 'rgb', r: 255, g: 0, b: 0 });

    // Modifying clone shouldn't affect original
    clone.attrs.bold = false;
    expect(original.attrs.bold).toBe(true);
  });
});

describe('charWidth', () => {
  test('ASCII is width 1', () => {
    expect(charWidth('A'.codePointAt(0)!)).toBe(1);
    expect(charWidth(' '.codePointAt(0)!)).toBe(1);
  });

  test('CJK characters are width 2', () => {
    expect(charWidth('漢'.codePointAt(0)!)).toBe(2);
    expect(charWidth('字'.codePointAt(0)!)).toBe(2);
    expect(charWidth('あ'.codePointAt(0)!)).toBe(2); // Hiragana
    expect(charWidth('ア'.codePointAt(0)!)).toBe(2); // Katakana
  });

  test('Hangul syllables are width 2', () => {
    expect(charWidth('한'.codePointAt(0)!)).toBe(2);
  });

  test('fullwidth forms are width 2', () => {
    expect(charWidth('Ａ'.codePointAt(0)!)).toBe(2); // Fullwidth A
  });

  test('Latin characters are width 1', () => {
    expect(charWidth('é'.codePointAt(0)!)).toBe(1);
    expect(charWidth('ñ'.codePointAt(0)!)).toBe(1);
  });
});
