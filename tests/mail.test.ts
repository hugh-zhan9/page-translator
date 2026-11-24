// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://mail.163.com/"}
import { expect, it, vi } from 'vitest';
import { PageTranslation } from '../src/page';

it('handles an unlabelled NetEase reader, a plaintext body and inbox fields without touching code or composing frames', async () => {
  document.body.innerHTML = '<ul><li><a href="#open"><span class="mail-sender">Sender</span><span id="subject">New message</span><time>Monday</time></a></li></ul><div class="gRead-content"><pre>Inline message body.</pre></div><iframe></iframe><iframe></iframe>';
  const [reader, compose] = [...document.querySelectorAll('iframe')].map(frame => frame.contentDocument!);
  reader.body.innerHTML = '<div id="contentDiv"><div><pre>Message in a nested container.</pre></div><pre><code>private code</code></pre></div>';
  compose.body.innerHTML = '<div id="contentDiv" contenteditable="true">Private draft</div>';
  const translate = vi.fn(async (texts: string[]) => texts.map(t => `译${t}`));
  const page = new PageTranslation(document, translate);
  try {
    expect(document.location.hostname).toBe('mail.163.com');
    page.start();
    await vi.waitFor(() => expect(reader.querySelector('pre > [data-pt-owned]')?.textContent).toBe('译Message in a nested container.'));
    expect(document.querySelector('#subject > [data-pt-owned]')?.textContent).toBe('（译New message）');
    expect(document.querySelector('.gRead-content pre > [data-pt-owned]')?.textContent).toBe('译Inline message body.');
    expect(translate.mock.calls.flatMap(([texts]) => texts).sort()).toEqual(['Inline message body.', 'Message in a nested container.', 'New message']);
  } finally { page.stop(); document.body.replaceChildren(); }
});
