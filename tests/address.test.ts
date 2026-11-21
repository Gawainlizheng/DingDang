import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyAddress, httpsUrl } from '../src/address.ts';
import { searchUrl } from '../src/search-engine.ts';

test('地址栏先识别盘符路径，然后识别 HTTPS 和裸域名', () => {
  assert.deepEqual(classifyAddress('D:\\项目\\资料'), { kind: 'folder', value: 'D:\\项目\\资料' });
  assert.equal(classifyAddress('C:/').kind, 'folder');
  assert.deepEqual(classifyAddress('example.com/docs'), { kind: 'web', value: 'https://example.com/docs' });
  assert.deepEqual(classifyAddress('https://example.com'), { kind: 'web', value: 'https://example.com/' });
  assert.equal(classifyAddress(' ').kind, 'empty');
  for (const address of ['C:资料', './资料', '//example.com', 'D:\\资料:文件', 'http://example.com',
    'https://', 'https:///example.com', 'https://user:pass@example.com', 'file:///C:/', 'javascript:alert(1)',
    'https:example.com', 'example..com', 'https://example..com', 'https://example.com\\foo']) {
    assert.equal(classifyAddress(address).kind, 'invalid', address);
  }
  assert.equal(httpsUrl('http://example.com'), undefined);
});

test('普通文字只分类为搜索候选，明确构造搜索时正确编码查询', () => {
  assert.deepEqual(classifyAddress('Photoshop 教程'), { kind: 'search', value: 'Photoshop 教程' });
  const url = new URL(searchUrl('Photoshop 教程 & 相册'));
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.searchParams.get('q'), 'Photoshop 教程 & 相册');
  assert.equal([...url.searchParams].length, 1);
});
