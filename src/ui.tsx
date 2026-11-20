import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Entry, Files, ItemResult, Place } from './contracts';
import { sortEntries, type Column } from './sort';
import { finishNavigation, folderTab, moveTab, neighborAfterClose, type FolderTab, type Navigation } from './tabs';
import { TabStrip } from './tab-strip';
import { ContextMenu, type MenuItem } from './context-menu';
import type { MenuResult } from './menu-worker';
import './ui.css';

declare global {
  interface Window {
    files: Files;
    showWindowsMenu(path: string, x: number, y: number): Promise<MenuResult>;
  }
}
const api = window.files;
const columns: [Column, string][] = [['name', '名称'], ['modified', '修改日期'], ['type', '类型'], ['size', '大小']];
const formatDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
const formatSize = (size: number) => size < 1024 ? `${size} B` : `${(size / (size >= 1048576 ? 1048576 : 1024)).toFixed(1)} ${size >= 1048576 ? 'MB' : 'KB'}`;
const message = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '');
type Clipboard = { mode: 'copy' | 'move'; paths: string[] };
type Editor = { title: string; value: string; source?: string };

function App() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [tabs, setTabs] = useState(() => [folderTab(0)]);
  const tabsRef = useRef(tabs);
  const [active, setActive] = useState(0);
  const menuRequest = useRef(0);
  const nativeMenuPending = useRef(false);
  const nextId = useRef(1);
  const tab = tabs.find(item => item.id === active) ?? tabs[0];
  const { listing, address, history, cursor, selection, column, ascending, notice, loading } = tab;
  function updateTabs(update: (items: FolderTab[]) => FolderTab[]) {
    tabsRef.current = update(tabsRef.current);
    setTabs(tabsRef.current);
  }
  function patchTab(id: number, patch: Partial<FolderTab>) {
    updateTabs(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  }
  const setSelection = (paths: string[]) => patchTab(active, { selection: paths });
  const setNotice = (value: string) => patchTab(active, { notice: value });
  const [clipboard, setClipboard] = useState<Clipboard>();
  const [report, setReport] = useState<{ id: number; items: ItemResult[] }>();
  const results = report?.id === active ? report.items : [];
  const setResults = (items: ItemResult[]) => setReport({ id: active, items });
  const [pending, setPending] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const [confirm, setConfirm] = useState(false);
  const sequence = useRef(0);
  const busy = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] }>();
  const entries = useMemo(() => sortEntries(listing?.entries ?? [], column, ascending), [listing, column, ascending]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const single = selection.length === 1 ? listing?.entries.find(entry => entry.path === selection[0]) : undefined;

  async function navigate(id: number, target: string, mode: Navigation = 'push') {
    const request = ++sequence.current;
    patchTab(id, { request, loading: true });
    try {
      const next = await api.listDirectory(target);
      updateTabs(items => finishNavigation(items, id, request, mode, { listing: next }));
    } catch (error) {
      updateTabs(items => finishNavigation(items, id, request, mode, { error: message(error) }));
    }
  }

  useEffect(() => {
    void api.places().then(paths => {
      setPlaces(paths);
      if (paths[0] && tabsRef.current[0]?.request === 0) void navigate(0, paths[0].path);
    }).catch(error => setNotice(message(error)));
  }, []);

  useEffect(() => {
    if (editor || confirm) dialog.current?.showModal();
    else dialog.current?.close();
  }, [Boolean(editor), confirm]);

  function go(target: string, mode?: 'refresh' | number) {
    if (!busy.current && target) {
      ++menuRequest.current;
      setNotice('');
      setResults([]);
      setMenu(undefined);
      void navigate(active, target, mode);
    }
  }

  /** 串行修改文件；重新读取已打开目录，包括跨标签操作的源与目标。 */
  async function operate(action: () => Promise<ItemResult[] | void>) {
    if (busy.current || !listing || loading) return;
    busy.current = true;
    setPending(true);
    setNotice('');
    setResults([]);
    try {
      const outcome = await action();
      if (outcome) {
        const succeeded = outcome.filter(item => item.ok).length;
        setResults(outcome);
        setNotice(`成功 ${succeeded} 项，失败 ${outcome.length - succeeded} 项`);
      } else setNotice('操作完成');
    } catch (error) {
      setNotice(message(error));
    } finally {
      await Promise.all(tabsRef.current.map(item => item.listing && !item.loading
        ? navigate(item.id, item.listing.path, 'refresh') : undefined));
      busy.current = false;
      setPending(false);
    }
  }

  function switchTo(id: number) {
    ++menuRequest.current;
    setMenu(undefined);
    setActive(id);
  }

  function addTab(target = places[0]?.path) {
    if (!target || busy.current) return;
    const id = nextId.current++;
    updateTabs(items => [...items, folderTab(id, target)]);
    switchTo(id);
    void navigate(id, target);
  }

  function closeTab(id: number) {
    if (busy.current) return;
    const neighbor = neighborAfterClose(tabsRef.current, id);
    if (neighbor === undefined) {
      if (!places[0]) return;
      const replacement = nextId.current++;
      updateTabs(() => [folderTab(replacement, places[0].path)]);
      switchTo(replacement);
      void navigate(replacement, places[0].path);
    } else {
      updateTabs(items => items.filter(item => item.id !== id));
      if (id === active) switchTo(neighbor);
    }
  }

  function paste() {
    if (!clipboard || !listing) return;
    void operate(async () => {
      if (clipboard.mode === 'copy') return api.copyItems(clipboard.paths, listing.path);
      const outcome = await api.moveItems(clipboard.paths, listing.path);
      const remaining = outcome.filter(item => !item.ok).map(item => item.path);
      setClipboard(remaining.length ? { mode: 'move', paths: remaining } : undefined);
      return outcome;
    });
  }

  function select(entry: Entry, event: React.MouseEvent) {
    if (busy.current) return;
    if (event.shiftKey && tab.anchor) {
      const first = entries.findIndex(item => item.path === tab.anchor);
      const last = entries.indexOf(entry);
      if (first >= 0) {
        const range = entries.slice(Math.min(first, last), Math.max(first, last) + 1).map(item => item.path);
        setSelection(event.ctrlKey ? [...new Set([...selection, ...range])] : range);
        return;
      }
    }
    patchTab(active, { anchor: entry.path });
    setSelection(event.ctrlKey ? selected.has(entry.path) ? selection.filter(item => item !== entry.path) : [...selection, entry.path] : [entry.path]);
  }

  function open(entry: Entry) {
    if (busy.current || loading) return;
    if (entry.kind === 'folder') go(entry.path);
    else void api.openItem(entry.path).catch(error => setNotice(message(error)));
  }

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (event.defaultPrevented || editor || confirm || event.target instanceof HTMLInputElement) return;
      const key = event.key.toLowerCase();
      if (event.altKey && !event.ctrlKey && ['arrowleft', 'arrowright', 'arrowup'].includes(key)) {
        event.preventDefault();
        if (key === 'arrowleft') go(history[cursor - 1], cursor - 1);
        else if (key === 'arrowright') go(history[cursor + 1], cursor + 1);
        else if (listing && listing.parent !== listing.path) go(listing.parent);
      } else if (event.ctrlKey && !event.altKey && ['t', 'w', 'tab'].includes(key)) {
        event.preventDefault();
        if (key === 't') addTab();
        else if (key === 'w') closeTab(active);
        else switchTo(tabs[(tabs.indexOf(tab) + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length].id);
      }
    }
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  });

  function showMenu(event: React.MouseEvent, entry?: Entry) {
    event.preventDefault();
    event.stopPropagation();
    if (pending || loading || !listing || nativeMenuPending.current) return;
    const paths = entry ? selected.has(entry.path) ? selection : [entry.path] : [];
    if (entry && !selected.has(entry.path)) patchTab(active, { selection: paths, anchor: entry.path });
    const items: MenuItem[] = [];
    if (!entry) {
      items.push({ label: '新建文件夹', run: () => setEditor({ title: '新建文件夹', value: '' }) },
        { label: '粘贴', disabled: !clipboard, run: paste },
        { label: '刷新', run: () => go(listing.path, 'refresh') });
    } else {
      if (paths.length === 1) {
        items.push({ label: '打开', run: () => open(entry) });
        if (entry.kind === 'folder') items.push({ label: '在新标签页中打开', run: () => addTab(entry.path) });
      }
      items.push({ label: '复制', run: () => setClipboard({ mode: 'copy', paths }) },
        { label: '剪切', run: () => setClipboard({ mode: 'move', paths }) });
      if (paths.length === 1) items.push({ label: '重命名', run: () => setEditor({ title: '重命名', value: entry.name, source: entry.path }) });
      items.push({ label: '移入回收站', run: () => setConfirm(true) });
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, event.clientX || bounds.left);
    const y = Math.max(0, event.clientY || bounds.top);
    const request = ++menuRequest.current;
    if (!entry || paths.length !== 1) {
      setMenu({ x, y, items });
      return;
    }
    setMenu(undefined);
    nativeMenuPending.current = true;
    void window.showWindowsMenu(entry.path, x, y).catch(() => 'unavailable' as const).then(result => {
      if (result === 'open-folder') {
        if (request === menuRequest.current && tabsRef.current.some(item => item.id === active)) go(entry.path);
      } else if (result === 'invoked' || result === 'failed') {
        if (result === 'failed') patchTab(active, { notice: 'Windows 未能执行所选命令' });
        for (const item of tabsRef.current) {
          if (item.listing && !item.loading) void navigate(item.id, item.listing.path, 'refresh');
        }
      } else if (result === 'unavailable' && request === menuRequest.current) {
        setMenu({ x, y, items });
      }
    }).finally(() => { nativeMenuPending.current = false; });
  }

  return <div className="app" onKeyDown={event => {
    if (pending || loading || menu || editor || confirm || event.target instanceof HTMLInputElement) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey && (key === 'c' || key === 'x') && selection.length) {
      event.preventDefault();
      setClipboard({ mode: key === 'c' ? 'copy' : 'move', paths: selection });
    } else if (event.ctrlKey && key === 'v' && clipboard) {
      event.preventDefault();
      paste();
    } else if (key === 'delete' && selection.length) setConfirm(true);
    else if (key === 'f2' && single) setEditor({ title: '重命名', value: single.name, source: single.path });
    else if (key === 'f5' && listing) { event.preventDefault(); go(listing.path, 'refresh'); }
  }}>
    <header>
      <TabStrip tabs={tabs} active={active} home={places[0]?.path} pending={pending}
        add={() => addTab()} close={closeTab} select={switchTo}
        reorder={(id, index) => updateTabs(items => moveTab(items, id, index))} />
      <div className="navigation">
        <button title="后退 (Alt+←)" aria-label="后退" disabled={pending || cursor < 1} onClick={() => go(history[cursor - 1], cursor - 1)}>←</button>
        <button title="前进 (Alt+→)" aria-label="前进" disabled={pending || cursor >= history.length - 1} onClick={() => go(history[cursor + 1], cursor + 1)}>→</button>
        <button title="上一级 (Alt+↑)" aria-label="上一级" disabled={pending || !listing || listing.parent === listing.path} onClick={() => listing && go(listing.parent)}>↑</button>
        <button title="刷新" aria-label="刷新" disabled={pending || !listing} onClick={() => listing && go(listing.path, 'refresh')}>↻</button>
        <form onSubmit={event => { event.preventDefault(); go(address); }}>
          <input aria-label="地址栏" value={address} disabled={pending} onChange={event => patchTab(active, { address: event.target.value })} onFocus={event => event.target.select()} placeholder="输入本地路径，例如 C:\" />
        </form>
      </div>
    </header>
    <div className="workspace">
      <aside aria-label="常用位置和磁盘">
        <h2>常用位置</h2>
        {places.slice(0, 4).map(place => <button key={place.label} className={listing?.path === place.path ? 'active' : ''} disabled={pending} onClick={() => go(place.path)}><span>◇</span>{place.label}</button>)}
        <h2>磁盘</h2>
        {places.slice(4).map(place => <button key={place.path} className={listing?.path === place.path ? 'active' : ''} disabled={pending} onClick={() => go(place.path)}><span>▱</span>{place.label}</button>)}
      </aside>
      <main id="folder-panel" role="tabpanel">
        <div className="toolbar" aria-label="文件操作" inert={loading}>
          <button disabled={pending || !listing} onClick={() => setEditor({ title: '新建文件夹', value: '' })}>＋ 新建文件夹</button>
          <button disabled={pending || !selection.length} onClick={() => setClipboard({ mode: 'copy', paths: selection })}>复制</button>
          <button disabled={pending || !selection.length} onClick={() => setClipboard({ mode: 'move', paths: selection })}>剪切</button>
          <button disabled={pending || !clipboard || !listing} onClick={paste}>粘贴{clipboard ? ` (${clipboard.paths.length})` : ''}</button>
          <button disabled={pending || !single} onClick={() => single && setEditor({ title: '重命名', value: single.name, source: single.path })}>重命名</button>
          <button className="danger" disabled={pending || !selection.length} onClick={() => setConfirm(true)}>移入回收站</button>
        </div>
        <div className="tableWrap" aria-busy={pending || loading} onContextMenu={event => showMenu(event)}>
          <table><colgroup><col /><col className="dateCol" /><col className="typeCol" /><col className="sizeCol" /></colgroup>
            <thead><tr>{columns.map(([key, label]) => <th key={key} aria-sort={column === key ? ascending ? 'ascending' : 'descending' : 'none'}>
              <button onClick={() => patchTab(active, { ascending: column === key ? !ascending : true, column: key })}>{label} {column === key ? ascending ? '↑' : '↓' : ''}</button>
            </th>)}</tr></thead>
            <tbody>{entries.map(entry => <tr key={entry.path} className={selected.has(entry.path) ? 'selected' : ''} aria-selected={selected.has(entry.path)} tabIndex={0}
              onClick={event => select(entry, event)} onDoubleClick={() => open(entry)} onContextMenu={event => showMenu(event, entry)}
              onKeyDown={event => { if (event.key === 'Enter') open(entry); if (event.key === ' ' && !pending) { event.preventDefault(); setSelection([entry.path]); } }}>
              <td title={entry.name}><span className={`itemIcon ${entry.kind}`} aria-hidden="true" />{entry.name}</td>
              <td>{entry.modified === null ? '—' : formatDate.format(entry.modified)}</td><td>{entry.type}</td><td>{entry.size === null ? '—' : formatSize(entry.size)}</td>
            </tr>)}</tbody>
          </table>
          {!entries.length && <p className="empty">{loading ? '正在读取文件夹…' : listing ? '此文件夹为空' : '请选择位置或输入路径'}</p>}
        </div>
        {notice && <div className="feedback" role="status"><div>{notice} <button onClick={() => { setNotice(''); setResults([]); }} aria-label="关闭提示">×</button></div>
          {results.length > 0 && <details open={results.some(item => !item.ok)}><summary>逐项结果</summary><ul>{results.map((item, index) => <li key={index}>{item.ok ? '成功' : '失败'} · {item.path}{item.error ? ` — ${item.error}` : ''}</li>)}</ul></details>}
        </div>}
      </main>
    </div>
    <footer>{entries.length} 个项目 <span>{selection.length ? `已选 ${selection.length} 项` : ''}</span><strong>{pending ? '正在处理…' : '本地文件'}</strong></footer>
    {menu && <ContextMenu {...menu} close={() => setMenu(undefined)} />}
    <dialog ref={dialog} onCancel={() => { setEditor(undefined); setConfirm(false); }}>
      {editor && <form onSubmit={event => {
        event.preventDefault();
        if (!listing) return;
        setEditor(undefined);
        void operate(() => editor.source ? api.renameItem(editor.source, editor.value) : api.createFolder(listing.path, editor.value));
      }}><h2>{editor.title}</h2><label>名称<input required autoFocus value={editor.value} onChange={event => setEditor({ ...editor, value: event.target.value })} /></label>
      <div className="actions"><button type="button" onClick={() => setEditor(undefined)}>取消</button><button className="primary" type="submit">确认</button></div></form>}
      {confirm && <><h2>移入回收站</h2><p>将选中的 {selection.length} 个项目移入回收站？</p><div className="actions">
        <button autoFocus onClick={() => setConfirm(false)}>取消</button>
        <button className="primary" onClick={() => { setConfirm(false); void operate(() => api.trashItems(selection)); }}>确认</button>
      </div></>}
    </dialog>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
