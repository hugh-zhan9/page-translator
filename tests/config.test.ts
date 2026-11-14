import { describe, expect, it } from 'vitest';
import { allowedSender, normalizeBaseUrl, originPattern, publicSettings, validateSettings, validateTexts, type Settings } from '../src/config';
const base: Settings = { provider: 'responses', baseUrl: 'https://example.com', model: 'translate', targetLanguage: '简体中文', apiKey: 'test-key' };
describe('configuration and message boundaries', () => {
  it('normalizes without inserting a version and permits loopback only for HTTP', () => {
    expect(normalizeBaseUrl(' https://example.com/v1/ ')).toBe('https://example.com/v1');
    expect(normalizeBaseUrl('http://127.0.0.1:1234/')).toBe('http://127.0.0.1:1234');
    expect(originPattern('https://example.com:9443/v1')).toBe('https://example.com/*');
    for (const url of ['http://example.com', 'https://u:p@example.com', 'https://example.com/?key=x', 'https://example.com/#key', 'file:///tmp/a']) {
      expect(() => normalizeBaseUrl(url)).toThrow();
    }
  });
  it('does not return keys and only preserves a key on the same source and protocol', () => {
    expect(publicSettings(base)).toEqual({ provider: 'responses', baseUrl: 'https://example.com', model: 'translate', targetLanguage: '简体中文', hasApiKey: true });
    expect(validateSettings({ ...base, apiKey: '', model: 'other' }, base).apiKey).toBe('test-key');
    expect(() => validateSettings({ ...base, apiKey: '', baseUrl: 'https://other.example' }, base)).toThrow();
    expect(() => validateSettings({ ...base, apiKey: '', provider: 'chat' }, base)).toThrow();
    expect(() => validateSettings({ ...base, apiKey: 'bad\nkey' })).toThrow();
  });
  it('validates empty, single, count, per-item and aggregate limits', () => {
    expect(validateTexts(['a'])).toEqual(['a']);
    expect(validateTexts(['x'.repeat(2400)])).toHaveLength(1);
    for (const input of [[], [' '], [1], ['x'.repeat(2401)], Array(17).fill('a'), Array(6).fill('x'.repeat(2400))]) {
      expect(() => validateTexts(input)).toThrow();
    }
  });
  it('limits settings to exact extension pages and translation to the main content frame', () => {
    const id = 'test-extension';
    const trusted = { id, url: `chrome-extension://${id}/options.html` };
    const page = { id, url: 'https://example.com', tab: { id: 42 }, frameId: 0 } as chrome.runtime.MessageSender;
    expect(allowedSender(trusted, 'saveSettings', id)).toBe(true);
    expect(allowedSender({ ...trusted, tab: { id: 7 }, frameId: 0 } as chrome.runtime.MessageSender, 'saveSettings', id)).toBe(true);
    expect(allowedSender({ ...trusted, frameId: 1 }, 'saveSettings', id)).toBe(false);
    expect(allowedSender(page, 'saveSettings', id)).toBe(false);
    expect(allowedSender(page, 'translate', id)).toBe(true);
    expect(allowedSender(page, 'disableSite', id)).toBe(true);
    expect(allowedSender(page, 'setSite', id)).toBe(false);
    expect(allowedSender(page, 'getSettings', id)).toBe(false);
    expect(allowedSender({ ...page, frameId: 1 }, 'disableSite', id)).toBe(false);
    expect(allowedSender({ ...page, id: 'other' }, 'disableSite', id)).toBe(false);
    expect(allowedSender({ ...page, frameId: 1 }, 'translate', id)).toBe(false);
    expect(allowedSender({ ...trusted, id: 'other' }, 'getSettings', id)).toBe(false);
    expect(allowedSender({ ...trusted, url: 'https://example.com/options.html' }, 'getSettings', id)).toBe(false);
    expect(allowedSender(page, 'unknown', id)).toBe(false);
  });
});
