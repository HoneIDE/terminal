/**
 * Mouse encoder tests.
 *
 * Tests mouse tracking sequence generation for all modes and formats.
 */

import { describe, test, expect } from 'bun:test';
import { encodeMouse, type MouseEvent, type MouseTrackingState } from '../../core/input/mouse-encoder';

function event(opts: Partial<MouseEvent> = {}): MouseEvent {
  return {
    button: 'left',
    action: 'press',
    x: 0,
    y: 0,
    shift: false,
    alt: false,
    ctrl: false,
    ...opts,
  };
}

const noTracking: MouseTrackingState = {
  x10: false, normal: false, buttonEvent: false, anyEvent: false, sgrFormat: false,
};

const normalTracking: MouseTrackingState = {
  ...noTracking, normal: true,
};

const sgrTracking: MouseTrackingState = {
  ...noTracking, normal: true, sgrFormat: true,
};

const anyEventTracking: MouseTrackingState = {
  ...noTracking, anyEvent: true, sgrFormat: true,
};

describe('MouseEncoder', () => {
  test('returns null when no tracking enabled', () => {
    expect(encodeMouse(event(), noTracking)).toBeNull();
  });

  test('normal tracking: left press', () => {
    const result = encodeMouse(event(), normalTracking);
    expect(result).not.toBeNull();
    // Legacy format: CSI M <button+32> <x+33> <y+33>
    expect(result).toBe(`\x1b[M${String.fromCharCode(32)}${String.fromCharCode(33)}${String.fromCharCode(33)}`);
  });

  test('normal tracking: left release', () => {
    const result = encodeMouse(event({ action: 'release' }), normalTracking);
    expect(result).not.toBeNull();
    // Release = button 3
    expect(result).toBe(`\x1b[M${String.fromCharCode(35)}${String.fromCharCode(33)}${String.fromCharCode(33)}`);
  });

  test('SGR format: left press', () => {
    const result = encodeMouse(event({ x: 5, y: 10 }), sgrTracking);
    expect(result).toBe('\x1b[<0;6;11M');
  });

  test('SGR format: left release', () => {
    const result = encodeMouse(event({ action: 'release', x: 5, y: 10 }), sgrTracking);
    expect(result).toBe('\x1b[<3;6;11m');
  });

  test('SGR format: right press', () => {
    const result = encodeMouse(event({ button: 'right', x: 0, y: 0 }), sgrTracking);
    expect(result).toBe('\x1b[<2;1;1M');
  });

  test('SGR format: middle press', () => {
    const result = encodeMouse(event({ button: 'middle' }), sgrTracking);
    expect(result).toBe('\x1b[<1;1;1M');
  });

  test('SGR format: wheel up', () => {
    const result = encodeMouse(event({ button: 'wheelUp' }), sgrTracking);
    expect(result).toBe('\x1b[<64;1;1M');
  });

  test('SGR format: wheel down', () => {
    const result = encodeMouse(event({ button: 'wheelDown' }), sgrTracking);
    expect(result).toBe('\x1b[<65;1;1M');
  });

  test('SGR format: with modifiers', () => {
    const result = encodeMouse(event({ shift: true, x: 0, y: 0 }), sgrTracking);
    expect(result).toBe('\x1b[<4;1;1M'); // shift adds 4
  });

  test('any-event tracking reports motion', () => {
    const result = encodeMouse(event({ action: 'move', button: 'release', x: 5, y: 5 }), anyEventTracking);
    expect(result).not.toBeNull();
  });

  test('normal tracking ignores motion', () => {
    const result = encodeMouse(event({ action: 'move', button: 'release' }), normalTracking);
    expect(result).toBeNull();
  });
});
