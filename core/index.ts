// Buffer
export {
  type Color,
  type CellAttributes,
  type TerminalCell,
  DEFAULT_COLOR,
  defaultCell,
  defaultAttrs,
  cloneAttrs,
  cloneCell,
  charWidth,
} from './buffer/cell';
export { TerminalLine } from './buffer/line';
export { ScreenBuffer } from './buffer/screen-buffer';
export { Scrollback, type SearchMatch } from './buffer/scrollback';

// VT Parser
export { VTParser } from './vt-parser/parser';
export { dispatchCsi, defaultModes, type TerminalModes, type CsiContext } from './vt-parser/csi';
export { dispatchOsc, type OscContext } from './vt-parser/osc';
export { dispatchDcs, type DcsContext } from './vt-parser/dcs';

// PTY
export { PTYManager, type PTY, type PTYOptions } from './pty/pty-manager';

// Input
export { encodeKey, encodePaste, type KeyEvent, type KeyEncoderOptions } from './input/key-encoder';
export {
  encodeMouse,
  type MouseEvent as TerminalMouseEvent,
  type MouseButton,
  type MouseAction,
  type MouseTrackingState,
} from './input/mouse-encoder';

// Emulator
export {
  TerminalEmulator,
  type TerminalOptions,
  type SearchOptions,
  type SearchResult,
  type Position,
  type SelectionRange,
} from './emulator';
