import type { Rectangle } from 'electron';

export interface WebState {
  url: string;
  title: string;
  loading: boolean;
  back: boolean;
  forward: boolean;
  error?: string;
}
export type WebCommand = 'back' | 'forward' | 'reload' | 'navigate';
export type WebShortcut = 'new' | 'close' | 'next' | 'previous' | 'address';
export type WebEvent = { type: 'state'; id: number; state: WebState }
  | { type: 'link'; id: number; url: string; background: boolean }
  | { type: 'shortcut'; id: number; shortcut: WebShortcut };
export interface WebTabs {
  display(view: { id: number; url: string; bounds: Rectangle } | null): Promise<void>;
  command(id: number, command: WebCommand, url?: string): Promise<void>;
  close(id: number): Promise<void>;
  subscribe(receive: (event: WebEvent) => void): () => void;
}
export const webChannels = {
  display: 'web-tabs:display', command: 'web-tabs:command', close: 'web-tabs:close',
  event: 'web-tabs:event', link: 'web-tabs:guest-link',
};
