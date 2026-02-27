/**
 * SGR attribute parsing tests.
 *
 * Tests all attribute combinations, ANSI colors, 256-color,
 * truecolor, and extended underline styles.
 */

import { describe, test, expect } from 'bun:test';
import { TerminalEmulator } from '../../core/emulator';

function createEmulator(rows = 24, cols = 80): TerminalEmulator {
  return new TerminalEmulator(rows, cols);
}

describe('SGR attributes', () => {
  test('reset (0) clears all attributes', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[1;3;4m'); // bold, italic, underline
    emu.feedData('\x1b[0m');
    const attrs = emu.buffer.cursorAttrs;
    expect(attrs.bold).toBe(false);
    expect(attrs.italic).toBe(false);
    expect(attrs.underline).toBe(false);
  });

  test('bold (1)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[1m');
    expect(emu.buffer.cursorAttrs.bold).toBe(true);
  });

  test('dim (2)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[2m');
    expect(emu.buffer.cursorAttrs.dim).toBe(true);
  });

  test('italic (3)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[3m');
    expect(emu.buffer.cursorAttrs.italic).toBe(true);
  });

  test('underline (4)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[4m');
    expect(emu.buffer.cursorAttrs.underline).toBe(true);
  });

  test('blink (5)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[5m');
    expect(emu.buffer.cursorAttrs.blink).toBe(true);
  });

  test('inverse (7)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[7m');
    expect(emu.buffer.cursorAttrs.inverse).toBe(true);
  });

  test('invisible (8)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[8m');
    expect(emu.buffer.cursorAttrs.invisible).toBe(true);
  });

  test('strikethrough (9)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[9m');
    expect(emu.buffer.cursorAttrs.strikethrough).toBe(true);
  });

  test('double underline (21)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[21m');
    expect(emu.buffer.cursorAttrs.underline).toBe(true);
    expect(emu.buffer.cursorAttrs.underlineStyle).toBe('double');
  });

  test('normal intensity (22) clears bold and dim', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[1;2m'); // bold + dim
    emu.feedData('\x1b[22m');
    expect(emu.buffer.cursorAttrs.bold).toBe(false);
    expect(emu.buffer.cursorAttrs.dim).toBe(false);
  });

  test('attribute removal (23-29)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[3;4;5;7;8;9m'); // all on
    emu.feedData('\x1b[23m'); expect(emu.buffer.cursorAttrs.italic).toBe(false);
    emu.feedData('\x1b[24m'); expect(emu.buffer.cursorAttrs.underline).toBe(false);
    emu.feedData('\x1b[25m'); expect(emu.buffer.cursorAttrs.blink).toBe(false);
    emu.feedData('\x1b[27m'); expect(emu.buffer.cursorAttrs.inverse).toBe(false);
    emu.feedData('\x1b[28m'); expect(emu.buffer.cursorAttrs.invisible).toBe(false);
    emu.feedData('\x1b[29m'); expect(emu.buffer.cursorAttrs.strikethrough).toBe(false);
  });

  test('foreground ANSI colors (30-37)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[31m'); // red
    expect(emu.buffer.cursorFg).toEqual({ type: 'indexed', index: 1 });
    emu.feedData('\x1b[36m'); // cyan
    expect(emu.buffer.cursorFg).toEqual({ type: 'indexed', index: 6 });
  });

  test('background ANSI colors (40-47)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[42m'); // green bg
    expect(emu.buffer.cursorBg).toEqual({ type: 'indexed', index: 2 });
  });

  test('bright foreground (90-97)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[91m'); // bright red
    expect(emu.buffer.cursorFg).toEqual({ type: 'indexed', index: 9 });
  });

  test('bright background (100-107)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[104m'); // bright blue bg
    expect(emu.buffer.cursorBg).toEqual({ type: 'indexed', index: 12 });
  });

  test('256-color foreground (38;5;n)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[38;5;196m'); // bright red (index 196)
    expect(emu.buffer.cursorFg).toEqual({ type: 'indexed', index: 196 });
  });

  test('256-color background (48;5;n)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[48;5;232m'); // dark gray
    expect(emu.buffer.cursorBg).toEqual({ type: 'indexed', index: 232 });
  });

  test('truecolor foreground (38;2;r;g;b)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[38;2;255;128;0m'); // orange
    expect(emu.buffer.cursorFg).toEqual({ type: 'rgb', r: 255, g: 128, b: 0 });
  });

  test('truecolor background (48;2;r;g;b)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[48;2;0;0;255m'); // blue
    expect(emu.buffer.cursorBg).toEqual({ type: 'rgb', r: 0, g: 0, b: 255 });
  });

  test('default foreground (39)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[31m'); // red
    emu.feedData('\x1b[39m'); // default
    expect(emu.buffer.cursorFg).toEqual({ type: 'default' });
  });

  test('default background (49)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[42m'); // green
    emu.feedData('\x1b[49m'); // default
    expect(emu.buffer.cursorBg).toEqual({ type: 'default' });
  });

  test('combined SGR: bold + italic + orange fg', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[1;3;38;2;255;100;0m');
    expect(emu.buffer.cursorAttrs.bold).toBe(true);
    expect(emu.buffer.cursorAttrs.italic).toBe(true);
    expect(emu.buffer.cursorFg).toEqual({ type: 'rgb', r: 255, g: 100, b: 0 });
  });

  test('SGR with no params resets (same as 0)', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[1m'); // bold
    emu.feedData('\x1b[m');  // reset
    expect(emu.buffer.cursorAttrs.bold).toBe(false);
  });

  test('written cells carry current attributes', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[1;31m'); // bold + red
    emu.feedData('A');
    const cell = emu.buffer.getCell(0, 0);
    expect(cell.char).toBe('A');
    expect(cell.attrs.bold).toBe(true);
    expect(cell.fg).toEqual({ type: 'indexed', index: 1 });
  });
});
