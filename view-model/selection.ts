/**
 * Selection model for the terminal.
 *
 * Supports click-drag line-based selection, double-click word selection,
 * and triple-click line selection.
 */

import { type SelectionRange } from '../core/emulator';

export type SelectionMode = 'char' | 'word' | 'line';

export interface SelectionState {
  active: boolean;
  mode: SelectionMode;
  anchor: { row: number; col: number } | null;
  current: { row: number; col: number } | null;
}

/**
 * Create a selection state for rendering.
 */
export function createSelectionState(): SelectionState {
  return {
    active: false,
    mode: 'char',
    anchor: null,
    current: null,
  };
}

/**
 * Compute the normalized selection range from anchor and current positions.
 */
export function computeSelectionRange(state: SelectionState): SelectionRange | null {
  if (!state.anchor || !state.current) return null;

  let startRow = state.anchor.row;
  let startCol = state.anchor.col;
  let endRow = state.current.row;
  let endCol = state.current.col;

  // Normalize so start is before end
  if (startRow > endRow || (startRow === endRow && startCol > endCol)) {
    [startRow, endRow] = [endRow, startRow];
    [startCol, endCol] = [endCol, startCol];
  }

  return { startRow, startCol, endRow, endCol };
}
