import type { Entry } from './contracts';
export type Column = 'name' | 'modified' | 'type' | 'size';
const names = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** 文件夹总是排在文件前；排序不修改原始列表。 */
export function sortEntries(entries: Entry[], column: Column, ascending: boolean) {
  return [...entries].sort((left, right) => {
    const folders = Number(right.kind === 'folder') - Number(left.kind === 'folder');
    if (folders) return folders;
    const value = column === 'size' || column === 'modified'
      ? (left[column] ?? -1) - (right[column] ?? -1)
      : names.compare(left[column], right[column]);
    return (value || names.compare(left.name, right.name)) * (ascending ? 1 : -1);
  });
}
