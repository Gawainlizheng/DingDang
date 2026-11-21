import { app, BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron';
import { lstat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { channels, type Files } from './contracts';
import { absolute, fileService } from './service';
import { windows } from './windows';
import { menuWorker } from './menu-worker';
import { tabSessionChannels } from './tab-session';
import { sessionStore } from './session-store';
import { webViews } from './web-views';
import { webChannels } from './web-contract';

const page = path.join(__dirname, 'index.html');
const trustedUrl = pathToFileURL(page).href;
const files = fileService(windows);
let window: BrowserWindow | undefined;
let sessions: ReturnType<typeof sessionStore> | undefined;
let quitting = false;
let flushed = false;
let menuOpen = false;
let authorizeMenu: ((pid: number) => boolean) | undefined;
const nativeDir = path.join(__dirname, '..', '.native-build-a');
const menus = menuWorker(path.join(nativeDir, 'context-menu.exe'),
  process.env.DINGDANG_MENU_COLD === '1', process.env.DINGDANG_MENU_TIMING === '1');

function trusted(event: IpcMainInvokeEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame
      || event.senderFrame?.url !== trustedUrl) throw new Error('未授权的页面');
  return window;
}

/** 只允许本地应用的顶层页面调用文件功能，不允许子框架或外部网页调用。 */
function register<Key extends keyof Files>(key: Key) {
  const handler = files[key] as (...args: Parameters<Files[Key]>) => unknown;
  ipcMain.handle(channels[key], (event, ...args: Parameters<Files[Key]>) => {
    trusted(event);
    return handler(...args);
  });
}

app.whenReady().then(() => {
  sessions = sessionStore(path.join(app.getPath('userData'), 'tab-session.json'), absolute);
  ipcMain.handle(tabSessionChannels.load, event => { trusted(event); return sessions!.load(); });
  ipcMain.handle(tabSessionChannels.save, (event, snapshot: unknown) => {
    trusted(event);
    if (!quitting) sessions!.save(snapshot);
  });
  if (process.platform === 'win32') {
    try {
      authorizeMenu = require(path.join(nativeDir, 'foreground.node')).allowWorkerForeground;
    } catch (error) {
      console.warn('[windows-menu] foreground bridge unavailable', error);
    }
  }
  for (const key of Object.keys(channels) as (keyof Files)[]) register(key);
  ipcMain.handle('files:windows-menu', async (event, input: unknown, x: unknown, y: unknown) => {
    const started = performance.now();
    const owner = trusted(event);
    if (menuOpen) return 'dismissed';
    menuOpen = true;
    try {
      const target = absolute(input);
      const bounds = owner.getContentBounds();
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
          || x < 0 || y < 0 || x >= bounds.width || y >= bounds.height) return 'unavailable';
      const info = await lstat(target);
      if (!owner.isFocused() || !authorizeMenu) return 'unavailable';
      const point = screen.dipToScreenPoint({ x: Math.round(bounds.x + x), y: Math.round(bounds.y + y) });
      return await menus.show(target, point, started, info.isDirectory(), authorizeMenu);
    } catch {
      return 'unavailable';
    } finally {
      menuOpen = false;
    }
  });
  window = new BrowserWindow({
    width: 1120, height: 720, minWidth: 760, minHeight: 480, backgroundColor: '#f9faf7', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.removeMenu();
  const browser = webViews(window);
  ipcMain.handle(webChannels.display, (event, input: unknown) => { trusted(event); browser.display(input); });
  ipcMain.handle(webChannels.command, (event, id: unknown, action: unknown, url: unknown) => {
    trusted(event); browser.command(id, action, url);
  });
  ipcMain.handle(webChannels.close, (event, id: unknown) => { trusted(event); browser.close(id); });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  if (process.platform === 'win32') menus.preheat();
  void window.loadFile(page);
});
app.on('before-quit', event => {
  if (!sessions || flushed) { menus.stop(); return; }
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void sessions.flush().finally(() => {
    flushed = true;
    app.quit();
  });
});
app.on('window-all-closed', () => app.quit());
