import type { Entry } from './contracts';

export function zipMenu(entries: Entry[], paths: string[]) {
  const selected = new Set(paths);
  const items = entries.filter(entry => selected.has(entry.path));
  const single = items.length === 1 ? items[0] : undefined;
  const canCompress = items.length > 0 && items.length === paths.length
    && items.every(entry => entry.kind === 'file' || entry.kind === 'folder');
  return {
    archiveName: canCompress ? single ? single.name + '.zip' : '归档.zip' : undefined,
    extractPath: paths.length === 1 && single?.kind === 'file' && /\.zip$/i.test(single.name) ? single.path : undefined,
  };
}
