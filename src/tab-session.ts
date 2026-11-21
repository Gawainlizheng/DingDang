import type { Listing } from './contracts';
import type { Tab } from './tabs';

export type SessionEntry = { kind: 'folder'; path: string } | { kind: 'web'; url: string };
export interface TabSession { version: 2; entries: SessionEntry[]; activeIndex: number }
export const maxSessionTabs = 1024;
export const tabSessionChannels = { load: 'tabs:load-session', save: 'tabs:save-session' };

export function sessionSnapshot(tabs: Tab[], active: number): TabSession | null {
  const loaded = tabs.flatMap<{ id: number; entry: SessionEntry }>(tab => {
    if (tab.kind === 'web') return [{ id: tab.id, entry: { kind: 'web', url: tab.state.url } }];
    return tab.listing ? [{ id: tab.id, entry: { kind: 'folder', path: tab.listing.path } }] : [];
  }).slice(0, maxSessionTabs);
  if (!loaded.length) return null;
  return { version: 2, entries: loaded.map(tab => tab.entry),
    activeIndex: Math.max(0, loaded.findIndex(tab => tab.id === active)) };
}

/** 文件夹并发恢复并保持原序，网页只恢复地址，不在这里联网。 */
export async function restoreTabSession(session: TabSession, list: (path: string) => Promise<Listing>) {
  type Restored = { kind: 'folder'; listing: Listing } | { kind: 'web'; url: string };
  const results = Array<Restored | undefined>(session.entries.length).fill(undefined);
  async function load(index: number) {
    const entry = session.entries[index];
    if (entry.kind === 'web') { results[index] = entry; return; }
    try { results[index] = { kind: 'folder', listing: await list(entry.path) }; } catch { /* 保留其他可用标签 */ }
  }
  await load(session.activeIndex);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, results.length) }, async () => {
    while (next < results.length) {
      const index = next++;
      if (index !== session.activeIndex) await load(index);
    }
  }));
  const tabs = results.flatMap((item, index) => item ? [{ index, ...item }] : []);
  return { tabs, activeIndex: Math.max(0, tabs.findIndex(tab => tab.index === session.activeIndex)) };
}
