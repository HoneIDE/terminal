/**
 * Search state for the terminal view.
 *
 * Tracks the current search query, results, and active match index
 * for rendering highlights.
 */

import { type SearchResult } from '../core/emulator';

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  results: SearchResult[];
  activeIndex: number;
  visible: boolean;
}

export function createSearchState(): SearchState {
  return {
    query: '',
    caseSensitive: false,
    results: [],
    activeIndex: -1,
    visible: false,
  };
}

/**
 * Get the active search match (the one currently highlighted / scrolled to).
 */
export function getActiveMatch(state: SearchState): SearchResult | null {
  if (state.activeIndex < 0 || state.activeIndex >= state.results.length) {
    return null;
  }
  return state.results[state.activeIndex];
}
