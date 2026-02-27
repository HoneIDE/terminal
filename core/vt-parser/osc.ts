/**
 * OSC sequence handlers.
 *
 * Handles window title, palette colors, hyperlinks, clipboard access,
 * shell integration markers, and color queries.
 */

import { type ScreenBuffer } from '../buffer/screen-buffer';

// ---------------------------------------------------------------------------
// OSC events
// ---------------------------------------------------------------------------

export interface OscContext {
  buffer: ScreenBuffer;
  /** Write data back to the PTY (for query responses). */
  writeBack: (data: string) => void;
  /** Set window title. */
  onTitle?: (title: string) => void;
  /** Set icon name (rarely used). */
  onIconName?: (name: string) => void;
  /** Set current working directory (file:// URL). */
  onCwd?: (cwd: string) => void;
  /** Clipboard access. */
  onClipboard?: (selection: string, data: string | null) => void;
  /** Bell event. */
  onBell?: () => void;
  /** Shell integration markers (OSC 133). */
  onShellIntegration?: (type: string) => void;
  /** Palette color set. */
  onPaletteColor?: (index: number, color: string) => void;
  /** Default foreground/background/cursor color set. */
  onDefaultColor?: (which: 'fg' | 'bg' | 'cursor', color: string) => void;
}

/**
 * Dispatch an OSC sequence.
 *
 * @param params OSC string split by ';' — params[0] is the command number
 * @param ctx    Context providing callbacks
 */
export function dispatchOsc(params: string[], ctx: OscContext): void {
  if (params.length === 0) return;

  const cmd = parseInt(params[0], 10);
  if (isNaN(cmd)) return;

  switch (cmd) {
    case 0: // Set window title and icon name
      if (params.length > 1) {
        const title = params.slice(1).join(';');
        ctx.onTitle?.(title);
        ctx.onIconName?.(title);
      }
      break;

    case 1: // Set icon name
      if (params.length > 1) {
        ctx.onIconName?.(params.slice(1).join(';'));
      }
      break;

    case 2: // Set window title
      if (params.length > 1) {
        ctx.onTitle?.(params.slice(1).join(';'));
      }
      break;

    case 4: // Set palette color: OSC 4 ; index ; color ST
      if (params.length >= 3) {
        const index = parseInt(params[1], 10);
        const color = params[2];
        if (!isNaN(index) && index >= 0 && index <= 255) {
          ctx.onPaletteColor?.(index, color);
        }
      }
      break;

    case 7: // Set current working directory: OSC 7 ; file://host/path ST
      if (params.length > 1) {
        const url = params.slice(1).join(';');
        // Parse file:// URL to extract path
        try {
          const match = url.match(/^file:\/\/[^/]*(\/.*)/);
          if (match) {
            ctx.onCwd?.(decodeURIComponent(match[1]));
          } else {
            ctx.onCwd?.(url);
          }
        } catch {
          ctx.onCwd?.(url);
        }
      }
      break;

    case 8: // Hyperlink: OSC 8 ; params ; uri ST
      if (params.length >= 3) {
        const uri = params[2];
        if (uri === '') {
          // Close hyperlink
          ctx.buffer.cursorHyperlink = undefined;
        } else {
          ctx.buffer.cursorHyperlink = uri;
        }
      }
      break;

    case 10: // Set/query default foreground color
      if (params.length > 1) {
        const color = params[1];
        if (color === '?') {
          // Query — respond with current color (placeholder)
          ctx.writeBack('\x1b]10;rgb:ffff/ffff/ffff\x1b\\');
        } else {
          ctx.onDefaultColor?.('fg', color);
        }
      }
      break;

    case 11: // Set/query default background color
      if (params.length > 1) {
        const color = params[1];
        if (color === '?') {
          ctx.writeBack('\x1b]11;rgb:0000/0000/0000\x1b\\');
        } else {
          ctx.onDefaultColor?.('bg', color);
        }
      }
      break;

    case 12: // Set/query cursor color
      if (params.length > 1) {
        const color = params[1];
        if (color === '?') {
          ctx.writeBack('\x1b]12;rgb:ffff/ffff/ffff\x1b\\');
        } else {
          ctx.onDefaultColor?.('cursor', color);
        }
      }
      break;

    case 52: // Clipboard access: OSC 52 ; selection ; base64data ST
      if (params.length >= 3) {
        const selection = params[1]; // 'c' = clipboard, 'p' = primary, etc.
        const data = params[2];
        if (data === '?') {
          // Query clipboard — send back empty or clipboard contents
          ctx.onClipboard?.(selection, null);
        } else {
          // Set clipboard — decode base64
          try {
            const decoded = atob(data);
            ctx.onClipboard?.(selection, decoded);
          } catch {
            // Invalid base64 — ignore
          }
        }
      }
      break;

    case 133: // Shell integration: OSC 133 ; type ST
      if (params.length > 1) {
        ctx.onShellIntegration?.(params[1]);
      }
      break;

    case 1337: // iTerm2 proprietary sequences (future: inline images)
      // Stub — ignore for now
      break;
  }
}
