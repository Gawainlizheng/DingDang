import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import type { EventEmitter } from 'node:events';

interface ZipEntry {
  fileName: string; versionMadeBy: number; externalFileAttributes: number;
  generalPurposeBitFlag: number; uncompressedSize: number; crc32: number;
}
interface ZipReader {
  eachEntry(): AsyncIterable<ZipEntry>;
  openReadStreamPromise(entry: ZipEntry): Promise<Readable>;
  close(): void;
}
interface ZipWriter extends EventEmitter {
  outputStream: Readable;
  addFile(source: string, name: string): void;
  addEmptyDirectory(name: string): void;
  end(): void;
}
const load = createRequire(path.resolve(typeof __filename === 'string' ? __filename : process.cwd() + '/package.json'));
const { openPromise } = load('yauzl') as {
  openPromise(source: string, options: object): Promise<ZipReader>;
};
const { ZipFile } = load('yazl') as { ZipFile: new () => ZipWriter };
const defaults = { entries: 100_000, bytes: 32 * 1024 ** 3 };
const conflict = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'EEXIST'
  ? new Error('目标已有同名项目，未覆盖') : error;

/** ZIP 只接受普通文件和目录。输出由本次操作独占创建，失败只清理已记录的产物。 */
export function zipOperations(absolute: (input: unknown) => string, nameOf: (input: unknown) => string, limits = defaults) {
  async function createZip(inputs: string[], archiveName: string): Promise<void> {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > limits.entries) throw new Error('无效的压缩选择');
    const sources = inputs.map(input => absolute(input));
    const parent = path.dirname(sources[0]);
    if (sources.some(source => source === path.dirname(source) || path.relative(parent, path.dirname(source)) !== '')) {
      throw new Error('只能压缩同一目录内的文件或文件夹');
    }
    const name = nameOf(archiveName);
    const target = path.join(parent, nameOf(/\.zip$/i.test(name) ? name : name + '.zip'));
    const members: { source: string; name: string; directory: boolean }[] = [];
    const seen = new Set<string>();
    async function collect(source: string, member: string) {
      const key = member.toLowerCase();
      if (seen.has(key)) throw new Error('压缩选择存在重复名称');
      if (members.length >= limits.entries) throw new Error('压缩条目超过上限');
      seen.add(key);
      const info = await fs.lstat(source);
      if (info.isSymbolicLink() || !(info.isDirectory() || info.isFile())) throw new Error('不支持压缩链接或特殊文件');
      members.push({ source, name: member, directory: info.isDirectory() });
      if (info.isDirectory()) {
        for (const child of await fs.readdir(source)) await collect(path.join(source, child), member + '/' + nameOf(child));
      }
    }
    for (const source of sources) await collect(source, nameOf(path.basename(source)));
    const handle = await fs.open(target, 'wx').catch(error => { throw conflict(error); });
    const archive = new ZipFile();
    archive.on('error', error => archive.outputStream.destroy(error));
    const writing = pipeline(archive.outputStream, handle.createWriteStream());
    try {
      for (const item of members) {
        if (item.directory) archive.addEmptyDirectory(item.name);
        else archive.addFile(item.source, item.name);
      }
      archive.end();
      await writing;
    } catch (error) {
      archive.outputStream.destroy();
      await writing.catch(() => {});
      await handle.close().catch(() => {});
      await fs.unlink(target).catch(() => { throw new Error('压缩失败，且无法清理未完成的 ZIP'); });
      throw error;
    }
  }

  async function extractZip(input: string): Promise<void> {
    const source = absolute(input);
    const filename = path.basename(source);
    if (!/\.zip$/i.test(filename) || !(await fs.lstat(source)).isFile()) throw new Error('请选择普通 ZIP 文件');
    const root = path.join(path.dirname(source), nameOf(filename.slice(0, -4)));
    await fs.mkdir(root).catch(error => { throw conflict(error); });
    const created = [{ target: root, directory: true }];
    const known = new Map<string, { name: string; directory: boolean; explicit: boolean }>();
    let reader: ZipReader | undefined;
    try {
      reader = await openPromise(source, { autoClose: false, strictFileNames: true, validateEntrySizes: true });
      let count = 0;
      let total = 0;
      for await (const entry of reader.eachEntry()) {
        if (++count > limits.entries || (total += entry.uncompressedSize) > limits.bytes) throw new Error('ZIP 解压超过条目数或容量上限');
        if (entry.generalPurposeBitFlag & 1) throw new Error('不支持加密 ZIP');
        const directory = entry.fileName.endsWith('/');
        const type = (entry.versionMadeBy >>> 8) === 3 ? (entry.externalFileAttributes >>> 16) & 0o170000 : 0;
        if ((entry.externalFileAttributes & 0x400) || (type && type !== (directory ? 0o040000 : 0o100000))
            || (directory && entry.uncompressedSize !== 0)) throw new Error('ZIP 包含链接或不支持的条目类型');
        const parts = (directory ? entry.fileName.slice(0, -1) : entry.fileName).split('/').map(nameOf);
        for (let index = 0; index < parts.length; index++) {
          const relative = parts.slice(0, index + 1);
          const name = relative.join('/');
          const key = name.toLowerCase();
          const leaf = index === parts.length - 1;
          const isDirectory = !leaf || directory;
          const previous = known.get(key);
          if (previous) {
            if (!isDirectory || !previous.directory || previous.name !== name || (leaf && previous.explicit)) {
              throw new Error('ZIP 包含重复条目或名称冲突');
            }
            if (leaf) previous.explicit = true;
            continue;
          }
          const target = path.join(root, ...relative);
          known.set(key, { name, directory: isDirectory, explicit: leaf });
          if (isDirectory) {
            await fs.mkdir(target);
            created.push({ target, directory: true });
          } else {
            const stream = await reader.openReadStreamPromise(entry);
            let checksum = 0;
            const check = new Transform({
              transform(chunk: Buffer, _encoding, callback) { checksum = crc32(chunk, checksum); callback(null, chunk); },
              flush(callback) { callback(checksum === entry.crc32 ? undefined : new Error('ZIP 完整性校验失败')); },
            });
            const output = createWriteStream(target, { flags: 'wx' });
            output.once('open', () => created.push({ target, directory: false }));
            await pipeline(stream, check, output);
          }
        }
      }
    } catch (error) {
      let cleanupFailed = false;
      for (const item of created.reverse()) {
        await (item.directory ? fs.rmdir(item.target) : fs.unlink(item.target)).catch(() => { cleanupFailed = true; });
      }
      if (cleanupFailed) throw new Error('解压失败，且无法清理全部未完成的输出', { cause: error });
      throw new Error('解压失败：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      reader?.close();
    }
  }
  return { createZip, extractZip };
}
