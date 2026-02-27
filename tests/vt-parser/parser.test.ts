/**
 * VT Parser state machine tests.
 *
 * Tests state transitions, UTF-8 decoding, incomplete sequences,
 * and C0 control handling.
 */

import { describe, test, expect } from 'bun:test';
import { VTParser, State } from '../../core/vt-parser/parser';

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('VTParser', () => {
  test('printable ASCII characters dispatch onPrint', () => {
    const parser = new VTParser();
    const printed: string[] = [];
    parser.onPrint((c) => printed.push(c));

    parser.feed(encode('Hello'));
    expect(printed).toEqual(['H', 'e', 'l', 'l', 'o']);
  });

  test('C0 controls dispatch onExecute', () => {
    const parser = new VTParser();
    const executed: number[] = [];
    parser.onExecute((code) => executed.push(code));

    // BEL, BS, HT, LF, CR
    parser.feed(new Uint8Array([0x07, 0x08, 0x09, 0x0a, 0x0d]));
    expect(executed).toEqual([0x07, 0x08, 0x09, 0x0a, 0x0d]);
  });

  test('ESC [ starts CSI sequence', () => {
    const parser = new VTParser();
    const csiCalls: { params: number[]; intermediates: string; final: string }[] = [];
    parser.onCsi((params, intermediates, finalByte) => {
      csiCalls.push({ params, intermediates, final: finalByte });
    });

    // CSI A = cursor up (no params)
    parser.feed(encode('\x1b[A'));
    expect(csiCalls).toHaveLength(1);
    expect(csiCalls[0].final).toBe('A');
    expect(csiCalls[0].params).toEqual([]);
  });

  test('CSI with numeric params', () => {
    const parser = new VTParser();
    const csiCalls: { params: number[]; final: string }[] = [];
    parser.onCsi((params, _i, f) => csiCalls.push({ params, final: f }));

    // CSI 5 ; 10 H = cursor position (5, 10)
    parser.feed(encode('\x1b[5;10H'));
    expect(csiCalls[0].params).toEqual([5, 10]);
    expect(csiCalls[0].final).toBe('H');
  });

  test('CSI with private mode marker (?)', () => {
    const parser = new VTParser();
    const csiCalls: { params: number[]; intermediates: string; final: string }[] = [];
    parser.onCsi((params, intermediates, f) => csiCalls.push({ params, intermediates, final: f }));

    // CSI ? 25 h = DECTCEM (cursor visible)
    parser.feed(encode('\x1b[?25h'));
    expect(csiCalls[0].intermediates).toBe('?');
    expect(csiCalls[0].params).toEqual([25]);
    expect(csiCalls[0].final).toBe('h');
  });

  test('OSC with BEL terminator', () => {
    const parser = new VTParser();
    const oscCalls: string[][] = [];
    parser.onOsc((params) => oscCalls.push(params));

    // OSC 0 ; title BEL
    parser.feed(encode('\x1b]0;My Title\x07'));
    expect(oscCalls).toHaveLength(1);
    expect(oscCalls[0]).toEqual(['0', 'My Title']);
  });

  test('OSC with ST terminator (ESC \\)', () => {
    const parser = new VTParser();
    const oscCalls: string[][] = [];
    parser.onOsc((params) => oscCalls.push(params));

    parser.feed(encode('\x1b]2;Window Title\x1b\\'));
    expect(oscCalls).toHaveLength(1);
    expect(oscCalls[0]).toEqual(['2', 'Window Title']);
  });

  test('UTF-8 multi-byte characters', () => {
    const parser = new VTParser();
    const printed: string[] = [];
    parser.onPrint((c) => printed.push(c));

    // 2-byte: é (U+00E9)
    parser.feed(new Uint8Array([0xc3, 0xa9]));
    expect(printed).toEqual(['é']);
  });

  test('UTF-8 3-byte CJK characters', () => {
    const parser = new VTParser();
    const printed: string[] = [];
    parser.onPrint((c) => printed.push(c));

    // 漢 (U+6F22) = 0xE6 0xBC 0xA2
    parser.feed(new Uint8Array([0xe6, 0xbc, 0xa2]));
    expect(printed).toEqual(['漢']);
  });

  test('UTF-8 4-byte emoji', () => {
    const parser = new VTParser();
    const printed: string[] = [];
    parser.onPrint((c) => printed.push(c));

    // 😀 (U+1F600) = 0xF0 0x9F 0x98 0x80
    parser.feed(new Uint8Array([0xf0, 0x9f, 0x98, 0x80]));
    expect(printed).toEqual(['😀']);
  });

  test('split UTF-8 across feed calls', () => {
    const parser = new VTParser();
    const printed: string[] = [];
    parser.onPrint((c) => printed.push(c));

    // Split é across two feeds
    parser.feed(new Uint8Array([0xc3]));
    expect(printed).toHaveLength(0);
    parser.feed(new Uint8Array([0xa9]));
    expect(printed).toEqual(['é']);
  });

  test('split CSI sequence across feed calls', () => {
    const parser = new VTParser();
    const csiCalls: { params: number[]; final: string }[] = [];
    parser.onCsi((params, _i, f) => csiCalls.push({ params, final: f }));

    // Split CSI 10 A across three feeds
    parser.feed(encode('\x1b'));
    parser.feed(encode('['));
    parser.feed(encode('10A'));
    expect(csiCalls).toHaveLength(1);
    expect(csiCalls[0].params).toEqual([10]);
  });

  test('C0 controls execute during escape sequences', () => {
    const parser = new VTParser();
    const executed: number[] = [];
    const printed: string[] = [];
    parser.onExecute((code) => executed.push(code));
    parser.onPrint((c) => printed.push(c));

    // LF in the middle of text
    parser.feed(encode('A\nB'));
    expect(printed).toEqual(['A', 'B']);
    expect(executed).toEqual([0x0a]);
  });

  test('ESC sequence dispatch', () => {
    const parser = new VTParser();
    const escCalls: { intermediates: string; final: string }[] = [];
    parser.onEsc((i, f) => escCalls.push({ intermediates: i, final: f }));

    // ESC 7 = DECSC
    parser.feed(encode('\x1b7'));
    expect(escCalls).toHaveLength(1);
    expect(escCalls[0].final).toBe('7');

    // ESC M = RI
    parser.feed(encode('\x1bM'));
    expect(escCalls).toHaveLength(2);
    expect(escCalls[1].final).toBe('M');
  });

  test('reset clears parser state', () => {
    const parser = new VTParser();
    const csiCalls: any[] = [];
    parser.onCsi((params, _i, f) => csiCalls.push(f));

    // Start a CSI sequence but don't finish
    parser.feed(encode('\x1b[5'));
    // Reset
    parser.reset();
    // Now feed normal text — should print, not CSI
    const printed: string[] = [];
    parser.onPrint((c) => printed.push(c));
    parser.feed(encode('A'));
    expect(printed).toEqual(['A']);
    expect(csiCalls).toHaveLength(0);
  });

  test('CAN (0x18) aborts sequence and returns to ground', () => {
    const parser = new VTParser();
    const csiCalls: any[] = [];
    const executed: number[] = [];
    parser.onCsi((_p, _i, f) => csiCalls.push(f));
    parser.onExecute((c) => executed.push(c));

    // Start CSI, then CAN
    parser.feed(new Uint8Array([0x1b, 0x5b, 0x33, 0x18]));
    expect(csiCalls).toHaveLength(0);
    expect(executed).toContain(0x18);
  });

  test('multiple CSI sequences in one feed', () => {
    const parser = new VTParser();
    const csiCalls: { params: number[]; final: string }[] = [];
    parser.onCsi((params, _i, f) => csiCalls.push({ params, final: f }));

    parser.feed(encode('\x1b[2J\x1b[H'));
    expect(csiCalls).toHaveLength(2);
    expect(csiCalls[0].final).toBe('J');
    expect(csiCalls[0].params).toEqual([2]);
    expect(csiCalls[1].final).toBe('H');
  });

  test('SGR with multiple params', () => {
    const parser = new VTParser();
    const csiCalls: { params: number[]; final: string }[] = [];
    parser.onCsi((params, _i, f) => csiCalls.push({ params, final: f }));

    // Bold + red foreground
    parser.feed(encode('\x1b[1;31m'));
    expect(csiCalls[0].params).toEqual([1, 31]);
    expect(csiCalls[0].final).toBe('m');
  });

  test('CSI with intermediate byte (cursor style)', () => {
    const parser = new VTParser();
    const csiCalls: { params: number[]; intermediates: string; final: string }[] = [];
    parser.onCsi((params, i, f) => csiCalls.push({ params, intermediates: i, final: f }));

    // CSI 2 SP q = steady block cursor
    parser.feed(encode('\x1b[2 q'));
    expect(csiCalls[0].intermediates).toBe(' ');
    expect(csiCalls[0].params).toEqual([2]);
    expect(csiCalls[0].final).toBe('q');
  });

  test('DEL (0x7F) is ignored in ground state', () => {
    const parser = new VTParser();
    const printed: string[] = [];
    parser.onPrint((c) => printed.push(c));

    parser.feed(new Uint8Array([0x41, 0x7f, 0x42])); // A DEL B
    expect(printed).toEqual(['A', 'B']);
  });
});
