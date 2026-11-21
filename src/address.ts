export function httpsUrl(input: unknown): string | undefined {
  if (typeof input !== 'string' || input.length > 8192 || !/^https:\/\/[^/\\]/i.test(input)
      || /[\s\\\x00-\x1f\x7f]/u.test(input)) return;
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/\.$/, '');
    const validHost = host.startsWith('[') || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(host);
    if (url.protocol === 'https:' && validHost && !url.username && !url.password) return url.href;
  } catch { return; }
}

export type Address =
  | { kind: 'folder' | 'web' | 'search'; value: string }
  | { kind: 'invalid' | 'empty' };

/** 可疑的路径或网址宁可报错，也不作为搜索词发给外部网站。 */
export function classifyAddress(input: string): Address {
  const value = input.trim();
  if (!value) return { kind: 'empty' };
  if (/^[a-z]:[\\/](?![\\/])/i.test(value) && !/[:\x00-\x1f]/.test(value.slice(2))) {
    return { kind: 'folder', value };
  }
  const explicit = httpsUrl(value);
  if (explicit) return { kind: 'web', value: explicit };
  if (/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*(?::\d+)?(?:[/?#]\S*)?$/i.test(value)) {
    const url = httpsUrl('https://' + value);
    if (url) return { kind: 'web', value: url };
  }
  if (/[.。．｡:\/\\@]|[\x00-\x1f\x7f]/u.test(value) || value.length > 2048) return { kind: 'invalid' };
  return { kind: 'search', value };
}
