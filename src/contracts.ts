export interface Entry {
  path: string;
  name: string;
  kind: 'folder' | 'file' | 'link' | 'unknown';
  modified: number | null;
  size: number | null;
  type: string;
}
export interface Place { label: string; path: string }
export interface Listing { path: string; parent: string; entries: Entry[] }
export interface ItemResult { path: string; ok: boolean; error?: string }

/** 渲染端唯一的文件接口；批量结果保持输入顺序，每项单独报告成功或错误。 */
export interface Files {
  places(): Promise<Place[]>;
  listDirectory(path: string): Promise<Listing>;
  openItem(path: string): Promise<void>;
  createFolder(parent: string, name: string): Promise<void>;
  renameItem(path: string, name: string): Promise<void>;
  copyItems(paths: string[], destination: string): Promise<ItemResult[]>;
  moveItems(paths: string[], destination: string): Promise<ItemResult[]>;
  trashItems(paths: string[]): Promise<ItemResult[]>;
}

export const channels = {
  places: 'files:places', listDirectory: 'files:list', openItem: 'files:open',
  createFolder: 'files:create', renameItem: 'files:rename',
  copyItems: 'files:copy', moveItems: 'files:move', trashItems: 'files:trash',
} as const satisfies Record<keyof Files, string>;
