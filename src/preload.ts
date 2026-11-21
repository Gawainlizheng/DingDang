import { contextBridge, ipcRenderer } from 'electron';
import { channels, type Files } from './contracts';
import { tabSessionChannels, type TabSession } from './tab-session';
import { webChannels, type WebEvent, type WebTabs } from './web-contract';

/** 暴露固定方法，不把 ipcRenderer 或任意频道名交给页面。 */
const api: Files = {
  places: () => ipcRenderer.invoke(channels.places),
  listDirectory: target => ipcRenderer.invoke(channels.listDirectory, target),
  openItem: target => ipcRenderer.invoke(channels.openItem, target),
  createFolder: (target, name) => ipcRenderer.invoke(channels.createFolder, target, name),
  renameItem: (target, name) => ipcRenderer.invoke(channels.renameItem, target, name),
  copyItems: (items, target) => ipcRenderer.invoke(channels.copyItems, items, target),
  moveItems: (items, target) => ipcRenderer.invoke(channels.moveItems, items, target),
  trashItems: items => ipcRenderer.invoke(channels.trashItems, items),
  createZip: (items, name) => ipcRenderer.invoke(channels.createZip, items, name),
  extractZip: target => ipcRenderer.invoke(channels.extractZip, target),
};
contextBridge.exposeInMainWorld('files', api);
const webTabs: WebTabs = {
  display: view => ipcRenderer.invoke(webChannels.display, view),
  command: (id, command, url) => ipcRenderer.invoke(webChannels.command, id, command, url),
  close: id => ipcRenderer.invoke(webChannels.close, id),
  subscribe(receive) {
    const listener = (_event: Electron.IpcRendererEvent, value: WebEvent) => receive(value);
    ipcRenderer.on(webChannels.event, listener);
    return () => ipcRenderer.removeListener(webChannels.event, listener);
  },
};
contextBridge.exposeInMainWorld('webTabs', webTabs);
contextBridge.exposeInMainWorld('tabSession', {
  loadTabSession: () => ipcRenderer.invoke(tabSessionChannels.load),
  saveTabSession: (snapshot: TabSession) => ipcRenderer.invoke(tabSessionChannels.save, snapshot),
});
contextBridge.exposeInMainWorld('showWindowsMenu', (path: string, x: number, y: number) =>
  ipcRenderer.invoke('files:windows-menu', path, x, y));
