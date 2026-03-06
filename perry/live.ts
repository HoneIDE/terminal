/**
 * Live (PTY-backed) terminal marker module.
 *
 * Importing this triggers Perry to discover @honeide/terminal's FFI manifest
 * and link the platform-native terminal library. The exported constant is
 * unused at runtime — it only exists so Perry can track the import.
 */

// Sentinel that confirms the live terminal FFI is available.
export const TERMINAL_LIVE = 1 as const;
