/**
 * Scrollback buffer tests.
 *
 * Tests ring buffer behavior, overflow, search, and clear.
 */

import { describe, test, expect } from 'bun:test';
import { Scrollback } from '../../core/buffer/scrollback';
import { TerminalLine } from '../../core/buffer/line';

function makeLine(text: string, cols = 80): TerminalLine {
  const line = new TerminalLine(cols);
  for (let i = 0; i < text.length && i < cols; i++) {
    line.cells[i].char = text[i];
  }
  return line;
}

describe('Scrollback', () => {
  test('push and retrieve lines', () => {
    const sb = new Scrollback(100);
    sb.push(makeLine('first'));
    sb.push(makeLine('second'));
    sb.push(makeLine('third'));

    expect(sb.length).toBe(3);
    // Most recent first
    expect(sb.getLine(0).trimmedText()).toBe('third');
    expect(sb.getLine(1).trimmedText()).toBe('second');
    expect(sb.getLine(2).trimmedText()).toBe('first');
  });

  test('ring buffer overflow discards oldest', () => {
    const sb = new Scrollback(3);
    sb.push(makeLine('A'));
    sb.push(makeLine('B'));
    sb.push(makeLine('C'));
    sb.push(makeLine('D')); // A should be discarded

    expect(sb.length).toBe(3);
    expect(sb.getLine(0).trimmedText()).toBe('D');
    expect(sb.getLine(1).trimmedText()).toBe('C');
    expect(sb.getLine(2).trimmedText()).toBe('B');
  });

  test('getLine throws for out of range', () => {
    const sb = new Scrollback(100);
    sb.push(makeLine('hello'));
    expect(() => sb.getLine(1)).toThrow();
    expect(() => sb.getLine(-1)).toThrow();
  });

  test('clear empties the buffer', () => {
    const sb = new Scrollback(100);
    sb.push(makeLine('hello'));
    sb.push(makeLine('world'));
    sb.clear();
    expect(sb.length).toBe(0);
  });

  test('search finds matches', () => {
    const sb = new Scrollback(100);
    sb.push(makeLine('hello world'));
    sb.push(makeLine('foo bar'));
    sb.push(makeLine('hello again'));

    const matches = sb.search('hello', true);
    expect(matches).toHaveLength(2);
    expect(matches[0].startCol).toBe(0);
    expect(matches[0].endCol).toBe(5);
  });

  test('search case insensitive', () => {
    const sb = new Scrollback(100);
    sb.push(makeLine('Hello World'));
    sb.push(makeLine('HELLO'));

    const matches = sb.search('hello', false);
    expect(matches).toHaveLength(2);
  });

  test('push clones the line (no shared references)', () => {
    const sb = new Scrollback(100);
    const line = makeLine('original');
    sb.push(line);

    // Modify the original
    line.cells[0].char = 'X';

    // Scrollback should have the original value
    expect(sb.getLine(0).cells[0].char).toBe('o');
  });
});
