import { PageTranslation, type Mode } from './page';

export class FloatingControls {
  private host?: HTMLElement;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private document: Document, private page: PageTranslation, private closeSite: () => Promise<void>) {}
  show() {
    if (this.host) return;
    const host = this.document.createElement('div');
    host.dataset.ptOwned = 'controls';
    host.style.cssText = 'all:initial!important;position:fixed!important;right:8px!important;bottom:8px!important;z-index:2147483647!important;display:grid!important;justify-items:right!important;';
    const root = host.attachShadow({ mode: 'closed' });
    this.host = host;
    const style = this.document.createElement('style');
    style.textContent = `
      :host{color-scheme:light dark}
      section,.trigger{font:13px/1.5 system-ui,sans-serif;background:#fff;color:#243047;border:1px solid #d8dfeb;box-shadow:0 2px 8px #0002}
      section{grid-row:1;border-radius:12px;padding:8px;margin-bottom:6px;width:160px;max-width:calc(100vw - 32px);box-sizing:border-box}
      button,select{font:inherit;display:block;width:100%;box-sizing:border-box;border:1px solid #d8dfeb;border-radius:7px;padding:7px;margin:4px 0;background:#fff;color:#243047;cursor:pointer}
      .trigger{grid-row:2;border-radius:50%;width:36px;height:36px;margin:0;padding:0;font-size:16px;font-weight:600}
      button.primary{background:#3159a7;color:#fff;border-color:#3159a7}
      p{font-size:11px;margin:6px 2px;overflow-wrap:anywhere}
      button:focus-visible,select:focus-visible{outline:2px solid #6287d1;outline-offset:2px}
      [hidden]{display:none}
      @media(prefers-color-scheme:dark){section,button,select,.trigger{background:#202838;color:#e5ebf6;border-color:#495570}}
    `;
    const trigger = this.document.createElement('button');
    trigger.className = 'trigger'; trigger.textContent = '译';
    const section = this.document.createElement('section');
    section.id = 'controls'; section.setAttribute('aria-label', '网页翻译快捷工具');
    trigger.setAttribute('aria-controls', section.id);
    const action = this.document.createElement('button');
    action.className = 'primary'; action.title = '将当前网页文本发送至配置的 API';
    action.addEventListener('click', event => {
      if (!event.isTrusted) return;
      if (this.page.status().active) {
        this.page.stop(); update();
      } else {
        this.page.start(); setExpanded(false); trigger.focus();
      }
    });
    const mode = this.document.createElement('select');
    mode.setAttribute('aria-label', '翻译显示方式');
    for (const [value, label] of [['bilingual', '双语对照'], ['translated', '仅译文']]) {
      const option = this.document.createElement('option'); option.value = value; option.textContent = label; mode.append(option);
    }
    mode.addEventListener('change', event => {
      if (event.isTrusted) this.page.setMode(mode.value as Mode);
      update();
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
    const update = () => {
      if (section.hidden) return;
      const state = this.page.status();
      action.textContent = state.active ? '恢复原文 / 停止' : '翻译';
      mode.value = state.mode; mode.hidden = !state.active;
      status.hidden = !state.active;
      const message = state.error || (state.total ? `${state.done}/${state.total} 段${state.pending ? ' · 翻译中' : ' · 完成'}` : '没有可翻译内容');
      if (status.textContent !== message) status.textContent = message;
    };
    const setExpanded = (expanded: boolean) => {
      section.hidden = !expanded;
      trigger.setAttribute('aria-expanded', String(expanded));
      trigger.title = expanded ? '收起网页翻译工具' : '展开网页翻译工具';
      trigger.setAttribute('aria-label', trigger.title);
      update();
    };
    trigger.addEventListener('click', event => {
      if (event.isTrusted) setExpanded(section.hidden === true);
    });
    host.addEventListener('keydown', event => {
      if (event.isTrusted && event.key === 'Escape' && !section.hidden) {
        event.stopPropagation(); setExpanded(false); trigger.focus();
      }
    });
    setExpanded(false);
    section.append(action, mode, status, close, closeError); root.append(style, trigger, section);
    this.document.documentElement.append(host);
    this.timer = setInterval(() => {
      if (!host.isConnected) this.document.documentElement.append(host);
      update();
    }, 600);
  }
  hide() {
    clearInterval(this.timer); this.timer = undefined;
    this.host?.remove(); this.host = undefined;
  }
}
