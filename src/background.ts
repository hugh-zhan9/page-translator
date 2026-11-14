import { allowedSender, DEFAULTS, originPattern, publicSettings, validateSettings, type Settings } from './config';
import { removeLegacySites, removeRevokedSites, setSite, siteStatus, sitePattern } from './sites';
import { safeError, translate } from './provider';

const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).then(() => removeLegacySites());
let saving = Promise.resolve();
async function load(): Promise<Settings | undefined> {
  return (await chrome.storage.local.get('settings')).settings as Settings | undefined;
}
async function withPermission(settings: Settings): Promise<void> {
  if (!await chrome.permissions.contains({ origins: [originPattern(settings.baseUrl)] })) {
    throw new Error('请先在设置页授权此 API 地址。');
  }
}
chrome.permissions.onRemoved.addListener(() => void removeRevokedSites().catch(() => undefined));
chrome.runtime.onStartup.addListener(() => void removeRevokedSites().catch(() => undefined));
chrome.runtime.onInstalled.addListener(() => void removeRevokedSites().catch(() => undefined));
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const type = message?.type;
  if (!allowedSender(sender, type, chrome.runtime.id)) {
    reply({ ok: false, error: '未授权的扩展消息。' });
    return false;
  }
  const run = async () => {
    await ready;
    if (type === 'siteStatus') return siteStatus(sender.url!);
    if (type === 'disableSite') {
      await setSite(sender.url!, false);
      return { enabled: false };
    }
    if (type === 'setSite') {
      if (!Number.isInteger(message.tabId) || typeof message.enabled !== 'boolean') throw new Error('无效设置。');
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab.url || sitePattern(tab.url) !== message.pattern) throw new Error('无法启用：当前页面已变化，请重新打开扩展。');
      await setSite(tab.url, message.enabled);
      return { enabled: message.enabled };
    }
    if (type === 'getSite') {
      if (!Number.isInteger(message.tabId)) throw new Error('无效设置。');
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab.url) throw new Error('无法获取当前网页。');
      return siteStatus(tab.url);
    }
    if (type === 'getSettings') return publicSettings(await load() ?? DEFAULTS);
    if (type === 'saveSettings') {
      const settings = validateSettings(message.settings, await load());
      await withPermission(settings);
      await chrome.storage.local.set({ settings });
      return publicSettings(settings);
    }
    if (type === 'clearSettings') {
      await chrome.storage.local.remove('settings');
      return null;
    }
    const settings = await load();
    if (!settings) throw new Error('请先在设置页填写 API 地址、模型和 Key。');
    await withPermission(settings);
    return translate(settings, type === 'testConnection' ? ['Hello, world.'] : message.texts);
  };
  // Configuration writes are sequential even when multiple settings tabs are open.
  const task = ['saveSettings', 'clearSettings'].includes(type) ? saving.then(run) : run();
  if (['saveSettings', 'clearSettings'].includes(type)) saving = task.then(() => undefined, () => undefined);
  task.then(data => reply({ ok: true, data }), error => reply({ ok: false, error: safeError(error) }));
  return true;
});
