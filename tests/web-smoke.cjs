const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { app, BrowserWindow, session } = require('electron');

const profile = fs.mkdtempSync(path.join(tmpdir(), 'dingdang-web-smoke-'));
const sessionFile = path.join(profile, 'tab-session.json');
fs.writeFileSync(sessionFile, JSON.stringify({ version: 1, paths: [tmpdir()], activeIndex: 0 }));
app.setPath('userData', profile);
const requests = [];
const home = 'https://dingdang.test/';
const html = `<!doctype html><title>测试首页</title><style>body{margin:12px}a{display:block;width:180px;height:35px}</style>
  <a href="/redirect" id="same">当前标签</a><a href="/new" target="_blank" id="new">前台标签</a>
  <a href="/background" id="background">后台标签</a><a href="/unsafe" id="unsafe">非 HTTPS 跳转</a>`;
app.whenReady().then(() => {
  session.fromPartition('dingdang-web').protocol.handle('https', request => {
    const url = new URL(request.url);
    requests.push(url.pathname);
    if (url.pathname === '/redirect') return Response.redirect(home + 'next');
    if (url.pathname === '/unsafe') return Response.redirect('http://dingdang.test/');
    return new Response(url.pathname === '/' ? html : `<title>${url.pathname}</title><p>测试</p>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
});
require('../dist/main.cjs');

async function wait(check) {
  for (let index = 0; index < 160; index++) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      if (!/destroyed/i.test(String(error))) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error('等待条件超时：' + check);
}

async function run() {
  const owner = await wait(() => BrowserWindow.getAllWindows()[0]);
  const ui = code => owner.webContents.executeJavaScript(code);
  const input = value => ui(`(() => {
    const input = document.querySelector('[aria-label="地址栏"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
  const enter = () => ui('document.querySelector(".navigation form").requestSubmit()');
  const view = () => owner.contentView.children.find(child => child.webContents && child.webContents !== owner.webContents);
  async function guestAt(url) {
    return wait(() => {
      const content = view()?.webContents;
      return content && content.getURL() === url && !content.isLoading() ? content : undefined;
    });
  }
  async function click(content, id, button = 'left') {
    const point = await content.executeJavaScript(`(() => {
      const {left,top,width,height} = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      return {x: Math.round(left + width / 2), y: Math.round(top + height / 2)};
    })()`);
    owner.focus();
    content.focus();
    content.sendInputEvent({ type: 'mouseDown', button, ...point, clickCount: 1 });
    content.sendInputEvent({ type: 'mouseUp', button, ...point, clickCount: 1 });
  }
  await wait(() => ui('document.querySelector("footer")?.textContent.includes("本地文件") && !!document.querySelector("[aria-label=地址栏]").value'));
  await input('a search phrase');
  await wait(() => ui('!!document.querySelector(".searchAction")'));
  await enter();
  assert.equal(view(), undefined);
  assert.deepEqual(requests, []);
  await input('dingdang.test');
  await enter();
  const guest = await guestAt(home);
  assert.equal(await guest.executeJavaScript('typeof window.files + " " + typeof require + " " + typeof window.webTabs'), 'undefined undefined undefined');
  const bounds = view().getBounds();
  assert.ok(bounds.y > 0 && bounds.height > 0);
  const [width, height] = owner.getSize();
  owner.unmaximize();
  owner.restore();
  owner.show();
  owner.setSize(width > 820 ? width - 60 : width + 60, height);
  await wait(() => owner.getSize()[0] !== width);
  await wait(() => {
    const actual = view()?.getBounds().width;
    return actual !== undefined && actual !== bounds.width
      && Math.abs(actual - owner.getContentBounds().width) <= 1;
  });
  await guest.executeJavaScript('window.open("/popup"); document.querySelector("#new").click(); void 0');
  await click(guest, 'background', 'middle');
  await wait(() => ui('document.querySelectorAll("[role=tab]").length === 3'));
  assert.deepEqual(requests, ['/']);
  await click(guest, 'new');
  await guestAt(home + 'new');
  await ui('document.querySelectorAll("[role=tab]")[1].click()');
  await guestAt(home);
  await click(guest, 'same');
  await guestAt(home + 'next');
  await wait(() => ui(`document.querySelector('[aria-label="地址栏"]').value === '${home}next'`));
  await ui('document.querySelector("[aria-label=后退]").click()');
  await guestAt(home);
  await click(guest, 'unsafe');
  await wait(() => ui('document.querySelector(".webError")?.textContent.includes("非 HTTPS")'));
  await ui('document.querySelectorAll("[role=tab]")[0].click()');
  await wait(() => !view());
  assert.ok(!requests.includes('/popup') && !requests.includes('/background'));
  const snapshot = await wait(() => {
    const saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    return saved.version === 2 && saved.entries.length === 4 && saved.activeIndex === 0 ? saved : undefined;
  });
  assert.deepEqual(snapshot.entries.map(item => item.kind), ['folder', 'web', 'web', 'web']);
  assert.equal(snapshot.entries[2].url, home + 'background');
  console.log('Windows Electron 网页视图烟雾测试通过');
}

app.whenReady().then(run).then(() => app.quit(), error => {
  console.error(error);
  app.exit(1);
});
app.on('quit', () => {
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
});
