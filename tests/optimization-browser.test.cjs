'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const appRoot = process.env.XPANORAMA_APP_ROOT || path.resolve(__dirname, '..');
const fixtureRoot = process.env.XPANORAMA_FIXTURES_DIR
  || 'C:\\Users\\dream\\Documents\\Codex\\2026-08-20\\k\\work\\fixtures\\xpanorama-v040-rc2';
const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.XPANORAMA_OPTIMIZATION_PORT || 8830);
const baseUrl = `http://127.0.0.1:${port}`;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png'
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, baseUrl);
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const root = path.resolve(appRoot);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return response.writeHead(403).end('Forbidden');
  fs.readFile(target, (error, body) => {
    if (error) return response.writeHead(404).end('Not found');
    response.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  });
});

const listen = () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
const closeServer = () => new Promise((resolve) => server.close(resolve));

async function openPage(browser, options = {}) {
  const { directoryPicker = false, ...contextOptions } = options;
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, ...contextOptions });
  if (directoryPicker) {
    await context.addInitScript(() => {
      window.showDirectoryPicker = () => Promise.reject(new DOMException('cancelled', 'AbortError'));
    });
  }
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?optimization=${Date.now()}-${Math.random()}`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__xPanoramaTest));
  return { context, page };
}

async function makeImageFileInPage(page, width, height, name, type = 'image/png') {
  await page.evaluate(async ({ width, height, name, type }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#4c8cff';
    context.fillRect(0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type));
    await window.__xPanoramaTest.loadSelection([new File([blob], name, { type })]);
  }, { width, height, name, type });
}

async function prepareGeneratedExport(page) {
  await makeImageFileInPage(page, 600, 400, 'optimization-source.png');
  await page.evaluate(async () => {
    const test = window.__xPanoramaTest;
    test.showStep(2);
    const preset = document.querySelector('#presetSelect');
    preset.value = 'custom';
    document.querySelector('#customWidth').value = '400';
    document.querySelector('#customHeight').value = '400';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    test.showStep(4);
    await test.generateExport();
  });
  assert.equal((await page.evaluate(() => window.__xPanoramaTest.stateSnapshot())).generatedFileCount, 4);
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
      const failure = { name, status: 'FAIL', error: error.stack || error.message || String(error) };
      results.push(failure);
      failures.push(failure);
    }
  }

  try {
    await listen();
    browser = await chromium.launch({ executablePath: edgePath, headless: true });

    await test('drag, wheel and zoom slider invalidate once per edit session and commit cleanly', async () => {
      const { context, page } = await openPage(browser);
      await prepareGeneratedExport(page);
      await page.evaluate(() => window.__xPanoramaTest.showStep(2));
      const canvas = page.locator('#editorCanvas');
      const box = await canvas.boundingBox();
      assert.ok(box);
      const beforeDrag = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
      await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5, { steps: 30 });
      await page.mouse.up();
      const afterDrag = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
      assert.equal(afterDrag.projectRevision, beforeDrag.projectRevision + 1);
      assert.equal(afterDrag.generated, false);
      assert.equal(afterDrag.editSession, null);

      const beforeWheel = afterDrag.projectRevision;
      const wheelLayoutReads = await page.evaluate(() => {
        const canvas = document.querySelector('#editorCanvas');
        const rect = canvas.getBoundingClientRect();
        let layoutReads = 0;
        canvas.getBoundingClientRect = () => {
          layoutReads += 1;
          return rect;
        };
        for (let index = 0; index < 20; index += 1) {
          canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -5, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
        }
        return layoutReads;
      });
      assert.equal(wheelLayoutReads, 1);
      await page.waitForTimeout(180);
      const afterWheel = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
      assert.equal(afterWheel.projectRevision, beforeWheel + 1);
      assert.equal(afterWheel.editSession, null);

      const beforeSlider = afterWheel.projectRevision;
      await page.evaluate(() => {
        const range = document.querySelector('#zoomRange');
        for (let value = 120; value < 140; value += 1) {
          range.value = String(value);
          range.dispatchEvent(new Event('input', { bubbles: true }));
        }
        range.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const afterSlider = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
      assert.equal(afterSlider.projectRevision, beforeSlider + 1);
      assert.equal(afterSlider.editSession, null);
      await context.close();
    });

    await test('four-image preview and operation estimates enforce aggregate budgets', async () => {
      const { context, page } = await openPage(browser, { directoryPicker: true, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36' });
      const largeJpeg = fs.readFileSync(path.join(fixtureRoot, 'single-6480x4320.jpg'));
      await page.setInputFiles('#fileInput', ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'].map((name) => ({ name, mimeType: 'image/jpeg', buffer: largeJpeg })));
      await page.waitForFunction(() => window.__xPanoramaTest.stateSnapshot().four.length === 4 || Boolean(document.querySelector('#loadError').textContent), null, { timeout: 90_000 });
      assert.equal(await page.locator('#loadError').textContent(), '');
      const firstGeneration = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot().loadGeneration);
      await page.setInputFiles('#fileInput', ['e.jpg', 'f.jpg', 'g.jpg', 'h.jpg'].map((name) => ({ name, mimeType: 'image/jpeg', buffer: largeJpeg })));
      await page.waitForFunction((generation) => {
        const snapshot = window.__xPanoramaTest.stateSnapshot();
        return snapshot.loadGeneration > generation && !snapshot.loadPending && snapshot.four.length === 4;
      }, firstGeneration, { timeout: 90_000 });
      assert.equal(await page.locator('#loadError').textContent(), '');
      const data = await page.evaluate(() => {
        const test = window.__xPanoramaTest;
        const snapshot = test.stateSnapshot();
        return {
          totalLimit: test.FOUR_IMAGE_TOTAL_PREVIEW_PIXELS,
          perLimit: test.FOUR_IMAGE_MAX_PREVIEW_PIXELS_PER_IMAGE,
          total: snapshot.fourPreviewPixels,
          perImage: snapshot.four.map((item) => item.drawableWidth * item.drawableHeight),
          small: test.estimateOperationPeak({ outputCanvases: [{ width: 1000, height: 1000 }] }),
          unsafe: test.estimateOperationPeak({ outputCanvases: [{ width: 12000, height: 12000 }] }),
          eightKExport: test.estimateOperationPeak({
            retainedImages: [{ width: 7680, height: 4320, drawableWidth: 2560, drawableHeight: 1440 }],
            decodingImage: { width: 7680, height: 4320, includeRaw: true, includePreview: false },
            outputCanvases: [{ width: 1920, height: 4320 }],
            generatedBlobs: Array.from({ length: 4 }, () => ({ estimatedBytes: 1920 * 4320 * 4.1 })),
            budgetBytes: test.LIMITS.exportEstimatedPeakBytes
          }),
          degraded: test.chooseImagePreviewBudget(
            { width: 6400, height: 6250 },
            [{ width: 3000, height: 2334, drawableWidth: 3000, drawableHeight: 2334 }],
            [],
            2_000_000
          )
        };
      });
      assert.equal(data.totalLimit, 8_000_000);
      assert.equal(data.perLimit, 2_000_000);
      assert.ok(data.total <= data.totalLimit);
      assert.ok(data.perImage.every((pixels) => pixels <= data.perLimit));
      assert.equal(data.small.withinBudget, true);
      assert.equal(data.unsafe.withinBudget, false);
      assert.equal(data.eightKExport.withinBudget, true);
      assert.ok(data.eightKExport.estimatedBytes <= data.eightKExport.budgetBytes);
      assert.equal(data.degraded.maxPixels, 1_000_000);
      assert.equal(data.degraded.decision.withinBudget, true);
      await context.close();
    });

    await test('actual 7680x4320 source exports four complete 1920x4320 panels', async () => {
      const { context, page } = await openPage(browser, {
        userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36'
      });
      await makeImageFileInPage(page, 7680, 4320, 'actual-8k.jpg', 'image/jpeg');
      const result = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        test.showStep(2);
        const preset = document.querySelector('#presetSelect');
        preset.value = 'vrchat8k';
        preset.dispatchEvent(new Event('change', { bubbles: true }));
        test.showStep(4);
        const inspect = async (format) => {
          document.querySelector('#formatSelect').value = format;
          await test.generateExport();
          const generated = test.generatedArtifacts();
          const dimensions = [];
          for (const item of generated ? generated.files : []) {
            const bitmap = await createImageBitmap(item.blob);
            dimensions.push({ width: bitmap.width, height: bitmap.height, size: item.blob.size });
            bitmap.close();
          }
          return {
            error: document.querySelector('#exportError').textContent,
            dimensions
          };
        };
        const jpeg = await inspect('image/jpeg');
        const png = await inspect('image/png');
        return {
          output: test.stateSnapshot().output,
          jpeg,
          png
        };
      });
      assert.deepEqual(result.output, { width: 7680, height: 4320, panelWidth: 1920 });
      for (const output of [result.jpeg, result.png]) {
        assert.equal(output.error, '');
        assert.equal(output.dimensions.length, 4);
        output.dimensions.forEach((item) => {
          assert.deepEqual({ width: item.width, height: item.height }, { width: 1920, height: 4320 });
          assert.ok(item.size > 0);
        });
      }
      await context.close();
    });

    await test('real signatures accept JFIF/octet-stream and reject corrupt or MIME-conflicting data', async () => {
      const { context, page } = await openPage(browser);
      const jpeg = fs.readFileSync(path.join(fixtureRoot, 'format.jpg'));
      await page.setInputFiles('#fileInput', { name: 'photo.jfif', mimeType: 'application/octet-stream', buffer: jpeg });
      await page.waitForFunction(() => window.__xPanoramaTest.stateSnapshot().single);
      const accepted = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot().single);
      assert.equal(accepted.detectedType, 'image/jpeg');
      assert.equal(accepted.extension, 'jpg');

      await page.setInputFiles('#fileInput', { name: 'fake.jpe', mimeType: 'application/octet-stream', buffer: Buffer.from('not an image') });
      await page.waitForFunction(() => Boolean(document.querySelector('#loadError').textContent));
      assert.equal((await page.evaluate(() => window.__xPanoramaTest.stateSnapshot().single.name)), 'photo.jfif');

      const png = fs.readFileSync(path.join(fixtureRoot, 'format.png'));
      await page.setInputFiles('#fileInput', { name: 'conflict.png', mimeType: 'image/jpeg', buffer: png });
      await page.waitForFunction(() => /MIME/.test(document.querySelector('#loadError').textContent));
      assert.equal((await page.evaluate(() => window.__xPanoramaTest.stateSnapshot().single.name)), 'photo.jfif');
      await context.close();
    });

    await test('one diagnostics run performs one Canvas pixel readback', async () => {
      const { context, page } = await openPage(browser);
      const names = ['same-01.png', 'same-02.png', 'same-03.png', 'same-04.png'];
      await page.setInputFiles('#fileInput', names.map((name) => path.join(fixtureRoot, name)));
      await page.waitForFunction(() => window.__xPanoramaTest.stateSnapshot().four.length === 4);
      await page.evaluate(() => {
        const prototype = CanvasRenderingContext2D.prototype;
        window.__originalGetImageData = prototype.getImageData;
        window.__diagnosticReadbacks = 0;
        prototype.getImageData = function getImageData(...args) {
          window.__diagnosticReadbacks += 1;
          return window.__originalGetImageData.apply(this, args);
        };
        window.__xPanoramaTest.showStep(3);
      });
      await page.waitForFunction(() => window.__xPanoramaTest.stateSnapshot().diagnostics.hasCompleted);
      const readbacks = await page.evaluate(() => {
        CanvasRenderingContext2D.prototype.getImageData = window.__originalGetImageData;
        return window.__diagnosticReadbacks;
      });
      assert.equal(readbacks, 1);
      await context.close();
    });

    await test('Android keeps direct downloads primary while directory save remains an advanced compatible fallback', async () => {
      const { context, page } = await openPage(browser, { directoryPicker: true, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36' });
      await page.evaluate(() => { window.showDirectoryPicker = () => Promise.reject(new DOMException('cancelled', 'AbortError')); });
      await prepareGeneratedExport(page);
      assert.equal(await page.locator('#fileSaveDetails').evaluate((element) => element.open), false);
      assert.equal(await page.locator('#androidDownloadCard').evaluate((element) => element.hidden), false);
      assert.equal(await page.locator('#directorySaveCard').evaluate((element) => element.hidden), false);
      assert.equal(await page.locator('#nextButton').textContent(), '4枚をダウンロード');
      assert.match(await page.locator('#directorySaveButton').getAttribute('class'), /secondary/);
      await page.evaluate(() => window.__xPanoramaTest.saveGeneratedToDirectory());
      assert.equal(await page.locator('#exportError').textContent(), '');
      assert.equal(await page.locator('#fileSaveDetails').evaluate((element) => element.open), false);

      const synchronousFallback = await page.evaluate(async () => {
        const calls = [];
        window.showDirectoryPicker = (options) => {
          calls.push(options);
          if (options && options.id) throw new TypeError('unsupported startIn/id');
          return Promise.reject(new DOMException('cancelled', 'AbortError'));
        };
        await window.__xPanoramaTest.saveGeneratedToDirectory();
        return calls;
      });
      assert.equal(synchronousFallback.length, 2);
      assert.deepEqual(synchronousFallback[1], { mode: 'readwrite' });
      assert.equal(await page.locator('#exportError').textContent(), '');

      await page.evaluate(() => { window.showDirectoryPicker = () => Promise.reject(new TypeError('unsupported options')); });
      await page.evaluate(() => window.__xPanoramaTest.saveGeneratedToDirectory());
      let snapshot = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
      assert.equal(snapshot.directoryPickerMode, 'mode-only');
      assert.equal(await page.locator('#fileSaveDetails').evaluate((element) => element.open), true);

      const retry = await page.evaluate(async () => {
        window.__pickerArgument = null;
        window.showDirectoryPicker = (options) => {
          window.__pickerArgument = options;
          return Promise.reject(new DOMException('cancelled', 'AbortError'));
        };
        await window.__xPanoramaTest.saveGeneratedToDirectory();
        return window.__pickerArgument;
      });
      assert.deepEqual(retry, { mode: 'readwrite' });
      await context.close();
    });

    await test('Directory Picker permission denial is not retried automatically', async () => {
      const { context, page } = await openPage(browser, { directoryPicker: true, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36' });
      await prepareGeneratedExport(page);
      const calls = await page.evaluate(async () => {
        window.__pickerCalls = 0;
        window.showDirectoryPicker = () => {
          window.__pickerCalls += 1;
          return Promise.reject(new DOMException('denied', 'NotAllowedError'));
        };
        await window.__xPanoramaTest.saveGeneratedToDirectory();
        return window.__pickerCalls;
      });
      assert.equal(calls, 1);
      assert.match(await page.locator('#exportError').textContent(), /許可されません/);
      assert.equal(await page.locator('#fileSaveDetails').evaluate((element) => element.open), true);
      await context.close();
    });

    await test('required 390, 412, 768 and 1440px widths keep the primary flow in view', async () => {
      for (const width of [390, 412, 768, 1440]) {
        const { context, page } = await openPage(browser, { viewport: { width, height: width >= 768 ? 900 : 844 } });
        await makeImageFileInPage(page, 600, 400, `responsive-${width}.png`);
        await page.evaluate(() => window.__xPanoramaTest.showStep(4));
        const layout = await page.evaluate(() => {
          const button = document.querySelector('#nextButton').getBoundingClientRect();
          return {
            viewport: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            buttonLeft: button.left,
            buttonRight: button.right,
            buttonHeight: button.height
          };
        });
        assert.ok(layout.documentWidth <= layout.viewport + 1, JSON.stringify(layout));
        assert.ok(layout.bodyWidth <= layout.viewport + 1, JSON.stringify(layout));
        assert.ok(layout.buttonLeft >= -1 && layout.buttonRight <= layout.viewport + 1, JSON.stringify(layout));
        assert.ok(layout.buttonHeight >= 44, JSON.stringify(layout));
        await context.close();
      }
    });
  } finally {
    if (browser) await browser.close();
    await closeServer();
  }

  console.log(JSON.stringify({ passed: results.length - failures.length, failed: failures.length, results }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
