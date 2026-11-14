// Opt-in only: LIVE_API_KEY, LIVE_BASE_URL and LIVE_MODEL are read from this process.
// Real credentials stay in process memory: only a placeholder is saved in the disposable browser profile.
import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const key = process.env.LIVE_API_KEY;
const baseUrl = process.env.LIVE_BASE_URL;
const model = process.env.LIVE_MODEL;
if (!key || !baseUrl || !model) throw new Error('Supply LIVE_API_KEY, LIVE_BASE_URL, LIVE_MODEL explicitly. This command invokes a real paid API.');
const base = new URL(baseUrl);
const profile = await mkdtemp(path.join(tmpdir(), 'page-translator-live-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: 'chromium' }), headless: true,
    args: [`--disable-extensions-except=${root}dist`, `--load-extension=${root}dist`],
  });
  let forwarded = 0;
  await context.route(url => url.origin === base.origin, async route => {
    const request = route.request();
    assert.equal(new URL(request.url()).pathname, base.pathname.replace(/\/$/, '') + '/responses');
    assert.equal(JSON.parse(request.postData()).model, model);
    forwarded++;
    await route.continue({ headers: { ...request.headers(), authorization: `Bearer ${key}` } });
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const permissionPage = await context.newPage();
  await permissionPage.goto('chrome://extensions');
  await permissionPage.evaluate(async ({ id, origin }) => chrome.developerPrivate.addHostPermission(id, origin), {
    id, origin: `${base.protocol}//${base.hostname}/*`,
  });
  await permissionPage.close();
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForFunction(() => document.querySelector('input[name=apiKey]').placeholder.length > 0);
  await options.locator('[name=baseUrl]').fill(baseUrl);
  await options.locator('[name=model]').fill(model);
  await options.locator('[name=apiKey]').fill('live-test-placeholder-not-a-real-key');
  await options.getByRole('button', { name: '保存并授权 API' }).click();
  await options.waitForFunction(() => document.querySelector('#status').textContent === '设置已保存。');
  await options.getByRole('button', { name: '测试已保存配置' }).click();
  await options.waitForFunction(() => !document.querySelector('#test').disabled, undefined, { timeout: 110_000 });
  const text = await options.locator('#status').textContent();
  assert.ok(text.startsWith('连接成功'), 'Live extension API request did not succeed; check the API configuration and network.');
  assert.equal(forwarded, 1, 'Expected the real key to be injected in memory exactly once');
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await options.screenshot({ path: path.join(root, 'test-results/live-api.png'), fullPage: true });
  console.log(JSON.stringify({ extensionBackgroundApi: 'Responses', model, result: text, requests: forwarded, credentialsSaved: false }));
} finally {
  if (context) await context.close();
  await rm(profile, { recursive: true, force: true });
}
