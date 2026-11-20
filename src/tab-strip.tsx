import { useLayoutEffect, useRef, useState } from 'react';
import type { FolderTab } from './tabs';

export function TabStrip({ tabs, active, home, pending, add, close, select, reorder }: {
  tabs: FolderTab[]; active: number; home?: string; pending: boolean;
  add: () => void; close: (id: number) => void; select: (id: number) => void;
  reorder: (id: number, index: number) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const frame = useRef<number>(0);
  const gesture = useRef<{ id: number; pointer: number; start: number; x: number; moved: boolean } | null>(null);
  const suppress = useRef(false);
  const [dragging, setDragging] = useState<number>();
  const [edges, setEdges] = useState({ left: false, right: false });
  const overflow = edges.left || edges.right;
  function measure() {
    const node = strip.current!;
    setEdges(previous => {
      const next = { left: node.scrollLeft > 1, right: node.scrollLeft + node.clientWidth < node.scrollWidth - 1 };
      return previous.left === next.left && previous.right === next.right ? previous : next;
    });
  }
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    const node = strip.current!;
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    measure();
    return () => observer.disconnect();
  }, [tabs]);
  useLayoutEffect(() => {
    const node = strip.current!;
    const selected = node.querySelector('.tab.active');
    if (selected) {
      const viewport = node.getBoundingClientRect();
      const bounds = selected.getBoundingClientRect();
      if (bounds.left < viewport.left) node.scrollLeft += bounds.left - viewport.left;
      else if (bounds.right > viewport.right) node.scrollLeft += bounds.right - viewport.right;
    }
    measure();
  }, [active, tabs.length, overflow]);
  useLayoutEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** 拖动时每帧按其他标签的中心计算插入位置，靠边时继续滚动。 */
  function dragFrame() {
    const drag = gesture.current;
    const node = strip.current;
    if (!drag?.moved || !node) return;
    const bounds = node.getBoundingClientRect();
    if (drag.x < bounds.left + 28) node.scrollLeft -= 14;
    else if (drag.x > bounds.right - 28) node.scrollLeft += 14;
    const index = Array.from(node.children).filter(child => {
      const rect = child.getBoundingClientRect();
      return child.getAttribute('data-tab') !== String(drag.id) && drag.x >= rect.left + rect.width / 2;
    }).length;
    reorder(drag.id, index);
    frame.current = requestAnimationFrame(dragFrame);
  }
  function end(pointer: number) {
    if (gesture.current?.pointer !== pointer) return;
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    setDragging(undefined);
  }
  function step(direction: -1 | 1) {
    const node = strip.current!;
    const left = node.getBoundingClientRect().left;
    const right = left + node.clientWidth;
    const bounds = Array.from(node.children, child => child.getBoundingClientRect());
    const next = direction < 0
      ? bounds.reverse().find(rect => rect.left < left - 1)
      : bounds.find(rect => rect.right > right + 1);
    if (!next) return;
    node.scrollLeft += direction < 0 ? next.left - left : next.right - right;
    measure();
  }
  return <div className="tabs">
    <div ref={strip} onScroll={measure} className="tabStrip" role="tablist" aria-label="文件夹标签页">
      {tabs.map(item => {
        const target = item.listing?.path ?? item.address;
        const label = target === home ? '用户目录' : target.split(/[\\/]/).filter(Boolean).at(-1) || '用户目录';
        return <div data-tab={item.id} className={`tab${item.id === active ? ' active' : ''}${item.id === dragging ? ' dragging' : ''}`} key={item.id}>
          <button role="tab" aria-selected={item.id === active} aria-controls="folder-panel" title={target}
            onClick={event => { if (!event.detail || !suppress.current) select(item.id); suppress.current = false; }}
            onPointerDown={event => {
              if (event.pointerType !== 'mouse' || event.button !== 0 || gesture.current) return;
              suppress.current = false;
              gesture.current = { id: item.id, pointer: event.pointerId, start: event.clientX, x: event.clientX, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              const drag = gesture.current;
              if (!drag || drag.pointer !== event.pointerId) return;
              drag.x = event.clientX;
              if (!drag.moved && Math.abs(drag.x - drag.start) >= 6) {
                drag.moved = suppress.current = true;
                setDragging(drag.id);
                frame.current = requestAnimationFrame(dragFrame);
              }
            }}
            onPointerUp={event => end(event.pointerId)} onPointerCancel={event => end(event.pointerId)}
            onLostPointerCapture={event => end(event.pointerId)}>{label}</button>
          <button title="关闭标签页" aria-label={`关闭 ${label}`} disabled={pending} onClick={() => close(item.id)}>×</button>
        </div>;
      })}
    </div>
    <div className="tabControls">
      {overflow && <>
        <button title="向左滚动标签" aria-label="向左滚动标签" disabled={!edges.left} onClick={() => step(-1)}>‹</button>
        <button title="向右滚动标签" aria-label="向右滚动标签" disabled={!edges.right} onClick={() => step(1)}>›</button>
      </>}
      <button title="新建标签页 (Ctrl+T)" aria-label="新建标签页" disabled={pending || !home} onClick={add}>＋</button>
    </div>
  </div>;
}
