import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Entry } from '../src/contracts';
import { absolute, nameOf } from '../src/service.ts';
import { zipMenu } from '../src/zip-menu.ts';
import { zipOperations } from '../src/zip.ts';

const zip = zipOperations(absolute, nameOf);

async function fixture(context: TestContext) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'dingdang-zip-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('右键 ZIP 入口区分空白、单选大写扩展名、混选和链接', () => {
  const file: Entry = { path: 'a', name: '资料.ZIP', kind: 'file', modified: null, size: 1, type: 'ZIP' };
  const folder: Entry = { ...file, path: 'b', name: '目录', kind: 'folder' };
  const link: Entry = { ...file, path: 'c', kind: 'link' };
  const entries = [file, folder, link];
  assert.deepEqual(zipMenu(entries, ['a']), { archiveName: '资料.ZIP.zip', extractPath: 'a' });
  assert.deepEqual(zipMenu(entries, ['a', 'b']), { archiveName: '归档.zip', extractPath: undefined });
  assert.equal(zipMenu(entries, ['b']).archiveName, '目录.zip');
  assert.equal(zipMenu(entries, ['c']).archiveName, undefined);
  assert.equal(zipMenu(entries, []).extractPath, undefined);
});

test('单文件、单文件夹和混选可往返，保留中文文件与空目录且不覆盖', async context => {
  const root = await fixture(context);
  const folder = path.join(root, '目录');
  const file = path.join(root, '中文.txt');
  await fs.mkdir(path.join(folder, '空目录'), { recursive: true });
  await fs.writeFile(file, '内容');
  for (const [name, sources] of [['单文件', [file]], ['单目录', [folder]], ['资料', [file, folder]]] as const) {
    const archive = path.join(root, name + '.ZIP');
    await zip.createZip([...sources], name + '.ZIP');
    const before = await fs.readFile(archive);
    await assert.rejects(zip.createZip([...sources], name + '.ZIP'), /同名/);
    assert.deepEqual(await fs.readFile(archive), before);
    await zip.extractZip(archive);
    const output = path.join(root, name);
    if (sources.includes(file)) assert.equal(await fs.readFile(path.join(output, '中文.txt'), 'utf8'), '内容');
    if (sources.includes(folder)) assert.deepEqual(await fs.readdir(path.join(output, '目录', '空目录')), []);
    await assert.rejects(zip.extractZip(archive), /同名/);
  }
  assert.equal(await fs.readFile(file, 'utf8'), '内容');
});

test('拒绝越界、加密、无效 CRC、损坏格式和展开超限，清理输出', async context => {
  const root = await fixture(context);
  const file = path.join(root, 'abcde');
  const archive = path.join(root, 'bad.zip');
  await fs.writeFile(file, 'content');
  await zip.createZip([file], 'bad');
  const original = await fs.readFile(archive);
  const central = original.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central > 0);
  for (const [edit, expected] of [
    [(data: Buffer) => data.write('../xy', central + 46), /解压失败/],
    [(data: Buffer) => data[central + 8] |= 1, /加密/],
    [(data: Buffer) => data.writeUInt32LE(0, central + 16), /完整性/],
    [(data: Buffer) => data.fill(0), /解压失败/],
  ] as const) {
    const invalid = Buffer.from(original);
    edit(invalid);
    await fs.writeFile(archive, invalid);
    await assert.rejects(zip.extractZip(archive), expected);
    assert.deepEqual((await fs.readdir(root)).sort(), ['abcde', 'bad.zip']);
  }
  await fs.writeFile(archive, original);
  await assert.rejects(zipOperations(absolute, nameOf, { entries: 2, bytes: 3 }).extractZip(archive), /上限/);
  assert.deepEqual((await fs.readdir(root)).sort(), ['abcde', 'bad.zip']);
});
