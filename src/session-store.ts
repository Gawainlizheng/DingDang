import { open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { maxSessionTabs, type TabSession } from './tab-session.ts';

export function validateSession(input: unknown, absolute: (input: unknown) => string): TabSession {
  if (!input || typeof input !== 'object') throw new Error('无效的标签会话');
  const { version, paths, activeIndex } = input as TabSession;
  if (version !== 1 || !Array.isArray(paths) || !paths.length || paths.length > maxSessionTabs
      || !Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= paths.length) {
    throw new Error('无效的标签会话');
  }
  return { version, paths: Array.from(paths, target => absolute(target)), activeIndex };
}

/** 只写入最新排队快照；同目录替换失败时保留上一份正式文件。 */
export function sessionStore(file: string, absolute: (input: unknown) => string,
  onError: () => void = () => console.warn('[tabs] 无法保存标签会话')) {
  let saved: string | undefined;
  let queued: string | undefined;
  let writing: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;

  async function drain() {
    while (queued !== undefined) {
      const content = queued;
      queued = undefined;
      if (content === saved) continue;
      const temporary = file + '.' + randomUUID() + '.tmp';
      let created = false;
      try {
        const handle = await open(temporary, 'wx');
        created = true;
        try { await handle.writeFile(content); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, file);
        saved = content;
      } catch {
        if (created) await unlink(temporary).catch(() => {});
        onError();
      }
    }
  }

  function flush(): Promise<void> {
    clearTimeout(timer);
    writing ??= Promise.resolve().then(drain).finally(() => { writing = undefined; });
    return writing;
  }

  return {
    async load(): Promise<TabSession | null> {
      try {
        const snapshot = validateSession(JSON.parse(await readFile(file, 'utf8')), absolute);
        saved = JSON.stringify(snapshot);
        return snapshot;
      } catch { return null; }
    },
    save(input: unknown) {
      const content = JSON.stringify(validateSession(input, absolute));
      if (queued === content || (!writing && queued === undefined && saved === content)) return;
      queued = content;
      if (!writing) {
        clearTimeout(timer);
        timer = setTimeout(() => void flush(), 120);
      }
    },
    flush,
  };
}
