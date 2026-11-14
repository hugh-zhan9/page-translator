// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collect, PageTranslation, splitText } from '../src/page';
const sessions: PageTranslation[] = [];
afterEach(() => { sessions.forEach(s => s.stop()); sessions.length = 0; document.body.innerHTML = ''; });
const make = (translator = async (texts: string[]) => texts.map(t => `译${t.trim()}`)) => {
  const page = new PageTranslation(document, translator); sessions.push(page); return page;
};
const completed = async (page: PageTranslation) => { await vi.waitFor(() => expect(page.status().pending).toBe(0)); };
describe('live webpage translation', () => {
  it('preserves node identity/listeners and whitespace across bilingual, translated and restore', async () => {
    document.body.innerHTML = '<p>Hello <a href="#target">world</a>.</p><pre>do not translate</pre>';
    const p = document.querySelector('p')!, link = document.querySelector('a')!;
    const original = p.innerHTML;
    const clicked = vi.fn(); link.addEventListener('click', clicked);
    const translate = vi.fn(async (texts: string[]) => texts.map(t => `译${t.trim()}`));
    const page = make(translate); page.start(); await completed(page);
    expect(p.firstChild!.textContent).toBe('Hello ');
    expect(p.querySelector('[data-pt-owned]')!.textContent).toContain('译Hello');
    page.setMode('translated');
    expect(p.querySelector('[data-pt-owned]')).toBeNull();
    expect(p.firstChild!.textContent).toBe('译Hello ');
    expect(document.querySelector('a')).toBe(link);
    link.click(); expect(clicked).toHaveBeenCalledOnce();
    page.setMode('bilingual'); expect(p.firstChild!.textContent).toBe('Hello ');
    page.stop(); expect(p.innerHTML).toBe(original);
    expect(translate).toHaveBeenCalledOnce();
    expect(document.querySelector('pre')!.textContent).toBe('do not translate');
  });
  it.each(['inline', 'inline-block', 'contents'])('keeps a link with a %s wrapper in its surrounding paragraph', async display => {
    document.body.innerHTML = '<div id="paragraph">Cognitive surrender is a term coined by <a href="#authors"><div id="wrapper" style="display:' + display + '">Steven Shaw and Gideon Nave</div></a> at Wharton. It fits neatly what I have been seeing.</div>';
    const paragraph = document.querySelector('#paragraph')!, link = document.querySelector('a')!;
    const original = paragraph.innerHTML;
    const clicked = vi.fn(); link.addEventListener('click', clicked);
    const translations = new Map([
      ['Cognitive surrender is a term coined by ', '认知放弃这个术语由'],
      ['Steven Shaw and Gideon Nave', '史蒂文·肖和吉迪恩·内夫'],
      [' at Wharton. It fits neatly what I have been seeing.', '在沃顿商学院提出。它恰好描述了我一直观察到的现象。'],
    ]);
    const translate = vi.fn(async (texts: string[]) => texts.map(text => translations.get(text)!));
    const page = make(translate); page.start(); await completed(page);
    expect(page.status()).toMatchObject({ total: 1, done: 1, failed: 0 });
    const outputs = paragraph.querySelectorAll('[data-pt-owned="translation"]');
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toBe(paragraph.lastChild);
    expect(outputs[0].textContent).toBe('认知放弃这个术语由 史蒂文·肖和吉迪恩·内夫 在沃顿商学院提出。它恰好描述了我一直观察到的现象。');
    expect(link.querySelector('[data-pt-owned]')).toBeNull();
    page.setMode('translated');
    expect(document.querySelector('a')).toBe(link);
    expect(link.textContent).toBe('史蒂文·肖和吉迪恩·内夫');
    link.click(); expect(clicked).toHaveBeenCalledOnce();
    page.setMode('bilingual');
    expect(paragraph.querySelectorAll('[data-pt-owned="translation"]')).toHaveLength(1);
    expect(translate).toHaveBeenCalledOnce();
    page.stop(); expect(paragraph.innerHTML).toBe(original);
  });
  it('separates CSS block paragraphs while retaining inline punctuation and spaces', async () => {
    document.body.innerHTML = '<section>\n<span style="display:block"><em>Hello</em> <a href="#world">world</a>!</span>\n<span style="display:block">Next paragraph.</span>\n</section>';
    const translate = vi.fn(async (texts: string[]) => texts.map(text => ({ Hello: '你好', world: '世界', 'Next paragraph.': '下一段。' })[text] ?? `unexpected:${text}`));
    const original = document.body.innerHTML;
    const page = make(translate); page.start(); await completed(page);
    expect(page.status()).toMatchObject({ total: 2, done: 2 });
    const paragraphs = [...document.querySelectorAll('section > span')];
    expect(paragraphs.map(p => p.querySelector('[data-pt-owned]')?.textContent)).toEqual(['你好 世界!', '下一段。']);
    expect(translate.mock.calls.flatMap(([texts]) => texts)).toEqual(['Hello', 'world', 'Next paragraph.']);
    page.stop(); expect(document.body.innerHTML).toBe(original);
  });
  it('keeps block children of inline-flex links in the surrounding paragraph', async () => {
    document.body.innerHTML = '<p>See <a href="#details" style="display:inline-flex"><span style="display:block">documentation</span></a> for details.</p>';
    const original = document.body.innerHTML;
    const page = make(); page.start(); await completed(page);
    expect(page.status()).toMatchObject({ total: 1, done: 1 });
    expect(document.querySelector('a [data-pt-owned]')).toBeNull();
    expect(document.querySelector('p > [data-pt-owned]')!.textContent).toContain('documentation');
    page.stop(); expect(document.body.innerHTML).toBe(original);
  });
  it('preserves separate semantic paragraphs even when styled inline-block', async () => {
    document.body.innerHTML = '<main><p style="display:inline-block">First paragraph.</p><p style="display:inline-block">Second paragraph.</p></main>';
    const page = make(); page.start(); await completed(page);
    expect(page.status()).toMatchObject({ total: 2, done: 2 });
    expect([...document.querySelectorAll('p > [data-pt-owned]')].map(n => n.textContent)).toEqual(['译First paragraph.', '译Second paragraph.']);
  });
  it('shows headings and navigation labels inline and restores them without more requests', async () => {
    document.body.innerHTML = '<nav><a href="#topics">Topics</a> <a href="#events">Events</a></nav><h1>Trending</h1><p>A full description.</p><footer><a href="#terms">Terms</a></footer>';
    const original = document.body.innerHTML;
    const translations = new Map([['Topics', '话题'], ['Events', '活动'], ['Trending', '热门'], ['A full description.', '完整说明。'], ['Terms', '条款']]);
    const translate = vi.fn(async (texts: string[]) => texts.map(text => translations.get(text)!));
    const page = make(translate); page.start(); await completed(page);
    for (const [selector, expected] of [['h1', 'Trending（热门）'], ['nav a', 'Topics（话题）'], ['footer a', 'Terms（条款）']]) {
      const element = document.querySelector(selector)!;
      expect(element.textContent).toBe(expected);
      const output = element.querySelector<HTMLElement>('[data-pt-owned]')!;
      expect(output.style.display).toBe('inline');
      expect(output.style.borderInlineStartWidth).toBe('0px');
    }
    expect(document.querySelector<HTMLElement>('p > [data-pt-owned]')!.style.display).toBe('block');
    page.setMode('translated'); expect(document.querySelector('h1')!.textContent).toBe('热门');
    page.setMode('bilingual'); expect(document.querySelector('h1')!.textContent).toBe('Trending（热门）');
    expect(translate).toHaveBeenCalledOnce();
    page.stop(); expect(document.body.innerHTML).toBe(original);
  });
  it('collapses source formatting in normal text and retains intentional pre-wrap', async () => {
    document.body.innerHTML = '<h2>\n    <a href="#repo">\n      <span>example /</span>\n      project\n    </a>\n  </h2><p>\n    A description.\n  </p><p style="white-space:pre-wrap">Line one\nLine two</p>';
    const original = document.body.innerHTML;
    const page = make(); page.start(); await completed(page);
    const title = document.querySelector('h2 > [data-pt-owned]')!;
    expect(title.textContent).toBe('（译example / 译project）');
    const paragraphs = [...document.querySelectorAll<HTMLElement>('p > [data-pt-owned]')];
    expect(paragraphs[0].textContent).toBe('译A description.');
    expect(paragraphs[0].style.whiteSpace).toBe('normal');
    expect(paragraphs[1].textContent).toBe('译Line one\nLine two');
    expect(paragraphs[1].style.whiteSpace).toBe('pre-wrap');
    page.stop(); expect(document.body.innerHTML).toBe(original);
  });
  it('keeps metadata and footer items compact without duplicating unchanged names or numbers', async () => {
    document.body.innerHTML = '<div style="display:flex"><span>Go</span><a href="#stars">50,861</a><span>Built by</span><span>215 stars today</span></div><footer><span>© 2026 Example, Inc.</span><a href="#docs">Docs</a></footer>';
    const original = document.body.innerHTML;
    const translations = new Map([['Go', 'Go'], ['Built by', '贡献者'], ['215 stars today', '今日新增 215 个星标'], ['© 2026 Example, Inc.', '© 2026 Example, Inc.'], ['Docs', '文档']]);
    const translate = vi.fn(async (texts: string[]) => texts.map(text => translations.get(text)!));
    const page = make(translate); page.start(); await completed(page);
    expect(translate.mock.calls.flatMap(([texts]) => texts)).not.toContain('50,861');
    expect(document.querySelectorAll('[data-pt-owned="translation"]')).toHaveLength(3);
    expect(document.querySelector('div')!.textContent).toBe('Go50,861Built by（贡献者）215 stars today（今日新增 215 个星标）');
    expect([...document.querySelectorAll<HTMLElement>('[data-pt-owned="translation"]')].every(output => output.style.display === 'inline')).toBe(true);
    page.stop(); expect(document.body.innerHTML).toBe(original);
  });
  it('keeps standalone inline metadata items separate and navigation list items compact', async () => {
    document.body.innerHTML = '<div><span style="display:inline-block">Language</span> <span style="display:inline-block">Built by</span></div><footer><ul style="display:flex"><li><a href="#terms">Terms</a></li><li><a href="#privacy">Privacy</a></li></ul></footer><a href="#card"><h2>Card title</h2><p>Card description.</p></a>';
    const page = make(); page.start(); await completed(page);
    expect(document.querySelectorAll('div > span > [data-pt-owned]')).toHaveLength(2);
    expect([...document.querySelectorAll<HTMLElement>('li > [data-pt-owned]')].map(output => output.style.display)).toEqual(['inline', 'inline']);
    expect(document.querySelector('h2 > [data-pt-owned]')!.textContent).toBe('（译Card title）');
    expect(document.querySelector('p > [data-pt-owned]')!.textContent).toBe('译Card description.');
  });
  it('preserves separate block paragraphs inside quotes, list items and table cells', async () => {
    document.body.innerHTML = '<blockquote><div>First quote.</div><div>Second quote.</div></blockquote><ul><li><div>First item.</div><div>Second item.</div></li></ul><table><tbody><tr><td><div>First cell.</div><div>Second cell.</div></td></tr></tbody></table>';
    const page = make(); page.start(); await completed(page);
    expect(page.status()).toMatchObject({ total: 6, done: 6 });
    expect(document.querySelectorAll('div > [data-pt-owned]')).toHaveLength(6);
    expect(document.querySelectorAll('blockquote > [data-pt-owned],li > [data-pt-owned],td > [data-pt-owned]')).toHaveLength(0);
  });
  it.each(['<p>twenty-five</p>', '<div>twenty-five <span style="display:inline-block">apples</span></div>'])('keeps numeric translations cached across mode changes and rescans: %s', async html => {
    document.body.innerHTML = html;
    const source = document.body.textContent;
    const expected = html.startsWith('<p>') ? '25' : '25 苹果';
    const translate = vi.fn(async (texts: string[]) => texts.map(text => text.trim() === 'apples' ? '苹果' : '25'));
    const page = make(translate); page.start(); await completed(page);
    page.setMode('translated'); await completed(page);
    document.body.classList.add('unrelated');
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(document.body.textContent).toBe(expected);
    expect(translate).toHaveBeenCalledOnce();
    page.setMode('bilingual'); await completed(page);
    expect(document.querySelector('[data-pt-owned]')!.textContent).toBe(expected);
    page.stop(); expect(document.body.textContent).toBe(source);
  });
  it('skips protected, hidden and editable content, handles empty and single paragraph', async () => {
    document.body.innerHTML = '<p translate="no">private</p><div hidden><p>hidden</p></div><div style="display:none">hidden2</div><div contenteditable="true"><p>draft</p></div><code>secret code</code><input value="secret input"><p>visible</p>';
    expect([...collect(document).values()].flat().map(x => x.source)).toEqual(['visible']);
    const page = make(); page.start(); await completed(page); expect(page.status().done).toBe(1);
    page.stop(); document.body.innerHTML = '<pre>only code</pre>';
    page.start(); expect(page.status().total).toBe(0);
  });
  it('splits long text without losing Unicode or text and respects batch limits', async () => {
    const text = 'Hello 🌍 '.repeat(1400);
    const parts = splitText(text); expect(parts.join('')).toBe(text);
    expect(parts.every(p => p.length <= 2400 && !/[\uD800-\uDBFF]$/.test(p))).toBe(true);
    document.body.innerHTML = '<p></p>'; document.querySelector('p')!.textContent = text;
    const translate = vi.fn(async (texts: string[]) => {
      expect(texts.length).toBeLessThanOrEqual(16); expect(texts.join('').length).toBeLessThanOrEqual(12000);
      return texts;
    });
    const page = make(translate); page.start('translated'); await completed(page);
    expect(document.querySelector('p')!.textContent).toBe(text);
    page.stop(); expect(document.querySelector('p')!.textContent).toBe(text);
  });
  it('translates dynamic text, never duplicates output or translates its own inserted text', async () => {
    document.body.innerHTML = '<p>First</p>';
    const translate = vi.fn(async (texts: string[]) => texts.map(t => `译${t}`));
    const page = make(translate); page.start(); await completed(page);
    const p = document.createElement('p'); p.textContent = 'Second'; document.body.append(p);
    await vi.waitFor(() => expect(page.status().done).toBe(2));
    page.start(); await completed(page);
    expect(document.querySelectorAll('[data-pt-owned]')).toHaveLength(2);
    expect(translate).toHaveBeenCalledTimes(2);
  });
  it('does not overwrite site edits or apply old results after restore', async () => {
    document.body.innerHTML = '<p>Original</p>';
    let resolve!: (value: string[]) => void;
    const page = make(() => new Promise(r => { resolve = r; }));
    page.start(); page.stop(); resolve(['迟到']);
    await Promise.resolve(); await Promise.resolve();
    expect(document.body.textContent).toBe('Original'); expect(document.querySelector('[data-pt-owned]')).toBeNull();
    const other = make(); other.start('translated'); await completed(other);
    document.querySelector('p')!.firstChild!.textContent = 'Site replacement';
    other.stop(); expect(document.body.textContent).toBe('Site replacement');
  });
  it('preserves whitespace-only long chunks without sending empty API inputs', async () => {
    const text = ' '.repeat(5000) + 'Hello' + ' '.repeat(5000);
    const p = document.createElement('p'); p.textContent = text; document.body.append(p);
    const page = make(async texts => { expect(texts.every(t => t.trim().length > 0)).toBe(true); return texts; });
    page.start('translated'); await completed(page);
    expect(page.status().failed).toBe(0); expect(p.textContent).toBe(text);
  });
  it('mode changes do not overwrite a site edit awaiting observer delivery', async () => {
    document.body.innerHTML = '<p>Original</p>';
    const page = make(); page.start(); await completed(page);
    document.querySelector('p')!.firstChild!.textContent = 'Updated by site';
    page.setMode('translated');
    expect(document.querySelector('p')!.firstChild!.textContent).toBe('Updated by site');
    await completed(page);
    expect(document.querySelector('p')!.firstChild!.textContent).toBe('译Updated by site');
    page.stop(); expect(document.body.textContent).toBe('Updated by site');
  });
  it('does not send closed details or content-visibility hidden content', () => {
    document.body.innerHTML = '<details><summary>Public title</summary><p>Hidden details</p>Hidden direct text</details><div style="content-visibility:hidden"><p>Hidden subtree</p></div><p>Visible</p>';
    const texts = [...collect(document).values()].flat().map(n => n.source);
    expect(texts).toEqual(['Public title', 'Visible']);
  });
  it('keeps an undelivered site mutation when an API completion renders first', async () => {
    document.body.innerHTML = '<p>First</p>';
    let release!: () => void;
    const translate = vi.fn(async (texts: string[]) => {
      if (texts[0] === 'First') await new Promise<void>(resolve => { release = resolve; });
      return texts.map(t => `译${t}`);
    });
    const page = make(translate); page.start(); release();
    queueMicrotask(() => { const p = document.createElement('p'); p.textContent = 'Second'; document.body.append(p); });
    await vi.waitFor(() => expect(translate.mock.calls.some(([texts]) => texts.includes('Second'))).toBe(true), { timeout: 800 });
    await completed(page); expect(page.status().done).toBe(2);
  });
  it('eventually scans during continuous unrelated mutations', async () => {
    document.body.innerHTML = '<p>First</p>';
    const translate = vi.fn(async (texts: string[]) => texts.map(t => `译${t}`));
    const page = make(translate); page.start(); await completed(page);
    const p = document.createElement('p'); p.textContent = 'Second'; document.body.append(p);
    const interval = setInterval(() => document.body.classList.toggle('unrelated'), 30);
    try {
      await vi.waitFor(() => expect(translate.mock.calls.some(([texts]) => texts.includes('Second'))).toBe(true), { timeout: 650, interval: 30 });
    } finally { clearInterval(interval); }
  });
  it('keeps observing when a site replaces the body', async () => {
    document.body.innerHTML = '<p>First</p>';
    const page = make(); page.start(); await completed(page);
    const body = document.createElement('body'); body.innerHTML = '<p>New body</p>';
    document.body.replaceWith(body);
    await vi.waitFor(() => expect(body.textContent).toContain('译New body'), { timeout: 800 });
    expect(page.status()).toMatchObject({ total: 1, done: 1 });
    page.stop(); expect(body.textContent).toBe('New body');
  });
  it('batches multiple paragraphs into bounded API requests without losing their mapping', async () => {
    document.body.innerHTML = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i + 1}</p>`).join('');
    const translate = vi.fn(async (texts: string[]) => texts.map(t => `译${t}`));
    const page = make(translate); page.start('translated');
    await vi.waitFor(() => expect(page.status().pending).toBe(0));
    expect(translate.mock.calls.length).toBeLessThanOrEqual(3);
    expect(translate.mock.calls.every(([texts]) => texts.length <= 16 && texts.join('').length <= 12000)).toBe(true);
    expect([...document.querySelectorAll('p')].map(p => p.textContent)).toEqual(Array.from({ length: 40 }, (_, i) => `译Paragraph ${i + 1}`));
  });
  it('keeps successful request batches and surfaces failed-batch originals', async () => {
    document.body.innerHTML = Array.from({ length: 17 }, (_, index) => `<p>paragraph-${index}</p>`).join('');
    const page = make(async texts => {
      if (texts.includes('paragraph-16')) throw new Error('HTTP 403');
      return texts.map(text => `译${text}`);
    });
    page.start('translated'); await completed(page);
    expect(page.status()).toMatchObject({ done: 16, failed: 1, error: 'HTTP 403' });
    expect(document.querySelectorAll('p')[15].textContent).toBe('译paragraph-15');
    expect(document.querySelectorAll('p')[16].textContent).toBe('paragraph-16');
    page.stop(); expect([...document.querySelectorAll('p')].map(p => p.textContent)).toEqual(Array.from({ length: 17 }, (_, i) => `paragraph-${i}`));
  });
});

it('keeps unchanged peers when a source changes during a batched request', async () => {
  document.body.innerHTML = '<p>Old</p><p>Stable</p>';
  let release!: (values: string[]) => void;
  let first = true;
  const page = make(async texts => {
    if (first) { first = false; return new Promise<string[]>(resolve => { release = resolve; }); }
    return texts.map(text => `译${text}`);
  });
  page.start('translated');
  document.querySelector('p')!.firstChild!.textContent = 'New';
  release(['译Old', '译Stable']);
  await completed(page);
  expect([...document.querySelectorAll('p')].map(p => p.textContent)).toEqual(['译New', '译Stable']);
});
it('caps in-flight API requests at three across a long page', async () => {
  document.body.innerHTML = Array.from({ length: 65 }, (_, i) => `<p>Paragraph ${i}</p>`).join('');
  let active = 0, peak = 0;
  const page = make(async texts => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--; return texts;
  });
  page.start(); await completed(page);
  expect(page.status().done).toBe(65);
  expect(peak).toBe(3);
});
