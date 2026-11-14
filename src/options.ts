import { normalizeBaseUrl, originPattern, type PublicSettings } from './config';
const form = document.querySelector<HTMLFormElement>('form')!;
const status = document.querySelector<HTMLElement>('#status')!;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
let saved: PublicSettings;
function show(message: string, error = false) { status.textContent = message; status.dataset.error = String(error); }
function apply(settings: PublicSettings) {
  saved = settings;
  for (const name of ['provider', 'baseUrl', 'model', 'targetLanguage'] as const) field(name).value = settings[name];
  field('apiKey').value = '';
  (field('apiKey') as HTMLInputElement).placeholder = settings.hasApiKey ? '已保存；留空保留当前 Key' : '填写你的 API Key';
}
async function request(type: string, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok) throw new Error(response?.error ?? '无法连接扩展后台。');
  return response.data;
}
form.addEventListener('submit', event => {
  event.preventDefault();
  // Permission request must remain in the click's user-gesture call chain.
  let settings: Record<string, string>, pattern: string;
  try {
    settings = Object.fromEntries(new FormData(form)) as Record<string, string>;
    settings.baseUrl = normalizeBaseUrl(settings.baseUrl);
    pattern = originPattern(settings.baseUrl);
    if (!settings.model.trim() || !settings.targetLanguage.trim() || (!settings.apiKey.trim() && !saved?.hasApiKey)) {
      throw new Error('请填写模型、目标语言及 API Key。');
    }
  } catch (error) { show((error as Error).message, true); return; }
  const save = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  save.disabled = true;
  chrome.permissions.request({ origins: [pattern] }).then(async granted => {
    if (!granted) throw new Error('未获得 API 来源访问权限，设置未保存。');
    apply(await request('saveSettings', { settings })); show('设置已保存。');
  }).catch(error => show(error.message, true)).finally(() => { save.disabled = false; });
});
field('provider').addEventListener('change', () => {
  field('apiKey').value = '';
  if (field('provider').value === 'anthropic') {
    field('baseUrl').value = 'https://api.anthropic.com'; field('model').value = 'claude-opus-5-5';
  } else if (saved?.provider === 'anthropic') {
    field('baseUrl').value = ''; field('model').value = 'translate';
  }
});
document.querySelector('#test')!.addEventListener('click', async () => {
  const button = document.querySelector<HTMLButtonElement>('#test')!;
  button.disabled = true; show('正在发送测试句子 Hello, world.（使用已保存设置，会产生 API 调用）…');
  try { const result = await request('testConnection'); show(`连接成功：${result[0]}`); }
  catch (error) { show((error as Error).message, true); }
  finally { button.disabled = false; }
});
document.querySelector('#clear')!.addEventListener('click', async () => {
  if (!confirm('清除本机保存的 API Key 和设置？')) return;
  try { await request('clearSettings'); apply(await request('getSettings')); show('配置和 Key 已清除。'); }
  catch (error) { show((error as Error).message, true); }
});
request('getSettings').then(apply).catch(error => show(error.message, true));
