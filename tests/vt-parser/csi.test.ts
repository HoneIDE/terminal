/**
 * CSI handler tests.
 *
 * Tests cursor movement, erase, scroll, insert/delete,
 * scroll region, private modes, and device status reports.
 */

import { describe, test, expect } from 'bun:test';
import { TerminalEmulator } from '../../core/emulator';

function createEmulator(rows = 24, cols = 80): TerminalEmulator {
  return new TerminalEmulator(rows, cols);
}

describe('CSI cursor movement', () => {
  test('CUU (cursor up)', () => {
    const emu = createEmulator(10, 10);
    emu.feedData('\x1b[5;5H'); // Move to row 5, col 5
    emu.feedData('\x1b[2A');   // Move up 2
    expect(emu.buffer.cursorRow).toBe(2); // 0-indexed: row 4 - 2 = 2
  });

  test('CUD (cursor down)', () => {
    const emu = createEmulator(10, 10);
    emu.feedData('\x1b[1;1H'); // Move to row 1, col 1
    emu.feedData('\x1b[3B');   // Move down 3
    expect(emu.buffer.cursorRow).toBe(3);
  });

  test('CUF (cursor forward)', () => {
    const emu = createEmulator(10, 10);
    emu.feedData('\x1b[1;1H'); // Home
    emu.feedData('\x1b[5C');   // Forward 5
    expect(emu.buffer.cursorCol).toBe(5);
  });

  test('CUB (cursor backward)', () => {
    const emu = createEmulator(10, 10);
    emu.feedData('\x1b[1;8H'); // Move to col 8
    emu.feedData('\x1b[3D');   // Backward 3
    expect(emu.buffer.cursorCol).toBe(4);
  });

  test('CUP (cursor position)', () => {
    const emu = createEmulator(10, 10);
    emu.feedData('\x1b[5;7H');
    expect(emu.buffer.cursorRow).toBe(4); // 1-indexed to 0-indexed
    expect(emu.buffer.cursorCol).toBe(6);
  });

  test('CHA (cursor horizontal absolute)', () => {
    const emu = createEmulator(10, 10);
    emu.feedData('\x1b[5G');
    expect(emu.buffer.cursorCol).toBe(4);
  });

  test('VPA (vertical position absolute)', () => {
    const emu = createEmulator(10, 10);
    emu.feedData('\x1b[8d');
    expect(emu.buffer.cursorRow).toBe(7);
  });

  test('CNL (cursor next line)', () => {
    const emu = createEmulator(10, 10);
    emu.feedData('\x1b[3;5H'); // row 3, col 5
    emu.feedData('\x1b[2E');   // next line x2
    expect(emu.buffer.cursorRow).toBe(4);
    expect(emu.buffer.cursorCol).toBe(0);
  });

  test('CPL (cursor previous line)', () => {
    const emu = createEmulator(10, 10);
    emu.feedData('\x1b[5;5H'); // row 5, col 5
    emu.feedData('\x1b[2F');   // previous line x2
    expect(emu.buffer.cursorRow).toBe(2);
    expect(emu.buffer.cursorCol).toBe(0);
  });

  test('cursor clamps to screen bounds', () => {
    const emu = createEmulator(5, 5);
    emu.feedData('\x1b[100;100H');
    expect(emu.buffer.cursorRow).toBe(4);
    expect(emu.buffer.cursorCol).toBe(4);
  });
});

describe('CSI erase', () => {
  test('ED 0 (erase below cursor)', () => {
    const emu = createEmulator(3, 5);
    emu.feedData('ABCDE');
    emu.feedData('FGHIJ');
    emu.feedData('KLMNO');
    emu.feedData('\x1b[2;3H'); // row 2, col 3
    emu.feedData('\x1b[0J');
    // Row 0 should be untouched
    expect(emu.buffer.getCell(0, 0).char).toBe('A');
    // Row 1, cols 0-1 should be untouched
    expect(emu.buffer.getCell(1, 0).char).toBe('F');
    expect(emu.buffer.getCell(1, 1).char).toBe('G');
    // Row 1, cols 2+ should be cleared
    expect(emu.buffer.getCell(1, 2).char).toBe(' ');
    // Row 2 should be cleared
    expect(emu.buffer.getCell(2, 0).char).toBe(' ');
  });

  test('ED 2 (erase entire screen)', () => {
    const emu = createEmulator(3, 5);
    emu.feedData('ABCDE');
    emu.feedData('\x1b[2J');
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        expect(emu.buffer.getCell(r, c).char).toBe(' ');
      }
    }
  });

  test('EL 0 (erase right of cursor)', () => {
    const emu = createEmulator(1, 10);
    emu.feedData('ABCDEFGHIJ');
    emu.feedData('\x1b[1;4H'); // col 4
    emu.feedData('\x1b[0K');
    expect(emu.buffer.getCell(0, 2).char).toBe('C');
    expect(emu.buffer.getCell(0, 3).char).toBe(' ');
    expect(emu.buffer.getCell(0, 9).char).toBe(' ');
  });

  test('EL 2 (erase entire line)', () => {
    const emu = createEmulator(1, 5);
    emu.feedData('HELLO');
    emu.feedData('\x1b[2K');
    for (let c = 0; c < 5; c++) {
      expect(emu.buffer.getCell(0, c).char).toBe(' ');
    }
  });

  test('ECH (erase characters)', () => {
    const emu = createEmulator(1, 10);
    emu.feedData('ABCDEFGHIJ');
    emu.feedData('\x1b[1;3H'); // col 3
    emu.feedData('\x1b[3X');   // erase 3 chars
    expect(emu.buffer.getCell(0, 1).char).toBe('B');
    expect(emu.buffer.getCell(0, 2).char).toBe(' ');
    expect(emu.buffer.getCell(0, 3).char).toBe(' ');
    expect(emu.buffer.getCell(0, 4).char).toBe(' ');
    expect(emu.buffer.getCell(0, 5).char).toBe('F');
  });
});

describe('CSI scroll', () => {
  test('SU (scroll up)', () => {
    const emu = createEmulator(3, 5);
    emu.feedData('AAAAA');
    emu.feedData('BBBBB');
    emu.feedData('CCCCC');
    emu.feedData('\x1b[1S');
    // Row 0 should now be "BBBBB"
    expect(emu.buffer.getLine(0).trimmedText()).toBe('BBBBB');
    // Row 1 should now be "CCCCC"
    expect(emu.buffer.getLine(1).trimmedText()).toBe('CCCCC');
    // Row 2 should be blank
    expect(emu.buffer.getLine(2).trimmedText()).toBe('');
  });

  test('SD (scroll down)', () => {
    const emu = createEmulator(3, 5);
    emu.feedData('AAAAA');
    emu.feedData('BBBBB');
    emu.feedData('CCCCC');
    emu.feedData('\x1b[1T');
    // Row 0 should be blank
    expect(emu.buffer.getLine(0).trimmedText()).toBe('');
    // Row 1 should be "AAAAA"
    expect(emu.buffer.getLine(1).trimmedText()).toBe('AAAAA');
  });
});

describe('CSI scroll region (DECSTBM)', () => {
  test('set scroll region and scroll within it', () => {
    const emu = createEmulator(5, 5);
    emu.feedData('AAAAA');
    emu.feedData('BBBBB');
    emu.feedData('CCCCC');
    emu.feedData('DDDDD');
    emu.feedData('EEEEE');
    // Set scroll region to rows 2-4 (1-indexed)
    emu.feedData('\x1b[2;4r');
    // Scroll up within region
    emu.feedData('\x1b[1S');
    // Row 0 should be untouched
    expect(emu.buffer.getLine(0).trimmedText()).toBe('AAAAA');
    // Row 4 should be untouched
    expect(emu.buffer.getLine(4).trimmedText()).toBe('EEEEE');
  });
});

describe('CSI insert/delete', () => {
  test('IL (insert lines)', () => {
    const emu = createEmulator(4, 5);
    emu.feedData('AAAAA');
    emu.feedData('BBBBB');
    emu.feedData('CCCCC');
    emu.feedData('DDDDD');
    emu.feedData('\x1b[2;1H'); // row 2
    emu.feedData('\x1b[1L');   // insert 1 line
    expect(emu.buffer.getLine(0).trimmedText()).toBe('AAAAA');
    expect(emu.buffer.getLine(1).trimmedText()).toBe('');
    expect(emu.buffer.getLine(2).trimmedText()).toBe('BBBBB');
  });

  test('DL (delete lines)', () => {
    const emu = createEmulator(4, 5);
    emu.feedData('AAAAA');
    emu.feedData('BBBBB');
    emu.feedData('CCCCC');
    emu.feedData('DDDDD');
    emu.feedData('\x1b[2;1H'); // row 2
    emu.feedData('\x1b[1M');   // delete 1 line
    expect(emu.buffer.getLine(0).trimmedText()).toBe('AAAAA');
    expect(emu.buffer.getLine(1).trimmedText()).toBe('CCCCC');
    expect(emu.buffer.getLine(2).trimmedText()).toBe('DDDDD');
    expect(emu.buffer.getLine(3).trimmedText()).toBe('');
  });

  test('ICH (insert characters)', () => {
    const emu = createEmulator(1, 10);
    emu.feedData('ABCDE');
    emu.feedData('\x1b[1;3H'); // col 3
    emu.feedData('\x1b[2@');   // insert 2 chars
    expect(emu.buffer.getCell(0, 0).char).toBe('A');
    expect(emu.buffer.getCell(0, 1).char).toBe('B');
    expect(emu.buffer.getCell(0, 2).char).toBe(' ');
    expect(emu.buffer.getCell(0, 3).char).toBe(' ');
    expect(emu.buffer.getCell(0, 4).char).toBe('C');
  });

  test('DCH (delete characters)', () => {
    const emu = createEmulator(1, 10);
    emu.feedData('ABCDEFGHIJ');
    emu.feedData('\x1b[1;3H'); // col 3
    emu.feedData('\x1b[2P');   // delete 2 chars
    expect(emu.buffer.getCell(0, 0).char).toBe('A');
    expect(emu.buffer.getCell(0, 1).char).toBe('B');
    expect(emu.buffer.getCell(0, 2).char).toBe('E');
    expect(emu.buffer.getCell(0, 3).char).toBe('F');
  });
});

describe('CSI private modes', () => {
  test('DECSET/DECRST 25 (cursor visibility)', () => {
    const emu = createEmulator();
    expect(emu.modes.cursorVisible).toBe(true);
    emu.feedData('\x1b[?25l'); // hide
    expect(emu.modes.cursorVisible).toBe(false);
    emu.feedData('\x1b[?25h'); // show
    expect(emu.modes.cursorVisible).toBe(true);
  });

  test('DECSET/DECRST 1 (application cursor keys)', () => {
    const emu = createEmulator();
    expect(emu.modes.applicationCursorKeys).toBe(false);
    emu.feedData('\x1b[?1h');
    expect(emu.modes.applicationCursorKeys).toBe(true);
    emu.feedData('\x1b[?1l');
    expect(emu.modes.applicationCursorKeys).toBe(false);
  });

  test('DECSET/DECRST 2004 (bracketed paste)', () => {
    const emu = createEmulator();
    expect(emu.modes.bracketedPaste).toBe(false);
    emu.feedData('\x1b[?2004h');
    expect(emu.modes.bracketedPaste).toBe(true);
    emu.feedData('\x1b[?2004l');
    expect(emu.modes.bracketedPaste).toBe(false);
  });

  test('DECSET 1049 (alternate buffer)', () => {
    const emu = createEmulator(5, 5);
    emu.feedData('Hello');
    expect(emu.buffer.isAlternate).toBe(false);
    emu.feedData('\x1b[?1049h');
    expect(emu.buffer.isAlternate).toBe(true);
    // Alternate buffer should be clean
    expect(emu.buffer.getCell(0, 0).char).toBe(' ');
    emu.feedData('\x1b[?1049l');
    expect(emu.buffer.isAlternate).toBe(false);
    // Main buffer should be restored
    expect(emu.buffer.getCell(0, 0).char).toBe('H');
  });
});

describe('CSI cursor style', () => {
  test('set cursor style to blinking block', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[1 q');
    expect(emu.modes.cursorStyle).toBe('block');
    expect(emu.modes.cursorBlink).toBe(true);
  });

  test('set cursor style to steady beam', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[6 q');
    expect(emu.modes.cursorStyle).toBe('beam');
    expect(emu.modes.cursorBlink).toBe(false);
  });

  test('set cursor style to blinking underline', () => {
    const emu = createEmulator();
    emu.feedData('\x1b[3 q');
    expect(emu.modes.cursorStyle).toBe('underline');
    expect(emu.modes.cursorBlink).toBe(true);
  });
});

describe('CSI tab stops', () => {
  test('HT moves to next tab stop (default every 8)', () => {
    const emu = createEmulator(1, 40);
    emu.feedData('\t');
    expect(emu.buffer.cursorCol).toBe(8);
    emu.feedData('\t');
    expect(emu.buffer.cursorCol).toBe(16);
  });

  test('CBT (cursor backward tab)', () => {
    const emu = createEmulator(1, 40);
    emu.feedData('\x1b[20G'); // col 20
    emu.feedData('\x1b[1Z');  // backward tab
    expect(emu.buffer.cursorCol).toBe(16);
  });
});
