/**
 * Perry component API for @honeide/terminal.
 *
 * Import this from Perry apps:
 *   import { Terminal } from '@honeide/terminal/perry';
 */

export { Terminal, type TerminalComponentOptions } from './terminal-component';
export { type NativeTerminalFFI, NoOpFFI } from '../native/ffi-bridge';
