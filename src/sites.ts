const PREFIX = 'pt-site-';
export function sitePattern(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('无法在此页面启用悬浮按钮。');
  return `${url.protocol}//${url.hostname}/*`;
}
async function disabledSites(): Promise<string[]> {
  return ((await chrome.storage.local.get('disabledSites')).disabledSites as string[] | undefined) ?? [];
}
export async function siteStatus(url: string): Promise<{ enabled: boolean; permitted: boolean }> {
  const pattern = sitePattern(url);
  const permitted = await chrome.permissions.contains({ origins: [pattern] });
  return { enabled: permitted && !(await disabledSites()).includes(pattern), permitted };
}
async function notify(pattern: string, enabled: boolean): Promise<void> {
  const tabs = await chrome.tabs.query(enabled ? { url: pattern } : {});
  await Promise.all(tabs.map(async tab => {
    if (tab.id === undefined) return;
    if (enabled) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => undefined);
    await chrome.tabs.sendMessage(tab.id, { type: 'siteChanged', enabled, pattern }, { frameId: 0 }).catch(() => undefined);
  }));
}
let changes: Promise<unknown> = Promise.resolve();
function sequential<T>(action: () => Promise<T>): Promise<T> {
  const task = changes.then(action);
  changes = task.catch(() => undefined);
  return task;
}
export function setSite(url: string, enabled: boolean): Promise<void> {
  return sequential(async () => {
    const pattern = sitePattern(url);
    if (enabled && !await chrome.permissions.contains({ origins: [pattern] })) throw new Error('请先授权当前网站。');
    const disabled = new Set(await disabledSites());
    if (enabled) disabled.delete(pattern); else disabled.add(pattern);
    await chrome.storage.local.set({ disabledSites: [...disabled] });
    await notify(pattern, enabled);
  });
}
export function removeRevokedSites(): Promise<void> {
  return sequential(async () => {
    // URL visibility may disappear with permission. Each content script checks its own site.
    await Promise.all((await chrome.tabs.query({})).map(tab => tab.id === undefined ? undefined :
      chrome.tabs.sendMessage(tab.id, { type: 'recheckSite' }, { frameId: 0 }).catch(() => undefined)));
  });
}
export function removeLegacySites(): Promise<void> {
  return sequential(async () => {
    const ids = (await chrome.scripting.getRegisteredContentScripts()).filter(script => script.id.startsWith(PREFIX)).map(script => script.id);
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  });
}
