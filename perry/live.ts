/**
 * LiveTerminal FFI declarations for Perry.
 * Import this module to trigger Perry's package.json FFI discovery.
 */

// FFI declarations resolved by Perry codegen from package.json manifest
declare function hone_terminal_open(rows: number, cols: number, shell: number, cwd: number): number;
declare function hone_terminal_nsview(handle: number): number;
declare function hone_terminal_poll(handle: number): number;
declare function hone_terminal_write(handle: number, data: number): number;
declare function hone_terminal_resize(handle: number, rows: number, cols: number): number;
declare function hone_terminal_close(handle: number): number;

// Re-export so Perry includes this module
export const TERMINAL_LIVE = 1;
