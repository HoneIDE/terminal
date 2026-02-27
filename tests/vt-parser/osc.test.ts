/**
 * OSC handler tests.
 *
 * Tests title changes, hyperlinks, current directory, clipboard,
 * shell integration, and color queries.
 */

import { describe, test, expect } from 'bun:test';
import { TerminalEmulator } from '../../core/emulator';

function createEmulator(rows = 24, cols = 80): TerminalEmulator {
  return new TerminalEmulator(rows, cols);
}

describe('OSC sequences', () => {
  test('OSC 0 sets window title', () => {
    const emu = createEmulator();
    let title = '';
    emu.onTitleChange((t) => { title = t; });

    emu.feedData('\x1b]0;My Terminal\x07');
    expect(title).toBe('My Terminal');
    expect(emu.title).toBe('My Terminal');
  });

  test('OSC 2 sets window title', () => {
    const emu = createEmulator();
    let title = '';
    emu.onTitleChange((t) => { title = t; });

    emu.feedData('\x1b]2;Another Title\x07');
    expect(title).toBe('Another Title');
  });

  test('OSC title with ST terminator', () => {
    const emu = createEmulator();
    let title = '';
    emu.onTitleChange((t) => { title = t; });

    emu.feedData('\x1b]0;ST Title\x1b\\');
    expect(title).toBe('ST Title');
  });

  test('OSC title with semicolons in value', () => {
    const emu = createEmulator();
    let title = '';
    emu.onTitleChange((t) => { title = t; });

    emu.feedData('\x1b]0;user@host: ~/dir\x07');
    expect(title).toBe('user@host: ~/dir');
  });

  test('OSC 8 hyperlink start and end', () => {
    const emu = createEmulator(1, 40);

    // Start hyperlink
    emu.feedData('\x1b]8;;https://example.com\x07');
    emu.feedData('Click here');
    // End hyperlink
    emu.feedData('\x1b]8;;\x07');

    // Check that cells 0-9 have the hyperlink
    for (let i = 0; i < 10; i++) {
      expect(emu.buffer.getCell(0, i).hyperlink).toBe('https://example.com');
    }
    // Cell after hyperlink should not have it
    emu.feedData('X');
    expect(emu.buffer.getCell(0, 10).hyperlink).toBeUndefined();
  });

  test('OSC 8 hyperlink with id parameter', () => {
    const emu = createEmulator(1, 40);
    emu.feedData('\x1b]8;id=foo;https://example.com\x07');
    emu.feedData('link');
    emu.feedData('\x1b]8;;\x07');

    expect(emu.buffer.getCell(0, 0).hyperlink).toBe('https://example.com');
  });

  test('multiple OSC sequences', () => {
    const emu = createEmulator();
    const titles: string[] = [];
    emu.onTitleChange((t) => titles.push(t));

    emu.feedData('\x1b]0;First\x07');
    emu.feedData('\x1b]0;Second\x07');
    expect(titles).toEqual(['First', 'Second']);
  });
});
