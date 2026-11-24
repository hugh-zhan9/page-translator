export type Mode = 'bilingual' | 'translated';
export interface PageStatus { active: boolean; mode: Mode; total: number; done: number; failed: number; pending: number; error: string }
type Translator = (texts: string[]) => Promise<string[]>;
const SKIP = 'script,style,noscript,code,kbd,samp,svg,math,textarea,input,select,button,option,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-pt-owned]';
const MAIL_BODY = '[aria-label="邮件正文"],[aria-label="Message body" i],.mail-plain,#mailContent';
const NETEASE_READER = '.gRead-content,[id^="_mail_read_"],#contentDiv';
const MAIL_META = 'time,[data-field="sender"],[data-field="from"],[data-field="date"],.mail-sender,.mail-date';
const MAIL_ROWS = 'tr,[role="row"],.mail-row,.nui-list-item';
const MAIL_DATE = /^(?:今天|昨天|昨日|前天|\d{1,2}月\d{1,2}日|\d{1,2}:\d{2}(?::\d{2})?)$/u;
function neteaseMail(document: Document): boolean {
  return /(^|\.)mail\.163\.com$/.test(document.location.hostname);
}
function mailRow(element: Element): Element | null {
  const webmail = neteaseMail(element.ownerDocument);
  if (element.closest(MAIL_BODY) || (webmail && element.closest(NETEASE_READER))) return null;
  const row = element.closest(webmail ? `${MAIL_ROWS},li,[role="option"],div:has(> .nui-chk),div:has(> input[type="checkbox"])` : MAIL_ROWS);
  if (!row) return null;
  return webmail || row.matches('.mail-row') || row.querySelector('[data-field="sender"],[data-field="subject"]') ? row : null;
}
function mailField(row: Element, element: Element): Element {
  const named = element.closest('[role="gridcell"],[role="cell"],td,[data-field],.mail-subject');
  if (named && row.contains(named)) return named;
  // Some inboxes wrap all columns in one clickable element. Walk through that shell
  // until the subject has an actual sibling field so the annotation stays in its column.
  for (let parent = row; parent !== element;) {
    const children = [...parent.children];
    const field = children.find(child => child.contains(element));
    if (!field) break;
    if (children.some(child => child !== field && !child.matches(SKIP) && child.textContent?.trim())) return field;
    parent = field;
  }
  return element;
}
function afterSource(block: Element, nodes: NodeText[], output: HTMLElement) {
  // In mail rows the subject may be direct text followed by a date or action span.
  let last: Node = nodes[nodes.length - 1].node;
  while (last.parentNode && last.parentNode !== block) last = last.parentNode;
  block.insertBefore(output, last.parentNode === block ? last.nextSibling : null);
}
function clearInboxTooltip(block: Element, output: HTMLElement) {
  if (output.dataset.ptTooltip === block.getAttribute('title')) block.removeAttribute('title');
  delete output.dataset.ptTooltip;
}
function fitInboxTranslation(block: Element, output: HTMLElement, lastSource: Text) {
  clearInboxTooltip(block, output);
  output.style.setProperty('display', 'inline', 'important');
  output.style.setProperty('white-space', 'nowrap', 'important');
  output.style.removeProperty('overflow-wrap');
  // Use the actual output geometry, including bold text, links and the subject's font.
  const rects = output.getClientRects();
  // A plain inline wrapper has no column of its own. Leave its natural wrapping alone.
  if (!block.clientWidth || !rects.length) return;
  const blockBox = block.getBoundingClientRect();
  const doc = block.ownerDocument;
  const range = doc.createRange();
  range.selectNodeContents(lastSource);
  const sourceRects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
  const last = sourceRects.at(-1);
  if (!last) return;
  const fits = rects.length === 1 && rects[0].top < last.bottom && rects[0].bottom > last.top &&
    rects[0].right <= blockBox.left + block.clientLeft + block.clientWidth + 1 && rects[0].left >= blockBox.left - 1;
  if (fits) return;
  output.style.setProperty('display', 'block', 'important');
  output.style.setProperty('white-space', 'normal', 'important');
  output.style.overflowWrap = 'anywhere';
  const row = mailRow(block);
  if (row && output.getBoundingClientRect().bottom > row.getBoundingClientRect().bottom + 1) {
    // A fixed-height row cannot admit another line. An inline tooltip trigger
    // would also be clipped, so place the full bilingual tooltip on the subject.
    output.style.setProperty('display', 'none', 'important');
    if (!block.hasAttribute('title')) {
      block.setAttribute('title', output.title);
      output.dataset.ptTooltip = output.title;
    }
  }
}
function readerDocument(frame: HTMLIFrameElement): Document | null {
  const parent = frame.ownerDocument;
  const identified = frame.closest(MAIL_BODY) || /邮件正文|mail content|message body/i.test(`${frame.title} ${frame.name} ${frame.getAttribute('aria-label') ?? ''}`) ||
    (neteaseMail(parent) && (frame.matches('.oD0,[id^="readmail" i]') || frame.closest('.gRead-content') || /\/read(?:\/|html\.)/i.test(frame.getAttribute('src') ?? '')));
  if ((!identified && !neteaseMail(parent)) || !frame.isConnected || frame.closest(SKIP + ',pre,[hidden],[aria-hidden="true"]') ||
    (frame.hasAttribute('sandbox') && !frame.getAttribute('sandbox')!.toLowerCase().split(/\s+/).includes('allow-same-origin'))) return null;
  for (let el: Element | null = frame; el; el = el.parentElement) {
    const style = parent.defaultView!.getComputedStyle(el);
    if (style.display === 'none' || /^(hidden|collapse)$/.test(style.visibility) || style.contentVisibility === 'hidden' ||
      (el === frame && (parseFloat(style.width) <= 1 || parseFloat(style.height) <= 1)) ||
      (el.matches('details:not([open])') && !el.querySelector(':scope > summary')?.contains(frame))) return null;
  }
  // contentDocument is null for inaccessible frames. Check the loaded document as well as the embedding context.
  const child = frame.contentDocument;
  if (!child || (child.location.origin !== parent.location.origin && !/^about:(blank|srcdoc)$/.test(child.URL))) return null;
  if (!child.body || child.contentType !== 'text/html' || child.designMode?.toLowerCase() === 'on') return null;
  // NetEase can initialize an untitled reader in about:blank before populating the message container.
  return identified || child.querySelector(MAIL_BODY + ',#contentDiv') ? child : null;
}
const HEADINGS = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
const PARAGRAPHS = `p,${HEADINGS},li,td,th,dt,dd,blockquote,figcaption`;
const LINK_ATTRIBUTES = ['target', 'rel', 'download', 'referrerpolicy', 'title'] as const;
interface NodeText { node: Text; source: string; link: HTMLAnchorElement | null; translated?: string }
interface RecordEntry { block: Element; nodes: NodeText[]; state: 'pending' | 'working' | 'done' | 'error'; output?: HTMLElement; error?: string; values?: string[]; presentation?: string }
const TEXT_STYLES = ['font-weight', 'font-style', 'font-size', 'font-family', 'font-variant', 'line-height',
  'letter-spacing', 'word-spacing', 'color', 'background-color', 'text-decoration-line', 'text-decoration-style',
  'text-decoration-color', 'text-decoration-thickness', 'vertical-align', 'white-space'] as const;
const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup']);
type TextView = string | { tag: string; styles: [string, string][]; attributes: [string, string][]; children: TextView[] };
function translatedView(document: Document, record: RecordEntry): TextView[] {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (element: Element) => {
    if (!styles.has(element)) styles.set(element, document.defaultView!.getComputedStyle(element));
    return styles.get(element)!;
  };
  const ancestors = new Set<Element>();
  const parts = record.nodes.map((node, i) => {
    for (let element = node.node.parentElement; element && element !== record.block; element = element.parentElement) ancestors.add(element);
    const whiteSpace = styleOf(node.node.parentElement!).whiteSpace || styleOf(record.block).whiteSpace || 'normal';
    const collapse = /^(normal|nowrap)$/.test(whiteSpace);
    return { node: node.node, collapse, text: collapse ? record.values![i].replace(/[\t\n\r\f ]+/g, ' ') : record.values![i] };
  });
  // Trim paragraph edges only; never trim the two sides of each styled fragment.
  let seenText = false, trailingSpace = false;
  for (const part of parts) {
    if (!seenText) part.text = part.text.trimStart();
    else if (part.collapse && trailingSpace) part.text = part.text.replace(/^ /, '');
    if (part.text) { seenText = true; trailingSpace = part.collapse && part.text.endsWith(' '); }
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    parts[i].text = parts[i].text.trimEnd();
    if (parts[i].text) break;
  }
  const texts = new Map(parts.map(part => [part.node, part.text]));
  const insideLink = record.block.closest('a');
  function project(node: Node): TextView[] {
    if (node.nodeType === 3) return texts.has(node as Text) ? [texts.get(node as Text)!] : [];
    if (node.nodeType !== 1) return [];
    const element = node as HTMLElement;
    const tag = element.localName;
    if (element.closest(SKIP)) return [];
    const style = styleOf(element);
    if (element.hidden || element.getAttribute('aria-hidden') === 'true' || style.display === 'none' ||
      ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden') return [];
    if (tag === 'br') return [{ tag: 'br', styles: [], attributes: [], children: [] }];
    if (!ancestors.has(element)) {
      // A visible inline wrapper may contain only a break, so it has no managed text ancestor path.
      const inline = !style.display || style.display.startsWith('inline') || style.display === 'contents';
      if (!inline || element.matches(PARAGRAPHS + ',details') || !element.querySelector('br')) return [];
    }
    const children = [...element.childNodes].flatMap(project);
    if (!children.length) return [];
    const view: Exclude<TextView, string> = { tag: INLINE_TAGS.has(tag) ? tag : 'span',
      styles: TEXT_STYLES.map(name => [name, style.getPropertyValue(name)]), attributes: [], children };
    if (!insideLink && tag === 'a') {
      const link = element as HTMLAnchorElement;
      if (link.hasAttribute('href') && /^(https?:|mailto:|tel:)$/.test(link.protocol)) {
        view.tag = 'a';
        // Raw href preserves native relative URL resolution after history/base changes.
        view.attributes.push(['href', link.getAttribute('href')!]);
        for (const name of LINK_ATTRIBUTES) {
          const value = link.getAttribute(name);
          if (value !== null && name !== 'rel') view.attributes.push([name, value]);
        }
        view.attributes.push(['rel', [...link.relList].filter(token => token.toLowerCase() !== 'opener').concat('noopener').join(' ')]);
        view.styles.push(['text-decoration-line', 'underline']);
      }
    }
    return [view];
  }
  return [...record.block.childNodes].flatMap(project);
}
function appendView(document: Document, parent: Node, views: TextView[]) {
  for (const view of views) {
    if (typeof view === 'string') { parent.appendChild(document.createTextNode(view)); continue; }
    const element = document.createElement(view.tag);
    for (const [name, value] of view.styles) if (value) element.style.setProperty(name, value, 'important');
    if (view.tag !== 'br') element.style.setProperty('display', 'inline', 'important');
    for (const [name, value] of view.attributes) element.setAttribute(name, value);
    appendView(document, element, view.children); parent.appendChild(element);
  }
}
export function splitText(text: string, limit = 2400): string[] {
  const result: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let end = limit;
    const prefix = rest.slice(0, limit);
    const boundary = Math.max(prefix.lastIndexOf('. '), prefix.lastIndexOf('。'), prefix.lastIndexOf('\n'), prefix.lastIndexOf(' '));
    if (boundary > limit / 2) end = boundary + 1;
    const c = rest.charCodeAt(end - 1);
    if (c >= 0xd800 && c <= 0xdbff) end--;
    result.push(rest.slice(0, end)); rest = rest.slice(end);
  }
  if (rest) result.push(rest);
  return result;
}
export function collect(document: Document, sourceOf: (node: Text) => string = node => node.data, reader = false): Map<Element, NodeText[]> {
  const groups = new Map<Element, NodeText[]>();
  if (!document.body) return groups;
  const visibility = new Map<Element, boolean>();
  const styles = new Map<Element, CSSStyleDeclaration>();
  const blocks = new Map<Element, Element>();
  function styleOf(element: Element): CSSStyleDeclaration {
    if (!styles.has(element)) styles.set(element, document.defaultView!.getComputedStyle(element));
    return styles.get(element)!;
  }
  function blockOf(element: Element): Element {
    if (blocks.has(element)) return blocks.get(element)!;
    let block = element;
    const parent = element.parentElement;
    const paragraph = element.closest(PARAGRAPHS);
    const link = element.closest('a,[role="link"]');
    if (paragraph && (paragraph === element || paragraph.matches(`p,${HEADINGS}`))) {
      // Text paragraphs/headings own inline descendants, including flex children.
      // Structural containers (quotes, list items, cells) can contain separate blocks.
      block = paragraph;
    } else if (link && link !== element) {
      block = blockOf(link);
    } else if (parent && element !== document.body) {
      const display = styleOf(element).display;
      const inline = !display || display.startsWith('inline') || display === 'contents' || display === 'ruby' || display.startsWith('ruby-');
      const layoutItem = /^(inline-)?(flex|grid)$/.test(styleOf(parent).display);
      const navigationLink = !!link && !paragraph && !!element.closest('nav,footer,[role="navigation"],[role="tablist"]');
      const standaloneItem = display.startsWith('inline-') && !link &&
        ![...parent.childNodes].some(node => node.nodeType === 3 && /\p{L}/u.test(sourceOf(node as Text)));
      if (inline && !layoutItem && !navigationLink && !standaloneItem) block = blockOf(parent);
    }
    blocks.set(element, block); return block;
  }
  function visible(element: Element): boolean {
    if (visibility.has(element)) return visibility.get(element)!;
    const style = styleOf(element);
    const yes = !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true' &&
      style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.contentVisibility !== 'hidden' &&
      (!element.parentElement || visible(element.parentElement));
    visibility.set(element, yes); return yes;
  }
  function inClosedDetails(node: Text): boolean {
    for (let element = node.parentElement; element; element = element.parentElement) {
      if (element.tagName === 'DETAILS' && !element.hasAttribute('open')) {
        const summary = [...element.children].find(child => child.tagName === 'SUMMARY');
        if (!summary?.contains(node)) return true;
      }
    }
    return false;
  }
  const walker = document.createTreeWalker(document.body, 4);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    const parent = text.parentElement;
    const source = sourceOf(text);
    if (!parent || !source || parent.closest(SKIP) || !visible(parent) || inClosedDetails(text)) continue;
    const pre = parent.closest('pre');
    if (pre) {
      // Some readers put a whole plaintext message in a single pre. Code samples remain protected.
      const plainBody = pre.closest(MAIL_BODY) || ((reader || neteaseMail(document)) && pre.closest(NETEASE_READER)) ||
        (reader && (pre.parentElement === document.body || document.body.querySelectorAll('pre').length === 1));
      if (!plainBody || pre.matches('[class*="language-"],[class*="highlight"],[data-language]') ||
        /^\s*(?:#!|(?:const|let|var)\s+[\w$]+\s*=|(?:async\s+)?function\s+[\w$]+\s*\(|(?:class|def)\s+\w+\s*[(:{])/u.test(source)) continue;
    }
    const row = reader ? null : mailRow(parent);
    if (row && (parent.closest(MAIL_META) || MAIL_DATE.test(source.trim()))) continue;
    // Mail list rows can position inline sender, subject and time spans as independent columns.
    const block = pre ?? (row ? mailField(row, parent) : blockOf(parent));
    const nodes = groups.get(block) ?? [];
    nodes.push({ node: text, source, link: parent.closest<HTMLAnchorElement>('a') }); groups.set(block, nodes);
  }
  // Keep separators inside a paragraph, but do not translate empty layout containers.
  for (const [block, nodes] of groups) {
    if (!nodes.some(n => /\p{L}/u.test(n.source))) groups.delete(block);
  }
  return groups;
}
export class PageTranslation {
  private active = false;
  private mode: Mode = 'bilingual';
  private epoch = 0;
  private records = new Map<Element, RecordEntry>();
  private observer: MutationObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private workers = 0;
  private readers = new Map<Document, HTMLIFrameElement>();
  private onResize = () => this.scheduleScan();
  private onFrameLoad = (event: Event) => {
    if ((event.target as Element)?.localName === 'iframe') this.scheduleScan();
  };
  constructor(private document: Document, private translator: Translator) {
    this.observer = new document.defaultView!.MutationObserver(() => this.scheduleScan());
  }
  private scheduleScan() {
    // A bounded throttle, not a trailing debounce: busy pages must still be scanned.
    if (!this.active || this.timer !== undefined) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.scan(); }, 180);
  }
  private observe() {
    if (!this.active) return;
    for (const doc of [this.document, ...this.readers.keys()]) this.observer.observe(doc, {
      childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'class', 'style', 'translate', 'contenteditable', 'open', 'href', 'src', 'srcdoc', 'sandbox', 'aria-label', ...LINK_ATTRIBUTES],
    });
  }
  private mutate(action: () => void) {
    // disconnect() drops queued records; preserve site changes before hiding our own writes.
    if (this.observer.takeRecords().length) this.scheduleScan();
    this.observer.disconnect();
    try { action(); } finally { this.observe(); }
  }
  start(mode: Mode = 'bilingual'): PageStatus {
    this.mode = mode;
    if (!this.active) {
      this.active = true; this.epoch++;
      this.document.defaultView!.addEventListener('resize', this.onResize);
      this.document.addEventListener('load', this.onFrameLoad, true);
    }
    this.mutate(() => { for (const record of this.records.values()) if (this.intact(record)) this.render(record); });
    this.scan(); return this.status();
  }
  setMode(mode: Mode): PageStatus {
    this.mode = mode;
    this.mutate(() => { for (const record of this.records.values()) if (this.intact(record)) this.render(record); });
    this.scan(); return this.status();
  }
  stop(): PageStatus {
    this.active = false; this.epoch++; clearTimeout(this.timer); this.timer = undefined; this.observer.disconnect();
    this.document.defaultView!.removeEventListener('resize', this.onResize);
    this.document.removeEventListener('load', this.onFrameLoad, true);
    this.readers.clear();
    for (const record of this.records.values()) this.restore(record);
    this.records.clear(); return this.status();
  }
  status(): PageStatus {
    const records = [...this.records.values()];
    return { active: this.active, mode: this.mode, total: records.length,
      done: records.filter(r => r.state === 'done').length,
      failed: records.filter(r => r.state === 'error').length,
      pending: records.filter(r => r.state === 'pending' || r.state === 'working').length,
      error: records.find(r => r.error)?.error ?? '' };
  }
  private intact(record: RecordEntry): boolean {
    return record.block.isConnected && record.nodes.every(n => n.node.isConnected &&
      record.block.contains(n.node) && n.node.parentElement?.closest('a') === n.link && n.node.data === (n.translated ?? n.source));
  }
  private restore(record: RecordEntry) {
    if (record.output) {
      clearInboxTooltip(record.block, record.output);
      record.output.remove(); record.output = undefined;
    }
    for (const n of record.nodes) {
      if (n.translated !== undefined && n.node.data === n.translated) n.node.data = n.source;
      n.translated = undefined;
    }
  }
  private render(record: RecordEntry, projected?: TextView[]) {
    if (record.state !== 'done') return;
    // Values are retained separately so switching modes never requires a new API call.
    const values = record.values!;
    const document = record.block.ownerDocument;
    const view = projected ?? translatedView(document, record);
    record.presentation = JSON.stringify(view);
    if (record.output) {
      clearInboxTooltip(record.block, record.output);
      record.output.remove(); record.output = undefined;
    }
    record.nodes.forEach((n, i) => {
      n.node.data = this.mode === 'translated' ? values[i] : n.source;
      n.translated = this.mode === 'translated' ? values[i] : undefined;
    });
    if (this.mode === 'bilingual') {
      const style = document.defaultView!.getComputedStyle(record.block);
      const whiteSpace = style.whiteSpace || 'normal';
      const normalize = (text: string) => /^(normal|nowrap)$/.test(whiteSpace) ? text.replace(/[\t\n\r\f ]+/g, ' ').trim() : text.trim();
      const source = normalize(record.nodes.map(n => n.source).join(''));
      const translation = normalize(values.join(''));
      if (!translation || translation === source) return;
      const parentDisplay = record.block.parentElement ? document.defaultView!.getComputedStyle(record.block.parentElement).display : '';
      const navigationItem = !!record.block.closest('nav,footer,[role="navigation"],[role="tablist"]') && source.length <= 120;
      const inboxField = document === this.document && !!mailRow(record.block);
      const inline = inboxField || record.block.matches(HEADINGS) ||
        (record.block.matches('li') && navigationItem) ||
        (!record.block.matches(PARAGRAPHS) && (record.block.matches('a,[role="link"],[role="tab"]') ||
          style.display.startsWith('inline') || /^(inline-)?(flex|grid)$/.test(parentDisplay) || navigationItem));
      const output = document.createElement('span');
      output.dataset.ptOwned = 'translation'; output.lang = 'und';
      output.style.cssText = inline
        ? 'display:inline!important;margin:0!important;padding:0!important;border-inline-start:0!important;opacity:0.85;'
        : 'display:block!important;margin:0.35em 0!important;padding:0 0 0 0.7em!important;border-inline-start:2px solid #7889a8!important;opacity:0.9;';
      output.style.setProperty('white-space', whiteSpace, 'important');
      if (inline) output.append('（');
      appendView(document, output, view);
      if (inline) output.append('）');
      if (inboxField) {
        output.title = `${translation}\n${source}`;
        afterSource(record.block, record.nodes, output);
        fitInboxTranslation(record.block, output, record.nodes.at(-1)!.node);
      } else record.block.append(output);
      record.output = output;
    }
  }
  private scan() {
    if (!this.active) return;
    this.mutate(() => {
      this.readers.clear();
      for (const frame of this.document.querySelectorAll('iframe')) {
        const child = readerDocument(frame);
        if (child) this.readers.set(child, frame);
      }
      // Restore only our untouched writes. Site-authored replacements always win.
      for (const [block, record] of this.records) {
        if ((block.ownerDocument !== this.document && !this.readers.has(block.ownerDocument)) || !this.intact(record)) {
          this.restore(record); this.records.delete(block);
        }
      }
      const sources = new Map<Text, string>();
      for (const record of this.records.values()) for (const node of record.nodes) sources.set(node.node, node.source);
      // Classify our own translated nodes using their original text (e.g. twenty-five → 25).
      const sourceOf = (node: Text) => sources.get(node) ?? node.data;
      const collectAll = () => {
        const groups = collect(this.document, sourceOf);
        for (const doc of this.readers.keys()) for (const [block, nodes] of collect(doc, sourceOf, true)) groups.set(block, nodes);
        return groups;
      };
      const groups = collectAll();
      for (const [block, record] of this.records) {
        const nodes = groups.get(block);
        if (!nodes || nodes.length !== record.nodes.length || nodes.some((n, i) => n.node !== record.nodes[i].node)) {
          this.restore(record); this.records.delete(block);
        }
      }
      // Recollect after restoration so new snapshots never capture our translation as source.
      for (const [block, nodes] of collectAll()) {
        if (!this.records.has(block)) this.records.set(block, { block, nodes, state: 'pending' });
      }
      for (const record of this.records.values()) {
        if (record.state !== 'done') continue;
        const view = translatedView(record.block.ownerDocument, record);
        if (record.presentation !== JSON.stringify(view) || (record.output && !record.output.isConnected)) this.render(record, view);
        else if (record.output && record.block.ownerDocument === this.document && mailRow(record.block)) {
          fitInboxTranslation(record.block, record.output, record.nodes.at(-1)!.node);
        }
      }
    });
    this.pump();
  }
  private pump() {
    while (this.active && this.workers < 3) {
      const batch = [...this.records.values()].filter(r => r.state === 'pending').slice(0, 16);
      if (!batch.length) break;
      batch.forEach(record => { record.state = 'working'; });
      this.workers++;
      const epoch = this.epoch;
      void this.processBatch(batch, epoch).finally(() => { this.workers--; this.pump(); });
    }
  }
  private async processBatch(records: RecordEntry[], epoch: number) {
    const current = (record: RecordEntry) => {
      if (!this.active || epoch !== this.epoch || this.records.get(record.block) !== record) return false;
      const doc = record.block.ownerDocument;
      if (doc === this.document) return true;
      const frame = this.readers.get(doc);
      return !!frame && readerDocument(frame) === doc;
    };
    try {
      type Piece = { record: RecordEntry; nodeIndex: number; source: string };
      const pieces: Piece[] = records.flatMap(record => record.nodes.flatMap((node, nodeIndex) => {
        // Blank lines in a plain mail body are paragraph boundaries, not a single
        // completion target. Keep the separators local and keep each result in order.
        const blocks = record.block.matches('pre') ? node.source.split(/((?:\r?\n[\t ]*){2,})/) : [node.source];
        return blocks.flatMap(block => splitText(block).map(source => ({ record, nodeIndex, source })));
      }));
      const results = new Map<Piece, string>();
      for (const piece of pieces) if (!/\p{L}/u.test(piece.source)) results.set(piece, piece.source);
      const pending = pieces.filter(piece => !results.has(piece));
      const finishReady = () => {
        for (const record of records) {
          if (!current(record) || record.state !== 'working') continue;
          const own = pieces.filter(piece => piece.record === record);
          if (own.some(piece => !results.has(piece))) continue;
          if (!this.intact(record)) { this.scan(); continue; }
          const values = record.nodes.map(() => '');
          for (const piece of own) values[piece.nodeIndex] += results.get(piece)!;
          record.values = values; record.state = 'done'; this.mutate(() => this.render(record));
        }
      };
      let offset = 0;
      while (offset < pending.length) {
        if (!this.active || epoch !== this.epoch) return;
        const request: Piece[] = [];
        let size = 0;
        while (offset < pending.length && request.length < 16 && size + pending[offset].source.length <= 12000) {
          const piece = pending[offset++];
          if (!current(piece.record) || piece.record.state === 'error') continue;
          size += piece.source.length; request.push(piece);
        }
        if (!request.length) continue;
        try {
          const translated = await this.translator(request.map(piece => piece.source));
          if (!this.active || epoch !== this.epoch) return;
          if (translated.length !== request.length) throw new Error('译文数量不正确。');
          request.forEach((piece, index) => {
            const leading = /^\s*/.exec(piece.source)![0], trailing = /\s*$/.exec(piece.source)![0];
            results.set(piece, leading + translated[index].trim() + trailing);
          });
          finishReady();
        } catch (error) {
          for (const { record } of request) if (current(record) && record.state !== 'done') {
            record.state = 'error'; record.error = error instanceof Error ? error.message : '翻译失败。';
          }
        }
      }
      finishReady();
    } catch (error) {
      for (const record of records) if (current(record)) {
        record.state = 'error'; record.error = error instanceof Error ? error.message : '翻译失败。';
      }
    }
  }
}
