// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collect, PageTranslation, splitText } from '../src/page';
const sessions: PageTranslation[] = [];
afterEach(() => { sessions.forEach(s => s.stop()); sessions.length = 0; vi.restoreAllMocks(); document.body.innerHTML = ''; });
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
  it('renders distinct translated links from source nodes, merging wrappers without guessing from repeated words', async () => {
    document.body.innerHTML = '<p>Read <a id="first" href="/first" target="_blank" rel="nofollow opener" style="color:rgb(12, 34, 56)" onclick="return false"><em>the</em> <strong>guide</strong></a>, then <a href="/second">guide</a>.</p>';
    const original = document.body.innerHTML, first = document.querySelector('a')!;
    const clicked = vi.fn(); first.addEventListener('click', clicked);
    const translate = vi.fn(async (texts: string[]) => texts.map(t => ({ Read: '阅读', the: '这份', guide: '指南', ', then': '，然后' })[t.trim()] ?? t));
    const page = make(translate); page.start(); await completed(page);
    const output = document.querySelector('[data-pt-owned="translation"]')!;
    const links = [...output.querySelectorAll('a')];
    expect(links.map(a => a.textContent)).toEqual(['这份 指南', '指南']);
    expect(links.map(a => a.href)).toEqual([new URL('/first', document.baseURI).href, new URL('/second', document.baseURI).href]);
    expect(links[0].target).toBe('_blank');
    expect(links[0].relList.contains('nofollow')).toBe(true);
    expect(links[0].relList.contains('noopener')).toBe(true);
    expect(links[0].relList.contains('opener')).toBe(false);
    expect(links[0].style.color).toBe('rgb(12, 34, 56)');
    expect(links[0].style.textDecorationLine).toBe('underline');
    expect(links[0].style.display).toBe('inline');
    expect(links[0].hasAttribute('id')).toBe(false);
    expect(links[0].hasAttribute('onclick')).toBe(false);
    expect(links[0].querySelector('em')?.textContent).toBe('这份');
    expect(links[0].querySelector('strong')?.textContent).toBe('指南');
    page.setMode('translated');
    expect(document.querySelector('a')).toBe(first);
    first.click(); expect(clicked).toHaveBeenCalledOnce();
    page.setMode('bilingual'); await completed(page);
    expect(document.querySelectorAll('[data-pt-owned] a')).toHaveLength(2);
    expect(translate).toHaveBeenCalledOnce();
    page.stop(); expect(document.body.innerHTML).toBe(original);
  });
  it('keeps heading links clickable without nesting anchors in standalone links or linked cards', async () => {
    document.body.innerHTML = '<h2><a href="#title">Title</a></h2><nav><a href="#docs">Docs</a></nav><a href="#card"><h3>Card</h3><p>Description</p></a>';
    const page = make(); page.start(); await completed(page);
    expect(document.querySelector<HTMLAnchorElement>('h2 > [data-pt-owned] a')?.href).toBe(new URL('#title', document.baseURI).href);
    expect(document.querySelectorAll('a a')).toHaveLength(0);
    expect(document.querySelector('nav a [data-pt-owned]')?.textContent).toBe('（译Docs）');
    expect(document.querySelector('a h3 [data-pt-owned]')?.textContent).toBe('（译Card）');
  });
  it('uses only safe source destinations, not model HTML or copied executable attributes', async () => {
    document.body.innerHTML = '<p>See <a href="java&#10;script:alert(1)">script</a> <a href="data:text/html,bad">data</a> <a href="mailto:test@example.com">email</a> <a href="tel:+123">phone</a> <a href="/safe" ping="/track" onmouseover="alert(1)">safe</a>.</p>';
    const page = make(async texts => texts.map(t => t.trim() === 'safe' ? '<img src=x onerror=alert(1)>' : `译${t}`));
    page.start(); await completed(page);
    const output = document.querySelector('[data-pt-owned]')!;
    expect([...output.querySelectorAll<HTMLAnchorElement>('a[href]')].map(a => a.href)).toEqual(['mailto:test@example.com', 'tel:+123', new URL('/safe', document.baseURI).href]);
    expect(output.querySelector('img,script,[ping],[onmouseover]')).toBeNull();
    expect(output.textContent).toContain('<img src=x onerror=alert(1)>');
  });
  it('keeps relative and fragment destinations aligned after history navigation without DOM changes', async () => {
    const originalUrl = location.href;
    try {
      history.replaceState({}, '', '/old/');
      document.body.innerHTML = '<p>See <a href="#details">details</a> or <a href="guide">guide</a>.</p>';
      const translate = vi.fn(async (texts: string[]) => texts.map(t => `译${t}`));
      const page = make(translate); page.start(); await completed(page);
      history.pushState({}, '', '/new/');
      const originals = [...document.querySelectorAll<HTMLAnchorElement>('p > a')];
      const copies = [...document.querySelectorAll<HTMLAnchorElement>('[data-pt-owned] a')];
      expect(copies.map(a => a.href)).toEqual(originals.map(a => a.href));
      expect(translate).toHaveBeenCalledOnce();
    } finally { history.replaceState({}, '', originalUrl); }
  });
  it('refreshes equivalent raw destinations before a later route change', async () => {
    const originalUrl = location.href;
    try {
      history.replaceState({}, '', '/');
      document.body.innerHTML = '<p>See <a href="/guide">guide</a>.</p>';
      const translate = vi.fn(async (texts: string[]) => texts.map(t => `译${t}`));
      const page = make(translate); page.start(); await completed(page);
      document.querySelector('p > a')!.setAttribute('href', 'guide');
      await vi.waitFor(() => expect(document.querySelector('[data-pt-owned] a')?.getAttribute('href')).toBe('guide'));
      history.pushState({}, '', '/new/');
      expect(document.querySelector<HTMLAnchorElement>('[data-pt-owned] a')?.href).toBe(new URL('guide', location.href).href);
      expect(translate).toHaveBeenCalledOnce();
    } finally { history.replaceState({}, '', originalUrl); }
  });
  it('refreshes translated destinations after source attribute changes without translating again', async () => {
    document.body.innerHTML = '<p>See <a href="/old">guide</a>.</p>';
    const source = document.querySelector('a')!;
    const translate = vi.fn(async (texts: string[]) => texts.map(t => `译${t}`));
    const page = make(translate); page.start(); await completed(page);
    expect(document.querySelector<HTMLAnchorElement>('[data-pt-owned] a')?.href).toBe(new URL('/old', document.baseURI).href);
    source.setAttribute('href', '/new'); source.setAttribute('target', '_blank');
    await vi.waitFor(() => expect(document.querySelector<HTMLAnchorElement>('[data-pt-owned] a')?.href).toBe(new URL('/new', document.baseURI).href));
    expect(document.querySelector<HTMLAnchorElement>('[data-pt-owned] a')?.target).toBe('_blank');
    source.setAttribute('href', 'javascript:alert(1)');
    await vi.waitFor(() => expect(document.querySelector('[data-pt-owned] a[href]')).toBeNull());
    expect(translate).toHaveBeenCalledOnce();
    page.stop(); expect(source.getAttribute('href')).toBe('javascript:alert(1)');
  });
  it('retains whole-paragraph and nested inline formatting, including formatting inside links', async () => {
    document.body.innerHTML = '<p><strong>Build critical thinking every day.</strong></p><p>Read <strong>bold <em>and italic</em></strong>, <u>underlined</u>, <s>deleted</s>, <mark>highlighted</mark>, x<sup>two</sup>, H<sub>two</sub>O and <a href="#guide"><strong>the guide</strong> now</a>.</p>';
    const original = document.body.innerHTML, sourceLink = document.querySelector('a');
    const translate = vi.fn(async (texts: string[]) => texts.map(t => `译${t.trim()}`));
    const page = make(translate); page.start(); await completed(page);
    const outputs = [...document.querySelectorAll('[data-pt-owned="translation"]')];
    expect(outputs[0].querySelector('strong')?.textContent).toBe('译Build critical thinking every day.');
    expect(outputs[1].querySelector('strong em')?.textContent).toBe('译and italic');
    for (const tag of ['u', 's', 'mark', 'sup', 'sub']) expect(outputs[1].querySelector(tag)?.textContent).toContain('译');
    expect(outputs[1].querySelector('a strong')?.textContent).toBe('译the guide');
    expect(outputs[1].querySelectorAll('a')).toHaveLength(1);
    page.setMode('translated'); expect(document.querySelector('a')).toBe(sourceLink);
    page.setMode('bilingual'); expect(document.querySelector('p [data-pt-owned] strong')).not.toBeNull();
    expect(translate).toHaveBeenCalledOnce();
    page.stop(); expect(document.body.innerHTML).toBe(original);
  });
  it('copies computed text formatting without copying layout, selectors, events or protected content', async () => {
    document.body.innerHTML = '<style>.source-format{font-weight:800;font-style:italic;color:rgb(12,34,56);background-color:rgb(255,240,100);font-size:21px;line-height:30px;letter-spacing:2px;position:fixed;width:700px;margin:90px;background-image:url(/not-copied)}</style><p>Normal <span class="source-format" id="styled" onclick="alert(1)">formatted</span> <code>protected</code></p>';
    const page = make(); page.start(); await completed(page);
    const output = document.querySelector('[data-pt-owned]')!;
    const span = output.querySelector<HTMLElement>('span')!;
    expect(span).not.toBeNull();
    expect(span.style.fontWeight).toBe('800'); expect(span.style.fontStyle).toBe('italic');
    expect(span.style.color).toBe('rgb(12, 34, 56)'); expect(span.style.backgroundColor).toBe('rgb(255, 240, 100)');
    expect(span.style.fontSize).toBe('21px'); expect(span.style.lineHeight).toBe('30px'); expect(span.style.letterSpacing).toBe('2px');
    expect(span.style.position).toBe(''); expect(span.style.width).toBe(''); expect(span.style.margin).toBe(''); expect(span.style.backgroundImage).toBe('');
    expect(output.querySelector('[id],[class],[onclick],code,style')).toBeNull();
    expect(output.textContent).not.toContain('protected');
  });
  it('retains explicit breaks and nested pre-wrap without flattening them or exposing hidden breaks', async () => {
    document.body.innerHTML = '<p>First<br>Second <strong>bold<br>next</strong><br hidden><span style="white-space:pre-wrap">line one\n  line two</span></p>';
    const original = document.body.innerHTML;
    const page = make(); page.start(); await completed(page);
    const output = document.querySelector('[data-pt-owned]')!;
    expect(output.querySelectorAll('br')).toHaveLength(2);
    expect(output.querySelector('strong br')).not.toBeNull();
    expect(output.querySelector('span')?.textContent).toBe('译line one\n  line two');
    page.stop(); expect(document.body.innerHTML).toBe(original);
  });
  it('retains visible break-only inline wrappers without copying hidden or protected breaks', async () => {
    document.body.innerHTML = '<p>First<span><b><br></b></span>Second<span hidden><br></span><span translate="no"><br></span><span style="display:none"><br></span></p>';
    const page = make(); page.start(); await completed(page);
    const output = document.querySelector('[data-pt-owned]')!;
    expect(output.querySelectorAll('br')).toHaveLength(1);
    expect(output.querySelector('span b br')).not.toBeNull();
    expect(output.textContent).toBe('译First译Second');
  });
  it('refreshes changed source typography from cached translations and observes resize only during a session', async () => {
    document.body.innerHTML = '<p>Read <span style="font-weight:700">this</span></p>';
    const source = document.querySelector('span')!;
    const translate = vi.fn(async (texts: string[]) => texts.map(t => `译${t}`));
    const page = make(translate); page.start(); await completed(page);
    expect(document.querySelector<HTMLElement>('[data-pt-owned] span')?.style.fontWeight).toBe('700');
    source.style.fontWeight = '400';
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('[data-pt-owned] span')?.style.fontWeight).toBe('400'));
    // Model a media-query change: computed style changes with no source DOM mutation.
    const computedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = computedStyle(element, pseudo);
      if (element !== source) return style;
      const changed = document.createElement('span').style;
      changed.cssText = style.cssText; changed.fontWeight = '900';
      return changed;
    });
    window.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('[data-pt-owned] span')?.style.fontWeight).toBe('900'));
    expect(source.style.fontWeight).toBe('400');
    expect(translate).toHaveBeenCalledOnce();
    page.stop(); window.dispatchEvent(new Event('resize'));
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(document.querySelector('[data-pt-owned]')).toBeNull();
    expect(translate).toHaveBeenCalledOnce();
  });
  it('translates a visible same-origin mail reader, including its plaintext body, in the top session', async () => {
    document.body.innerHTML = '<iframe title="邮件正文"></iframe><iframe title="邮件正文" hidden></iframe><iframe title="Advertisement"></iframe><pre>ordinary protected text</pre>';
    const frames = [...document.querySelectorAll('iframe')];
    const reader = frames[0].contentDocument!;
    reader.body.innerHTML = '<pre>Hello reader!\n\nYour package was published.</pre><pre><code>private code</code></pre><div contenteditable="true">private reply</div>';
    frames[1].contentDocument!.body.textContent = 'hidden message';
    frames[2].contentDocument!.body.textContent = 'unrelated frame';
    const original = reader.body.innerHTML;
    const translate = vi.fn(async (texts: string[]) => texts.map(t => `译${t}`));
    const page = make(translate); page.start(); await completed(page);
    expect(reader.querySelector('pre > [data-pt-owned]')?.textContent).toContain('译Hello reader!');
    expect(translate.mock.calls.flatMap(([texts]) => texts)).toEqual(['Hello reader!', 'Your package was published.']);
    reader.body.insertAdjacentHTML('beforeend', '<p>New mail paragraph</p>');
    await vi.waitFor(() => expect(reader.querySelector('p [data-pt-owned]')?.textContent).toBe('译New mail paragraph'));
    page.setMode('translated'); expect(reader.querySelector('pre')!.textContent).toContain('译Hello reader!');
    expect(translate).toHaveBeenCalledTimes(2);
    page.stop(); reader.querySelector('p')!.remove(); expect(reader.body.innerHTML).toBe(original);
  });
  it('ignores late results for a removed mail reader and restores a newly hidden reader', async () => {
    document.body.innerHTML = '<iframe title="Message body"></iframe>';
    const frame = document.querySelector('iframe')!, doc = frame.contentDocument!;
    doc.body.innerHTML = '<p>First message</p>';
    let finish!: (values: string[]) => void;
    const page = make(() => new Promise(resolve => { finish = resolve; }));
    page.start(); frame.hidden = true; finish(['第一封邮件']);
    await vi.waitFor(() => expect(page.status().total).toBe(0));
    expect(doc.querySelector('[data-pt-owned]')).toBeNull();
    frame.hidden = false;
    await vi.waitFor(() => expect(page.status().pending).toBe(1));
    frame.remove(); finish(['迟到译文']); await completed(page);
    expect(doc.querySelector('[data-pt-owned]')).toBeNull();
  });
  it('handles clickable inbox rows wrapped around unlabelled subject and metadata spans', async () => {
    document.body.innerHTML = '<div class="mail-row"><a href="#open"><span class="mail-sender">Example</span><span class="title"><b>Release</b> details</span><time>Yesterday</time></a></div>';
    const page = make(); page.start(); await completed(page);
    expect(document.querySelector('.title > [data-pt-owned]')?.textContent).toBe('（译Release 译details）');
    expect(document.querySelector('a > [data-pt-owned],time > [data-pt-owned],.mail-sender > [data-pt-owned]')).toBeNull();
  });
  it('sends every prose paragraph of a plaintext email, while protecting marked code', async () => {
    document.body.innerHTML = '<iframe title="Message body"></iframe>';
    const reader = document.querySelector('iframe')!.contentDocument!;
    const parts = ['Hello reader!', 'A new version of Example was published;\nread the notes at https://example.test/releases.', 'The checksum is abc123.', 'Thanks!'];
    reader.body.innerHTML = `<pre>${parts.join('\n\n')}</pre><pre class="language-js">runExample()</pre><pre>const sample = 1;</pre>`;
    const original = reader.body.innerHTML;
    const translator = vi.fn(async (texts: string[]) => texts.map((text) => `译${text.trim()}`));
    const page = make(translator); page.start(); await completed(page);
    expect(translator.mock.calls.flatMap(([texts]) => texts).map(text => text.trim())).toEqual(parts);
    expect(reader.querySelector('pre > [data-pt-owned]')?.textContent).toBe(parts.map(part => `译${part}`).join('\n\n'));
    page.setMode('translated');
    expect(reader.querySelector('pre')?.textContent).toBe(parts.map(part => `译${part}`).join('\n\n'));
    page.stop(); expect(reader.body.innerHTML).toBe(original);
    expect(translator).toHaveBeenCalledOnce();
  });
  it('does not use a shared inbox wrapper containing unlabelled metadata as the subject', async () => {
    document.body.innerHTML = '<div class="mail-row"><input type="checkbox"><a href="#open">Release is ready <span>11月23日</span></a></div>';
    const translator = vi.fn(async (texts: string[]) => texts.map(text => `译${text.trim()}`));
    const page = make(translator); page.start(); await completed(page);
    expect(translator.mock.calls.flatMap(([texts]) => texts).map(text => text.trim())).toEqual(['Release is ready']);
    expect(document.querySelector('a > [data-pt-owned]')?.textContent).toBe('（译Release is ready）');
    expect(document.querySelector('a > span:not([data-pt-owned])')?.textContent).toBe('11月23日');
    expect(document.querySelector('a')?.childNodes[1]).toBe(document.querySelector('[data-pt-owned]'));
  });
  it('keeps mail subject translations inside their column and omits sender and date fields', async () => {
    document.body.innerHTML = '<ul><li role="row"><span data-field="sender">Example Sender</span><span role="gridcell"><b>Package published</b></span><time>Yesterday</time></li></ul>';
    const translate = vi.fn(async (texts: string[]) => texts.map(t => `译${t}`));
    const page = make(translate); page.start(); await completed(page);
    expect(document.querySelector('[role="gridcell"] > [data-pt-owned]')?.textContent).toBe('（译Package published）');
    expect(document.querySelector('li > [data-pt-owned]')).toBeNull();
    expect(translate.mock.calls.flatMap(([texts]) => texts)).toEqual(['Package published']);
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
