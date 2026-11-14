export type Provider = 'responses' | 'chat' | 'anthropic';
export interface Settings {
  provider: Provider;
  baseUrl: string;
  model: string;
  targetLanguage: string;
  apiKey: string;
}
export type PublicSettings = Omit<Settings, 'apiKey'> & { hasApiKey: boolean };
export const DEFAULTS: Settings = {
  provider: 'responses', baseUrl: '', model: 'translate',
  targetLanguage: '简体中文', apiKey: '',
};
export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('API 地址必须是完整 URL。'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('API 必须使用 HTTPS；只有本机回环地址允许 HTTP。');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API 地址不能包含用户名、密码、查询参数或 fragment。');
  }
  return url.href.replace(/\/+$/, '');
}
export function originPattern(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  return `${url.protocol}//${url.hostname}/*`;
}
export function validateSettings(input: unknown, previous?: Settings): Settings {
  if (!input || typeof input !== 'object') throw new Error('无效设置。');
  const x = input as Record<string, unknown>;
  if (!['responses', 'chat', 'anthropic'].includes(String(x.provider))) throw new Error('请选择支持的 API 类型。');
  for (const field of ['baseUrl', 'model', 'targetLanguage', 'apiKey']) {
    if (typeof x[field] !== 'string') throw new Error('设置字段必须是文本。');
  }
  const baseUrl = normalizeBaseUrl(x.baseUrl as string);
  const model = (x.model as string).trim();
  const targetLanguage = (x.targetLanguage as string).trim();
  if (!model || model.length > 160 || !targetLanguage || targetLanguage.length > 80) {
    throw new Error('请填写有效的模型名和目标语言。');
  }
  let apiKey = (x.apiKey as string).trim();
  if (!apiKey && previous?.apiKey) {
    if (new URL(baseUrl).origin !== new URL(previous.baseUrl).origin || x.provider !== previous.provider) {
      throw new Error('更换 API 来源或协议时，请重新填写 Key。');
    }
    apiKey = previous.apiKey;
  }
  if (!apiKey || apiKey.length > 2048 || /[\r\n]/.test(apiKey)) throw new Error('请填写有效 API Key。');
  return { provider: x.provider as Provider, baseUrl, model, targetLanguage, apiKey };
}
export function publicSettings(settings: Settings): PublicSettings {
  const { apiKey, ...rest } = settings;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}
export function validateTexts(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 16 ||
    input.some(x => typeof x !== 'string' || !x.trim() || x.length > 2400) ||
    input.reduce((n, x: string) => n + x.length, 0) > 12000) {
    throw new Error('翻译分块超出限制或包含无效文本。');
  }
  return input;
}
export function allowedSender(sender: chrome.runtime.MessageSender, type: string, id: string): boolean {
  if (sender.id !== id) return false;
  const root = `chrome-extension://${id}/`;
  const trusted = [root + 'options.html', root + 'popup.html'].includes(sender.url ?? '') &&
    (sender.frameId === undefined || sender.frameId === 0);
  if (['getSettings', 'saveSettings', 'clearSettings', 'testConnection', 'setSite', 'getSite'].includes(type)) return trusted;
  return ['translate', 'siteStatus', 'disableSite'].includes(type) && sender.tab?.id !== undefined && sender.frameId === 0 &&
    /^https?:\/\//.test(sender.url ?? '');
}
