import { PageTranslation, type Mode } from './page';

export class FloatingControls {
  private host?: HTMLElement;
  private root?: ShadowRoot;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private document: Document, private page: PageTranslation, private closeSite: () => Promise<void>) {}
  show() {
    if (this.host) return;
    const host = this.document.createElement('div');
    host.dataset.ptOwned = 'controls';
    host.style.cssText = 'all:initial!important;position:fixed!important;right:12px!important;top:40%!important;z-index:2147483647!important;display:block!important;';
    const root = host.attachShadow({ mode: 'closed' });
    this.host = host; this.root = root;
    const style = this.document.createElement('style');
    style.textContent = ':host{color-scheme:light dark}section{font:13px/1.5 system-ui,sans-serif;background:#fff;color:#243047;border:1px solid #d8dfeb;border-radius:12px;padding:8px;box-shadow:0 4px 18px #0002;max-width:184px}button,select{font:inherit;display:block;width:100%;box-sizing:border-box;border:1px solid #d8dfeb;border-radius:7px;padding:7px;margin:4px 0;background:#fff;color:#243047;cursor:pointer}button.primary{background:#3159a7;color:#fff;border-color:#3159a7}p{font-size:11px;margin:6px 2px;overflow-wrap:anywhere}button:focus-visible,select:focus-visible{outline:2px solid #6287d1;outline-offset:2px}@media(prefers-color-scheme:dark){section,button,select{background:#202838;color:#e5ebf6;border-color:#495570}}';
    const section = this.document.createElement('section');
    section.setAttribute('aria-label', '网页翻译快捷工具');
    const action = this.document.createElement('button');
    action.className = 'primary'; action.textContent = '翻译'; action.title = '将当前网页文本发送至配置的 API';
    action.addEventListener('click', event => {
      if (!event.isTrusted) return;
      if (this.page.status().active) this.page.stop(); else this.page.start();
      this.update();
    });
    const mode = this.document.createElement('select');
    mode.setAttribute('aria-label', '翻译显示方式');
    for (const [value, label] of [['bilingual', '双语对照'], ['translated', '仅译文']]) {
      const option = this.document.createElement('option'); option.value = value; option.textContent = label; mode.append(option);
    }
    mode.addEventListener('change', event => {
      if (event.isTrusted) this.page.setMode(mode.value as Mode);
      this.update();
    });
    const status = this.document.createElement('p'); status.setAttribute('role', 'status');
    const close = this.document.createElement('button');
    close.textContent = '关闭此网站'; close.title = '记住关闭状态；可从扩展弹窗重新开启';
    close.style.cssText = 'font-size:11px;padding:3px;border:0;margin-bottom:0;';
    const closeError = this.document.createElement('p'); closeError.setAttribute('role', 'alert'); closeError.hidden = true;
    close.addEventListener('click', event => {
      if (!event.isTrusted) return;
      close.disabled = true; closeError.hidden = true;
      void this.closeSite().catch(error => {
        closeError.textContent = error instanceof Error ? error.message : '无法关闭此网站悬浮按钮。'; closeError.hidden = false;
      }).finally(() => { close.disabled = false; });
    });
    section.append(action, mode, status, close, closeError); root.append(style, section);
    this.document.documentElement.append(host);
    this.timer = setInterval(() => {
      if (this.host && !this.host.isConnected) this.document.documentElement.append(this.host);
      this.update();
    }, 600);
    this.update();
  }
  private update() {
    if (!this.root) return;
    const state = this.page.status();
    const action = this.root.querySelector('button')!;
    action.textContent = state.active ? '恢复原文 / 停止' : '翻译';
    const mode = this.root.querySelector('select')!;
    mode.value = state.mode; mode.hidden = !state.active;
    const status = this.root.querySelector('p')!;
    status.hidden = !state.active;
    status.textContent = state.error || (state.total ? `${state.done}/${state.total} 段${state.pending ? ' · 翻译中' : ' · 完成'}` : '没有可翻译内容');
  }
  hide() {
    clearInterval(this.timer); this.timer = undefined;
    this.host?.remove(); this.host = undefined; this.root = undefined;
  }
}
