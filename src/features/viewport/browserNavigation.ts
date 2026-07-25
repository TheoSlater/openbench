const LOCAL_TARGET = /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#].*)?$/i;
const DOMAIN_TARGET = /^[^\s/]+\.[^\s/]+(?:[/?#].*)?$/i;

export function resolveBrowserInput(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (LOCAL_TARGET.test(value)) return `http://${value}`;
  if (DOMAIN_TARGET.test(value)) return `https://${value}`;
  return `https://www.google.com/search?${new URLSearchParams({ q: value })}`;
}

export type BrowserHistoryState = {
  entries: string[];
  index: number;
};

export function pushBrowserHistory(state: BrowserHistoryState, url: string): BrowserHistoryState {
  if (state.entries[state.index] === url) return state;
  const entries = [...state.entries.slice(0, state.index + 1), url];
  return { entries, index: entries.length - 1 };
}

export function moveBrowserHistory(
  state: BrowserHistoryState,
  delta: -1 | 1,
): { state: BrowserHistoryState; url: string | null } {
  const index = state.index + delta;
  if (index < 0 || index >= state.entries.length) return { state, url: null };
  return { state: { ...state, index }, url: state.entries[index] };
}
