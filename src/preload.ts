import { contextBridge, ipcRenderer } from 'electron';
import { channels, type Files } from './contracts';

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
};
contextBridge.exposeInMainWorld('files', api);
