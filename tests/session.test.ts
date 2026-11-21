import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { restoreTabSession, sessionSnapshot } from '../src/tab-session.ts';
import { sessionStore } from '../src/session-store.ts';
import { absolute } from '../src/service.ts';
import { folderTab, webTab } from '../src/tabs.ts';

const listing = (path: string) => ({ path, parent: '', entries: [] });

test('快照保留重排、重复路径和活动标签，不保存未加载标签', async () => {
  const snapshot = sessionSnapshot([
    { ...folderTab(5), listing: listing('B') }, folderTab(9), { ...folderTab(7), listing: listing('A') },
    { ...folderTab(8), listing: listing('B') },
  ], 8)!;
  assert.deepEqual(snapshot, { version: 2, entries: ['B', 'A', 'B'].map(path => ({ kind: 'folder', path })), activeIndex: 2 });
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
  assert.throws(() => store.save({ version: 3, paths: [root], activeIndex: 0 }));
  assert.throws(() => store.save({ version: 1, paths: ['relative'], activeIndex: 0 }));
  assert.throws(() => store.save({ version: 1, paths: [root], activeIndex: 1 }));
  store.save({ version: 1, paths: [root, root], activeIndex: 0 });
  const flushing = store.flush();
  const latest = { version: 2, entries: [{ kind: 'folder', path: path.join(root, '目录') },
    { kind: 'folder', path: root }], activeIndex: 1 };
  store.save(latest);
  await flushing;
  assert.deepEqual(await sessionStore(file, absolute).load(), latest);
  assert.deepEqual(await readdir(root), ['session.json']);
  const idleFlush = store.flush();
  const afterClose = { version: 2, entries: [{ kind: 'folder', path: root }], activeIndex: 0 };
  store.save(afterClose);
  await idleFlush;
  assert.deepEqual(await sessionStore(file, absolute).load(), afterClose);
});

test('读取旧会话并迁移；网页还原保留顺序但不会发起目录或网络读取', async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'dingdang-mixed-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'session.json');
  await writeFile(file, JSON.stringify({ version: 1, paths: [root], activeIndex: 0 }));
  const store = sessionStore(file, absolute);
  const legacy = await store.load();
  assert.deepEqual(legacy, { version: 2, entries: [{ kind: 'folder', path: root }], activeIndex: 0 });
  store.save(legacy);
  await store.flush();
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), legacy);
  const snapshot = sessionSnapshot([webTab(1, 'https://example.com/'),
    { ...folderTab(2), listing: listing(root) }, webTab(3, 'https://example.org/')], 3)!;
  store.save(snapshot);
  await store.flush();
  assert.deepEqual(await store.load(), snapshot);
  assert.throws(() => store.save({ ...snapshot, entries: [{ kind: 'web', url: 'file:///C:/users' }], activeIndex: 0 }));
  const result = await restoreTabSession(snapshot, async target => {
    assert.equal(target, root);
    throw new Error('目录已失效');
  });
  assert.deepEqual(result.tabs.map(item => item.index), [0, 2]);
  assert.equal(result.activeIndex, 1);
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
