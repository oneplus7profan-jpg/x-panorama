'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const oldRoot = process.env.XPANORAMA_PREVIOUS_ROOT
  || 'C:\\Users\\dream\\Documents\\Codex\\2026-08-20\\k\\work\\x-panorama-pwa-deploy-v0.5.0-rc.3';
const newRoot = process.env.XPANORAMA_RC64_ROOT
  || path.resolve(__dirname, '..');
const currentVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'release-version.json'), 'utf8')).version;
const edgePath = process.env.EDGE_PATH
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.XPANORAMA_RC64_PWA_PORT || 8850);
const baseUrl = `http://127.0.0.1:${port}`;
const oldCacheName = `x-panorama:${encodeURIComponent('/')}:0.5.0-rc.3`;
const newCacheName = `x-panorama:${encodeURIComponent('/')}:${currentVersion}`;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png'
};
let deployed = 'old';

const server = http.createServer((request, response) => {
  const url = new URL(request.url, baseUrl);
  if (url.pathname === '/__slow-image-worker.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(`self.onmessage = () => self.postMessage({ type: 'progress', text: 'holding' });`);
    return;
  }
  const root = path.resolve(deployed === 'old' ? oldRoot : newRoot);
  const slowNavigation = url.pathname === '/slow-navigation';
  const relative = url.pathname === '/' || url.pathname === '/offline-probe' || slowNavigation
    ? 'index.html'
    : decodeURIComponent(url.pathname.slice(1));
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (error, body) => {
    const send = () => {
    if (error) {
      response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/'
    });
    response.end(body);
    };
    if (slowNavigation) setTimeout(send, 5000);
    else send();
  });
});

const listen = () => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
const closeServer = () => new Promise((resolve) => server.close(resolve));

async function waitForControlled(page, version) {
  await page.waitForFunction((expected) => window.__xPanoramaTest && window.__xPanoramaTest.APP_VERSION === expected, version);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

async function cacheState(page) {
  return page.evaluate(async () => {
    const names = (await caches.keys()).sort();
    const entries = {};
    for (const name of names) {
      const cache = await caches.open(name);
      entries[name] = (await cache.keys()).map((request) => request.url).sort();
    }
    return { names, entries };
  });
}

(async () => {
  const results = [];
  const failures = [];
  let browser;
  async function test(name, body) {
    try {
      await body();
      results.push({ name, status: 'PASS' });
    } catch (error) {
      failures.push({ name, error: error.stack || String(error) });
      results.push({ name, status: 'FAIL' });
    }
  }

  try {
    await listen();
    browser = await chromium.launch({ executablePath: edgePath, headless: true });

    const migration = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 } });
    const page = await migration.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

    await test('v0.5 RC3 installs and the current release waits without reloading the current project', async () => {
      deployed = 'old';
      await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
      await waitForControlled(page, '0.5.0-rc.3');
      await page.evaluate(() => caches.open('unrelated-app-cache'));
      await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const context = canvas.getContext('2d');
        context.fillStyle = '#2c55c7';
        context.fillRect(0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        await window.__xPanoramaTest.loadSelection([new File([blob], 'keep-current.png', { type: 'image/png' })]);
        window.__xPanoramaTest.showStep(2);
      });
      let navigations = 0;
      const countNavigation = (frame) => { if (frame === page.mainFrame()) navigations += 1; };
      page.on('framenavigated', countNavigation);
      deployed = 'new';
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration.update();
      });
      await page.waitForFunction(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return Boolean(registration && registration.waiting && !document.querySelector('#updateNotice').hidden);
      }, null, { timeout: 30000 });
      await page.waitForTimeout(500);
      page.off('framenavigated', countNavigation);
      const state = await page.evaluate(() => ({
        version: window.__xPanoramaTest.APP_VERSION,
        step: window.__xPanoramaTest.stateSnapshot().step,
        name: window.__xPanoramaTest.stateSnapshot().single.name,
        noticeHidden: document.querySelector('#updateNotice').hidden
      }));
      assert.equal(navigations, 0);
      assert.deepEqual(state, { version: '0.5.0-rc.3', step: 2, name: 'keep-current.png', noticeHidden: false });
    });

    await test('explicit current-release update reloads once, removes the RC3 cache, preserves unrelated cache and works offline', async () => {
      let documentRequests = 0;
      const countDocumentRequest = (request) => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests += 1; };
      page.on('request', countDocumentRequest);
      const navigation = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame(), { timeout: 30000 });
      await page.click('#applyUpdateButton');
      await navigation;
      await page.waitForLoadState('load');
      await waitForControlled(page, currentVersion);
      await page.waitForTimeout(500);
      page.off('request', countDocumentRequest);
      assert.equal(documentRequests, 1);

      const cachesAfter = await cacheState(page);
      assert.ok(cachesAfter.names.includes(newCacheName), JSON.stringify(cachesAfter.names));
      assert.ok(cachesAfter.names.includes('unrelated-app-cache'));
      assert.ok(!cachesAfter.names.includes(oldCacheName));
      assert.equal(cachesAfter.entries[newCacheName].length, 10);
      assert.ok(cachesAfter.entries[newCacheName].some((url) => url.endsWith(`/core.js?v=${currentVersion}`)));
      assert.ok(cachesAfter.entries[newCacheName].some((url) => url.endsWith(`/diagnostics.js?v=${currentVersion}`)));
      assert.ok(cachesAfter.entries[newCacheName].some((url) => url.endsWith(`/app.js?v=${currentVersion}`)));

      await migration.setOffline(true);
      await page.goto(`${baseUrl}/offline-probe`, { waitUntil: 'load' });
      await page.waitForFunction((version) => window.__xPanoramaTest && window.__xPanoramaTest.APP_VERSION === version, currentVersion);
      assert.equal(await page.evaluate(() => document.querySelector('.app-footer > span:last-child').textContent), `v${currentVersion}`);
      await migration.setOffline(false);
    });

    await test('slow navigation falls back to the cached shell after the 2.5 second network budget', async () => {
      const started = Date.now();
      await page.goto(`${baseUrl}/slow-navigation`, { waitUntil: 'load', timeout: 10000 });
      const elapsed = Date.now() - started;
      await page.waitForFunction((version) => window.__xPanoramaTest && window.__xPanoramaTest.APP_VERSION === version, currentVersion);
      assert.ok(elapsed >= 1800 && elapsed < 4500, `navigation took ${elapsed}ms`);
    });

    await test('active image job blocks update activation until the job is cancelled', async () => {
      const isolated = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      const guarded = await isolated.newPage();
      await guarded.goto(`${baseUrl}/?active-update-guard=1`, { waitUntil: 'load' });
      await guarded.waitForFunction(() => Boolean(window.__xPanoramaTest));
      await guarded.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        await window.__xPanoramaTest.loadSelection([new File([blob], 'guard.png', { type: 'image/png' })]);
        window.__IMAGE_WORKER_URL = '/__slow-image-worker.js';
        window.__xUpdatePosts = 0;
        window.__xPanoramaTest.showUpdateNotice({ postMessage() { window.__xUpdatePosts += 1; } });
        window.__xPanoramaTest.showStep(4);
        window.__pendingExport = window.__xPanoramaTest.generateExport();
      });
      await guarded.waitForFunction(() => window.__xPanoramaTest.activeJobInProgress());
      const during = await guarded.evaluate(() => {
        document.querySelector('#applyUpdateButton').dispatchEvent(new Event('click'));
        return { posts: window.__xUpdatePosts, snapshot: window.__xPanoramaTest.stateSnapshot().pwa };
      });
      assert.equal(during.posts, 0);
      assert.equal(during.snapshot.updateDeferred, true);
      assert.equal(during.snapshot.buttonDisabled, true);

      await guarded.evaluate(async () => {
        window.__xPanoramaTest.cancelExport();
        await window.__pendingExport;
      });
      await guarded.waitForFunction(() => !window.__xPanoramaTest.activeJobInProgress());
      const after = await guarded.evaluate(() => window.__xPanoramaTest.stateSnapshot().pwa);
      assert.equal(after.buttonDisabled, false);
      assert.match(after.buttonText, /処理が完了|更新/);
      await isolated.close();
    });

    await test('PWA scenarios have no uncaught page errors', async () => {
      assert.deepEqual(pageErrors, []);
    });
    await migration.close();

    process.stdout.write(`${JSON.stringify({
      passed: results.filter((item) => item.status === 'PASS').length,
      failed: failures.length,
      results,
      failures
    }, null, 2)}\n`);
    if (failures.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server.listening) await closeServer();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

