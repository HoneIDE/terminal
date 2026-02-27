/**
 * Terminal Emulator end-to-end integration tests.
 *
 * Tests the full pipeline: input → parser → buffer → output.
 */

import { describe, test, expect } from 'bun:test';
import { TerminalEmulator } from '../core/emulator';

function createEmulator(rows = 24, cols = 80): TerminalEmulator {
  return new TerminalEmulator(rows, cols);
}

describe('TerminalEmulator', () => {
  test('plain text populates buffer', () => {
    const emu = createEmulator(3, 10);
    emu.feedData('Hello');
    expect(emu.buffer.getCell(0, 0).char).toBe('H');
    expect(emu.buffer.getCell(0, 4).char).toBe('o');
    expect(emu.buffer.cursorCol).toBe(5);
  });

  test('colored text with SGR', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[31mHello\x1b[0m');
    const cell = emu.buffer.getCell(0, 0);
    expect(cell.char).toBe('H');
    expect(cell.fg).toEqual({ type: 'indexed', index: 1 }); // Red
    // After reset
    const cellAfter = emu.buffer.getCell(0, 5);
    // The space after "Hello" should have default colors
    expect(cellAfter.fg).toEqual({ type: 'default' });
  });

  test('clear screen and home cursor', () => {
    const emu = createEmulator(5, 10);
    emu.feedData('ABCDEFGHIJ');
    emu.feedData('\x1b[2J\x1b[H');
    expect(emu.buffer.getCell(0, 0).char).toBe(' ');
    expect(emu.buffer.cursorRow).toBe(0);
    expect(emu.buffer.cursorCol).toBe(0);
  });

  test('alternate screen buffer', () => {
    const emu = createEmulator(5, 10);
    emu.feedData('Main');
    emu.feedData('\x1b[?1049h'); // Switch to alternate
    expect(emu.buffer.isAlternate).toBe(true);
    emu.feedData('Alt');
    expect(emu.buffer.getCell(0, 0).char).toBe('A');

    emu.feedData('\x1b[?1049l'); // Switch back
    expect(emu.buffer.isAlternate).toBe(false);
    expect(emu.buffer.getCell(0, 0).char).toBe('M');
  });

  test('line wrapping', () => {
    const emu = createEmulator(3, 5);
    emu.feedData('ABCDEFGH');
    expect(emu.buffer.getCell(0, 0).char).toBe('A');
    expect(emu.buffer.getCell(0, 4).char).toBe('E');
    expect(emu.buffer.getCell(1, 0).char).toBe('F');
    expect(emu.buffer.getCell(1, 2).char).toBe('H');
  });

  test('CR + LF moves to start of next line', () => {
    const emu = createEmulator(5, 10);
    emu.feedData('Hello\r\nWorld');
    expect(emu.buffer.getCell(0, 0).char).toBe('H');
    expect(emu.buffer.getCell(1, 0).char).toBe('W');
  });

  test('backspace moves cursor left', () => {
    const emu = createEmulator(1, 10);
    emu.feedData('ABC\x08X');
    // After ABC, cursor is at col 3
    // BS moves to col 2, then X is written at col 2
    expect(emu.buffer.getCell(0, 0).char).toBe('A');
    expect(emu.buffer.getCell(0, 1).char).toBe('B');
    expect(emu.buffer.getCell(0, 2).char).toBe('X');
  });

  test('scrollback receives scrolled-off lines', () => {
    const emu = createEmulator(3, 5);
    emu.feedData('AAA\r\n');
    emu.feedData('BBB\r\n');
    emu.feedData('CCC\r\n'); // This should scroll AAA off
    emu.feedData('DDD');
    expect(emu.scrollback.length).toBe(1);
    expect(emu.scrollback.getLine(0).trimmedText()).toBe('AAA');
  });

  test('title change event', () => {
    const emu = createEmulator();
    let title = '';
    emu.onTitleChange((t) => { title = t; });
    emu.feedData('\x1b]0;Test Title\x07');
    expect(title).toBe('Test Title');
    expect(emu.title).toBe('Test Title');
  });

  test('bell event', () => {
    const emu = createEmulator();
    let bellCount = 0;
    emu.onBell(() => { bellCount++; });
    emu.feedData('\x07\x07');
    expect(bellCount).toBe(2);
  });

  test('render event fires on data', () => {
    const emu = createEmulator(5, 10);
    const renders: number[][] = [];
    emu.onRender((dirty) => renders.push([...dirty]));
    emu.feedData('Hello');
    expect(renders.length).toBeGreaterThan(0);
    expect(renders[0]).toContain(0);
  });

  test('full reset (ESC c)', () => {
    const emu = createEmulator(5, 10);
    emu.feedData('\x1b[1;31m'); // bold + red
    emu.feedData('Hello');
    emu.feedData('\x1bc'); // Full reset
    expect(emu.buffer.cursorRow).toBe(0);
    expect(emu.buffer.cursorCol).toBe(0);
    expect(emu.buffer.getCell(0, 0).char).toBe(' ');
    expect(emu.buffer.cursorAttrs.bold).toBe(false);
  });

  test('DECSC/DECRC (save/restore cursor)', () => {
    const emu = createEmulator(10, 20);
    emu.feedData('\x1b[5;10H'); // Move to row 5, col 10
    emu.feedData('\x1b7');      // Save
    emu.feedData('\x1b[1;1H');  // Move home
    emu.feedData('\x1b8');      // Restore
    expect(emu.buffer.cursorRow).toBe(4);
    expect(emu.buffer.cursorCol).toBe(9);
  });

  test('IND (index / move down)', () => {
    const emu = createEmulator(3, 5);
    emu.feedData('\x1bD\x1bD\x1bD'); // 3 index operations, should scroll
    expect(emu.buffer.cursorRow).toBe(2);
  });

  test('RI (reverse index)', () => {
    const emu = createEmulator(5, 5);
    // RI at top of screen should scroll down
    emu.feedData('\x1bM');
    expect(emu.buffer.cursorRow).toBe(0);
  });

  test('resize terminal', () => {
    const emu = createEmulator(10, 20);
    emu.feedData('Hello World');
    emu.resize(5, 10);
    expect(emu.rows).toBe(5);
    expect(emu.cols).toBe(10);
  });

  test('search in buffer', () => {
    const emu = createEmulator(5, 20);
    emu.feedData('Hello World\r\n');
    emu.feedData('Foo Bar\r\n');
    emu.feedData('Hello Again');
    const results = emu.search('Hello');
    expect(results.length).toBe(2);
  });

  test('selection and copy', () => {
    const emu = createEmulator(3, 10);
    emu.feedData('ABCDEFGHIJ');
    emu.setSelection({ row: 0, col: 2 }, { row: 0, col: 5 });
    expect(emu.getSelectedText()).toBe('CDE');
  });

  test('wide (CJK) character occupies 2 cells', () => {
    const emu = createEmulator(1, 10);
    emu.feedData('漢');
    expect(emu.buffer.getCell(0, 0).char).toBe('漢');
    expect(emu.buffer.getCell(0, 0).width).toBe(2);
    expect(emu.buffer.getCell(0, 1).char).toBe(''); // continuation cell
    expect(emu.buffer.cursorCol).toBe(2);
  });

  test('hyperlink via OSC 8', () => {
    const emu = createEmulator(1, 40);
    emu.feedData('\x1b]8;;https://example.com\x07Link\x1b]8;;\x07');
    expect(emu.buffer.getCell(0, 0).hyperlink).toBe('https://example.com');
    expect(emu.buffer.getCell(0, 3).hyperlink).toBe('https://example.com');
  });

  test('truecolor rendering', () => {
    const emu = createEmulator(1, 10);
    emu.feedData('\x1b[38;2;255;128;0mA\x1b[0m');
    const cell = emu.buffer.getCell(0, 0);
    expect(cell.fg).toEqual({ type: 'rgb', r: 255, g: 128, b: 0 });
  });

  test('synchronized output batches renders', () => {
    const emu = createEmulator(5, 10);
    const renders: number[][] = [];
    emu.onRender((dirty) => renders.push([...dirty]));

    emu.feedData('\x1b[?2026h'); // Enable synchronized output
    expect(emu.modes.synchronizedOutput).toBe(true);

    emu.feedData('Hello');
    emu.feedData('\x1b[2;1HWorld');
    // Renders should be batched (not flushed yet)
    const rendersDuringSynced = renders.length;

    emu.feedData('\x1b[?2026l'); // Disable synchronized output
    // Now dirty rows should flush
    expect(renders.length).toBeGreaterThan(rendersDuringSynced);
  });
});
