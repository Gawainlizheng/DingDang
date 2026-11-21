import { ipcRenderer } from 'electron';
import { httpsUrl } from './address';
import { webChannels } from './web-contract';

/** 不向网页暴露 IPC；只转发顶层文档中由浏览器派发的链接手势。 */
if (process.isMainFrame) {
  function openLink(event: MouseEvent) {
    if (!event.isTrusted || event.defaultPrevented || event.altKey || event.shiftKey || event.metaKey) return;
    const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement);
    if (!(anchor instanceof HTMLAnchorElement) || !anchor.hasAttribute('href') || anchor.hasAttribute('download')) return;
    const background = event.type === 'auxclick' && event.button === 1
      || event.type === 'click' && event.button === 0 && event.ctrlKey;
    const target = anchor.getAttribute('target') ?? document.querySelector('base[target]')?.getAttribute('target');
    if (!background && !(event.type === 'click' && event.button === 0 && target?.toLowerCase() === '_blank')) return;
    const url = httpsUrl(anchor.href);
    if (!url) return;
    event.preventDefault();
    ipcRenderer.send(webChannels.link, url, background);
  }
  window.addEventListener('click', openLink, true);
  window.addEventListener('auxclick', openLink, true);
}
