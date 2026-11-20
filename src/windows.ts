import { app, shell } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import type { Place } from './contracts';
import { moveAcrossVolumes } from './service';

const execute = promisify(execFile);
const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

/** 脚本是固定常量，文件路径只作为环境数据传递，不拼接进命令。 */
function run(script: string, variables: Record<string, string> = {}) {
  return execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, env: { ...process.env, ...variables },
  });
}

export const windows = {
  async places(): Promise<Place[]> {
    const places = [
      { label: '用户目录', path: app.getPath('home') },
      { label: '桌面', path: app.getPath('desktop') },
      { label: '文档', path: app.getPath('documents') },
      { label: '下载', path: app.getPath('downloads') },
    ];
    const { stdout } = await run('[IO.DriveInfo]::GetDrives() | ForEach-Object { $_.Name }').catch(() => ({ stdout: '' }));
    for (const root of stdout.split(/\r?\n/).map(line => line.trim()).filter(line => /^[a-z]:\\$/i.test(line))) {
      places.push({ label: `本地磁盘 (${root.slice(0, 2)})`, path: root });
    }
    return places;
  },
  async openItem(target: string) {
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  },
  async trash(target: string) {
    await shell.trashItem(target);
  },
  async move(source: string, target: string) {
    const info = await lstat(source);
    if (info.isSymbolicLink()) throw new Error('首版不移动链接');
    if (!info.isDirectory() && !info.isFile()) throw new Error('首版不移动特殊文件');
    if (path.parse(source).root.toLowerCase() !== path.parse(target).root.toLowerCase()) {
      return moveAcrossVolumes(source, target);
    }
    const statement = info.isDirectory() ? '[IO.Directory]::Move' : '[IO.File]::Move';
    try {
      await run(`try { ${statement}($env:DINGDANG_SOURCE, $env:DINGDANG_TARGET) } catch { $cause = $_.Exception.GetBaseException(); if (($cause.HResult -band 65535) -eq 17) { exit 17 }; if (($cause.HResult -band 65535) -in 80,183) { exit 80 }; [Console]::Error.WriteLine($cause.Message); exit 1 }`,
        { DINGDANG_SOURCE: source, DINGDANG_TARGET: target });
    } catch (error) {
      const failure = error as { code?: number; stderr?: string };
      if (failure.code === 17) return moveAcrossVolumes(source, target);
      if (failure.code === 80) throw new Error('目标已有同名项目，未覆盖');
      throw new Error(failure.stderr?.trim() || '系统无法移动此项目');
    }
  },
};
