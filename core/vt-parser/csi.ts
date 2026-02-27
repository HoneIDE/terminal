/**
 * CSI sequence dispatcher.
 *
 * Handles cursor movement, erase, scroll, insert/delete, SGR attributes,
 * private modes (DECSET/DECRST), device status reports, and cursor style.
 */

import { type ScreenBuffer } from '../buffer/screen-buffer';
import { type Color, defaultAttrs } from '../buffer/cell';

// ---------------------------------------------------------------------------
// Terminal mode flags (tracked externally by the emulator)
// ---------------------------------------------------------------------------

export interface TerminalModes {
  // Private modes (DECSET/DECRST)
  applicationCursorKeys: boolean;   // Mode 1 (DECCKM)
  reverseVideo: boolean;            // Mode 5 (DECSCNM)
  cursorBlink: boolean;             // Mode 12
  cursorVisible: boolean;           // Mode 25 (DECTCEM)
  mouseTrackingX10: boolean;        // Mode 9
  mouseTrackingNormal: boolean;     // Mode 1000
  mouseTrackingButton: boolean;     // Mode 1002
  mouseTrackingAny: boolean;        // Mode 1003
  mouseFormatSGR: boolean;          // Mode 1006
  bracketedPaste: boolean;          // Mode 2004
  synchronizedOutput: boolean;      // Mode 2026

  // Cursor style
  cursorStyle: 'block' | 'underline' | 'beam';
}

export function defaultModes(): TerminalModes {
  return {
    applicationCursorKeys: false,
    reverseVideo: false,
    cursorBlink: true,
    cursorVisible: true,
    mouseTrackingX10: false,
    mouseTrackingNormal: false,
    mouseTrackingButton: false,
    mouseTrackingAny: false,
    mouseFormatSGR: false,
    bracketedPaste: false,
    synchronizedOutput: false,
    cursorStyle: 'block',
  };
}

// ---------------------------------------------------------------------------
// CSI dispatcher
// ---------------------------------------------------------------------------

export interface CsiContext {
  buffer: ScreenBuffer;
  modes: TerminalModes;
  /** Write data back to the PTY (for DSR responses). */
  writeBack: (data: string) => void;
  /** Notify that the alternate buffer was toggled. */
  onAlternateBuffer?: (enabled: boolean) => void;
}

/**
 * Dispatch a CSI sequence.
 *
 * @param params    Numeric parameters (0 = default/missing)
 * @param intermediates  Intermediate bytes (e.g., '?' for private modes, ' ' for cursor style)
 * @param finalByte The final byte determining the command
 * @param ctx       Context providing the buffer, modes, and write-back
 */
export function dispatchCsi(
  params: number[],
  intermediates: string,
  finalByte: string,
  ctx: CsiContext,
): void {
  const buf = ctx.buffer;
  const p0 = params[0] || 0;
  const p1 = params[1] || 0;

  // Private mode sequences (CSI ? ... h/l)
  if (intermediates === '?') {
    if (finalByte === 'h') {
      for (const p of params) setPrivateMode(p, true, ctx);
    } else if (finalByte === 'l') {
      for (const p of params) setPrivateMode(p, false, ctx);
    }
    return;
  }

  // Cursor style (CSI n SP q)
  if (intermediates === ' ' && finalByte === 'q') {
    setCursorStyle(p0, ctx.modes);
    return;
  }

  switch (finalByte) {
    // --- Cursor Movement ---

    case 'A': // CUU — Cursor Up
      buf.cursorRow = Math.max(buf.scrollTop, buf.cursorRow - Math.max(p0, 1));
      buf.pendingWrap = false;
      break;

    case 'B': // CUD — Cursor Down
      buf.cursorRow = Math.min(buf.scrollBottom, buf.cursorRow + Math.max(p0, 1));
      buf.pendingWrap = false;
      break;

    case 'C': // CUF — Cursor Forward
      buf.cursorCol = Math.min(buf.cols - 1, buf.cursorCol + Math.max(p0, 1));
      buf.pendingWrap = false;
      break;

    case 'D': // CUB — Cursor Backward
      buf.cursorCol = Math.max(0, buf.cursorCol - Math.max(p0, 1));
      buf.pendingWrap = false;
      break;

    case 'E': // CNL — Cursor Next Line
      buf.cursorRow = Math.min(buf.scrollBottom, buf.cursorRow + Math.max(p0, 1));
      buf.cursorCol = 0;
      buf.pendingWrap = false;
      break;

    case 'F': // CPL — Cursor Previous Line
      buf.cursorRow = Math.max(buf.scrollTop, buf.cursorRow - Math.max(p0, 1));
      buf.cursorCol = 0;
      buf.pendingWrap = false;
      break;

    case 'G': // CHA — Cursor Horizontal Absolute
      buf.cursorCol = Math.max(0, Math.min(buf.cols - 1, (p0 || 1) - 1));
      buf.pendingWrap = false;
      break;

    case 'H': // CUP — Cursor Position
    case 'f': // HVP — Horizontal and Vertical Position
    {
      const row = Math.max(p0, 1) - 1;
      const col = Math.max(p1, 1) - 1;
      if (buf.originMode) {
        buf.cursorRow = Math.min(buf.scrollTop + row, buf.scrollBottom);
      } else {
        buf.cursorRow = Math.min(row, buf.rows - 1);
      }
      buf.cursorCol = Math.min(col, buf.cols - 1);
      buf.pendingWrap = false;
      break;
    }

    case 'd': // VPA — Vertical Position Absolute
    {
      const row = Math.max(p0, 1) - 1;
      if (buf.originMode) {
        buf.cursorRow = Math.min(buf.scrollTop + row, buf.scrollBottom);
      } else {
        buf.cursorRow = Math.min(row, buf.rows - 1);
      }
      buf.pendingWrap = false;
      break;
    }

    case 's': // SCP — Save Cursor Position
      buf.saveCursor();
      break;

    case 'u': // RCP — Restore Cursor Position
      buf.restoreCursor();
      break;

    // --- Erase ---

    case 'J': // ED — Erase in Display
      buf.eraseInDisplay(p0);
      break;

    case 'K': // EL — Erase in Line
      buf.eraseInLine(p0);
      break;

    case 'X': // ECH — Erase Characters
      buf.eraseCharacters(Math.max(p0, 1));
      break;

    // --- Scroll ---

    case 'S': // SU — Scroll Up
      buf.scrollUp(Math.max(p0, 1));
      break;

    case 'T': // SD — Scroll Down
      buf.scrollDown(Math.max(p0, 1));
      break;

    // --- Insert / Delete ---

    case 'L': // IL — Insert Lines
      buf.insertLines(Math.max(p0, 1));
      break;

    case 'M': // DL — Delete Lines
      buf.deleteLines(Math.max(p0, 1));
      break;

    case '@': // ICH — Insert Characters
      buf.insertCharacters(Math.max(p0, 1));
      break;

    case 'P': // DCH — Delete Characters
      buf.deleteCharacters(Math.max(p0, 1));
      break;

    // --- Tab Stops ---

    case 'I': // CHT — Cursor Forward Tab
      buf.tabForward(Math.max(p0, 1));
      break;

    case 'Z': // CBT — Cursor Backward Tab
      buf.tabBackward(Math.max(p0, 1));
      break;

    case 'g': // TBC — Tab Clear
      buf.clearTabStop(p0);
      break;

    // --- Scroll Region ---

    case 'r': // DECSTBM — Set Top and Bottom Margins
    {
      const top = (p0 || 1) - 1;
      const bottom = (p1 || buf.rows) - 1;
      if (top < bottom) {
        buf.setScrollRegion(top, bottom);
      }
      break;
    }

    // --- SGR (Select Graphic Rendition) ---

    case 'm':
      dispatchSgr(params, buf);
      break;

    // --- Device Status Reports ---

    case 'n':
      if (intermediates === '') {
        if (p0 === 5) {
          // Device status — respond OK
          ctx.writeBack('\x1b[0n');
        } else if (p0 === 6) {
          // Cursor position report
          ctx.writeBack(`\x1b[${buf.cursorRow + 1};${buf.cursorCol + 1}R`);
        }
      }
      break;

    // --- Standard modes (SM/RM) ---

    case 'h': // SM — Set Mode
      if (p0 === 4) buf.insertMode = true;   // IRM
      if (p0 === 20) buf.lineFeedMode = true; // LNM
      break;

    case 'l': // RM — Reset Mode
      if (p0 === 4) buf.insertMode = false;
      if (p0 === 20) buf.lineFeedMode = false;
      break;

    // --- Misc ---

    case 'c': // DA — Device Attributes
      if (intermediates === '' || intermediates === '>') {
        // Respond with VT220 capabilities
        ctx.writeBack('\x1b[?62;22c');
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// SGR
// ---------------------------------------------------------------------------

function dispatchSgr(params: number[], buf: ScreenBuffer): void {
  // If no params, treat as reset
  if (params.length === 0) {
    params = [0];
  }

  for (let i = 0; i < params.length; i++) {
    // Skip colon-separator sentinels
    if (params[i] === -1) continue;

    const p = params[i];

    switch (p) {
      case 0: // Reset
        buf.cursorAttrs = defaultAttrs();
        buf.cursorFg = { type: 'default' };
        buf.cursorBg = { type: 'default' };
        break;

      case 1: buf.cursorAttrs.bold = true; break;
      case 2: buf.cursorAttrs.dim = true; break;
      case 3: buf.cursorAttrs.italic = true; break;
      case 4:
        buf.cursorAttrs.underline = true;
        // Check for extended underline style (4:n via colon separator)
        if (i + 2 < params.length && params[i + 1] === -1) {
          const style = params[i + 2];
          switch (style) {
            case 0: buf.cursorAttrs.underline = false; break;
            case 1: buf.cursorAttrs.underlineStyle = 'single'; break;
            case 2: buf.cursorAttrs.underlineStyle = 'double'; break;
            case 3: buf.cursorAttrs.underlineStyle = 'curly'; break;
            case 4: buf.cursorAttrs.underlineStyle = 'dotted'; break;
            case 5: buf.cursorAttrs.underlineStyle = 'dashed'; break;
          }
          i += 2; // Skip the sentinel and subparam
        }
        break;
      case 5: buf.cursorAttrs.blink = true; break;
      case 7: buf.cursorAttrs.inverse = true; break;
      case 8: buf.cursorAttrs.invisible = true; break;
      case 9: buf.cursorAttrs.strikethrough = true; break;

      case 21: // Double underline
        buf.cursorAttrs.underline = true;
        buf.cursorAttrs.underlineStyle = 'double';
        break;

      case 22: // Normal intensity (not bold, not dim)
        buf.cursorAttrs.bold = false;
        buf.cursorAttrs.dim = false;
        break;
      case 23: buf.cursorAttrs.italic = false; break;
      case 24: buf.cursorAttrs.underline = false; break;
      case 25: buf.cursorAttrs.blink = false; break;
      case 27: buf.cursorAttrs.inverse = false; break;
      case 28: buf.cursorAttrs.invisible = false; break;
      case 29: buf.cursorAttrs.strikethrough = false; break;

      // Foreground colors (ANSI 0-7)
      case 30: case 31: case 32: case 33:
      case 34: case 35: case 36: case 37:
        buf.cursorFg = { type: 'indexed', index: p - 30 };
        break;

      case 38: // Extended foreground color
        i = parseExtendedColor(params, i, true, buf);
        break;

      case 39: // Default foreground
        buf.cursorFg = { type: 'default' };
        break;

      // Background colors (ANSI 0-7)
      case 40: case 41: case 42: case 43:
      case 44: case 45: case 46: case 47:
        buf.cursorBg = { type: 'indexed', index: p - 40 };
        break;

      case 48: // Extended background color
        i = parseExtendedColor(params, i, false, buf);
        break;

      case 49: // Default background
        buf.cursorBg = { type: 'default' };
        break;

      // Bright foreground (ANSI 8-15)
      case 90: case 91: case 92: case 93:
      case 94: case 95: case 96: case 97:
        buf.cursorFg = { type: 'indexed', index: p - 90 + 8 };
        break;

      // Bright background (ANSI 8-15)
      case 100: case 101: case 102: case 103:
      case 104: case 105: case 106: case 107:
        buf.cursorBg = { type: 'indexed', index: p - 100 + 8 };
        break;
    }
  }
}

/**
 * Parse extended color (38;5;n or 38;2;r;g;b).
 * Returns the updated param index.
 */
function parseExtendedColor(
  params: number[],
  i: number,
  isFg: boolean,
  buf: ScreenBuffer,
): number {
  if (i + 1 >= params.length) return i;

  const mode = params[i + 1];
  if (mode === 5) {
    // 256-color: 38;5;n
    if (i + 2 < params.length) {
      const color: Color = { type: 'indexed', index: params[i + 2] };
      if (isFg) buf.cursorFg = color; else buf.cursorBg = color;
      return i + 2;
    }
  } else if (mode === 2) {
    // Truecolor: 38;2;r;g;b
    if (i + 4 < params.length) {
      const color: Color = {
        type: 'rgb',
        r: params[i + 2],
        g: params[i + 3],
        b: params[i + 4],
      };
      if (isFg) buf.cursorFg = color; else buf.cursorBg = color;
      return i + 4;
    }
  }

  return i;
}

// ---------------------------------------------------------------------------
// Private modes
// ---------------------------------------------------------------------------

function setPrivateMode(mode: number, enabled: boolean, ctx: CsiContext): void {
  const buf = ctx.buffer;
  const modes = ctx.modes;

  switch (mode) {
    case 1: // DECCKM — Application cursor keys
      modes.applicationCursorKeys = enabled;
      break;
    case 5: // DECSCNM — Reverse video
      modes.reverseVideo = enabled;
      buf.markAllDirty();
      break;
    case 6: // DECOM — Origin mode
      buf.originMode = enabled;
      buf.cursorRow = enabled ? buf.scrollTop : 0;
      buf.cursorCol = 0;
      buf.pendingWrap = false;
      break;
    case 7: // DECAWM — Auto-wrap mode
      buf.autoWrapMode = enabled;
      break;
    case 12: // Cursor blink
      modes.cursorBlink = enabled;
      break;
    case 25: // DECTCEM — Cursor visible
      modes.cursorVisible = enabled;
      break;
    case 9: // X10 mouse tracking
      modes.mouseTrackingX10 = enabled;
      break;
    case 47: // Alternate screen buffer (old style)
      if (enabled) buf.switchToAlternate();
      else buf.switchToMain();
      ctx.onAlternateBuffer?.(enabled);
      break;
    case 1000: // Normal mouse tracking
      modes.mouseTrackingNormal = enabled;
      break;
    case 1002: // Button-event mouse tracking
      modes.mouseTrackingButton = enabled;
      break;
    case 1003: // Any-event mouse tracking
      modes.mouseTrackingAny = enabled;
      break;
    case 1006: // SGR mouse format
      modes.mouseFormatSGR = enabled;
      break;
    case 1049: // Alternate screen buffer (save cursor, switch, clear)
      if (enabled) {
        buf.switchToAlternate();
      } else {
        buf.switchToMain();
      }
      ctx.onAlternateBuffer?.(enabled);
      break;
    case 2004: // Bracketed paste
      modes.bracketedPaste = enabled;
      break;
    case 2026: // Synchronized output
      modes.synchronizedOutput = enabled;
      break;
  }
}

// ---------------------------------------------------------------------------
// Cursor style
// ---------------------------------------------------------------------------

function setCursorStyle(style: number, modes: TerminalModes): void {
  switch (style) {
    case 0: case 1: // Blinking block
      modes.cursorStyle = 'block';
      modes.cursorBlink = true;
      break;
    case 2: // Steady block
      modes.cursorStyle = 'block';
      modes.cursorBlink = false;
      break;
    case 3: // Blinking underline
      modes.cursorStyle = 'underline';
      modes.cursorBlink = true;
      break;
    case 4: // Steady underline
      modes.cursorStyle = 'underline';
      modes.cursorBlink = false;
      break;
    case 5: // Blinking beam
      modes.cursorStyle = 'beam';
      modes.cursorBlink = true;
      break;
    case 6: // Steady beam
      modes.cursorStyle = 'beam';
      modes.cursorBlink = false;
      break;
  }
}
