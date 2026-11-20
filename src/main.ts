import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { channels, type Files } from './contracts';
import { fileService } from './service';
import { windows } from './windows';

const page = path.join(__dirname, 'index.html');
const trustedUrl = pathToFileURL(page).href;
const files = fileService(windows);
let window: BrowserWindow | undefined;

/** 只允许本地应用的顶层页面调用文件功能，不允许子框架或外部网页调用。 */
function register<Key extends keyof Files>(key: Key) {
  const handler = files[key] as (...args: Parameters<Files[Key]>) => unknown;
  ipcMain.handle(channels[key], (event, ...args: Parameters<Files[Key]>) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame
        || event.senderFrame?.url !== trustedUrl) throw new Error('未授权的页面');
    return handler(...args);
  });
}

app.whenReady().then(() => {
  for (const key of Object.keys(channels) as (keyof Files)[]) register(key);
  window = new BrowserWindow({
    width: 1120, height: 720, minWidth: 760, minHeight: 480, backgroundColor: '#f9faf7', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.removeMenu();
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  void window.loadFile(page);
});
app.on('window-all-closed', () => app.quit());
