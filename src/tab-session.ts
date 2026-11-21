import type { Listing } from './contracts';

export interface TabSession { version: 1; paths: string[]; activeIndex: number }
export const maxSessionTabs = 1024;
export const tabSessionChannels = { load: 'tabs:load-session', save: 'tabs:save-session' };

export function sessionSnapshot(tabs: { id: number; listing?: Listing }[], active: number): TabSession | null {
  const loaded = tabs.filter(tab => tab.listing).slice(0, maxSessionTabs);
  if (!loaded.length) return null;
  return { version: 1, paths: loaded.map(tab => tab.listing!.path),
    activeIndex: Math.max(0, loaded.findIndex(tab => tab.id === active)) };
}

/** 先加载活动目录，再并发读取剩余目录；结果按原始索引排列。 */
export async function restoreTabSession(session: TabSession, list: (path: string) => Promise<Listing>) {
  const results = Array<Listing | undefined>(session.paths.length).fill(undefined);
  async function load(index: number) {
    try { results[index] = await list(session.paths[index]); } catch { /* 保留其他可用标签 */ }
  }
  await load(session.activeIndex);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, results.length) }, async () => {
    while (next < results.length) {
      const index = next++;
      if (index !== session.activeIndex) await load(index);
    }
  }));
  const tabs = results.flatMap((listing, index) => listing ? [{ index, listing }] : []);
  return { tabs, activeIndex: Math.max(0, tabs.findIndex(tab => tab.index === session.activeIndex)) };
}
