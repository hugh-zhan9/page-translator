// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ active: false, visible: false }));
vi.mock('../src/page', () => ({ PageTranslation: class {
  start() { state.active = true; return this.status(); }
  stop() { state.active = false; return this.status(); }
  setMode() { return this.status(); }
  status() { return { active: state.active }; }
} }));
vi.mock('../src/floating', () => ({ FloatingControls: class {
  show() { state.visible = true; }
  hide() { state.visible = false; }
} }));
afterEach(() => { vi.unstubAllGlobals(); delete (globalThis as any).__pageTranslatorInstalled; state.active = false; state.visible = false; });
it('keeps manually started translation on a hidden-button site when another site loses access', async () => {
  vi.resetModules();
  let listener!: (message: any, sender: any, reply: any) => boolean;
  let permitted = true;
  vi.stubGlobal('chrome', { runtime: { id: 'fixture', getURL: (file: string) => `chrome-extension://fixture/${file}`,
    sendMessage: vi.fn(async () => ({ ok: true, data: { enabled: false, permitted } })),
    onMessage: { addListener: (handler: typeof listener) => { listener = handler; } },
  } });
  await import('../src/content');
  await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledOnce());
  listener({ type: 'start' }, { id: 'fixture', url: 'chrome-extension://fixture/popup.html' }, () => {});
  expect(state.active).toBe(true);
  listener({ type: 'recheckSite' }, { id: 'fixture' }, () => {});
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.active).toBe(true);
  expect(state.visible).toBe(false);
  permitted = false;
  listener({ type: 'recheckSite' }, { id: 'fixture' }, () => {});
  await vi.waitFor(() => expect(state.active).toBe(false));
});
it('applies explicit site closure before a concurrent permission recheck', async () => {
  vi.resetModules();
  let listener!: (message: any, sender: any, reply: any) => boolean;
  const responses: ((value: unknown) => void)[] = [];
  vi.stubGlobal('chrome', { runtime: { id: 'fixture', getURL: (file: string) => `chrome-extension://fixture/${file}`,
    sendMessage: vi.fn(() => new Promise(resolve => { responses.push(resolve); })),
    onMessage: { addListener: (handler: typeof listener) => { listener = handler; } },
  } });
  await import('../src/content');
  responses.shift()!({ ok: true, data: { enabled: true, permitted: true } });
  await vi.waitFor(() => expect(state.visible).toBe(true));
  listener({ type: 'start' }, { id: 'fixture', url: 'chrome-extension://fixture/popup.html' }, () => {});
  const pattern = `${location.protocol}//${location.hostname}/*`;
  listener({ type: 'siteChanged', pattern, enabled: false }, { id: 'fixture' }, () => {});
  listener({ type: 'recheckSite' }, { id: 'fixture' }, () => {});
  for (const resolve of responses) resolve({ ok: true, data: { enabled: false, permitted: true } });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.visible).toBe(false);
  expect(state.active).toBe(false);
});
