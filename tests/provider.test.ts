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
  it('returns Chinese UI text verbatim without sending an all-Chinese batch', async () => {
    const texts = [' 收件箱（2） ', '使用 Gmail 登录', '查看 API 设置', '打开 GitHub 通知', '芙蓉碧潭', '11月23日', '支付成功 ¥128.00'];
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(output()));
    expect(await translate(settings, texts, fetcher)).toEqual(texts);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends mixed-language subjects and sentences and restores each result to its original position', async () => {
    const subject = '会议通知：Review';
    const sentence = '这封邮件很重要，请在回复前确认所有细节。Please read it carefully.';
    const texts = ['收件箱', subject, '已发送', sentence, subject, '草稿'];
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(output('{"translations":["会议通知：审阅","请仔细阅读。","会议通知：复核"]}')));
    expect(await translate(settings, texts, fetcher)).toEqual(['收件箱', '会议通知：审阅', '已发送', '请仔细阅读。', '会议通知：复核', '草稿']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(JSON.parse(request.input)).toEqual({ texts: [subject, sentence, subject] });
  });
  it.each(['中文', 'Chinese', 'zh'])('accepts both scripts for the generic target %s', async targetLanguage => {
    const texts = ['邮箱', '郵箱'];
    const fetcher = vi.fn<typeof fetch>();
    expect(await translate({ ...settings, targetLanguage }, texts, fetcher)).toEqual(texts);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ['简体中文', '设置与帮助', '設定與幫助'],
    ['zh-Hans', '已发送邮件', '已傳送郵件'],
    ['Chinese (Simplified)', '账户信息', '帳戶資訊'],
    ['繁體中文', '帳戶設定', '账户设置'],
    ['zh-TW', '電子郵件', '电子邮件'],
    ['Traditional Chinese', '開啟通知', '开启通知'],
  ])('keeps matching text and sends differing scripts for %s', async (targetLanguage, matching, differing) => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(output()));
    expect(await translate({ ...settings, targetLanguage }, [matching, differing], fetcher)).toEqual([matching, '你好']);
    expect(JSON.parse(JSON.parse(fetcher.mock.calls[0][1]!.body as string).input)).toEqual({ texts: [differing] });
  });
  it('submits Chinese for non-Chinese targets and text containing other scripts for Chinese targets', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(output('{"translations":["Inbox"]}')));
    for (const targetLanguage of ['English', '日语', 'English and Chinese']) {
      expect(await translate({ ...settings, targetLanguage }, ['收件箱'], fetcher)).toEqual(['Inbox']);
    }
    for (const text of ['新しい受信箱', '使用 한국어', '查看 отчёт', '邮件 café']) {
      expect(await translate(settings, [text], fetcher)).toEqual(['Inbox']);
    }
  });
  it('checks original limits and URL safety before skipping and checks response count against items sent', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(output('{"translations":["一","二"]}')));
    await expect(translate(settings, Array(17).fill('收件箱'), fetcher)).rejects.toThrow('翻译分块');
    await expect(translate(settings, ['收件箱', ' '], fetcher)).rejects.toThrow('翻译分块');
    await expect(translate({ ...settings, baseUrl: 'http://example.org' }, ['收件箱'], fetcher)).rejects.toThrow('HTTPS');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(translate(settings, ['收件箱', 'Hello'], fetcher)).rejects.toThrow('数量');
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
