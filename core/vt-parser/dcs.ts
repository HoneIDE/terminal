/**
 * DCS sequence handlers.
 *
 * Handles DECRQSS (Request Selection or Setting) and SIXEL stub.
 */

import { type ScreenBuffer } from '../buffer/screen-buffer';

export interface DcsContext {
  buffer: ScreenBuffer;
  /** Write data back to the PTY (for DECRQSS responses). */
  writeBack: (data: string) => void;
}

/**
 * Dispatch a DCS sequence.
 *
 * @param params       Numeric parameters
 * @param intermediates Intermediate bytes (e.g., '$' for DECRQSS)
 * @param data         Passthrough data
 * @param ctx          Context for write-back
 */
export function dispatchDcs(
  params: number[],
  intermediates: string,
  data: string,
  ctx: DcsContext,
): void {
  // DECRQSS: DCS $ q <data> ST
  if (intermediates.includes('$') && intermediates.includes('q')) {
    handleDecrqss(data, ctx);
    return;
  }

  // SIXEL: DCS q <data> ST — stub, ignore pixel data
  if (intermediates.endsWith('q') && !intermediates.includes('$')) {
    // SIXEL graphics — parse header but discard pixel data
    // This prevents the parser from breaking on SIXEL input
    return;
  }
}

function handleDecrqss(data: string, ctx: DcsContext): void {
  // data is the "setting" being queried
  const trimmed = data.trim();

  switch (trimmed) {
    case 'm': // Query current SGR
    {
      // Respond with current SGR attributes
      // DCS 1 $ r <SGR params> m ST
      // For simplicity, respond with SGR 0 (default)
      const buf = ctx.buffer;
      const parts: number[] = [];

      if (buf.cursorAttrs.bold) parts.push(1);
      if (buf.cursorAttrs.dim) parts.push(2);
      if (buf.cursorAttrs.italic) parts.push(3);
      if (buf.cursorAttrs.underline) parts.push(4);
      if (buf.cursorAttrs.blink) parts.push(5);
      if (buf.cursorAttrs.inverse) parts.push(7);
      if (buf.cursorAttrs.invisible) parts.push(8);
      if (buf.cursorAttrs.strikethrough) parts.push(9);

      // Foreground
      if (buf.cursorFg.type === 'indexed') {
        if (buf.cursorFg.index < 8) parts.push(30 + buf.cursorFg.index);
        else if (buf.cursorFg.index < 16) parts.push(90 + buf.cursorFg.index - 8);
        else parts.push(38, 5, buf.cursorFg.index);
      } else if (buf.cursorFg.type === 'rgb') {
        parts.push(38, 2, buf.cursorFg.r, buf.cursorFg.g, buf.cursorFg.b);
      }

      // Background
      if (buf.cursorBg.type === 'indexed') {
        if (buf.cursorBg.index < 8) parts.push(40 + buf.cursorBg.index);
        else if (buf.cursorBg.index < 16) parts.push(100 + buf.cursorBg.index - 8);
        else parts.push(48, 5, buf.cursorBg.index);
      } else if (buf.cursorBg.type === 'rgb') {
        parts.push(48, 2, buf.cursorBg.r, buf.cursorBg.g, buf.cursorBg.b);
      }

      const sgrStr = parts.length > 0 ? parts.join(';') : '0';
      ctx.writeBack(`\x1bP1$r${sgrStr}m\x1b\\`);
      break;
    }

    case 'r': // Query scroll region (DECSTBM)
    {
      const buf = ctx.buffer;
      ctx.writeBack(`\x1bP1$r${buf.scrollTop + 1};${buf.scrollBottom + 1}r\x1b\\`);
      break;
    }

    default:
      // Unknown query — respond with invalid
      ctx.writeBack(`\x1bP0$r\x1b\\`);
      break;
  }
}
