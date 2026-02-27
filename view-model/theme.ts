/**
 * Terminal color theme.
 *
 * Defines the 16 ANSI palette colors plus UI colors for foreground,
 * background, cursor, and selection.
 */

export interface TerminalTheme {
  /** 16 ANSI palette colors (indices 0-15). */
  palette: [
    string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string,
  ];
  foreground: string;
  background: string;
  cursor: string;
  cursorAccent: string;
  selection: string;
  selectionForeground?: string;
  /** Optional overrides for 256-color palette indices 16-255. */
  extendedPalette?: Map<number, string>;
}

/** Default dark terminal theme (based on common terminal defaults). */
export const DARK_THEME: TerminalTheme = {
  palette: [
    '#1d1f21', // 0: Black
    '#cc6666', // 1: Red
    '#b5bd68', // 2: Green
    '#f0c674', // 3: Yellow
    '#81a2be', // 4: Blue
    '#b294bb', // 5: Magenta
    '#8abeb7', // 6: Cyan
    '#c5c8c6', // 7: White
    '#969896', // 8: Bright Black
    '#de935f', // 9: Bright Red
    '#a3be8c', // 10: Bright Green
    '#ebcb8b', // 11: Bright Yellow
    '#88c0d0', // 12: Bright Blue
    '#b48ead', // 13: Bright Magenta
    '#93e0d5', // 14: Bright Cyan
    '#eceff4', // 15: Bright White
  ],
  foreground: '#c5c8c6',
  background: '#1d1f21',
  cursor: '#c5c8c6',
  cursorAccent: '#1d1f21',
  selection: 'rgba(255, 255, 255, 0.2)',
};

/** Light terminal theme. */
export const LIGHT_THEME: TerminalTheme = {
  palette: [
    '#000000', // 0: Black
    '#c91b00', // 1: Red
    '#00c200', // 2: Green
    '#c7c400', // 3: Yellow
    '#0225c7', // 4: Blue
    '#ca30c7', // 5: Magenta
    '#00c5c7', // 6: Cyan
    '#c7c7c7', // 7: White
    '#686868', // 8: Bright Black
    '#ff6e67', // 9: Bright Red
    '#5ffa68', // 10: Bright Green
    '#fffc67', // 11: Bright Yellow
    '#6871ff', // 12: Bright Blue
    '#ff77ff', // 13: Bright Magenta
    '#60fdff', // 14: Bright Cyan
    '#ffffff', // 15: Bright White
  ],
  foreground: '#000000',
  background: '#ffffff',
  cursor: '#000000',
  cursorAccent: '#ffffff',
  selection: 'rgba(0, 0, 0, 0.15)',
};

/**
 * Resolve an indexed color (0-255) to a hex string using the theme.
 */
export function resolveIndexedColor(index: number, theme: TerminalTheme): string {
  // ANSI 16 colors
  if (index < 16) {
    return theme.palette[index];
  }

  // Check extended palette overrides
  if (theme.extendedPalette?.has(index)) {
    return theme.extendedPalette.get(index)!;
  }

  // 6x6x6 color cube (indices 16-231)
  if (index < 232) {
    const cubeIndex = index - 16;
    const r = Math.floor(cubeIndex / 36);
    const g = Math.floor((cubeIndex % 36) / 6);
    const b = cubeIndex % 6;
    const toHex = (v: number) => {
      const val = v === 0 ? 0 : 55 + v * 40;
      return val.toString(16).padStart(2, '0');
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Grayscale ramp (indices 232-255)
  const gray = 8 + (index - 232) * 10;
  const hex = gray.toString(16).padStart(2, '0');
  return `#${hex}${hex}${hex}`;
}
