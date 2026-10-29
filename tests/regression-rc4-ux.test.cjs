'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const appRoot = process.env.XPANORAMA_RC64_ROOT
  || path.resolve(__dirname, '..');
const currentVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'release-version.json'), 'utf8')).version;
const fixtureRoot = process.env.XPANORAMA_FIXTURES_DIR
  || 'C:\\Users\\dream\\Documents\\Codex\\2026-08-20\\k\\work\\fixtures\\xpanorama-v040-rc2';
const edgePath = process.env.EDGE_PATH
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.XPANORAMA_RC64_UX_PORT || 8804);
const baseUrl = `http://127.0.0.1:${port}`;
const qaRoot = process.env.XPANORAMA_RC64_UX_QA_ROOT || path.join(path.dirname(appRoot), 'qa-v050-rc4-ux');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png'
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, baseUrl);
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const root = path.resolve(appRoot);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (error, body) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(body);
  });
});

const listen = () => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolve);
});
const closeServer = () => new Promise((resolve) => server.close(resolve));

async function loadFiles(page, names) {
  await page.setInputFiles('#fileInput', names.map((name) => path.join(fixtureRoot, name)));
  await page.waitForFunction(() => document.querySelector('#dropZone')?.dataset.selectionState === 'selected');
}

async function waitForStep(page, step) {
  await page.waitForFunction((value) => window.__xPanoramaTest?.stateSnapshot().step === value, step);
}

async function waitForDiagnostics(page) {
  await page.waitForFunction(() => {
    const value = window.__xPanoramaTest?.stateSnapshot().diagnostics;
    return value && value.status !== 'running';
  });
}

function nearlyEqual(a, b, tolerance = 2) {
  return Math.abs(a - b) <= tolerance;
}

(async () => {
  const results = [];
  const failures = [];
  let browser;

  async function test(name, callback) {
    try {
      await callback();
      results.push({ name, status: 'PASS' });
    } catch (error) {
      const failure = { name, status: 'FAIL', error: error && (error.stack || error.message) || String(error) };
      results.push(failure);
      failures.push(failure);
    }
  }

  try {
    fs.mkdirSync(qaRoot, { recursive: true });
    await listen();
    browser = await chromium.launch({ executablePath: edgePath, headless: true });

    await test('semantic structure, icon system and single Step 4 primary CTA are present in source', async () => {
      const index = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
      const styles = fs.readFileSync(path.join(appRoot, 'styles.css'), 'utf8');
      const app = fs.readFileSync(path.join(appRoot, 'app.js'), 'utf8');
      assert.equal((index.match(/<h1\b/g) || []).length, 1);
      assert.match(index, /class="skip-link"/);
      assert.match(index, /id="diagnosticsOverview"/);
      assert.ok(index.indexOf('class="tab-row"') < index.indexOf('id="diagnosticsOverview"'));
      assert.match(index, /id="gestureHint"[\s\S]*?<\/p>/);
      assert.match(index, /id="gestureInstructions"/);
      assert.match(index, /id="chooseSingleImageButton"/);
      assert.match(index, /id="chooseFourImagesButton"/);
      assert.ok(index.indexOf('class="canvas-wrap"') < index.indexOf('id="gestureHint"'));
      assert.doesNotMatch(index, /id="generateButton"/);
      assert.doesNotMatch(app, /generateButton/);
      assert.match(index, /<svg class="icon"/);
      assert.match(styles, /--control-target-min:\s*48px/);
      assert.match(styles, /touch-action:\s*pan-x pan-y/);
      assert.doesNotMatch(styles, /\.order-thumb\s*\{\s*display:\s*none/);
    });

    await test('runtime semantics expose one h1, unique IDs, a working skip link and no duplicate generate control', async () => {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.__xPanoramaTest));
      const audit = await page.evaluate(() => {
        const ids = Array.from(document.querySelectorAll('[id]')).map((node) => node.id);
        const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
        const hint = document.querySelector('#gestureHint');
        const overview = document.querySelector('#diagnosticsOverview');
        const tabs = document.querySelector('.tab-row');
        return {
          version: window.__xPanoramaTest.APP_VERSION,
          h1: document.querySelectorAll('h1').length,
          duplicates,
          hasGenerate: Boolean(document.querySelector('#generateButton')),
          hintInsideCanvas: Boolean(hint?.closest('.canvas-wrap')),
          overviewAfterTabs: Boolean(overview && tabs && (tabs.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING)),
          skipText: document.querySelector('.skip-link')?.textContent.trim(),
          iconOnlyWithoutName: Array.from(document.querySelectorAll('button')).filter((button) => {
            const visibleText = button.textContent.trim();
            return button.querySelector('svg') && !visibleText && !button.getAttribute('aria-label');
          }).length
        };
      });
      assert.equal(audit.version, currentVersion);
      assert.equal(audit.h1, 1);
      assert.deepEqual(audit.duplicates, []);
      assert.equal(audit.hasGenerate, false);
      assert.equal(audit.hintInsideCanvas, false);
      assert.equal(audit.overviewAfterTabs, true);
      assert.equal(audit.skipText, 'メインコンテンツへ移動');
      assert.equal(audit.iconOnlyWithoutName, 0);
      await page.locator('.skip-link').focus();
      assert.equal(await page.locator('.skip-link').evaluate((node) => getComputedStyle(node).transform === 'none' || node.getBoundingClientRect().top >= 0), true);
      await context.close();
    });

    await test('single-image flow uses an 8px drag threshold and consolidates adjustment announcements', async () => {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.__xPanoramaTest));
      await loadFiles(page, ['fractional-crop.png']);
      await page.click('#nextButton');
      await waitForStep(page, 2);
      assert.equal(await page.evaluate(() => history.state.xPanoramaStep), 2);
      assert.equal(await page.evaluate(() => window.__xPanoramaTest.DRAG_THRESHOLD_PX), 8);

      await page.click('#zoomInButton');
      const canvas = page.locator('#editorCanvas');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      assert.ok(box && box.width > 40 && box.height > 40);
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      const beforeSmall = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 4, startY);
      await page.mouse.up();
      const afterSmall = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
      assert.deepEqual(afterSmall.crop, beforeSmall.crop);
      assert.equal(afterSmall.projectRevision, beforeSmall.projectRevision);

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 20, startY);
      await page.mouse.up();
      await page.waitForFunction(() => window.__xPanoramaTest.stateSnapshot().adjustmentStatus.includes('構図を調整しました'));
      const afterLarge = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
      assert.notDeepEqual(afterLarge.crop, beforeSmall.crop);
      assert.ok(afterLarge.projectRevision > beforeSmall.projectRevision);
      assert.match(afterLarge.adjustmentStatus, /拡大率\d+%/);
      await context.close();
    });

    await test('step history, scroll restoration and diagnostics state stay synchronized', async () => {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.__xPanoramaTest));
      await loadFiles(page, ['fractional-crop.png']);
      await page.click('#nextButton');
      await waitForStep(page, 2);
      await page.click('#zoomInButton');
      const cropBefore = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot().crop);
      const storedScroll = await page.evaluate(() => {
        const top = Math.min(360, Math.max(0, document.documentElement.scrollHeight - innerHeight));
        window.scrollTo(0, top);
        return window.scrollY;
      });

      await page.evaluate(() => {
        const original = window.requestAnimationFrame;
        const held = [];
        window.__releaseHeldDiagnosticFrames = () => {
          window.requestAnimationFrame = original;
          held.splice(0).forEach((callback) => original(() => callback(performance.now())));
        };
        window.requestAnimationFrame = (callback) => {
          held.push(callback);
          return 900000 + held.length;
        };
        document.querySelector('#nextButton').click();
      });
      const running = await page.evaluate(() => ({
        snapshot: window.__xPanoramaTest.stateSnapshot(),
        nextDisabled: document.querySelector('#nextButton').disabled,
        nextText: document.querySelector('#nextButton').textContent
      }));
      assert.equal(running.snapshot.step, 3);
      assert.equal(running.snapshot.diagnostics.status, 'running');
      assert.equal(running.nextDisabled, true);
      assert.equal(running.nextText, '検査中…');
      await page.evaluate(() => window.__releaseHeldDiagnosticFrames());
      await waitForDiagnostics(page);
      const inspected = await page.evaluate(() => ({
        snapshot: window.__xPanoramaTest.stateSnapshot(),
        nextDisabled: document.querySelector('#nextButton').disabled,
        overviewVisible: document.querySelector('#diagnosticsOverview').getBoundingClientRect().height > 0
      }));
      assert.ok(['passed', 'warning', 'failed'].includes(inspected.snapshot.diagnostics.status));
      assert.equal(inspected.snapshot.diagnostics.hasCompleted, true);
      assert.equal(inspected.nextDisabled, false);
      assert.equal(inspected.overviewVisible, true);

      await page.evaluate(() => history.back());
      await waitForStep(page, 2);
      await page.waitForFunction((expected) => Math.abs(window.scrollY - expected) <= 4, storedScroll);
      const restored = await page.evaluate(() => ({
        crop: window.__xPanoramaTest.stateSnapshot().crop,
        scrollY: window.scrollY,
        historyStep: history.state.xPanoramaStep,
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight,
        saved: window.__xPanoramaTest.stateSnapshot().history.scrollPositions
      }));
      assert.deepEqual(restored.crop, cropBefore);
      assert.equal(restored.historyStep, 2);
      assert.ok(nearlyEqual(restored.scrollY, storedScroll, 4), `scroll ${restored.scrollY} != ${storedScroll}; ${JSON.stringify(restored)}`);

      await page.evaluate(() => history.forward());
      await waitForStep(page, 3);
      assert.equal(await page.evaluate(() => history.state.xPanoramaStep), 3);
      await page.click('#backButton');
      await waitForStep(page, 2);
      assert.equal(await page.evaluate(() => history.state.xPanoramaStep), 2);

      await page.click('#zoomInButton');
      const stale = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot().diagnostics);
      assert.equal(stale.status, 'idle');
      assert.equal(stale.dirty, true);
      await page.click('#nextButton');
      await waitForStep(page, 3);
      await waitForDiagnostics(page);

      await page.evaluate(async () => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, options) {
          if (type === '2d' && options && options.willReadFrequently) throw new Error('synthetic diagnostics failure');
          return original.call(this, type, options);
        };
        try { await window.__xPanoramaTest.runDiagnostics(); }
        finally { HTMLCanvasElement.prototype.getContext = original; }
      });
      const failed = await page.evaluate(() => ({
        diagnostics: window.__xPanoramaTest.stateSnapshot().diagnostics,
        nextDisabled: document.querySelector('#nextButton').disabled
      }));
      assert.equal(failed.diagnostics.status, 'failed');
      assert.equal(failed.diagnostics.hasCompleted, true);
      assert.equal(failed.nextDisabled, false);

      await page.click('#nextButton');
      await waitForStep(page, 4);
      const primary = await page.evaluate(() => Array.from(document.querySelectorAll('button.primary')).filter((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      }).map((button) => ({ id: button.id, text: button.textContent.trim() })));
      assert.deepEqual(primary, [{ id: 'nextButton', text: '4枚を書き出す' }]);

      await page.evaluate(() => {
        window.__xPanoramaTest.generateExport();
        history.back();
      });
      await waitForStep(page, 3);
      await page.waitForFunction(() => window.__xPanoramaTest.stateSnapshot().activeExportId === null);
      const cancelledByBack = await page.evaluate(() => ({
        step: window.__xPanoramaTest.stateSnapshot().step,
        activeExportId: window.__xPanoramaTest.stateSnapshot().activeExportId,
        historyStep: history.state.xPanoramaStep,
        backDisabled: document.querySelector('#backButton').disabled
      }));
      assert.deepEqual(cancelledByBack, { step: 3, activeExportId: null, historyStep: 3, backDisabled: false });
      await context.close();
    });

    await test('320px four-image order cards retain thumbnails and 48px move targets without overflow', async () => {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 320, height: 800 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.__xPanoramaTest));
      await loadFiles(page, ['same-01.png', 'same-02.png', 'same-03.png', 'same-04.png']);
      await page.click('#nextButton');
      await waitForStep(page, 2);
      const metrics = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.order-card'));
        const controls = Array.from(document.querySelectorAll('.step-panel.active button, .step-panel.active summary, .bottom-nav button')).filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).map((node) => ({ label: node.getAttribute('aria-label') || node.textContent.trim(), height: node.getBoundingClientRect().height }));
        return {
          count: cards.length,
          cards: cards.map((card) => {
            const thumb = card.querySelector('.order-thumb').getBoundingClientRect();
            const buttons = Array.from(card.querySelectorAll('.order-buttons button')).map((button) => button.getBoundingClientRect());
            const rect = card.getBoundingClientRect();
            return {
              thumb: { width: thumb.width, height: thumb.height },
              buttons: buttons.map((button) => ({ width: button.width, height: button.height })),
              gap: buttons[1].left - buttons[0].right,
              left: rect.left,
              right: rect.right,
              hasSvgButtons: Array.from(card.querySelectorAll('.order-buttons button')).every((button) => Boolean(button.querySelector('svg')))
            };
          }),
          controls,
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth
        };
      });
      assert.equal(metrics.count, 4);
      metrics.cards.forEach((card) => {
        assert.ok(card.thumb.width >= 56 && card.thumb.height >= 64);
        card.buttons.forEach((button) => {
          assert.ok(button.width >= 48);
          assert.ok(button.height >= 48);
        });
        assert.ok(card.gap >= 8);
        assert.ok(card.left >= -1 && card.right <= metrics.viewport + 1);
        assert.equal(card.hasSvgButtons, true);
      });
      assert.ok(metrics.scrollWidth <= metrics.viewport + 1);
      metrics.controls.forEach((control) => assert.ok(control.height >= 48, `${control.label}: ${control.height}px`));
      await page.screenshot({ path: path.join(qaRoot, 'mobile-320-four-image-order.png'), fullPage: true });
      await page.locator('.order-card').first().locator('button[data-move="right"]').click();
      await page.waitForFunction(() => document.querySelector('#orderStatus').textContent.includes('2番目へ移動'));
      const focusedMove = await page.evaluate(() => document.activeElement?.getAttribute('data-move'));
      assert.ok(focusedMove === 'left' || focusedMove === 'right');
      await context.close();
    });

    await test('carousel permits vertical touch scrolling while retaining horizontal snap controls', async () => {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(baseUrl, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.__xPanoramaTest));
      await loadFiles(page, ['fractional-crop.png']);
      await page.click('#nextButton');
      await page.click('#nextButton');
      await waitForStep(page, 3);
      await waitForDiagnostics(page);
      const carousel = page.locator('#carouselPreview');
      await carousel.scrollIntoViewIfNeeded();
      const touchAction = await carousel.evaluate((node) => getComputedStyle(node).touchAction);
      assert.match(touchAction, /pan-x/);
      assert.match(touchAction, /pan-y/);
      const box = await carousel.boundingBox();
      assert.ok(box);
      const initial = await page.evaluate(() => window.scrollY);
      const session = await context.newCDPSession(page);
      const x = box.x + Math.min(box.width - 12, Math.max(12, box.width / 2));
      const startY = box.y + Math.min(box.height - 24, Math.max(80, box.height * 0.68));
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY, radiusX: 2, radiusY: 2, force: 1 }] });
      for (const offset of [24, 52, 84, 116]) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY - offset, radiusX: 2, radiusY: 2, force: 1 }] });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(120);
      const after = await page.evaluate(() => window.scrollY);
      assert.ok(after > initial + 12, `vertical scroll did not advance: ${initial} -> ${after}`);
      assert.equal(await page.locator('#carouselPrevButton').isVisible(), true);
      assert.equal(await page.locator('#carouselNextButton').isVisible(), true);
      await context.close();
    });

    const summary = {
      passed: results.filter((item) => item.status === 'PASS').length,
      failed: failures.length,
      qaRoot,
      results,
      failures
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (failures.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server.listening) await closeServer();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

