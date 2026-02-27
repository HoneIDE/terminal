/**
 * MouseEncoder — translates mouse events into VT mouse tracking sequences.
 *
 * Supports X10, normal, button-event, and any-event tracking modes,
 * with both legacy and SGR encoding formats.
 */

export type MouseButton = 'left' | 'middle' | 'right' | 'release' | 'wheelUp' | 'wheelDown';
export type MouseAction = 'press' | 'release' | 'move';

export interface MouseEvent {
  button: MouseButton;
  action: MouseAction;
  x: number; // 0-indexed column
  y: number; // 0-indexed row
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export interface MouseTrackingState {
  x10: boolean;         // Mode 9: press only
  normal: boolean;      // Mode 1000: press + release
  buttonEvent: boolean; // Mode 1002: press + release + drag
  anyEvent: boolean;    // Mode 1003: all motion
  sgrFormat: boolean;   // Mode 1006: SGR extended coordinates
}

/**
 * Encode a mouse event into a VT tracking sequence.
 * Returns null if the event should not be reported.
 */
export function encodeMouse(event: MouseEvent, state: MouseTrackingState): string | null {
  // Determine if this event should be reported
  if (!shouldReport(event, state)) return null;

  // Compute button byte
  let button = getButtonCode(event);

  // Add modifier flags
  if (event.shift) button |= 4;
  if (event.alt) button |= 8;
  if (event.ctrl) button |= 16;

  // Motion flag
  if (event.action === 'move') button |= 32;

  // 1-indexed coordinates
  const x = event.x + 1;
  const y = event.y + 1;

  if (state.sgrFormat) {
    // SGR format: CSI < button ; x ; y M/m
    const suffix = event.action === 'release' ? 'm' : 'M';
    return `\x1b[<${button};${x};${y}${suffix}`;
  }

  // Legacy format: CSI M (button+32) (x+32) (y+32)
  // Coordinates limited to 223
  if (x > 223 || y > 223) return null;

  return `\x1b[M${String.fromCharCode(button + 32)}${String.fromCharCode(x + 32)}${String.fromCharCode(y + 32)}`;
}

function shouldReport(event: MouseEvent, state: MouseTrackingState): boolean {
  if (state.anyEvent) return true;

  if (state.buttonEvent) {
    // Report press, release, and drag (motion while button held)
    if (event.action === 'press' || event.action === 'release') return true;
    if (event.action === 'move' && event.button !== 'release') return true;
    return false;
  }

  if (state.normal) {
    // Report press and release
    return event.action === 'press' || event.action === 'release';
  }

  if (state.x10) {
    // Report press only
    return event.action === 'press';
  }

  return false;
}

function getButtonCode(event: MouseEvent): number {
  if (event.action === 'release' && !event.button) return 3;

  switch (event.button) {
    case 'left': return event.action === 'release' ? 3 : 0;
    case 'middle': return event.action === 'release' ? 3 : 1;
    case 'right': return event.action === 'release' ? 3 : 2;
    case 'release': return 3;
    case 'wheelUp': return 64;
    case 'wheelDown': return 65;
    default: return 0;
  }
}
