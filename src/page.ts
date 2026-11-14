export type Mode = 'bilingual' | 'translated';
export interface PageStatus { active: boolean; mode: Mode; total: number; done: number; failed: number; pending: number; error: string }
type Translator = (texts: string[]) => Promise<string[]>;
const SKIP = 'script,style,noscript,pre,code,kbd,samp,svg,math,textarea,input,select,button,option,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-pt-owned]';
const HEADINGS = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
const PARAGRAPHS = `p,${HEADINGS},li,td,th,dt,dd,blockquote,figcaption`;
interface NodeText { node: Text; source: string; translated?: string }
interface RecordEntry { block: Element; nodes: NodeText[]; state: 'pending' | 'working' | 'done' | 'error'; output?: HTMLElement; error?: string; values?: string[] }
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
export function collect(document: Document, sourceOf: (node: Text) => string = node => node.data): Map<Element, NodeText[]> {
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
    const block = blockOf(parent);
    const nodes = groups.get(block) ?? [];
    nodes.push({ node: text, source }); groups.set(block, nodes);
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
  constructor(private document: Document, private translator: Translator) {
    this.observer = new document.defaultView!.MutationObserver(() => this.scheduleScan());
  }
  private scheduleScan() {
    // A bounded throttle, not a trailing debounce: busy pages must still be scanned.
    if (!this.active || this.timer !== undefined) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.scan(); }, 180);
  }
  private observe() {
    if (this.active) this.observer.observe(this.document, {
      childList: true, characterData: true, subtree: true, attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'class', 'style', 'translate', 'contenteditable', 'open'],
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
    if (!this.active) { this.active = true; this.epoch++; }
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
      record.block.contains(n.node) && n.node.data === (n.translated ?? n.source));
  }
  private restore(record: RecordEntry) {
    record.output?.remove(); record.output = undefined;
    for (const n of record.nodes) {
      if (n.translated !== undefined && n.node.data === n.translated) n.node.data = n.source;
      n.translated = undefined;
    }
  }
  private render(record: RecordEntry) {
    if (record.state !== 'done') return;
    // Values are retained separately so switching modes never requires a new API call.
    const values = record.values!;
    record.output?.remove(); record.output = undefined;
    record.nodes.forEach((n, i) => {
      n.node.data = this.mode === 'translated' ? values[i] : n.source;
      n.translated = this.mode === 'translated' ? values[i] : undefined;
    });
    if (this.mode === 'bilingual') {
      const style = this.document.defaultView!.getComputedStyle(record.block);
      const whiteSpace = style.whiteSpace || 'normal';
      const normalize = (text: string) => /^(normal|nowrap)$/.test(whiteSpace) ? text.replace(/[\t\n\r\f ]+/g, ' ').trim() : text.trim();
      const source = normalize(record.nodes.map(n => n.source).join(''));
      const translation = normalize(values.join(''));
      if (!translation || translation === source) return;
      const parentDisplay = record.block.parentElement ? this.document.defaultView!.getComputedStyle(record.block.parentElement).display : '';
      const navigationItem = !!record.block.closest('nav,footer,[role="navigation"],[role="tablist"]') && source.length <= 120;
      const inline = record.block.matches(HEADINGS) ||
        (record.block.matches('li') && navigationItem) ||
        (!record.block.matches(PARAGRAPHS) && (record.block.matches('a,[role="link"],[role="tab"]') ||
          style.display.startsWith('inline') || /^(inline-)?(flex|grid)$/.test(parentDisplay) || navigationItem));
      const output = this.document.createElement('span');
      output.dataset.ptOwned = 'translation'; output.lang = 'und';
      output.style.cssText = inline
        ? 'display:inline!important;margin:0!important;padding:0!important;border-inline-start:0!important;opacity:0.85;'
        : 'display:block!important;margin:0.35em 0!important;padding:0 0 0 0.7em!important;border-inline-start:2px solid #7889a8!important;opacity:0.9;';
      output.style.setProperty('white-space', whiteSpace, 'important');
      output.textContent = inline ? `（${translation}）` : translation;
      record.block.append(output); record.output = output;
    }
  }
  private scan() {
    if (!this.active) return;
    this.mutate(() => {
      // Restore only our untouched writes. Site-authored replacements always win.
      for (const [block, record] of this.records) {
        if (!this.intact(record)) { this.restore(record); this.records.delete(block); }
      }
      const sources = new Map<Text, string>();
      for (const record of this.records.values()) for (const node of record.nodes) sources.set(node.node, node.source);
      // Classify our own translated nodes using their original text (e.g. twenty-five → 25).
      const sourceOf = (node: Text) => sources.get(node) ?? node.data;
      const groups = collect(this.document, sourceOf);
      for (const [block, record] of this.records) {
        const nodes = groups.get(block);
        if (!nodes || nodes.length !== record.nodes.length || nodes.some((n, i) => n.node !== record.nodes[i].node)) {
          this.restore(record); this.records.delete(block);
        }
      }
      // Recollect after restoration so new snapshots never capture our translation as source.
      for (const [block, nodes] of collect(this.document, sourceOf)) {
        if (!this.records.has(block)) this.records.set(block, { block, nodes, state: 'pending' });
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
    const current = (record: RecordEntry) => this.active && epoch === this.epoch && this.records.get(record.block) === record;
    try {
      type Piece = { record: RecordEntry; nodeIndex: number; source: string };
      const pieces: Piece[] = records.flatMap(record => record.nodes.flatMap((node, nodeIndex) =>
        splitText(node.source).map(source => ({ record, nodeIndex, source }))));
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
