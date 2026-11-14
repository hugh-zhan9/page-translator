import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const linkedSource = 'Cognitive surrender is a term coined by Steven Shaw and Gideon Nave at Wharton. It fits neatly what I have been seeing.';
const linkedTranslation = '认知放弃这个术语由 史蒂文·肖和吉迪恩·内夫 在沃顿商学院提出。它恰好描述了我一直观察到的现象。';
const linkedParts = new Map([
  ['Cognitive surrender is a term coined by ', '认知放弃这个术语由'],
  ['Steven Shaw and Gideon Nave', '史蒂文·肖和吉迪恩·内夫'],
  [' at Wharton. It fits neatly what I have been seeing.', '在沃顿商学院提出。它恰好描述了我一直观察到的现象。'],
]);
const fixture = '<!doctype html><html><head><title>Translation fixture</title></head><body><main><h1>A readable webpage</h1><p id="paragraph">Hello <a id="link" href="#original">world</a>.</p><div id="linked-paragraph" style="max-width:1000px;font:24px/1.6 sans-serif;padding:24px">Cognitive surrender is a term coined by <a id="authors" href="#authors-target"><div style="display:inline">Steven Shaw and Gideon Nave</div></a> at Wharton. It fits neatly what I have been seeing.</div><p translate="no">Private text</p><details><summary>Public summary</summary><p>Hidden private details</p>Hidden direct details</details><div style="content-visibility:hidden"><p>Hidden private subtree</p></div><pre>const untouched = true;</pre><div contenteditable="true">Editable draft</div></main></body></html>';
const layoutParts = new Map([
  ['Explore', '探索'], ['Topics', '话题'], ['Trending', '热门'], ['Collections', '合集'], ['Events', '活动'],
  ['See what the community is most excited about today.', '看看社区今天最热门的内容。'],
  ['example /', '示例 /'], ['review-tool', 'review-tool'],
  ['Secure, fast code review with precise comments and support for multiple languages.', '安全、快速的代码审查，提供精确注释并支持多种语言。'],
  ['Go', 'Go'], ['Built by', '贡献者'], ['215 stars today', '今日新增 215 个星标'],
  ['© 2026 Example, Inc.', '© 2026 Example, Inc.'], ['Terms', '条款'], ['Privacy', '隐私'], ['Security', '安全'], ['Docs', '文档'],
]);
const layoutFixture = `<!doctype html><html><head><title>Compact translation fixture</title><style>
body{margin:0;color:#26313d;background:#fff;font:16px/1.5 sans-serif}main{max-width:1100px;margin:auto;padding:24px}
nav,footer ul,.metadata{display:flex;align-items:center;gap:20px;flex-wrap:wrap}a{color:#1769ba;text-decoration:none}nav{padding:12px 0}.hero{text-align:center;background:#f5f7f9;padding:24px}h1{font-size:32px;margin:0 0 12px}.hero p{margin:0}article{margin:24px 0;padding:20px;border:1px solid #cdd4dc;border-radius:6px}h2{font-size:23px;margin:0 0 12px}article p{max-width:750px}.metadata{font-size:14px;color:#56616f}.metadata>span{display:inline-block}.today{margin-left:auto}footer ul{list-style:none;padding:0;gap:16px;font-size:14px}
</style></head><body><main><nav aria-label="Sections"><a href="#explore">Explore</a><a href="#topics">Topics</a><a href="#trending">Trending</a><a href="#collections">Collections</a><a href="#events">Events</a></nav><section class="hero"><h1>Trending</h1><p>
    See what the community is most excited about today.
  </p></section><article><h2>
    <a href="#repository">
      <span>example /</span>
      review-tool
    </a>
  </h2><p>
    Secure, fast code review with precise comments and support for multiple languages.
  </p><div class="metadata">
    <span>Go</span>
    <a href="#stars">50,861</a>
    <a href="#forks">3,787</a>
    <span>Built by</span>
    <span class="today">215 stars today</span>
  </div></article><footer><ul><li>© 2026 Example, Inc.</li><li><a href="#terms">Terms</a></li><li><a href="#privacy">Privacy</a></li><li><a href="#security">Security</a></li><li><a href="#docs">Docs</a></li></ul></footer></main></body></html>`;
const requests = [];
const server = createServer(async (req, res) => {
  if (req.method === 'POST') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const data = JSON.parse(raw); requests.push({ url: req.url, data });
    const texts = JSON.parse(data.input ?? data.messages?.at(-1).content ?? '{}').texts;
    const translated = JSON.stringify({ translations: texts.map(t => linkedParts.get(t) ?? layoutParts.get(t.trim()) ?? `译${t.trim()}`) });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '```json\n' + translated + '\n```' }] }] }));
  } else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(req.url === '/layout' ? layoutFixture : fixture); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(tmpdir(), 'page-translator-test-'));
let context;
try {
  const executablePath = process.env.BROWSER_PATH;
  context = await chromium.launchPersistentContext(profile, {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }), headless: true,
    args: [`--disable-extensions-except=${root}dist`, `--load-extension=${root}dist`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => {
    globalThis.senderDiagnostics = [];
    chrome.runtime.onMessage.addListener((message, sender) => { globalThis.senderDiagnostics.push({ type: message.type, id: sender.id, url: sender.url, frameId: sender.frameId, tab: sender.tab?.id }); });
  });
  const permissionsPage = await context.newPage();
  await permissionsPage.goto('chrome://extensions');
  await permissionsPage.evaluate(async ({ id, address }) => {
    await chrome.developerPrivate.addHostPermission(id, `http://${new URL(address).hostname}/*`);
  }, { id, address });
  await permissionsPage.close();
  const options = await context.newPage();
  const errors = [];
  options.on('pageerror', e => errors.push(e.message));
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForFunction(() => document.querySelector('input[name=apiKey]').placeholder.length > 0);
  await options.locator('input[name=baseUrl]').fill(address);
  await options.locator('input[name=apiKey]').fill('browser-test-placeholder');
  await options.getByRole('button', { name: '保存并授权 API' }).click();
  // Headless Chromium may show a native permission prompt. Grant only the local fixture origin via CDP if supported.
  await options.waitForFunction(() => document.querySelector('#status').textContent.length > 0, undefined, { timeout: 10_000 }).catch(async error => {
    console.log('Save diagnostics', await worker.evaluate(async () => ({ senders: globalThis.senderDiagnostics, permissions: await chrome.permissions.getAll() })));
    throw error;
  });
  const saveStatus = await options.locator('#status').textContent();
  assert.match(saveStatus, /设置已保存/, `Save failed: ${saveStatus}`);
  await options.getByRole('button', { name: '测试已保存配置' }).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent.startsWith('连接成功'), undefined, { timeout: 15_000 });
  assert.equal(await options.locator('input[name=apiKey]').inputValue(), '');
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await options.screenshot({ path: path.join(root, 'test-results/options.png'), fullPage: true });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const beforeNavigation = requests.length;
  await page.goto(address);
  await page.waitForSelector('[data-pt-owned="controls"]');
  assert.equal(requests.length, beforeNavigation, 'Default floating entry must not send page text');
  assert.equal(await page.locator('[data-pt-owned="translation"]').count(), 0);
  await page.evaluate(() => {
    window.fixtureLink = document.querySelector('#link'); window.fixtureClicks = 0;
    window.fixtureLink.addEventListener('click', () => window.fixtureClicks++);
    window.authorsLink = document.querySelector('#authors'); window.authorsClicks = 0;
    window.authorsLink.addEventListener('click', () => window.authorsClicks++);
  });
  const linkedOriginal = await page.locator('#linked-paragraph').innerHTML();
  // Headless Chrome does not expose the toolbar bubble as a Playwright Page.
  // Load the same popup document in an inactive extension tab; keep the fixture active.
  const popup = await context.newPage();
  await page.bringToFront();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  popup.on('pageerror', e => errors.push(e.message));
  await popup.getByRole('button', { name: '翻译当前页' }).click();
  await page.waitForSelector('#paragraph [data-pt-owned]');
  assert.equal(await page.locator('#paragraph').evaluate(el => el.firstChild.data), 'Hello ');
  await page.waitForSelector('#linked-paragraph > [data-pt-owned="translation"]');
  assert.equal(await page.locator('#linked-paragraph [data-pt-owned="translation"]').count(), 1);
  assert.equal(await page.locator('#authors [data-pt-owned]').count(), 0);
  assert.equal(await page.locator('#linked-paragraph > [data-pt-owned="translation"]').textContent(), linkedTranslation);
  assert.equal(await page.locator('#linked-paragraph').textContent(), linkedSource + linkedTranslation);
  const layout = await page.locator('#linked-paragraph').evaluate(el => {
    const output = el.querySelector('[data-pt-owned="translation"]');
    const range = document.createRange(); range.setStart(el, 0); range.setEndBefore(output);
    return { originalBottom: range.getBoundingClientRect().bottom, translationTop: output.getBoundingClientRect().top };
  });
  assert.ok(layout.translationTop >= layout.originalBottom, 'Translation must appear below the whole original paragraph');
  await page.locator('#linked-paragraph').screenshot({ path: path.join(root, 'test-results/inline-link-bilingual.png') });
  await popup.selectOption('#mode', 'translated');
  await page.waitForFunction(() => document.querySelector('#paragraph').firstChild.data.startsWith('译'));
  assert.equal(await page.evaluate(() => window.fixtureLink === document.querySelector('#link')), true);
  await page.locator('#link').click();
  assert.equal(await page.evaluate(() => window.fixtureClicks), 1);
  assert.equal(await page.locator('#linked-paragraph').textContent(), linkedTranslation);
  assert.equal(await page.evaluate(() => window.authorsLink === document.querySelector('#authors')), true);
  await page.locator('#authors').click();
  assert.equal(await page.evaluate(() => window.authorsClicks), 1);
  await page.evaluate(() => {
    const p = document.createElement('p'); p.id = 'dynamic'; p.textContent = 'New content'; document.querySelector('main').append(p);
    window.fixtureInterval = setInterval(() => document.body.classList.toggle('unrelated'), 30);
  });
  await page.waitForFunction(() => document.querySelector('#dynamic').textContent.startsWith('译'));
  await page.evaluate(() => clearInterval(window.fixtureInterval));
  await popup.selectOption('#mode', 'bilingual');
  await page.waitForSelector('#paragraph [data-pt-owned]');
  await page.screenshot({ path: path.join(root, 'test-results/bilingual.png'), fullPage: true });
  const count = requests.length;
  await popup.getByRole('button', { name: '恢复原文' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-pt-owned="translation"]'));
  assert.equal(await page.locator('#paragraph').textContent(), 'Hello world.');
  assert.equal(requests.length, count);
  assert.equal(await page.locator('#linked-paragraph').innerHTML(), linkedOriginal);
  await popup.getByRole('button', { name: '翻译当前页' }).click();
  await page.waitForSelector('#paragraph [data-pt-owned]');
  await page.evaluate(() => {
    const body = document.createElement('body'); body.innerHTML = '<p id="replaced">Replacement body</p>';
    document.body.replaceWith(body);
  });
  await page.waitForSelector('#replaced [data-pt-owned]');
  await popup.getByRole('button', { name: '恢复原文' }).click();
  await page.waitForFunction(() => document.body.textContent === 'Replacement body');
  const protectedTexts = requests.flatMap(r => JSON.parse(r.data.input).texts).join(' ');
  assert.ok(!protectedTexts.includes('Private text') && !protectedTexts.includes('untouched') && !protectedTexts.includes('Editable draft') && !protectedTexts.includes('Hidden private') && !protectedTexts.includes('Hidden direct'));
  const isolation = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
    return chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
      let denied = false;
      try { await chrome.storage.local.get('settings'); } catch { denied = true; }
      const result = await chrome.runtime.sendMessage({ type: 'getSettings' });
      return { denied, allowed: result.ok };
    } });
  });
  assert.deepEqual(isolation[0].result, { denied: true, allowed: false });
  // The default entry is present before any site opt-in and never auto-translates.
  assert.equal(await page.locator('[data-pt-owned="controls"]').count(), 1);
  const beforeEnable = requests.length;
  assert.equal((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 0);
  await page.reload();
  await page.waitForSelector('[data-pt-owned="controls"]');
  assert.equal(requests.length, beforeEnable, 'Reload must not send text');
  // Use real pointer input; the controls intentionally live in a closed shadow root.
  const clickFloating = async () => {
    const box = await page.locator('[data-pt-owned="controls"]').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 26);
  };
  await clickFloating();
  await page.waitForSelector('#paragraph [data-pt-owned="translation"]');
  const afterFloating = requests.length;
  assert.equal(afterFloating - beforeEnable, 1, 'Fixture paragraphs must share one request');
  await clickFloating();
  await page.waitForFunction(() => !document.querySelector('[data-pt-owned="translation"]'));
  assert.equal(requests.length, afterFloating);
  await clickFloating();
  await page.waitForSelector('#paragraph [data-pt-owned="translation"]');
  // Close through trusted pointer input inside the closed shadow root.
  const controlsBox = await page.locator('[data-pt-owned="controls"]').boundingBox();
  await page.mouse.click(controlsBox.x + controlsBox.width / 2, controlsBox.y + controlsBox.height - 20);
  await page.waitForFunction(() => !document.querySelector('[data-pt-owned]'));
  assert.equal(await page.locator('#paragraph').textContent(), 'Hello world.');
  await page.reload();
  assert.equal(await page.locator('[data-pt-owned="controls"]').count(), 0);
  // Re-enable via the popup after a persisted close.
  await popup.reload();
  await popup.locator('#site').click();
  await page.waitForSelector('[data-pt-owned="controls"]');
  await clickFloating();
  await page.waitForSelector('#paragraph [data-pt-owned="translation"]');
  await clickFloating();
  await page.waitForFunction(() => !document.querySelector('[data-pt-owned="translation"]'));
  assert.equal(await page.locator('#paragraph').textContent(), 'Hello world.');
  const otherPage = await context.newPage();
  const otherPopup = await context.newPage();
  await otherPopup.goto(`chrome-extension://${id}/popup.html`);
  // A neutral fixture exercises the title/card/footer layout from the reported screenshots.
  otherPage.on('pageerror', e => errors.push(e.message));
  await otherPage.goto(address + '/layout');
  await otherPage.setViewportSize({ width: 1280, height: 900 });
  const originalLayout = await otherPage.locator('body').innerHTML();
  const originalSizes = await otherPage.evaluate(() => Object.fromEntries(['nav', 'h1', 'article', 'footer'].map(selector => [selector, document.querySelector(selector).getBoundingClientRect().height])));
  await otherPage.screenshot({ path: path.join(root, 'test-results/compact-layout-before.png'), fullPage: true });
  await otherPage.bringToFront(); await otherPopup.reload();
  await otherPopup.selectOption('#mode', 'bilingual');
  await otherPopup.getByRole('button', { name: '翻译当前页' }).click();
  await otherPage.waitForFunction(() => document.querySelectorAll('[data-pt-owned="translation"]').length === 15).catch(async error => {
    console.log('Layout diagnostics', await otherPage.locator('main').innerText(), await otherPopup.locator('#status').textContent());
    throw error;
  });
  assert.equal(await otherPage.locator('h1').textContent(), 'Trending（热门）');
  assert.equal(await otherPage.locator('nav a').first().textContent(), 'Explore（探索）');
  assert.equal(await otherPage.locator('.metadata > [data-pt-owned]').count(), 0);
  assert.equal(await otherPage.locator('.metadata a [data-pt-owned]').count(), 0);
  assert.equal(await otherPage.locator('footer li').first().locator('[data-pt-owned]').count(), 0);
  assert.equal(await otherPage.locator('h2 > [data-pt-owned]').textContent(), '（示例 / review-tool）');
  assert.ok(await otherPage.locator('nav [data-pt-owned],h1 [data-pt-owned],h2 [data-pt-owned],.metadata [data-pt-owned],footer [data-pt-owned]').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display === 'inline')));
  const compactSizes = await otherPage.evaluate(() => Object.fromEntries(['nav', 'h1', 'article', 'footer'].map(selector => [selector, document.querySelector(selector).getBoundingClientRect().height])));
  assert.ok(compactSizes.h1 <= originalSizes.h1 + 1, 'Heading must keep one line when there is room');
  assert.ok(compactSizes.article <= originalSizes.article + 100, 'Card must not expand from source indentation');
  assert.ok(compactSizes.footer <= originalSizes.footer + 30, 'Footer must stay compact');
  await otherPage.screenshot({ path: path.join(root, 'test-results/compact-layout-bilingual.png'), fullPage: true });
  await otherPage.setViewportSize({ width: 390, height: 844 });
  assert.ok(await otherPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Compact translations must not cause horizontal page overflow');
  await otherPage.screenshot({ path: path.join(root, 'test-results/compact-layout-mobile.png'), fullPage: true });
  const beforeModeChanges = requests.length;
  await otherPopup.selectOption('#mode', 'translated');
  await otherPage.waitForFunction(() => document.querySelector('h1').textContent === '热门');
  await otherPopup.selectOption('#mode', 'bilingual');
  await otherPage.waitForFunction(() => document.querySelector('h1').textContent === 'Trending（热门）');
  await otherPopup.getByRole('button', { name: '恢复原文' }).click();
  await otherPage.waitForFunction(() => !document.querySelector('[data-pt-owned="translation"]'));
  assert.equal(await otherPage.locator('body').innerHTML(), originalLayout);
  assert.equal(requests.length, beforeModeChanges);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ browser: process.env.BROWSER_PATH?.includes('Microsoft Edge') ? 'Microsoft Edge' : 'Chromium', version: context.browser().version(), extensionLoaded: true, settings: true, responses: true,
    bilingual: true, inlineLinkParagraph: true, inlineLinkLayout: true, compactHeadings: true, compactMetadata: true, compactFooter: true, mobileLayout: true, translated: true, restore: true, dynamicContent: true, continuousUpdates: true, bodyReplacement: true, hiddenContentExcluded: true,
    floatingControls: true, defaultFloatingControls: true, siteReload: true, siteDisable: true, siteReenable: true, batchedRequests: true, linkListenerPreserved: true, contentScriptKeyAccessDenied: true, requests: requests.length, pageErrors: errors.length }));
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
