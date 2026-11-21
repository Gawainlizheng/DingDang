import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { Entry, Files, ItemResult } from './contracts';
import { zipOperations } from './zip.ts';

/** 仅接受完整的本机路径；Windows 拒绝设备命名空间、相对盘符路径和备用数据流。 */
export function absolute(input: unknown, windows = process.platform === 'win32'): string {
  if (typeof input !== 'string' || !input || input.includes('\0')) throw new Error('请输入有效的绝对路径');
  if (!windows && path.posix.isAbsolute(input)) return path.posix.normalize(input);
  if (windows && /^[a-z]:[\\/]/i.test(input) && !input.slice(2).includes(':')) {
    const normalized = path.win32.resolve(input);
    for (const segment of normalized.slice(3).split('\\').filter(Boolean)) nameOf(segment);
    return normalized;
  }
  throw new Error('请输入本地磁盘的绝对路径，例如 C:\\Users');
}

export function nameOf(input: unknown): string {
  if (typeof input !== 'string' || !input || /[<>:"/\\|?*\x00-\x1f]|[ .]$/.test(input)
      || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$) *(\.|$)/i.test(input)) {
    throw new Error('名称无效或为系统保留名称');
  }
  return input;
}

function mutable(input: unknown): string {
  const target = absolute(input);
  if (path.dirname(target) === target) throw new Error('不能修改磁盘根目录');
  return target;
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function describe(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  const messages: Record<string, string> = {
    EEXIST: '目标已有同名项目，未覆盖', ENOENT: '项目已不存在或路径无效',
    EACCES: '权限不足', EPERM: '权限不足或文件被占用', EBUSY: '文件正在使用',
    ENOSPC: '目标磁盘空间不足', ENOTDIR: '目标不是文件夹',
  };
  return (code && messages[code]) || (error instanceof Error ? error.message : String(error));
}

/** 独占创建每个目标，不覆盖文件；遇到链接时停止，不跟随链接复制其他位置。 */
async function copyExclusive(source: string, target: string): Promise<void> {
  const info = await fs.lstat(source);
  if (info.isFile()) {
    await fs.copyFile(source, target, constants.COPYFILE_EXCL);
  } else if (info.isDirectory()) {
    await fs.mkdir(target);
    try {
      for (const child of await fs.readdir(source)) {
        await copyExclusive(path.join(source, child), path.join(target, child));
      }
    } catch (error) {
      throw new Error(`复制未完成，目标中保留已复制的内容：${describe(error)}`);
    }
  } else {
    throw new Error('首版不复制文件链接或特殊文件');
  }
}

type Platform = Pick<Files, 'places' | 'openItem'> & {
  trash(path: string): Promise<void>;
  move(source: string, target: string): Promise<void>;
};

/** 跨盘目录先完整复制，之后才清理源目录；清理失败时保留目标并报告。 */
export async function moveAcrossVolumes(source: string, target: string): Promise<void> {
  await copyExclusive(source, target);
  try {
    await fs.rm(source, { recursive: true });
  } catch (error) {
    throw new Error(`已复制到目标，但源项目未能完全清理：${describe(error)}`);
  }
}

/** 文件业务独立于 Electron；注入平台能力后可在临时目录测试。 */
export function fileService(platform: Platform): Files {
  async function batch(paths: string[], action: (source: string) => Promise<void>): Promise<ItemResult[]> {
    if (!Array.isArray(paths) || paths.length > 10000 || paths.some(item => typeof item !== 'string')) {
      throw new Error('无效的文件选择');
    }
    const results: ItemResult[] = [];
    for (const item of paths) {
      try {
        await action(mutable(item));
        results.push({ path: item, ok: true });
      } catch (error) {
        results.push({ path: item, ok: false, error: describe(error) });
      }
    }
    return results;
  }

  async function transfer(paths: string[], destination: string, move: boolean) {
    const folder = await fs.realpath(absolute(destination));
    if (!(await fs.stat(folder)).isDirectory()) throw new Error('目标不是文件夹');
    return batch(paths, async source => {
      const sourceInfo = await fs.lstat(source);
      const target = path.join(folder, path.basename(source));
      const realSource = sourceInfo.isSymbolicLink() ? source : await fs.realpath(source);
      const relative = path.relative(realSource, folder);
      if (sourceInfo.isDirectory() && (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)))) {
        throw new Error('不能将文件夹放进自身或其子文件夹');
      }
      if (samePath(source, target)) throw new Error('源和目标相同');
      await (move ? platform.move(source, target) : copyExclusive(source, target));
    });
  }

  return {
    places: platform.places,
    ...zipOperations(absolute, nameOf),
    async listDirectory(input) {
      const folder = absolute(input);
      const children = await fs.readdir(folder, { withFileTypes: true });
      const entries: Entry[] = [];
      for (let offset = 0; offset < children.length; offset += 32) {
        entries.push(...await Promise.all(children.slice(offset, offset + 32).map(async (child): Promise<Entry> => {
          const fullPath = path.join(folder, child.name);
          const info = await fs.lstat(fullPath).catch(() => null);
          const kind = child.isDirectory() ? 'folder' : child.isFile() ? 'file' : child.isSymbolicLink() ? 'link' : 'unknown';
          return { path: fullPath, name: child.name, kind, modified: info?.mtimeMs ?? null,
            size: kind === 'file' ? info?.size ?? null : null,
            type: kind === 'folder' ? '文件夹' : kind === 'link' ? '链接' : path.extname(child.name).slice(1).toUpperCase() || '文件' };
        })));
      }
      return { path: folder, parent: path.dirname(folder), entries };
    },
    async openItem(input) { await platform.openItem(absolute(input)); },
    async createFolder(parent, name) { await fs.mkdir(path.join(absolute(parent), nameOf(name))).catch(error => { throw new Error(describe(error)); }); },
    async renameItem(input, name) {
      const source = mutable(input);
      const target = path.join(path.dirname(source), nameOf(name));
      if (source !== target) await platform.move(source, target).catch(error => { throw new Error(describe(error)); });
    },
    copyItems: (paths, target) => transfer(paths, target, false),
    moveItems: (paths, target) => transfer(paths, target, true),
    trashItems: paths => batch(paths, platform.trash),
  };
}
