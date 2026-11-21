import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { restoreTabSession, sessionSnapshot } from '../src/tab-session.ts';
import { sessionStore } from '../src/session-store.ts';
import { absolute } from '../src/service.ts';

const listing = (path: string) => ({ path, parent: '', entries: [] });

test('快照保留重排、重复路径和活动标签，不保存未加载标签', async () => {
  const snapshot = sessionSnapshot([
    { id: 5, listing: listing('B') }, { id: 9 }, { id: 7, listing: listing('A') },
    { id: 8, listing: listing('B') },
  ], 8)!;
  assert.deepEqual(snapshot, { version: 1, paths: ['B', 'A', 'B'], activeIndex: 2 });
  const calls: string[] = [];
  const restored = await restoreTabSession(snapshot, async target => {
    calls.push(target);
    if (target === 'A') throw new Error('离线');
    return listing(target);
  });
  assert.equal(calls[0], 'B');
  assert.deepEqual(restored.tabs.map(tab => tab.index), [0, 2]);
  assert.equal(restored.activeIndex, 1);
  const fallback = await restoreTabSession({ ...snapshot, activeIndex: 1 }, async target => {
    if (target === 'A') throw new Error('离线');
    return listing(target);
  });
  assert.equal(fallback.activeIndex, 0);
  const empty = await restoreTabSession(snapshot, async () => { throw new Error('离线'); });
  assert.deepEqual(empty.tabs, []);
});

test('会话文件缺失或损坏时回退，退出刷盘保留最新快照', async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'dingdang-session-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'session.json');
  const store = sessionStore(file, absolute);
  assert.equal(await store.load(), null);
  await writeFile(file, '{');
  assert.equal(await store.load(), null);
  assert.throws(() => store.save({ version: 2, paths: [root], activeIndex: 0 }));
  assert.throws(() => store.save({ version: 1, paths: ['relative'], activeIndex: 0 }));
  assert.throws(() => store.save({ version: 1, paths: [root], activeIndex: 1 }));
  store.save({ version: 1, paths: [root, root], activeIndex: 0 });
  const flushing = store.flush();
  const latest = { version: 1, paths: [path.join(root, '目录'), root], activeIndex: 1 };
  store.save(latest);
  await flushing;
  assert.deepEqual(await sessionStore(file, absolute).load(), latest);
  assert.deepEqual(await readdir(root), ['session.json']);
  const idleFlush = store.flush();
  const afterClose = { version: 1, paths: [root], activeIndex: 0 };
  store.save(afterClose);
  await idleFlush;
  assert.deepEqual(await sessionStore(file, absolute).load(), afterClose);
});

test('替换失败不破坏已有目标，并清理临时文件', async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'dingdang-session-failure-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const previous = path.join(root, 'previous.json');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(previous);
  await writeFile(path.join(previous, 'keep'), 'previous');
  let errors = 0;
  const store = sessionStore(previous, absolute, () => { errors++; });
  store.save({ version: 1, paths: [root], activeIndex: 0 });
  await store.flush();
  assert.equal(errors, 1);
  assert.equal(await readFile(path.join(previous, 'keep'), 'utf8'), 'previous');
  assert.deepEqual(await readdir(root), ['previous.json']);
});
