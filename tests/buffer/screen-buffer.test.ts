/**
 * ScreenBuffer tests.
 *
 * Tests grid operations, cursor, scroll region, alternate buffer,
 * resize, and dirty tracking.
 */

import { describe, test, expect } from 'bun:test';
import { ScreenBuffer } from '../../core/buffer/screen-buffer';
import { Scrollback } from '../../core/buffer/scrollback';

function createBuffer(rows = 5, cols = 10): { buf: ScreenBuffer; sb: Scrollback } {
  const sb = new Scrollback(100);
  const buf = new ScreenBuffer(rows, cols, sb);
  return { buf, sb };
}

describe('ScreenBuffer', () => {
  test('initialize with correct dimensions', () => {
    const { buf } = createBuffer(5, 10);
    expect(buf.rows).toBe(5);
    expect(buf.cols).toBe(10);
  });

  test('default cells are blank spaces', () => {
    const { buf } = createBuffer(5, 10);
    const cell = buf.getCell(0, 0);
    expect(cell.char).toBe(' ');
    expect(cell.fg).toEqual({ type: 'default' });
    expect(cell.bg).toEqual({ type: 'default' });
  });

  test('write characters at cursor', () => {
    const { buf } = createBuffer(5, 10);
    buf.printChar('A');
    expect(buf.getCell(0, 0).char).toBe('A');
    expect(buf.cursorCol).toBe(1);
  });

  test('cursor wraps at end of line', () => {
    const { buf } = createBuffer(5, 5);
    for (let i = 0; i < 5; i++) {
      buf.printChar(String.fromCharCode(65 + i)); // A-E
    }
    // After writing 5 chars in 5 cols, pending wrap should be set
    expect(buf.pendingWrap).toBe(true);
    // Next char should trigger wrap
    buf.printChar('F');
    expect(buf.cursorRow).toBe(1);
    expect(buf.cursorCol).toBe(1);
    expect(buf.getCell(1, 0).char).toBe('F');
  });

  test('line feed scrolls when at bottom', () => {
    const { buf, sb } = createBuffer(3, 5);
    buf.printChar('A'); buf.lineFeed();
    buf.printChar('B'); buf.lineFeed();
    buf.printChar('C'); buf.lineFeed(); // Should scroll
    expect(sb.length).toBe(1);
    expect(sb.getLine(0).cells[0].char).toBe('A');
  });

  test('scroll region constrains scrolling', () => {
    const { buf } = createBuffer(5, 5);
    // Write to all rows
    for (let r = 0; r < 5; r++) {
      buf.cursorRow = r;
      buf.cursorCol = 0;
      buf.printChar(String.fromCharCode(65 + r)); // A-E
    }
    // Set scroll region to rows 1-3
    buf.setScrollRegion(1, 3);
    buf.scrollUp(1);
    // Row 0 should be untouched
    expect(buf.getCell(0, 0).char).toBe('A');
    // Row 4 should be untouched
    expect(buf.getCell(4, 0).char).toBe('E');
  });

  test('alternate buffer switch', () => {
    const { buf } = createBuffer(3, 5);
    buf.printChar('M'); // Main buffer

    buf.switchToAlternate();
    expect(buf.isAlternate).toBe(true);
    expect(buf.getCell(0, 0).char).toBe(' '); // Alternate is blank

    buf.printChar('A'); // Write to alternate

    buf.switchToMain();
    expect(buf.isAlternate).toBe(false);
    expect(buf.getCell(0, 0).char).toBe('M'); // Main restored
  });

  test('resize shrinks columns', () => {
    const { buf } = createBuffer(3, 10);
    for (let i = 0; i < 10; i++) {
      buf.printChar(String.fromCharCode(65 + i));
    }
    buf.resize(3, 5);
    expect(buf.cols).toBe(5);
    expect(buf.getCell(0, 0).char).toBe('A');
    expect(buf.getCell(0, 4).char).toBe('E');
  });

  test('resize grows columns', () => {
    const { buf } = createBuffer(3, 5);
    buf.printChar('X');
    buf.resize(3, 10);
    expect(buf.cols).toBe(10);
    expect(buf.getCell(0, 0).char).toBe('X');
    expect(buf.getCell(0, 9).char).toBe(' ');
  });

  test('resize shrinks rows pushes to scrollback', () => {
    const { buf, sb } = createBuffer(5, 5);
    for (let r = 0; r < 5; r++) {
      buf.cursorRow = r;
      buf.cursorCol = 0;
      buf.printChar(String.fromCharCode(65 + r));
    }
    buf.resize(3, 5);
    expect(buf.rows).toBe(3);
    expect(sb.length).toBe(2); // 2 rows pushed to scrollback
  });

  test('dirty tracking', () => {
    const { buf } = createBuffer(5, 5);
    buf.clearDirty();
    expect(buf.getDirtyLines()).toEqual([]);

    buf.printChar('X');
    expect(buf.getDirtyLines()).toContain(0);

    buf.clearDirty();
    expect(buf.getDirtyLines()).toEqual([]);
  });

  test('save and restore cursor', () => {
    const { buf } = createBuffer(5, 10);
    buf.cursorRow = 3;
    buf.cursorCol = 7;
    buf.saveCursor();

    buf.cursorRow = 0;
    buf.cursorCol = 0;
    buf.restoreCursor();

    expect(buf.cursorRow).toBe(3);
    expect(buf.cursorCol).toBe(7);
  });

  test('erase in display (mode 2)', () => {
    const { buf } = createBuffer(3, 5);
    for (let r = 0; r < 3; r++) {
      buf.cursorRow = r;
      buf.cursorCol = 0;
      for (let c = 0; c < 5; c++) buf.printChar('X');
    }
    buf.eraseInDisplay(2);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        expect(buf.getCell(r, c).char).toBe(' ');
      }
    }
  });

  test('tab stops at every 8 columns', () => {
    const { buf } = createBuffer(1, 40);
    buf.tabForward();
    expect(buf.cursorCol).toBe(8);
    buf.tabForward();
    expect(buf.cursorCol).toBe(16);
  });

  test('full reset clears everything', () => {
    const { buf, sb } = createBuffer(3, 5);
    buf.printChar('X');
    sb.push(buf.getLine(0));
    buf.fullReset();
    expect(buf.getCell(0, 0).char).toBe(' ');
    expect(buf.cursorRow).toBe(0);
    expect(buf.cursorCol).toBe(0);
    expect(sb.length).toBe(0);
  });
});
