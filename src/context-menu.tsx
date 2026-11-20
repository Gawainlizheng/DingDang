import { useLayoutEffect, useRef } from 'react';

export interface MenuItem { label: string; run: () => void; disabled?: boolean }

/** 在可视窗口内定位菜单，并用同一套按钮支持鼠标与键盘。 */
export function ContextMenu({ x, y, items, close }: {
  x: number; y: number; items: MenuItem[]; close: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => {
    const element = menu.current!;
    const previous = document.activeElement;
    function position() {
      element.style.left = Math.max(0, Math.min(x, window.innerWidth - element.offsetWidth)) + 'px';
      element.style.top = Math.max(0, Math.min(y, window.innerHeight - element.offsetHeight)) + 'px';
    }
    function outside(event: PointerEvent) {
      if (!element.contains(event.target as Node)) closeRef.current();
    }
    position();
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    window.addEventListener('resize', position);
    window.addEventListener('pointerdown', outside);
    window.addEventListener('blur', closeRef.current);
    const onBlur = closeRef.current;
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('pointerdown', outside);
      window.removeEventListener('blur', onBlur);
      if (element.contains(document.activeElement) && previous instanceof HTMLElement) previous.focus();
    };
  }, [x, y]);
  return <div ref={menu} className="contextMenu" role="menu" aria-label="文件操作" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }} onContextMenu={event => event.preventDefault()}>
    {items.map(item => <button key={item.label} role="menuitem" disabled={item.disabled}
      onClick={() => { close(); item.run(); }}>{item.label}</button>)}
  </div>;
}
