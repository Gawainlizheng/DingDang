import { WebContentsView, ipcMain, session, type BrowserWindow, type Rectangle, type WebContents } from 'electron';
import path from 'node:path';
import { httpsUrl } from './address';
import { maxSessionTabs } from './tab-session';
import { webChannels, type WebEvent, type WebShortcut, type WebState } from './web-contract';

interface Page { id: number; view: WebContentsView; state: WebState; attempt: string }
const validId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0;

export function webViews(owner: BrowserWindow) {
  const browsing = session.fromPartition('dingdang-web');
  browsing.setPermissionCheckHandler(() => false);
  browsing.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  browsing.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  browsing.on('will-download', event => event.preventDefault());
  const pages = new Map<number, Page>();
  let visible: Page | undefined;

  function send(event: WebEvent) {
    if (!owner.isDestroyed()) owner.webContents.send(webChannels.event, event);
  }
  function notify(page: Page, patch: Partial<WebState> = {}) {
    if (pages.get(page.id) !== page) return;
    const history = page.view.webContents.navigationHistory;
    page.state = { ...page.state, ...patch, back: history.canGoBack(), forward: history.canGoForward() };
    page.view.setVisible(visible === page && !page.state.error);
    send({ type: 'state', id: page.id, state: page.state });
  }
  function load(page: Page, url: string) {
    page.attempt = url;
    notify(page, { error: undefined, loading: true, title: '' });
    void page.view.webContents.loadURL(url).catch(() => {});
  }
  function create(id: number, url: string) {
    const view = new WebContentsView({ webPreferences: {
      session: browsing, preload: path.join(__dirname, 'web-guest.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
      devTools: false, navigateOnDragDrop: false, disableDialogs: true,
    } });
    view.setVisible(false);
    const contents = view.webContents;
    const page: Page = { id, view, attempt: url, state: { url, title: '', loading: false, back: false, forward: false } };
    pages.set(id, page);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('will-frame-navigate', event => {
      if (event.isMainFrame && !httpsUrl(event.url)) event.preventDefault();
    });
    contents.on('will-redirect', event => {
      if (event.isMainFrame && !httpsUrl(event.url)) {
        event.preventDefault();
        notify(page, { loading: false, error: '已阻止跳转到非 HTTPS 地址' });
      }
    });
    contents.on('did-start-navigation', event => {
      if (!event.isMainFrame || event.isSameDocument) return;
      const target = httpsUrl(event.url);
      if (target) page.attempt = target;
      notify(page, { error: undefined, loading: true, title: '' });
    });
    function committed(target: string) {
      const safe = httpsUrl(target);
      if (safe) {
        page.attempt = safe;
        notify(page, { url: safe, error: undefined });
      }
    }
    contents.on('did-navigate', (_event, target) => committed(target));
    contents.on('did-navigate-in-page', (_event, target, main) => { if (main) committed(target); });
    contents.on('did-stop-loading', () => notify(page, { loading: false }));
    contents.on('page-title-updated', (_event, title, explicit) => {
      if (explicit) notify(page, { title: title.slice(0, 256) });
    });
    contents.on('did-fail-load', (_event, code, _description, _target, main) => {
      if (main && code !== -3) notify(page, { loading: false, error: `无法打开网页（${code}）` });
    });
    contents.on('render-process-gone', () => notify(page, { loading: false, error: '网页进程已退出，请重试' }));
    contents.on('before-input-event', (event, input) => {
      if (visible !== page || input.type !== 'keyDown' || input.isAutoRepeat) return;
      const key = input.key.toLowerCase();
      let shortcut: WebShortcut | undefined;
      if (input.control && !input.alt && !input.meta) {
        if (key === 't') shortcut = 'new';
        if (key === 'w') shortcut = 'close';
        if (key === 'tab') shortcut = input.shift ? 'previous' : 'next';
        if (key === 'l') shortcut = 'address';
      }
      if (shortcut) {
        event.preventDefault();
        send({ type: 'shortcut', id, shortcut });
      } else if (key === 'f5' || input.alt && !input.control && ['arrowleft', 'arrowright'].includes(key)) {
        event.preventDefault();
        command(id, key === 'f5' ? 'reload' : key === 'arrowleft' ? 'back' : 'forward');
      }
    });
    return page;
  }
  function detach() {
    if (!visible) return;
    visible.view.setVisible(false);
    if (!owner.isDestroyed()) owner.contentView.removeChildView(visible.view);
    visible = undefined;
  }
  function close(id: unknown) {
    if (!validId(id)) return;
    const page = pages.get(id);
    if (!page) return;
    if (visible === page) detach();
    pages.delete(id);
    page.view.webContents.close({ waitForBeforeUnload: false });
  }
  function display(input: unknown) {
    if (input === null) { detach(); return; }
    if (!input || typeof input !== 'object') throw new Error('无效的网页视图');
    const { id, url, bounds } = input as { id: unknown; url: unknown; bounds?: Rectangle };
    const safe = httpsUrl(url);
    if (!validId(id) || !safe || !bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
      throw new Error('无效的网页视图');
    }
    const content = owner.getContentBounds();
    const x = Math.round(Math.max(0, Math.min(content.width, bounds.x)));
    const y = Math.round(Math.max(0, Math.min(content.height, bounds.y)));
    const width = Math.round(Math.max(0, Math.min(content.width - x, bounds.width)));
    const height = Math.round(Math.max(0, Math.min(content.height - y, bounds.height)));
    const existing = pages.get(id);
    if (!existing && pages.size >= maxSessionTabs) throw new Error('网页标签已达上限');
    const page = existing ?? create(id, safe);
    if (visible !== page) {
      detach();
      visible = page;
      owner.contentView.addChildView(page.view);
    }
    page.view.setBounds({ x, y, width, height });
    page.view.setVisible(!page.state.error);
    if (!existing) load(page, safe);
  }
  function command(id: unknown, action: unknown, target?: unknown) {
    if (!validId(id) || visible?.id !== id) return;
    const page = visible;
    const contents = page.view.webContents;
    const history = contents.navigationHistory;
    if (action === 'navigate') {
      const safe = httpsUrl(target);
      if (!safe) throw new Error('只允许 HTTPS 网址');
      load(page, safe);
    } else if (action === 'back' && history.canGoBack()) history.goBack();
    else if (action === 'forward' && history.canGoForward()) history.goForward();
    else if (action === 'reload') {
      if (page.state.error) load(page, page.attempt);
      else contents.reload();
    }
  }
  function link(event: Electron.IpcMainEvent, target: unknown, background: unknown) {
    const url = httpsUrl(target);
    const source: WebContents | undefined = visible?.view.webContents;
    if (!visible || !url || typeof background !== 'boolean' || source !== event.sender
        || !event.senderFrame || event.senderFrame !== source.mainFrame || !httpsUrl(event.senderFrame.url)) return;
    send({ type: 'link', id: visible.id, url, background });
  }
  ipcMain.on(webChannels.link, link);
  owner.once('closed', () => {
    ipcMain.removeListener(webChannels.link, link);
    for (const id of pages.keys()) close(id);
  });
  return { display, command, close };
}
