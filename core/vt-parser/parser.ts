/**
 * VT Parser — deterministic state machine for VT100/xterm escape sequences.
 *
 * Based on Paul Flo Williams' state machine for DEC-compatible terminal
 * parsing. Processes a byte stream and dispatches semantic actions.
 *
 * 14 states, transition table driven.
 */

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

// Perry-compatible constants (replaces const enum for native compilation)
export const State_Ground = 0;
export const State_Escape = 1;
export const State_EscapeIntermediate = 2;
export const State_CsiEntry = 3;
export const State_CsiParam = 4;
export const State_CsiIntermediate = 5;
export const State_CsiIgnore = 6;
export const State_OscString = 7;
export const State_DcsEntry = 8;
export const State_DcsParam = 9;
export const State_DcsIntermediate = 10;
export const State_DcsPassthrough = 11;
export const State_DcsIgnore = 12;
export const State_SosPmApc = 13;

// Alias object for backward-compatible enum-style access
export const State = {
  Ground: State_Ground,
  Escape: State_Escape,
  EscapeIntermediate: State_EscapeIntermediate,
  CsiEntry: State_CsiEntry,
  CsiParam: State_CsiParam,
  CsiIntermediate: State_CsiIntermediate,
  CsiIgnore: State_CsiIgnore,
  OscString: State_OscString,
  DcsEntry: State_DcsEntry,
  DcsParam: State_DcsParam,
  DcsIntermediate: State_DcsIntermediate,
  DcsPassthrough: State_DcsPassthrough,
  DcsIgnore: State_DcsIgnore,
  SosPmApc: State_SosPmApc,
} as const;

export type State = typeof State[keyof typeof State];

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const Action_None = 0;
const Action_Print = 1;
const Action_Execute = 2;
const Action_Collect = 3;
const Action_Param = 4;
const Action_EscDispatch = 5;
const Action_CsiDispatch = 6;
const Action_OscStart = 7;
const Action_OscPut = 8;
const Action_OscEnd = 9;
const Action_DcsHook = 10;
const Action_DcsPut = 11;
const Action_DcsUnhook = 12;

const Action = {
  None: Action_None,
  Print: Action_Print,
  Execute: Action_Execute,
  Collect: Action_Collect,
  Param: Action_Param,
  EscDispatch: Action_EscDispatch,
  CsiDispatch: Action_CsiDispatch,
  OscStart: Action_OscStart,
  OscPut: Action_OscPut,
  OscEnd: Action_OscEnd,
  DcsHook: Action_DcsHook,
  DcsPut: Action_DcsPut,
  DcsUnhook: Action_DcsUnhook,
} as const;

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

export type PrintHandler = (char: string) => void;
export type ExecuteHandler = (code: number) => void;
export type CsiHandler = (params: number[], intermediates: string, finalByte: string) => void;
export type OscHandler = (params: string[]) => void;
export type DcsHandler = (params: number[], intermediates: string, data: string) => void;
export type EscHandler = (intermediates: string, finalByte: string) => void;

// ---------------------------------------------------------------------------
// VTParser
// ---------------------------------------------------------------------------

export class VTParser {
  private state: State = State.Ground;
  private params: number[] = [];
  private currentParam: number = 0;
  private hasParam: boolean = false;
  private intermediates: string = '';
  private oscString: string = '';
  private dcsData: string = '';
  private precedingState: State = State.Ground; // track state before ESC transition

  // Handlers
  private printHandler: PrintHandler = () => {};
  private executeHandler: ExecuteHandler = () => {};
  private csiHandler: CsiHandler = () => {};
  private oscHandler: OscHandler = () => {};
  private dcsHandler: DcsHandler = () => {};
  private escHandler: EscHandler = () => {};

  // UTF-8 decoding state
  private utf8Buf: number[] = [];
  private utf8Remaining: number = 0;

  onPrint(handler: PrintHandler): void { this.printHandler = handler; }
  onExecute(handler: ExecuteHandler): void { this.executeHandler = handler; }
  onCsi(handler: CsiHandler): void { this.csiHandler = handler; }
  onOsc(handler: OscHandler): void { this.oscHandler = handler; }
  onDcs(handler: DcsHandler): void { this.dcsHandler = handler; }
  onEsc(handler: EscHandler): void { this.escHandler = handler; }

  /** Reset parser to ground state. */
  reset(): void {
    this.state = State.Ground;
    this.params = [];
    this.currentParam = 0;
    this.hasParam = false;
    this.intermediates = '';
    this.oscString = '';
    this.dcsData = '';
    this.utf8Buf = [];
    this.utf8Remaining = 0;
  }

  /** Feed raw bytes from PTY output into the parser. */
  feed(data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];

      // UTF-8 continuation handling (in Ground or OscString state)
      if (this.utf8Remaining > 0) {
        if ((byte & 0xc0) === 0x80) {
          this.utf8Buf.push(byte);
          this.utf8Remaining--;
          if (this.utf8Remaining === 0) {
            const char = this.decodeUtf8(this.utf8Buf);
            this.utf8Buf = [];
            if (this.state === State.OscString) {
              this.oscString += char;
            } else {
              this.printHandler(char);
            }
          }
          continue;
        } else {
          // Invalid continuation, reset UTF-8 state
          this.utf8Buf = [];
          this.utf8Remaining = 0;
        }
      }

      // Check for anywhere-transitions first (these apply in ANY state)
      if (byte === 0x18 || byte === 0x1a) {
        // CAN, SUB → execute and go to Ground
        this.executeHandler(byte);
        this.state = State.Ground;
        continue;
      }
      if (byte === 0x1b) {
        // ESC → transition to Escape (from any state)
        // Save preceding state so we can dispatch OSC/DCS on ST (ESC \)
        this.precedingState = this.state;
        this.enterState(State.Escape);
        continue;
      }

      // State-specific transitions
      switch (this.state) {
        case State.Ground:
          this.handleGround(byte);
          break;
        case State.Escape:
          this.handleEscape(byte);
          break;
        case State.EscapeIntermediate:
          this.handleEscapeIntermediate(byte);
          break;
        case State.CsiEntry:
          this.handleCsiEntry(byte);
          break;
        case State.CsiParam:
          this.handleCsiParam(byte);
          break;
        case State.CsiIntermediate:
          this.handleCsiIntermediate(byte);
          break;
        case State.CsiIgnore:
          this.handleCsiIgnore(byte);
          break;
        case State.OscString:
          this.handleOscString(byte);
          break;
        case State.DcsEntry:
          this.handleDcsEntry(byte);
          break;
        case State.DcsParam:
          this.handleDcsParam(byte);
          break;
        case State.DcsIntermediate:
          this.handleDcsIntermediate(byte);
          break;
        case State.DcsPassthrough:
          this.handleDcsPassthrough(byte);
          break;
        case State.DcsIgnore:
          this.handleDcsIgnore(byte);
          break;
        case State.SosPmApc:
          this.handleSosPmApc(byte);
          break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // State entry
  // -----------------------------------------------------------------------

  private enterState(state: State): void {
    this.state = state;
    switch (state) {
      case State.Escape:
        this.intermediates = '';
        break;
      case State.CsiEntry:
        this.params = [];
        this.currentParam = 0;
        this.hasParam = false;
        this.intermediates = '';
        break;
      case State.OscString:
        this.oscString = '';
        break;
      case State.DcsEntry:
        this.params = [];
        this.currentParam = 0;
        this.hasParam = false;
        this.intermediates = '';
        this.dcsData = '';
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Ground state
  // -----------------------------------------------------------------------

  private handleGround(byte: number): void {
    if (byte < 0x20) {
      // C0 controls
      this.executeHandler(byte);
    } else if (byte <= 0x7e) {
      // Printable ASCII
      this.printHandler(String.fromCharCode(byte));
    } else if (byte === 0x7f) {
      // DEL — ignore in ground state
    } else if (byte >= 0x80) {
      // High bytes — UTF-8 lead or C1 controls
      this.handleHighByte(byte);
    }
  }

  private handleHighByte(byte: number): void {
    // C1 control characters (8-bit versions)
    if (byte >= 0x80 && byte <= 0x9f) {
      switch (byte) {
        case 0x84: // IND
        case 0x85: // NEL
        case 0x88: // HTS
        case 0x8d: // RI
          this.executeHandler(byte);
          break;
        case 0x90: // DCS
          this.enterState(State.DcsEntry);
          break;
        case 0x9b: // CSI
          this.enterState(State.CsiEntry);
          break;
        case 0x9c: // ST
          break;
        case 0x9d: // OSC
          this.enterState(State.OscString);
          break;
        case 0x98: // SOS
        case 0x9e: // PM
        case 0x9f: // APC
          this.enterState(State.SosPmApc);
          break;
        default:
          // Ignore other C1 controls
          break;
      }
      return;
    }

    // UTF-8 multi-byte sequences
    if ((byte & 0xe0) === 0xc0) {
      // 2-byte sequence
      this.utf8Buf = [byte];
      this.utf8Remaining = 1;
    } else if ((byte & 0xf0) === 0xe0) {
      // 3-byte sequence
      this.utf8Buf = [byte];
      this.utf8Remaining = 2;
    } else if ((byte & 0xf8) === 0xf0) {
      // 4-byte sequence
      this.utf8Buf = [byte];
      this.utf8Remaining = 3;
    }
    // else: invalid byte, ignore
  }

  private decodeUtf8(bytes: number[]): string {
    if (bytes.length === 2) {
      const cp = ((bytes[0] & 0x1f) << 6) | (bytes[1] & 0x3f);
      return String.fromCodePoint(cp);
    } else if (bytes.length === 3) {
      const cp = ((bytes[0] & 0x0f) << 12) | ((bytes[1] & 0x3f) << 6) | (bytes[2] & 0x3f);
      return String.fromCodePoint(cp);
    } else if (bytes.length === 4) {
      const cp = ((bytes[0] & 0x07) << 18) | ((bytes[1] & 0x3f) << 12) |
                 ((bytes[2] & 0x3f) << 6) | (bytes[3] & 0x3f);
      return String.fromCodePoint(cp);
    }
    return '\ufffd'; // replacement character
  }

  // -----------------------------------------------------------------------
  // Escape state
  // -----------------------------------------------------------------------

  private handleEscape(byte: number): void {
    if (byte < 0x20) {
      // C0 in escape — execute immediately
      this.executeHandler(byte);
      return;
    }

    switch (byte) {
      case 0x5b: // '['
        this.enterState(State.CsiEntry);
        break;
      case 0x5d: // ']'
        this.enterState(State.OscString);
        break;
      case 0x50: // 'P'
        this.enterState(State.DcsEntry);
        break;
      case 0x58: // 'X' — SOS
      case 0x5e: // '^' — PM
      case 0x5f: // '_' — APC
        this.enterState(State.SosPmApc);
        break;
      case 0x5c: // '\' — String Terminator (ST = ESC \)
        // If we came from OscString, dispatch the OSC
        if (this.precedingState === State.OscString) {
          this.dispatchOsc();
          this.state = State.Ground;
          this.precedingState = State.Ground;
        } else if (this.precedingState === State.DcsPassthrough) {
          this.dcsHandler(this.params, this.intermediates, this.dcsData);
          this.state = State.Ground;
          this.precedingState = State.Ground;
        } else if (this.precedingState === State.SosPmApc || this.precedingState === State.DcsIgnore) {
          this.state = State.Ground;
          this.precedingState = State.Ground;
        } else {
          // Normal ESC \ dispatch
          this.escHandler(this.intermediates, '\\');
          this.state = State.Ground;
        }
        break;
      default:
        if (byte >= 0x20 && byte <= 0x2f) {
          // Intermediate bytes
          this.intermediates += String.fromCharCode(byte);
          this.state = State.EscapeIntermediate;
        } else if (byte >= 0x30 && byte <= 0x7e) {
          // Final byte — dispatch ESC sequence
          this.escHandler(this.intermediates, String.fromCharCode(byte));
          this.state = State.Ground;
        } else if (byte === 0x7f) {
          // DEL — ignore
        }
        this.precedingState = State.Ground;
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Escape Intermediate
  // -----------------------------------------------------------------------

  private handleEscapeIntermediate(byte: number): void {
    if (byte < 0x20) {
      this.executeHandler(byte);
    } else if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte);
    } else if (byte >= 0x30 && byte <= 0x7e) {
      this.escHandler(this.intermediates, String.fromCharCode(byte));
      this.state = State.Ground;
    } else if (byte === 0x7f) {
      // DEL — ignore
    }
  }

  // -----------------------------------------------------------------------
  // CSI states
  // -----------------------------------------------------------------------

  private handleCsiEntry(byte: number): void {
    if (byte < 0x20) {
      this.executeHandler(byte);
    } else if (byte >= 0x30 && byte <= 0x39) {
      // Digit — start parameter
      this.currentParam = byte - 0x30;
      this.hasParam = true;
      this.state = State.CsiParam;
    } else if (byte === 0x3b) {
      // Semicolon — empty first parameter (default)
      this.params.push(0);
      this.state = State.CsiParam;
    } else if (byte >= 0x3c && byte <= 0x3f) {
      // Private mode markers: ? > = !
      this.intermediates += String.fromCharCode(byte);
      this.state = State.CsiParam;
    } else if (byte >= 0x40 && byte <= 0x7e) {
      // Final byte — dispatch with no params
      this.csiHandler(this.params, this.intermediates, String.fromCharCode(byte));
      this.state = State.Ground;
    } else if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte);
      this.state = State.CsiIntermediate;
    } else if (byte === 0x7f) {
      // DEL — ignore
    }
  }

  private handleCsiParam(byte: number): void {
    if (byte < 0x20) {
      this.executeHandler(byte);
    } else if (byte >= 0x30 && byte <= 0x39) {
      // Digit — accumulate parameter
      this.currentParam = this.currentParam * 10 + (byte - 0x30);
      this.hasParam = true;
    } else if (byte === 0x3b) {
      // Semicolon — next parameter
      this.params.push(this.hasParam ? this.currentParam : 0);
      this.currentParam = 0;
      this.hasParam = false;
    } else if (byte === 0x3a) {
      // Colon — subparameter separator (used in SGR extended underline)
      // Encode as a separate value: use negative numbers to mark subparams
      this.params.push(this.hasParam ? this.currentParam : 0);
      this.currentParam = 0;
      this.hasParam = false;
      // Mark the next param as a subparam with a special sentinel
      this.params.push(-1); // -1 sentinel for colon separator
    } else if (byte >= 0x40 && byte <= 0x7e) {
      // Final byte — dispatch
      if (this.hasParam) this.params.push(this.currentParam);
      this.csiHandler(this.params, this.intermediates, String.fromCharCode(byte));
      this.state = State.Ground;
    } else if (byte >= 0x20 && byte <= 0x2f) {
      if (this.hasParam) this.params.push(this.currentParam);
      this.intermediates += String.fromCharCode(byte);
      this.state = State.CsiIntermediate;
    } else if (byte >= 0x3c && byte <= 0x3f) {
      // Invalid in param state — ignore sequence
      this.state = State.CsiIgnore;
    } else if (byte === 0x7f) {
      // DEL — ignore
    }
  }

  private handleCsiIntermediate(byte: number): void {
    if (byte < 0x20) {
      this.executeHandler(byte);
    } else if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte);
    } else if (byte >= 0x40 && byte <= 0x7e) {
      this.csiHandler(this.params, this.intermediates, String.fromCharCode(byte));
      this.state = State.Ground;
    } else if (byte >= 0x30 && byte <= 0x3f) {
      // Invalid — ignore rest of sequence
      this.state = State.CsiIgnore;
    } else if (byte === 0x7f) {
      // DEL — ignore
    }
  }

  private handleCsiIgnore(byte: number): void {
    if (byte < 0x20) {
      this.executeHandler(byte);
    } else if (byte >= 0x40 && byte <= 0x7e) {
      // Final byte — discard sequence and return to Ground
      this.state = State.Ground;
    }
    // Everything else is ignored
  }

  // -----------------------------------------------------------------------
  // OSC state
  // -----------------------------------------------------------------------

  private handleOscString(byte: number): void {
    if (byte === 0x07) {
      // BEL terminates OSC
      this.dispatchOsc();
      this.state = State.Ground;
    } else if (byte === 0x9c) {
      // ST (8-bit) terminates OSC
      this.dispatchOsc();
      this.state = State.Ground;
    } else if (byte >= 0x20 && byte <= 0x7e) {
      this.oscString += String.fromCharCode(byte);
    } else if (byte >= 0x80) {
      // UTF-8 in OSC string
      if ((byte & 0xe0) === 0xc0) {
        this.utf8Buf = [byte];
        this.utf8Remaining = 1;
      } else if ((byte & 0xf0) === 0xe0) {
        this.utf8Buf = [byte];
        this.utf8Remaining = 2;
      } else if ((byte & 0xf8) === 0xf0) {
        this.utf8Buf = [byte];
        this.utf8Remaining = 3;
      }
    }
    // Note: ESC in OSC is handled in the main loop (transitions to Escape state),
    // and the next byte '\' will dispatch ST via the ESC handler.
  }

  private dispatchOsc(): void {
    // Split OSC string by ';' — first part is the command number
    const parts = this.oscString.split(';');
    this.oscHandler(parts);
  }

  // -----------------------------------------------------------------------
  // DCS states
  // -----------------------------------------------------------------------

  private handleDcsEntry(byte: number): void {
    if (byte >= 0x30 && byte <= 0x39) {
      this.currentParam = byte - 0x30;
      this.hasParam = true;
      this.state = State.DcsParam;
    } else if (byte === 0x3b) {
      this.params.push(0);
      this.state = State.DcsParam;
    } else if (byte >= 0x3c && byte <= 0x3f) {
      this.intermediates += String.fromCharCode(byte);
      this.state = State.DcsParam;
    } else if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte);
      this.state = State.DcsIntermediate;
    } else if (byte >= 0x40 && byte <= 0x7e) {
      // Final byte — enter passthrough
      this.intermediates += String.fromCharCode(byte);
      this.state = State.DcsPassthrough;
    } else if (byte < 0x20) {
      this.executeHandler(byte);
    }
  }

  private handleDcsParam(byte: number): void {
    if (byte >= 0x30 && byte <= 0x39) {
      this.currentParam = this.currentParam * 10 + (byte - 0x30);
      this.hasParam = true;
    } else if (byte === 0x3b) {
      this.params.push(this.hasParam ? this.currentParam : 0);
      this.currentParam = 0;
      this.hasParam = false;
    } else if (byte >= 0x40 && byte <= 0x7e) {
      if (this.hasParam) this.params.push(this.currentParam);
      this.intermediates += String.fromCharCode(byte);
      this.state = State.DcsPassthrough;
    } else if (byte >= 0x20 && byte <= 0x2f) {
      if (this.hasParam) this.params.push(this.currentParam);
      this.intermediates += String.fromCharCode(byte);
      this.state = State.DcsIntermediate;
    } else if (byte === 0x3a) {
      this.state = State.DcsIgnore;
    } else if (byte < 0x20) {
      this.executeHandler(byte);
    }
  }

  private handleDcsIntermediate(byte: number): void {
    if (byte >= 0x20 && byte <= 0x2f) {
      this.intermediates += String.fromCharCode(byte);
    } else if (byte >= 0x40 && byte <= 0x7e) {
      this.intermediates += String.fromCharCode(byte);
      this.state = State.DcsPassthrough;
    } else if (byte >= 0x30 && byte <= 0x3f) {
      this.state = State.DcsIgnore;
    } else if (byte < 0x20) {
      this.executeHandler(byte);
    }
  }

  private handleDcsPassthrough(byte: number): void {
    if (byte === 0x9c) {
      // ST (8-bit)
      this.dcsHandler(this.params, this.intermediates, this.dcsData);
      this.state = State.Ground;
    } else if (byte >= 0x00 && byte <= 0x7e) {
      this.dcsData += String.fromCharCode(byte);
    }
    // ESC is handled in the main loop (anywhere transition)
  }

  private handleDcsIgnore(byte: number): void {
    if (byte === 0x9c) {
      this.state = State.Ground;
    }
    // Ignore everything until ST
  }

  // -----------------------------------------------------------------------
  // SOS/PM/APC state
  // -----------------------------------------------------------------------

  private handleSosPmApc(byte: number): void {
    if (byte === 0x9c) {
      this.state = State.Ground;
    }
    // Consume and ignore everything until ST
  }
}
