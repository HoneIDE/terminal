/**
 * Key encoder tests.
 *
 * Tests key → escape sequence mapping for all key types.
 */

import { describe, test, expect } from 'bun:test';
import { encodeKey, encodePaste, type KeyEvent } from '../../core/input/key-encoder';

function key(k: string, opts: Partial<KeyEvent> = {}): KeyEvent {
  return {
    key: k,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    ...opts,
  };
}

const normalOptions = {
  applicationCursorKeys: false,
  applicationKeypad: false,
  bracketedPaste: false,
};

const appCursorOptions = {
  ...normalOptions,
  applicationCursorKeys: true,
};

describe('KeyEncoder', () => {
  test('printable characters pass through', () => {
    expect(encodeKey(key('a'), normalOptions)).toBe('a');
    expect(encodeKey(key('Z'), normalOptions)).toBe('Z');
    expect(encodeKey(key('1'), normalOptions)).toBe('1');
    expect(encodeKey(key(' '), normalOptions)).toBe(' ');
  });

  test('Enter sends CR', () => {
    expect(encodeKey(key('Enter'), normalOptions)).toBe('\r');
  });

  test('Tab sends HT', () => {
    expect(encodeKey(key('Tab'), normalOptions)).toBe('\t');
  });

  test('Shift+Tab sends CSI Z', () => {
    expect(encodeKey(key('Tab', { shift: true }), normalOptions)).toBe('\x1b[Z');
  });

  test('Backspace sends DEL', () => {
    expect(encodeKey(key('Backspace'), normalOptions)).toBe('\x7f');
  });

  test('Escape sends ESC', () => {
    expect(encodeKey(key('Escape'), normalOptions)).toBe('\x1b');
  });

  test('arrow keys in normal mode', () => {
    expect(encodeKey(key('ArrowUp'), normalOptions)).toBe('\x1b[A');
    expect(encodeKey(key('ArrowDown'), normalOptions)).toBe('\x1b[B');
    expect(encodeKey(key('ArrowRight'), normalOptions)).toBe('\x1b[C');
    expect(encodeKey(key('ArrowLeft'), normalOptions)).toBe('\x1b[D');
  });

  test('arrow keys in application cursor mode', () => {
    expect(encodeKey(key('ArrowUp'), appCursorOptions)).toBe('\x1bOA');
    expect(encodeKey(key('ArrowDown'), appCursorOptions)).toBe('\x1bOB');
    expect(encodeKey(key('ArrowRight'), appCursorOptions)).toBe('\x1bOC');
    expect(encodeKey(key('ArrowLeft'), appCursorOptions)).toBe('\x1bOD');
  });

  test('arrow keys with modifiers', () => {
    // Shift+Up = CSI 1;2 A
    expect(encodeKey(key('ArrowUp', { shift: true }), normalOptions)).toBe('\x1b[1;2A');
    // Ctrl+Right = CSI 1;5 C
    expect(encodeKey(key('ArrowRight', { ctrl: true }), normalOptions)).toBe('\x1b[1;5C');
    // Alt+Down = CSI 1;3 B
    expect(encodeKey(key('ArrowDown', { alt: true }), normalOptions)).toBe('\x1b[1;3B');
  });

  test('function keys', () => {
    expect(encodeKey(key('F1'), normalOptions)).toBe('\x1bOP');
    expect(encodeKey(key('F5'), normalOptions)).toBe('\x1b[15~');
    expect(encodeKey(key('F12'), normalOptions)).toBe('\x1b[24~');
  });

  test('editing keys', () => {
    expect(encodeKey(key('Delete'), normalOptions)).toBe('\x1b[3~');
    expect(encodeKey(key('Insert'), normalOptions)).toBe('\x1b[2~');
    expect(encodeKey(key('Home'), normalOptions)).toBe('\x1b[H');
    expect(encodeKey(key('End'), normalOptions)).toBe('\x1b[F');
    expect(encodeKey(key('PageUp'), normalOptions)).toBe('\x1b[5~');
    expect(encodeKey(key('PageDown'), normalOptions)).toBe('\x1b[6~');
  });

  test('Ctrl+A through Ctrl+Z', () => {
    expect(encodeKey(key('a', { ctrl: true }), normalOptions)).toBe('\x01');
    expect(encodeKey(key('c', { ctrl: true }), normalOptions)).toBe('\x03');
    expect(encodeKey(key('z', { ctrl: true }), normalOptions)).toBe('\x1a');
  });

  test('Alt+key sends ESC prefix', () => {
    expect(encodeKey(key('a', { alt: true }), normalOptions)).toBe('\x1ba');
    expect(encodeKey(key('x', { alt: true }), normalOptions)).toBe('\x1bx');
  });

  test('modifier-only keys return null', () => {
    expect(encodeKey(key('Shift'), normalOptions)).toBeNull();
    expect(encodeKey(key('Control'), normalOptions)).toBeNull();
    expect(encodeKey(key('Alt'), normalOptions)).toBeNull();
    expect(encodeKey(key('Meta'), normalOptions)).toBeNull();
  });
});

describe('encodePaste', () => {
  test('without bracketed paste', () => {
    expect(encodePaste('hello', false)).toBe('hello');
  });

  test('with bracketed paste', () => {
    expect(encodePaste('hello', true)).toBe('\x1b[200~hello\x1b[201~');
  });
});
