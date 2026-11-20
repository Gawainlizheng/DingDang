import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finishNavigation, folderTab, moveTab, neighborAfterClose, type FolderTab, type Navigation } from '../src/tabs.ts';

function visit(tabs: FolderTab[], id: number, path: string, mode: Navigation = 'push') {
  const requested = tabs.map(tab => tab.id === id ? { ...tab, request: tab.request + 1 } : tab);
  return finishNavigation(requested, id, requested.find(tab => tab.id === id)!.request,
    mode, { listing: { path, parent: '/', entries: [] } });
}

test('标签各自保留历史，从后退位置打开新目录时截断前进历史', () => {
  let tabs = [folderTab(1), folderTab(2)];
  tabs = visit(tabs, 1, '/first');
  tabs = visit(tabs, 1, '/second');
  tabs = visit(tabs, 2, '/other');
  tabs = visit(tabs, 1, '/first', 0);
  tabs = visit(tabs, 1, '/third');
  assert.deepEqual(tabs.map(tab => tab.history), [['/first', '/third'], ['/other']]);
  assert.deepEqual(tabs.map(tab => tab.cursor), [1, 0]);
});

test('关闭优先选择右侧，否则选择左侧；最后一个没有邻居', () => {
  const tabs = [folderTab(1), folderTab(2), folderTab(3)];
  assert.equal(neighborAfterClose(tabs, 2), 3);
  assert.equal(neighborAfterClose(tabs, 3), 2);
  assert.equal(neighborAfterClose([tabs[0]], 1), undefined);
});

test('旧请求和已关闭标签的响应不能改变任何标签', () => {
  const tab = { ...folderTab(4), request: 3, loading: true };
  const listing = { path: '/stale', parent: '/', entries: [] };
  assert.equal(finishNavigation([tab], 4, 2, 'push', { listing })[0], tab);
  assert.equal(finishNavigation([tab], 3, 3, 'push', { listing })[0], tab);
  assert.equal(finishNavigation([tab], 4, 3, 'push', { listing })[0].listing, listing);
});
test('标签可双向重排，原位不变，路径与历史仍属于原对象', () => {
  const original = visit([folderTab(1), folderTab(2), folderTab(3)], 1, '/first');
  const moved = moveTab(original, 1, 2);
  assert.deepEqual(moved.map(tab => tab.id), [2, 3, 1]);
  assert.equal(moved[2], original[0]);
  assert.deepEqual(moveTab(moved, 1, 0), original);
  assert.equal(moveTab(moved, 1, 2), moved);
});
