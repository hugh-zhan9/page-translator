import { describe, expect, it, vi } from 'vitest';
import { parseTranslations, responseText, safeError, translate } from '../src/provider';
import type { Settings } from '../src/config';
const settings: Settings = { provider: 'responses', baseUrl: 'https://api.example.com', apiKey: 'test-only-key', model: 'translate', targetLanguage: '简体中文' };
const output = (text = '{"translations":["你好"]}') => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
describe('translation protocols', () => {
  it('accepts exact JSON and the observed single fenced JSON, rejects missing or malformed items', () => {
    expect(parseTranslations('```json\n{"translations":["你好"]}\n```', 1)).toEqual(['你好']);
    for (const text of ['{}', '{"translations":[]}', '{"translations":[1]}', '{"translations":[""]}', 'translation: {"translations":["a"]}', '```json\n{}\n``` trailing']) {
      expect(() => parseTranslations(text, 1)).toThrow();
    }
  });
  it('uses Responses at the supplied base path, no version guessing, redirects, cookies or fallback', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(output()));
    expect(await translate(settings, ['Hello'], fetcher)).toEqual(['你好']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/responses');
    expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'translate', input: '{"texts":["Hello"]}', stream: false });
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-only-key');
  });
  it('supports Chat Completions as a separate configured protocol', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"translations":["你好"]}' } }] }));
    expect(await translate({ ...settings, provider: 'chat', baseUrl: 'https://api.example.com/v1' }, ['Hello'], fetcher)).toEqual(['你好']);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
  });
  it('calls the native Anthropic SDK with no retries or fallback', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: '{"translations":["你好"]}' }] }));
    expect(await translate({ ...settings, provider: 'anthropic', model: 'claude-opus-5-5' }, ['Hello'], fetcher)).toEqual(['你好']);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/messages');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-only-key');
    expect(JSON.parse(init.body as string).fallbacks).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects incomplete/refused responses, wrong counts and HTTP errors without leaking server bodies', async () => {
    for (const data of [{ ...output(), status: 'incomplete' }, { ...output(), error: { message: 'secret' } },
      { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }]) {
      expect(() => responseText(data, 'responses')).toThrow();
    }
    expect(() => responseText({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }, 'chat')).toThrow();
    await expect(translate(settings, ['a', 'b'], async () => Response.json(output()))).rejects.toThrow('数量');
    const fetcher = vi.fn<typeof fetch>(async () => new Response('test-only-key server body', { status: 403 }));
    await expect(translate(settings, ['a'], fetcher)).rejects.toThrow('HTTP 403');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(safeError(new Error('403 test-only-key upstream body'))).not.toContain('test-only-key');
  });
});
