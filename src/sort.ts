import type { Entry } from './contracts';
export type Column = 'name' | 'modified' | 'type' | 'size';
const names = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** 文件和文件夹统一排序；缺失的数值始终排在末尾，不修改原始列表。 */
export function sortEntries(entries: Entry[], column: Column, ascending: boolean) {
  return [...entries].sort((left, right) => {
    let value: number;
    if (column === 'size' || column === 'modified') {
      const leftValue = left[column];
      const rightValue = right[column];
      if (leftValue === null && rightValue !== null) return 1;
      if (leftValue !== null && rightValue === null) return -1;
      value = leftValue === null || rightValue === null ? 0 : leftValue - rightValue;
    } else {
      value = names.compare(left[column], right[column]);
    }
    return (value || names.compare(left.name, right.name)) * (ascending ? 1 : -1);
  });
}
