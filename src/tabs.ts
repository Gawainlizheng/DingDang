import type { Listing } from './contracts';
import type { Column } from './sort';
import type { WebState } from './web-contract';

export type Navigation = 'push' | 'refresh' | 'background' | number;

export function beginNavigation(tab: FolderTab, request: number, mode: Navigation): FolderTab {
  return { ...tab, request, loading: mode !== 'background' };
}

export interface FolderTab {
  kind: 'folder';
  id: number;
  listing?: Listing;
  address: string;
  history: string[];
  cursor: number;
  selection: string[];
  anchor: string | null;
  column: Column;
  ascending: boolean;
  notice: string;
  request: number;
  loading: boolean;
}

export function folderTab(id: number, address = ''): FolderTab {
  return { kind: 'folder', id, address, history: [], cursor: -1, selection: [], anchor: null,
    column: 'name', ascending: true, notice: '', request: 0, loading: false };
}

export interface WebTab { kind: 'web'; id: number; address: string; state: WebState }
export type Tab = FolderTab | WebTab;
export function webTab(id: number, url: string): WebTab {
  return { kind: 'web', id, address: url, state: { url, title: '', loading: false, back: false, forward: false } };
}

/** 只接收仍存在的标签的最新响应；刷新不推进历史，也保留仍存在的选中项。 */
export function finishNavigation(tabs: FolderTab[], id: number, request: number,
  mode: Navigation, outcome: { listing: Listing } | { error: string }): FolderTab[] {
  return tabs.map(tab => {
    if (tab.id !== id || tab.request !== request) return tab;
    if (mode === 'background' && ('error' in outcome || outcome.listing.path !== tab.listing?.path)) return tab;
    if ('error' in outcome) return { ...tab, loading: false, notice: outcome.error };
    const { listing } = outcome;
    const push = mode === 'push' && listing.path !== tab.history[tab.cursor];
    const keep = (mode === 'refresh' || mode === 'background') && listing.path === tab.listing?.path;
    const available = keep ? new Set(listing.entries.map(entry => entry.path)) : new Set<string>();
    return { ...tab, listing, address: mode === 'background' ? tab.address : listing.path, loading: false,
      history: push ? [...tab.history.slice(0, tab.cursor + 1), listing.path] : tab.history,
      cursor: push ? tab.cursor + 1 : typeof mode === 'number' ? mode : tab.cursor,
      selection: tab.selection.filter(item => available.has(item)),
      anchor: tab.anchor && available.has(tab.anchor) ? tab.anchor : null };
  });
}

export function neighborAfterClose(tabs: { id: number }[], id: number): number | undefined {
  const index = tabs.findIndex(tab => tab.id === id);
  return index < 0 ? undefined : (tabs[index + 1] ?? tabs[index - 1])?.id;
}
/** 移动标签对象，不改写其中的路径、历史或选区。 */
export function moveTab<T extends { id: number }>(tabs: T[], id: number, index: number): T[] {
  const from = tabs.findIndex(tab => tab.id === id);
  if (from < 0 || index < 0 || index >= tabs.length || index === from) return tabs;
  const next = [...tabs];
  next.splice(index, 0, next.splice(from, 1)[0]);
  return next;
}
