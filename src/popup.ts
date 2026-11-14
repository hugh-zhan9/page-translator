import type { PageStatus } from './page';
import { sitePattern } from './sites';
const status = document.querySelector<HTMLElement>('#status')!;
const mode = document.querySelector<HTMLSelectElement>('#mode')!;
let tabId: number | undefined;
let siteEnabled = true;
function showState(state: PageStatus) {
  mode.value = state.mode;
  status.dataset.error = String(Boolean(state.failed));
  status.textContent = !state.active ? '点击「翻译当前页」开始。' : !state.total ? '没有可翻译内容。' :
    `已翻译 ${state.done} / ${state.total} 段${state.pending ? ` · 待完成 ${state.pending}` : ''}${state.failed ? ` · 失败 ${state.failed}：${state.error}` : ''}`;
}
async function send(type: string) {
  if (tabId === undefined) throw new Error('无法获取当前网页。');
  const state = await chrome.tabs.sendMessage(tabId, { type, mode: mode.value });
  if (state) showState(state);
}
function failure(error: unknown) { status.dataset.error = 'true'; status.textContent = error instanceof Error ? error.message : '无法操作当前页面。'; }
document.querySelector('#settings')!.addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('#start')!.addEventListener('click', async () => {
  try {
    const config = await chrome.runtime.sendMessage({ type: 'getSettings' });
    if (!config?.ok || !config.data.hasApiKey) throw new Error('请先打开 API 设置，保存地址、模型和 Key。');
    if (!await chrome.permissions.contains({ origins: [`${new URL(config.data.baseUrl).protocol}//${new URL(config.data.baseUrl).hostname}/*`] })) {
      throw new Error('请在 API 设置页重新保存，授权 API 来源。');
    }
    if (tabId === undefined) throw new Error('无法获取当前网页。');
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await send('start');
  } catch (error) { failure(error); }
});
document.querySelector('#restore')!.addEventListener('click', () => send('restore').catch(() => { status.textContent = '当前页尚未开始翻译。'; }));
mode.addEventListener('change', () => send('mode').catch(() => undefined));
const siteButton = document.querySelector<HTMLButtonElement>('#site')!;
let tabUrl: string | undefined;
siteButton.addEventListener('click', () => {
  if (tabId === undefined || !tabUrl) return;
  const enabled = !siteEnabled;
  const pattern = sitePattern(tabUrl);
  // Keep the permission request in the direct user-gesture chain.
  const permission = enabled ? chrome.permissions.request({ origins: [pattern] }) : Promise.resolve(true);
  siteButton.disabled = true;
  permission.then(async granted => {
    if (!granted) throw new Error('未获得当前网站权限，未启用悬浮按钮。');
    const response = await chrome.runtime.sendMessage({ type: 'setSite', tabId, enabled, pattern });
    if (!response?.ok) throw new Error(response?.error ?? '无法更改站点设置。');
    siteEnabled = response.data.enabled;
    siteButton.textContent = siteEnabled ? '关闭此网站悬浮按钮' : '在此网站显示悬浮按钮';
  }).catch(failure).finally(() => { siteButton.disabled = false; });
});
chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  tabId = tab?.id; tabUrl = tab?.url;
  if (!tab?.url || !/^https?:\/\//.test(tab.url)) {
    document.querySelector<HTMLButtonElement>('#start')!.disabled = true;
    siteButton.disabled = true;
    status.textContent = '请打开普通 HTTP / HTTPS 网页。浏览器内部页面和 PDF 暂不支持。';
    return;
  }
  const site = await chrome.runtime.sendMessage({ type: 'getSite', tabId });
  siteEnabled = Boolean(site?.ok && site.data.enabled);
  siteButton.textContent = siteEnabled ? '关闭此网站悬浮按钮' : '在此网站显示悬浮按钮';
  siteButton.disabled = false;
  await send('status').catch(() => undefined);
}).catch(failure);
const timer = setInterval(() => { if (tabId !== undefined) void send('status').catch(() => undefined); }, 700);
window.addEventListener('pagehide', () => clearInterval(timer));
