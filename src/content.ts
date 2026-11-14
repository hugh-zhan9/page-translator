import { PageTranslation, type Mode } from './page';
import { FloatingControls } from './floating';
import { sitePattern } from './sites';
const scope = globalThis as typeof globalThis & { __pageTranslatorInstalled?: boolean };
if (!scope.__pageTranslatorInstalled) {
  scope.__pageTranslatorInstalled = true;
  const page = new PageTranslation(document, async texts => {
    const response = await chrome.runtime.sendMessage({ type: 'translate', texts });
    if (!response?.ok) throw new Error(response?.error ?? '无法连接扩展后台。');
    return response.data as string[];
  });
  const floating = new FloatingControls(document, page, async () => {
    const response = await chrome.runtime.sendMessage({ type: 'disableSite' });
    if (!response?.ok) throw new Error(response?.error ?? '无法关闭此网站悬浮按钮。');
    page.stop(); floating.hide();
  });
  let revision = 0;
  async function checkSite(reason: 'initial' | 'permission' = 'initial') {
    const check = ++revision;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'siteStatus' });
      if (check !== revision) return;
      if (result?.ok && result.data.enabled) floating.show();
      else {
        if (reason === 'permission' && result?.ok && result.data.permitted === false) page.stop();
        floating.hide();
      }
    } catch { /* A failed status query does not establish revoked access. */ }
  }
  void checkSite();
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return false;
    const fromPopup = sender.url === chrome.runtime.getURL('popup.html');
    const fromBackground = !sender.tab && (!sender.url || sender.url === chrome.runtime.getURL('background.js'));
    if (fromBackground && ['siteChanged', 'recheckSite'].includes(message.type)) {
      if (message.type === 'siteChanged' && message.pattern === sitePattern(location.href)) {
        if (message.enabled === false) { revision++; page.stop(); floating.hide(); }
        else void checkSite();
      } else if (message.type === 'recheckSite') void checkSite('permission');
      reply({ ok: true }); return false;
    }
    if (!fromPopup) return false;
    const mode: Mode = message.mode === 'translated' ? 'translated' : 'bilingual';
    if (message.type === 'start') reply(page.start(mode));
    else if (message.type === 'mode') reply(page.setMode(mode));
    else if (message.type === 'restore') reply(page.stop());
    else if (message.type === 'status') reply(page.status());
    return false;
  });
}
