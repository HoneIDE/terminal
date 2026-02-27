/**
 * KeyEncoder — translates keyboard events into VT escape sequences.
 *
 * Handles normal printable characters, control keys, arrow keys,
 * function keys, editing keys, and modifier combinations.
 */

export interface KeyEvent {
  key: string;
  code?: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface KeyEncoderOptions {
  applicationCursorKeys: boolean;
  applicationKeypad: boolean;
  bracketedPaste: boolean;
}

/**
 * Encode a keyboard event into a VT escape sequence string.
 * Returns null if the key should not be sent to the PTY.
 */
export function encodeKey(event: KeyEvent, options: KeyEncoderOptions): string | null {
  const { key, ctrl, alt, shift } = event;

  // Modifier code for CSI sequences: 1 + (shift?1:0) + (alt?2:0) + (ctrl?4:0)
  const modCode = 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0);
  const hasMod = modCode > 1;

  // --- Special keys ---

  switch (key) {
    case 'Enter':
      return ctrl ? '\x0a' : '\x0d';
    case 'Tab':
      return shift ? '\x1b[Z' : '\x09';
    case 'Backspace':
      return ctrl ? '\x08' : '\x7f';
    case 'Escape':
      return '\x1b';
    case 'Delete':
      return hasMod ? `\x1b[3;${modCode}~` : '\x1b[3~';
    case 'Insert':
      return hasMod ? `\x1b[2;${modCode}~` : '\x1b[2~';

    // Arrow keys
    case 'ArrowUp':
      if (hasMod) return `\x1b[1;${modCode}A`;
      return options.applicationCursorKeys ? '\x1bOA' : '\x1b[A';
    case 'ArrowDown':
      if (hasMod) return `\x1b[1;${modCode}B`;
      return options.applicationCursorKeys ? '\x1bOB' : '\x1b[B';
    case 'ArrowRight':
      if (hasMod) return `\x1b[1;${modCode}C`;
      return options.applicationCursorKeys ? '\x1bOC' : '\x1b[C';
    case 'ArrowLeft':
      if (hasMod) return `\x1b[1;${modCode}D`;
      return options.applicationCursorKeys ? '\x1bOD' : '\x1b[D';

    // Home/End
    case 'Home':
      return hasMod ? `\x1b[1;${modCode}H` : '\x1b[H';
    case 'End':
      return hasMod ? `\x1b[1;${modCode}F` : '\x1b[F';

    // Page Up/Down
    case 'PageUp':
      return hasMod ? `\x1b[5;${modCode}~` : '\x1b[5~';
    case 'PageDown':
      return hasMod ? `\x1b[6;${modCode}~` : '\x1b[6~';

    // Function keys
    case 'F1':
      return hasMod ? `\x1b[1;${modCode}P` : '\x1bOP';
    case 'F2':
      return hasMod ? `\x1b[1;${modCode}Q` : '\x1bOQ';
    case 'F3':
      return hasMod ? `\x1b[1;${modCode}R` : '\x1bOR';
    case 'F4':
      return hasMod ? `\x1b[1;${modCode}S` : '\x1bOS';
    case 'F5':
      return hasMod ? `\x1b[15;${modCode}~` : '\x1b[15~';
    case 'F6':
      return hasMod ? `\x1b[17;${modCode}~` : '\x1b[17~';
    case 'F7':
      return hasMod ? `\x1b[18;${modCode}~` : '\x1b[18~';
    case 'F8':
      return hasMod ? `\x1b[19;${modCode}~` : '\x1b[19~';
    case 'F9':
      return hasMod ? `\x1b[20;${modCode}~` : '\x1b[20~';
    case 'F10':
      return hasMod ? `\x1b[21;${modCode}~` : '\x1b[21~';
    case 'F11':
      return hasMod ? `\x1b[23;${modCode}~` : '\x1b[23~';
    case 'F12':
      return hasMod ? `\x1b[24;${modCode}~` : '\x1b[24~';
  }

  // --- Control keys (Ctrl+A..Z) ---
  if (ctrl && !alt && !shift && key.length === 1) {
    const code = key.toUpperCase().charCodeAt(0);
    if (code >= 0x40 && code <= 0x5f) {
      // Ctrl+@ through Ctrl+_
      return String.fromCharCode(code - 0x40);
    }
    // Special cases
    if (key === '?') return '\x7f';
    if (key === '2' || key === ' ') return '\x00'; // Ctrl+Space or Ctrl+2 = NUL
    if (key === '3') return '\x1b'; // Ctrl+3 = ESC
    if (key === '4') return '\x1c'; // Ctrl+4 = FS
    if (key === '5') return '\x1d'; // Ctrl+5 = GS
    if (key === '6') return '\x1e'; // Ctrl+6 = RS
    if (key === '7') return '\x1f'; // Ctrl+7 = US
    if (key === '8') return '\x7f'; // Ctrl+8 = DEL
  }

  // --- Alt+key ---
  if (alt && !ctrl && key.length === 1) {
    return '\x1b' + key;
  }

  // --- Normal printable characters ---
  if (!ctrl && !alt && !event.meta && key.length === 1) {
    return key;
  }

  // Modifier-only keys or unhandled
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') {
    return null;
  }

  // Ctrl+Alt combinations
  if (ctrl && alt && key.length === 1) {
    return '\x1b' + String.fromCharCode(key.toUpperCase().charCodeAt(0) - 0x40);
  }

  return null;
}

/**
 * Wrap text in bracketed paste sequences.
 */
export function encodePaste(text: string, bracketedPaste: boolean): string {
  if (bracketedPaste) {
    return `\x1b[200~${text}\x1b[201~`;
  }
  return text;
}
