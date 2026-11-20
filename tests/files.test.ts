import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Entry } from '../src/contracts';
import { absolute, fileService, moveAcrossVolumes, nameOf } from '../src/service.ts';
import { sortEntries } from '../src/sort.ts';

test('Windows 路径和名称拒绝设备路径、盘符相对路径和备用数据流', () => {
  assert.equal(absolute('C:/Docs/中文.txt', true), 'C:\\Docs\\中文.txt');
  for (const input of ['C:Docs', 'https://example.com', '//?/C:/Docs', 'C:/Docs/file:stream', 'C:/Docs/NUL.txt', 'C:/Docs/名称.']) {
    assert.throws(() => absolute(input, true));
  }
  for (const input of ['..', 'a/b', 'CON.txt', 'x.']) assert.throws(() => nameOf(input));
});

test('排序保留文件夹优先，使用自然数字顺序，不修改原数组', () => {
  const entry = (name: string, kind: Entry['kind'], size: number): Entry =>
    ({ name, kind, size, path: name, type: kind, modified: size });
  const entries = [entry('文件10', 'file', 12), entry('文件2', 'file', 2), entry('目录', 'folder', 0)];
  assert.deepEqual(sortEntries(entries, 'name', true).map(item => item.name), ['目录', '文件2', '文件10']);
  assert.deepEqual(sortEntries(entries, 'size', false).map(item => item.name), ['目录', '文件10', '文件2']);
  assert.equal(entries[0].name, '文件10');
});

test('临时目录：复制、逐项冲突、重命名、移动、回收失败', async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'dingdang-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const service = fileService({ places: async () => [], openItem: async () => {},
    trash: async () => { throw new Error('回收站不可用'); }, move: rename });
  const source = path.join(root, '源');
  const target = path.join(root, '目标');
  await service.createFolder(root, '源');
  await service.createFolder(root, '目标');
  const first = path.join(source, '一.txt');
  const second = path.join(source, '二.txt');
  await writeFile(first, 'one');
  await writeFile(second, 'two');
  await writeFile(path.join(target, '一.txt'), 'keep');
  const copied = await service.copyItems([first, second], target);
  assert.deepEqual(copied.map(item => item.ok), [false, true]);
  assert.match(copied[0].error!, /同名/);
  assert.equal(await readFile(path.join(target, '一.txt'), 'utf8'), 'keep');
  assert.equal(await readFile(path.join(target, '二.txt'), 'utf8'), 'two');
  await service.renameItem(first, '改名.txt');
  const renamed = path.join(source, '改名.txt');
  assert.equal((await service.moveItems([renamed], target))[0].ok, true);
  await assert.rejects(readFile(renamed), { code: 'ENOENT' });
  const moved = path.join(target, '改名.txt');
  assert.equal((await service.trashItems([moved]))[0].error, '回收站不可用');
  assert.equal(await readFile(moved, 'utf8'), 'one');
  assert.equal((await service.copyItems([target], target))[0].ok, false);
});

test('模拟跨盘回退：冲突保留源，成功后才移除源', async context => {
  const root = await mkdtemp(path.join(tmpdir(), 'dingdang-cross-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const existing = path.join(root, 'existing');
  const target = path.join(root, 'target');
  await mkdir(source);
  await mkdir(existing);
  await writeFile(path.join(source, 'data.txt'), 'content');
  await assert.rejects(moveAcrossVolumes(source, existing), { code: 'EEXIST' });
  assert.equal(await readFile(path.join(source, 'data.txt'), 'utf8'), 'content');
  await moveAcrossVolumes(source, target);
  assert.equal(await readFile(path.join(target, 'data.txt'), 'utf8'), 'content');
  await assert.rejects(readFile(path.join(source, 'data.txt')), { code: 'ENOENT' });
});
