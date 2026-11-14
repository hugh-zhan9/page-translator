import { afterEach, expect, it, vi } from 'vitest';
import { sitePattern, siteStatus, setSite, removeRevokedSites, removeLegacySites } from '../src/sites';
const siteEnabled = async (url: string) => (await siteStatus(url)).enabled;
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const scripts: chrome.scripting.RegisteredContentScript[] = [];
  const storage: Record<string, unknown> = {};
  let granted = true;
  const api = {
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(storage, value); }),
    } },
    permissions: { contains: vi.fn(async () => granted) },
    scripting: {
      getRegisteredContentScripts: vi.fn(async () => [...scripts]),
      unregisterContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => { for (let i = scripts.length - 1; i >= 0; i--) if (ids.includes(scripts[i].id)) scripts.splice(i, 1); }),
      executeScript: vi.fn(async () => []),
    },
    tabs: { query: vi.fn(async () => [{ id: 1 }]), sendMessage: vi.fn(async () => ({})) },
  };
  vi.stubGlobal('chrome', api);
  return { api, scripts, storage, grant: (value: boolean) => { granted = value; } };
}
it('limits site patterns to the exact HTTP(S) host, never subdomain wildcards', () => {
  expect(sitePattern('https://example.com:8443/path')).toBe('https://example.com/*');
  expect(sitePattern('https://sub.example.com/')).toBe('https://sub.example.com/*');
  expect(() => sitePattern('chrome://extensions')).toThrow();
});
it('shows by default, persists closing a site and supports re-enabling', async () => {
  const f = fixture();
  expect(await siteEnabled('https://example.com')).toBe(true);
  await setSite('https://example.com', false);
  expect(await siteEnabled('https://example.com/next')).toBe(false);
  expect(await siteEnabled('https://sub.example.com')).toBe(true);
  expect(await siteEnabled('http://example.com')).toBe(true);
  expect(f.api.tabs.sendMessage).toHaveBeenLastCalledWith(1, { type: 'siteChanged', enabled: false, pattern: 'https://example.com/*' }, { frameId: 0 });
  expect(f.storage.disabledSites).toEqual(['https://example.com/*']);
  await setSite('https://example.com', true);
  expect(await siteEnabled('https://example.com')).toBe(true);
  expect(f.storage.disabledSites).toEqual([]);
  expect(f.api.scripting.executeScript).toHaveBeenCalled();
});
it('serializes changes to different sites without losing disabled preferences', async () => {
  const f = fixture();
  await Promise.all([setSite('https://one.example', false), setSite('https://two.example', false)]);
  expect(f.storage.disabledSites).toEqual(['https://one.example/*', 'https://two.example/*']);
  await setSite('https://one.example', true);
  expect(await siteEnabled('https://two.example')).toBe(false);
});
it('respects revoked browser access without discarding preferences', async () => {
  const f = fixture();
  await setSite('https://closed.example', false);
  f.grant(false);
  expect(await siteEnabled('https://example.com')).toBe(false);
  await expect(setSite('https://example.com', true)).rejects.toThrow('授权');
  await removeRevokedSites();
  expect(f.api.tabs.sendMessage).toHaveBeenLastCalledWith(1, { type: 'recheckSite' }, { frameId: 0 });
  f.grant(true);
  expect(await siteEnabled('https://example.com')).toBe(true);
  expect(await siteEnabled('https://closed.example')).toBe(false);
});
it('removes only old per-site dynamic scripts during migration', async () => {
  const f = fixture();
  f.scripts.push({ id: 'pt-site-old', matches: ['https://example.com/*'], js: ['content.js'] }, { id: 'unrelated', js: ['other.js'] });
  await removeLegacySites();
  expect(f.scripts.map(script => script.id)).toEqual(['unrelated']);
  expect(await siteEnabled('https://example.com')).toBe(true);
  await removeLegacySites();
  expect(f.api.scripting.unregisterContentScripts).toHaveBeenCalledOnce();
});
