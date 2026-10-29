const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const appRoot = process.env.XPANORAMA_APP_ROOT
  || path.resolve(__dirname, '..');
const currentVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'release-version.json'), 'utf8')).version;
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 8765;
const baseUrl = `http://127.0.0.1:${port}`;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png'
};

function parseHeaderRules() {
  const lines = fs.readFileSync(path.join(appRoot, '_headers'), 'utf8').split(/\r?\n/);
  const rules = [];
  let current = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const match = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (match) current.headers[match[1]] = match[2];
  }
  return rules;
}

const headerRules = parseHeaderRules();

function configuredHeaders(pathname) {
  const headers = {};
  for (const rule of headerRules) {
    const matches = rule.pattern.endsWith('*')
      ? pathname.startsWith(rule.pattern.slice(0, -1))
      : pathname === rule.pattern;
    if (matches) Object.assign(headers, rule.headers);
  }
  return headers;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, baseUrl);
  if (url.pathname === '/blank.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...configuredHeaders(url.pathname) });
    response.end('<!doctype html><title>blank</title>');
    return;
  }
  if (url.pathname === '/dynamic-probe.txt') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...configuredHeaders(url.pathname) });
    response.end('dynamic probe');
    return;
  }
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const target = path.resolve(appRoot, relative);
  if (!target.startsWith(path.resolve(appRoot))) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (error, body) => {
    if (error) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...configuredHeaders(url.pathname)
    });
    response.end(body);
  });
});

function listen() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function closeServer() {
  return new Promise((resolve) => server.close(resolve));
}

async function makeImageFileInPage(page, width, height, name, color = '#4c8cff') {
  return page.evaluate(async ({ width, height, name, color }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = color;
    context.fillRect(0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], name, { type: 'image/png' });
    await window.__xPanoramaTest.loadSelection([file]);
    return window.__xPanoramaTest.stateSnapshot();
  }, { width, height, name, color });
}

async function fresh(page) {
  await page.goto(`${baseUrl}/?test=${Date.now()}-${Math.random()}`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__xPanoramaTest));
}

async function prepareGeneratedExportInPage(page, name = 'platform-source.png') {
  await fresh(page);
  await makeImageFileInPage(page, 600, 400, name);
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
  const snapshot = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
  assert.equal(snapshot.generatedFileCount, 4);
  return snapshot;
}

(async () => {
  const results = [];
  const failures = [];
  let browser;
  let context;
  try {
    await listen();
    browser = await chromium.launch({ executablePath: edgePath, headless: true });
    context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.5 });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

    async function test(name, fn) {
      const errorCountBefore = pageErrors.length;
      try {
        await fn();
        if (!page.isClosed()) await page.waitForTimeout(30);
        const newPageErrors = pageErrors.slice(errorCountBefore);
        assert.deepEqual(newPageErrors, [], `page errors during ${name}: ${newPageErrors.join(' | ')}`);
        results.push({ name, status: 'PASS' });
      } catch (error) {
        failures.push({ name, error: error.stack || String(error) });
        results.push({ name, status: 'FAIL' });
      }
    }

    await fresh(page);

    await test('version and script boot', async () => {
      const data = await page.evaluate(() => ({
        version: window.__xPanoramaTest.APP_VERSION,
        footerVersion: document.querySelector('.app-footer span:last-child').textContent,
        title: document.title
      }));
      assert.deepEqual(data, { version: currentVersion, footerVersion: `v${currentVersion}`, title: 'X 4枚パノラマ' });
    });

    await test('Step 1 empty card has two explicit accessible picker intents', async () => {
      await fresh(page);
      const initial = await page.evaluate(() => {
        const zone = document.querySelector('#dropZone');
        const single = document.querySelector('#chooseSingleImageButton');
        const four = document.querySelector('#chooseFourImagesButton');
        const input = document.querySelector('#fileInput');
        const zoneRect = zone.getBoundingClientRect();
        const styles = getComputedStyle(zone);
        const contentWidth = zoneRect.width
          - Number.parseFloat(styles.paddingLeft)
          - Number.parseFloat(styles.paddingRight)
          - Number.parseFloat(styles.borderLeftWidth)
          - Number.parseFloat(styles.borderRightWidth);
        const describe = (button) => {
          const rect = button.getBoundingClientRect();
          return {
            tag: button.tagName,
            text: button.textContent.replace(/\s+/g, ' ').trim(),
            controls: button.getAttribute('aria-controls'),
            height: rect.height,
            width: rect.width
          };
        };
        return {
          zoneTag: zone.tagName,
          zoneRole: zone.getAttribute('role'),
          zoneState: zone.dataset.selectionState,
          zoneBusy: zone.getAttribute('aria-busy'),
          single: describe(single),
          four: describe(four),
          contentWidth,
          inputTabIndex: input.getAttribute('tabindex'),
          inputAriaHidden: input.getAttribute('aria-hidden'),
          liveAtomic: document.querySelector('#selectionPreviewStatus').getAttribute('aria-atomic'),
          nextDisabled: document.querySelector('#nextButton').disabled,
          dockHidden: document.querySelector('.bottom-nav').hidden
        };
      });
      assert.deepEqual({
        zoneTag: initial.zoneTag,
        zoneRole: initial.zoneRole,
        zoneState: initial.zoneState,
        zoneBusy: initial.zoneBusy,
        single: { tag: initial.single.tag, text: initial.single.text, controls: initial.single.controls },
        four: { tag: initial.four.tag, text: initial.four.text, controls: initial.four.controls },
        inputTabIndex: initial.inputTabIndex,
        inputAriaHidden: initial.inputAriaHidden,
        liveAtomic: initial.liveAtomic,
        nextDisabled: initial.nextDisabled,
        dockHidden: initial.dockHidden
      }, {
        zoneTag: 'DIV',
        zoneRole: 'group',
        zoneState: 'empty',
        zoneBusy: 'false',
        single: { tag: 'BUTTON', text: '1枚を選ぶ1枚の画像を4分割', controls: 'fileInput' },
        four: { tag: 'BUTTON', text: '4枚を選ぶ4枚を順番に並べる', controls: 'fileInput' },
        inputTabIndex: '-1',
        inputAriaHidden: 'true',
        liveAtomic: 'true',
        nextDisabled: true,
        dockHidden: true
      });
      assert.ok(initial.single.height >= 48 && initial.four.height >= 48);
      assert.ok(Math.abs(initial.single.width - initial.contentWidth) < 1);
      assert.ok(Math.abs(initial.four.width - initial.contentWidth) < 1);

      await page.evaluate(() => {
        window.__pickerOpenCount = 0;
        document.querySelector('#fileInput').click = () => { window.__pickerOpenCount += 1; };
      });
      await page.click('#chooseSingleImageButton');
      assert.equal(await page.evaluate(() => window.__pickerOpenCount), 1);
      assert.equal(await page.locator('#fileInput').getAttribute('multiple'), null);
      await page.focus('#chooseSingleImageButton');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');
      assert.equal(await page.evaluate(() => window.__pickerOpenCount), 3);
      await page.click('#chooseFourImagesButton');
      assert.equal(await page.evaluate(() => window.__pickerOpenCount), 4);
      assert.notEqual(await page.locator('#fileInput').getAttribute('multiple'), null);
      await page.locator('#dropZone').click({ position: { x: 10, y: 10 } });
      assert.equal(await page.evaluate(() => window.__pickerOpenCount), 4);
    });

    await test('Step 1 selected card shows one-image metadata and persistent reselection controls', async () => {
      await fresh(page);
      await makeImageFileInPage(page, 1800, 1200, 'selected-card.png', '#37a86b');
      const selected = await page.evaluate(() => {
        const test = window.__xPanoramaTest;
        const snapshot = test.stateSnapshot();
        const zoneElement = document.querySelector('#dropZone');
        const buttonElement = document.querySelector('#chooseImagesButton');
        const zone = zoneElement.getBoundingClientRect();
        const button = buttonElement.getBoundingClientRect();
        const zoneStyle = getComputedStyle(zoneElement);
        const contentWidth = zone.width
          - Number.parseFloat(zoneStyle.paddingLeft)
          - Number.parseFloat(zoneStyle.paddingRight)
          - Number.parseFloat(zoneStyle.borderLeftWidth)
          - Number.parseFloat(zoneStyle.borderRightWidth);
        const canvas = document.querySelector('#selectionPreviewGrid canvas');
        return {
          snapshot,
          icon: Boolean(document.querySelector('#selectionStateIcon svg')),
          caption: document.querySelector('.selection-preview-caption').textContent,
          canvasRole: canvas.getAttribute('role'),
          previewButtonCount: document.querySelector('#selectionPreview').querySelectorAll('button').length,
          buttonHeight: button.height,
          buttonWidth: button.width,
          contentWidth,
          horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
          buttonFocusedStyle: getComputedStyle(buttonElement).minHeight,
          modeChangeVisible: !document.querySelector('#changeSelectionModeButton').hidden,
          dockHidden: document.querySelector('.bottom-nav').hidden
        };
      });
      assert.equal(selected.snapshot.selectionZone.state, 'selected');
      assert.equal(selected.snapshot.selectionZone.busy, 'false');
      assert.equal(selected.snapshot.selectionZone.title, '1枚選択済み');
      assert.equal(selected.snapshot.selectionZone.buttonText, '別の1枚を選ぶ');
      assert.equal(selected.snapshot.selectionPreview.count, 1);
      assert.equal(selected.snapshot.selectionPreview.status, '1枚の画像を選択しました。');
      assert.equal(selected.icon, true);
      assert.match(selected.caption, /selected-card\.png/);
      assert.match(selected.caption, /1800 × 1200px/);
      assert.equal(selected.canvasRole, 'img');
      assert.equal(selected.previewButtonCount, 0);
      assert.ok(selected.buttonHeight >= 48);
      assert.ok(Math.abs(selected.buttonWidth - selected.contentWidth) < 1);
      assert.ok(selected.horizontalOverflow <= 0);
      assert.equal(selected.buttonFocusedStyle, '48px');
      assert.equal(selected.modeChangeVisible, true);
      assert.equal(selected.dockHidden, false);
    });

    await test('security headers preserve blob images and workers', async () => {
      const response = await page.request.get(`${baseUrl}/`);
      const headers = response.headers();
      assert.equal(headers['x-content-type-options'], 'nosniff');
      assert.equal(headers['referrer-policy'], 'no-referrer');
      assert.equal(headers['x-frame-options'], 'DENY');
      assert.match(headers['permissions-policy'], /camera=\(\)/);
      assert.doesNotMatch(headers['permissions-policy'], /web-share=\(\)/);
      assert.match(headers['content-security-policy'], /img-src 'self' blob: data:/);
      assert.match(headers['content-security-policy'], /worker-src 'self' blob:/);
      assert.match(headers['content-security-policy'], /script-src 'self'/);
      assert.doesNotMatch(headers['content-security-policy'], /script-src[^;]*'unsafe-inline'/);

      const runtime = await page.evaluate(async () => {
        const violations = [];
        document.addEventListener('securitypolicyviolation', (event) => violations.push(event.violatedDirective), { once: false });
        const workerUrl = URL.createObjectURL(new Blob([`self.postMessage('worker-ok')`], { type: 'text/javascript' }));
        const workerResult = await new Promise((resolve, reject) => {
          const worker = new Worker(workerUrl);
          worker.onmessage = (event) => { worker.terminate(); resolve(event.data); };
          worker.onerror = (event) => reject(new Error(event.message));
        });
        URL.revokeObjectURL(workerUrl);
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        const imageBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const imageUrl = URL.createObjectURL(imageBlob);
        const image = new Image();
        image.src = imageUrl;
        await image.decode();
        URL.revokeObjectURL(imageUrl);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { workerResult, imageWidth: image.naturalWidth, violations };
      });
      assert.deepEqual(runtime, { workerResult: 'worker-ok', imageWidth: 2, violations: [] });
    });

    await test('pure canvas budgets and fitting', async () => {
      const data = await page.evaluate(() => {
        const test = window.__xPanoramaTest;
        return {
          exactLimit: test.canvasBudgetIssue(3000, 16000, 'export'),
          overPixels: test.canvasBudgetIssue(3001, 16000, 'export'),
          overEdge: test.canvasBudgetIssue(64000, 16000, 'export'),
          fitted: test.fitDimensionsWithinBudget(975, 1053000, test.LIMITS.previewCanvasMaxEdge, test.LIMITS.previewCanvasMaxPixels),
          allocated: test.allocateWidths(4096, [16000, 16000, 16000, 16000])
        };
      });
      assert.equal(data.exactLimit, '');
      assert.match(data.overPixels, /総画素数/);
      assert.match(data.overEdge, /一辺/);
      assert.ok(data.fitted.width <= 4096 && data.fitted.height <= 4096);
      assert.ok(data.fitted.width * data.fitted.height <= 8000000);
      assert.equal(data.allocated.reduce((sum, value) => sum + value, 0), 4096);
      assert.ok(data.allocated.every((value) => value >= 1));
    });

    await test('custom intermediate values never redraw huge canvas', async () => {
      await fresh(page);
      await makeImageFileInPage(page, 1200, 800, 'custom-source.png');
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        test.showStep(2);
        const preset = document.querySelector('#presetSelect');
        preset.value = 'custom';
        preset.dispatchEvent(new Event('change', { bubbles: true }));
        const before = test.stateSnapshot();
        const width = document.querySelector('#customWidth');
        width.value = '5';
        width.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 260));
        const invalid = test.stateSnapshot();
        const invalidUi = {
          nextDisabled: document.querySelector('#nextButton').disabled,
          ariaInvalid: width.getAttribute('aria-invalid'),
          value: width.value
        };
        width.dispatchEvent(new Event('change', { bubbles: true }));
        const committedMin = test.stateSnapshot();
        const minValue = width.value;
        width.value = '20000';
        width.dispatchEvent(new Event('change', { bubbles: true }));
        const committedMax = test.stateSnapshot();
        return { before, invalid, invalidUi, committedMin, minValue, committedMax, maxValue: width.value };
      });
      assert.equal(data.invalid.projectRevision, data.before.projectRevision);
      assert.deepEqual(data.invalid.editorCanvas, data.before.editorCanvas);
      assert.deepEqual(data.invalidUi, { nextDisabled: true, ariaInvalid: 'true', value: '5' });
      assert.equal(data.minValue, '400');
      assert.ok(Math.abs(data.committedMin.aspect - data.committedMin.output.width / data.committedMin.output.height) < 1e-9);
      assert.ok(data.committedMin.editorCanvas.width <= 4096 && data.committedMin.editorCanvas.height <= 4096);
      assert.ok(data.committedMin.editorCanvas.width * data.committedMin.editorCanvas.height <= 8000000);
      assert.equal(data.maxValue, '16000');
      assert.ok(Math.abs(data.committedMax.aspect - data.committedMax.output.width / data.committedMax.output.height) < 1e-9);
    });

    await test('large source retains only bounded preview proxy', async () => {
      await fresh(page);
      const snapshot = await makeImageFileInPage(page, 3000, 2000, 'large-preview.png');
      assert.equal(snapshot.single.width, 3000);
      assert.equal(snapshot.single.height, 2000);
      assert.ok(snapshot.single.drawableWidth <= 2560 && snapshot.single.drawableHeight <= 2560);
      assert.ok(snapshot.single.drawableWidth * snapshot.single.drawableHeight <= 4000000);
      assert.ok(snapshot.single.drawableWidth < snapshot.single.width);
      assert.equal(snapshot.selectionPreview.hidden, false);
      assert.equal(snapshot.selectionPreview.count, 1);
      assert.equal(snapshot.selectionPreview.canvases.length, 1);
      assert.ok(snapshot.selectionPreview.canvases[0].width <= 640 && snapshot.selectionPreview.canvases[0].height <= 640);
      assert.ok(snapshot.selectionPreview.canvases[0].width * snapshot.selectionPreview.canvases[0].height <= 400000);
      assert.match(snapshot.selectionPreview.canvases[0].label, /large-preview\.png/);
    });

    await test('Step 1 preview releases on leave and recreates from retained proxy', async () => {
      await fresh(page);
      await makeImageFileInPage(page, 1400, 900, 'step1-recreate.png', '#c44cff');
      const data = await page.evaluate(() => {
        const test = window.__xPanoramaTest;
        const initial = test.stateSnapshot();
        test.showStep(2);
        const released = test.stateSnapshot();
        test.showStep(1);
        const recreated = test.stateSnapshot();
        return {
          initial,
          released,
          recreated,
          overlays: document.querySelector('#selectionPreviewGrid').querySelectorAll('.gesture-hint, .guide-settings, .boundary-panel').length,
          caption: document.querySelector('.selection-preview-caption')?.textContent || ''
        };
      });
      assert.equal(data.initial.selectionPreview.count, 1);
      assert.equal(data.released.selectionPreview.hidden, true);
      assert.equal(data.released.selectionPreview.count, 0);
      assert.equal(data.recreated.selectionPreview.hidden, false);
      assert.equal(data.recreated.selectionPreview.count, 1);
      assert.equal(data.overlays, 0);
      assert.match(data.caption, /step1-recreate\.png/);
      assert.match(data.caption, /1400 × 900px/);
    });

    await test('initial and replacement loading states stay explicit and preserve the committed preview', async () => {
      await fresh(page);
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const make = async (name, color) => {
          const canvas = document.createElement('canvas');
          canvas.width = 720;
          canvas.height = 480;
          const context = canvas.getContext('2d');
          context.fillStyle = color;
          context.fillRect(0, 0, canvas.width, canvas.height);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          return new File([blob], name, { type: 'image/png' });
        };
        const initialFile = await make('initial-slow.png', '#a64cff');
        const replacementFile = await make('replacement-slow.png', '#25a36f');
        const originalBitmap = window.createImageBitmap.bind(window);
        window.createImageBitmap = async (source, ...args) => {
          if (source instanceof File && /-slow\.png$/.test(source.name)) await new Promise((resolve) => setTimeout(resolve, 90));
          return originalBitmap(source, ...args);
        };
        try {
          const firstPending = test.loadSelection([initialFile]);
          await new Promise((resolve) => setTimeout(resolve, 15));
          const initialLoading = test.stateSnapshot();
          const initialButtonDisabled = document.querySelector('#chooseImagesButton').disabled;
          const initialNextDisabled = document.querySelector('#nextButton').disabled;
          await firstPending;

          const oldCanvas = document.querySelector('#selectionPreviewGrid canvas');
          const oldCaption = document.querySelector('.selection-preview-caption').textContent;
          const replacementPending = test.loadSelection([replacementFile]);
          await new Promise((resolve) => setTimeout(resolve, 15));
          const replacing = test.stateSnapshot();
          const replacingCaption = document.querySelector('.selection-preview-caption').textContent;
          const sameCanvasWhileLoading = oldCanvas === document.querySelector('#selectionPreviewGrid canvas');
          const replacementButtonDisabled = document.querySelector('#chooseImagesButton').disabled;
          const replacementNextDisabled = document.querySelector('#nextButton').disabled;
          await replacementPending;
          return {
            initialLoading,
            initialButtonDisabled,
            initialNextDisabled,
            oldCaption,
            replacing,
            replacingCaption,
            sameCanvasWhileLoading,
            replacementButtonDisabled,
            replacementNextDisabled,
            settled: test.stateSnapshot(),
            settledCaption: document.querySelector('.selection-preview-caption').textContent
          };
        } finally {
          window.createImageBitmap = originalBitmap;
        }
      });
      assert.equal(data.initialLoading.selectionZone.state, 'loading');
      assert.equal(data.initialLoading.selectionZone.busy, 'true');
      assert.equal(data.initialLoading.selectionZone.title, '画像を読み込み中');
      assert.equal(data.initialLoading.selectionZone.buttonText, '画像を読み込み中…');
      assert.equal(data.initialLoading.selectionPreview.hidden, true);
      assert.equal(data.initialLoading.selectionPreview.count, 0);
      assert.equal(data.initialButtonDisabled, true);
      assert.equal(data.initialNextDisabled, true);
      assert.match(data.oldCaption, /initial-slow\.png/);
      assert.equal(data.replacing.selectionZone.state, 'replacing');
      assert.equal(data.replacing.selectionZone.busy, 'true');
      assert.equal(data.replacing.selectionZone.title, '1枚選択済み');
      assert.equal(data.replacing.selectionZone.buttonText, '画像を読み込み中…');
      assert.equal(data.replacing.selectionPreview.count, 1);
      assert.match(data.replacingCaption, /initial-slow\.png/);
      assert.equal(data.sameCanvasWhileLoading, true);
      assert.equal(data.replacementButtonDisabled, true);
      assert.equal(data.replacementNextDisabled, true);
      assert.equal(data.settled.selectionZone.state, 'selected');
      assert.equal(data.settled.single.name, 'replacement-slow.png');
      assert.match(data.settledCaption, /replacement-slow\.png/);
    });

    await test('picker cancellation, same-file reselection, and invalid candidates are non-destructive', async () => {
      await fresh(page);
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 420;
        const context = canvas.getContext('2d');
        context.fillStyle = '#2176d2';
        context.fillRect(0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const sameFile = new File([blob], 'same-file.png', { type: 'image/png' });
        const input = document.querySelector('#fileInput');
        const selectThroughInput = async (file) => {
          const transfer = new DataTransfer();
          transfer.items.add(file);
          input.files = transfer.files;
          const previousGeneration = test.stateSnapshot().loadGeneration;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          while (test.stateSnapshot().loadPending || test.stateSnapshot().loadGeneration === previousGeneration) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return test.stateSnapshot();
        };
        const first = await selectThroughInput(sameFile);
        const second = await selectThroughInput(sameFile);
        const beforeCancel = test.stateSnapshot();
        const emptyTransfer = new DataTransfer();
        input.files = emptyTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 20));
        const afterCancel = test.stateSnapshot();

        const secondCanvas = document.createElement('canvas');
        secondCanvas.width = 32;
        secondCanvas.height = 32;
        const secondBlob = await new Promise((resolve) => secondCanvas.toBlob(resolve, 'image/png'));
        await test.loadSelection([sameFile, new File([secondBlob], 'extra.png', { type: 'image/png' })]);
        const invalidCount = test.stateSnapshot();
        const countError = document.querySelector('#loadError').textContent;
        await test.loadSelection([new File(['not an image'], 'wrong.txt', { type: 'text/plain' })]);
        const invalidType = test.stateSnapshot();
        const typeError = document.querySelector('#loadError').textContent;
        return { first, second, beforeCancel, afterCancel, invalidCount, countError, invalidType, typeError };
      });
      assert.equal(data.first.single.name, 'same-file.png');
      assert.equal(data.second.single.name, 'same-file.png');
      assert.ok(data.second.loadGeneration > data.first.loadGeneration);
      assert.ok(data.second.projectRevision > data.first.projectRevision);
      assert.deepEqual(data.afterCancel, data.beforeCancel);
      assert.equal(data.invalidCount.single.name, 'same-file.png');
      assert.equal(data.invalidCount.projectRevision, data.beforeCancel.projectRevision);
      assert.match(data.countError, /1枚または4枚/);
      assert.equal(data.invalidType.single.name, 'same-file.png');
      assert.equal(data.invalidType.projectRevision, data.beforeCancel.projectRevision);
      assert.match(data.typeError, /JPEG、PNG、WebP/);
    });

    await test('corrupt replacement fails preflight without replacing the project or allocating a URL', async () => {
      await fresh(page);
      await makeImageFileInPage(page, 640, 480, 'kept.png');
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const originalRevoke = URL.revokeObjectURL.bind(URL);
        const originalBitmap = window.createImageBitmap.bind(window);
        let revokeCount = 0;
        URL.revokeObjectURL = (value) => { revokeCount += 1; return originalRevoke(value); };
        window.createImageBitmap = async (source, ...args) => {
          if (source instanceof File && source.name === 'broken.png') await new Promise((resolve) => setTimeout(resolve, 70));
          return originalBitmap(source, ...args);
        };
        try {
          const invalid = new File([new Uint8Array([1, 2, 3, 4])], 'broken.png', { type: 'image/png' });
          const pending = test.loadSelection([invalid]);
          await new Promise((resolve) => setTimeout(resolve, 15));
          const loading = test.stateSnapshot();
          await pending;
          return { snapshot: test.stateSnapshot(), loading, revokeCount, error: document.querySelector('#loadError').textContent };
        } finally {
          URL.revokeObjectURL = originalRevoke;
          window.createImageBitmap = originalBitmap;
        }
      });
      assert.equal(data.snapshot.single.name, 'kept.png');
      assert.equal(data.snapshot.loadPending, false);
      assert.equal(data.loading.selectionPreview.busy, 'false');
      assert.equal(data.loading.selectionPreview.count, 1);
      assert.equal(data.loading.selectionZone.state, 'selected');
      assert.equal(data.loading.selectionZone.title, '1枚選択済み');
      assert.equal(data.snapshot.selectionPreview.busy, 'false');
      assert.equal(data.snapshot.selectionPreview.count, 1);
      assert.equal(data.revokeCount, 0);
      assert.ok(data.error.length > 0);
    });

    await test('successful replacement releases the old Step 1 canvas and retained URL', async () => {
      await fresh(page);
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const make = async (name, color) => {
          const canvas = document.createElement('canvas');
          canvas.width = 700;
          canvas.height = 420;
          const context = canvas.getContext('2d');
          context.fillStyle = color;
          context.fillRect(0, 0, canvas.width, canvas.height);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          return new File([blob], name, { type: 'image/png' });
        };
        const originalRevoke = URL.revokeObjectURL.bind(URL);
        let revokeCount = 0;
        URL.revokeObjectURL = (value) => { revokeCount += 1; return originalRevoke(value); };
        try {
          await test.loadSelection([await make('old-selection.png', '#b23')]);
          const oldCanvas = document.querySelector('#selectionPreviewGrid canvas');
          const oldSize = { width: oldCanvas.width, height: oldCanvas.height };
          await test.loadSelection([await make('new-selection.png', '#28a')]);
          return {
            oldSize,
            oldReleasedSize: { width: oldCanvas.width, height: oldCanvas.height },
            oldConnected: oldCanvas.isConnected,
            revokeCount,
            snapshot: test.stateSnapshot(),
            caption: document.querySelector('.selection-preview-caption').textContent
          };
        } finally {
          URL.revokeObjectURL = originalRevoke;
        }
      });
      assert.ok(data.oldSize.width > 1 && data.oldSize.height > 1);
      assert.deepEqual(data.oldReleasedSize, { width: 1, height: 1 });
      assert.equal(data.oldConnected, false);
      assert.ok(data.revokeCount >= 1);
      assert.equal(data.snapshot.single.name, 'new-selection.png');
      assert.match(data.caption, /new-selection\.png/);
    });

    await test('concurrent loads keep only newest selection', async () => {
      await fresh(page);
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const make = async (name, color) => {
          const canvas = document.createElement('canvas');
          canvas.width = 800;
          canvas.height = 600;
          const context = canvas.getContext('2d');
          context.fillStyle = color;
          context.fillRect(0, 0, 800, 600);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          return new File([blob], name, { type: 'image/png' });
        };
        const slow = await make('slow-a.png', '#f00');
        const fast = await make('fast-b.png', '#00f');
        const original = window.createImageBitmap.bind(window);
        window.createImageBitmap = async (source, ...args) => {
          if (source instanceof File && source.name === 'slow-a.png') await new Promise((resolve) => setTimeout(resolve, 220));
          return original(source, ...args);
        };
        try {
          const first = test.loadSelection([slow]);
          await new Promise((resolve) => setTimeout(resolve, 20));
          const second = test.loadSelection([fast]);
          await Promise.all([first, second]);
          return test.stateSnapshot();
        } finally {
          window.createImageBitmap = original;
        }
      });
      assert.equal(data.single.name, 'fast-b.png');
      assert.equal(data.loadPending, false);
      assert.equal(data.selectionPreview.count, 1);
      assert.match(data.selectionPreview.canvases[0].label, /fast-b\.png/);
      assert.equal(data.selectionZone.state, 'selected');
      assert.equal(data.selectionZone.title, '1枚選択済み');
      assert.equal(data.selectionPreview.status, '1枚の画像を選択しました。');
    });

    await test('four-image selected card shows complete metadata without per-image controls', async () => {
      await fresh(page);
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const specs = [
          [120, 90, '01-landscape.png', '#d33'],
          [90, 120, '02-portrait.png', '#3d3'],
          [100, 100, '03-square.png', '#33d'],
          [180, 90, '04-wide.png', '#dd3']
        ];
        const files = [];
        for (const [width, height, name, color] of specs) {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          context.fillStyle = color;
          context.fillRect(0, 0, width, height);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          files.push(new File([blob], name, { type: 'image/png' }));
        }
        await test.loadSelection(files);
        const grid = document.querySelector('#selectionPreviewGrid');
        return {
          snapshot: test.stateSnapshot(),
          icon: Boolean(document.querySelector('#selectionStateIcon svg')),
          captions: Array.from(grid.querySelectorAll('.selection-preview-caption')).map((element) => element.textContent),
          canvasLabels: Array.from(grid.querySelectorAll('canvas')).map((element) => element.getAttribute('aria-label')),
          interactiveCount: grid.querySelectorAll('button, a, input, [role="button"]').length,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
          horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth
        };
      });
      assert.equal(data.snapshot.selectionZone.state, 'selected');
      assert.equal(data.snapshot.selectionZone.title, '4枚選択済み');
      assert.equal(data.snapshot.selectionZone.buttonText, '別の4枚を選ぶ');
      assert.equal(data.snapshot.selectionPreview.count, 4);
      assert.equal(data.snapshot.selectionPreview.canvases.length, 4);
      assert.equal(data.icon, true);
      assert.equal(data.interactiveCount, 0);
      assert.equal(data.columns, 2);
      assert.ok(data.horizontalOverflow <= 0);
      assert.deepEqual(data.captions, [
        '1. 01-landscape.png120 × 90px',
        '2. 02-portrait.png90 × 120px',
        '3. 03-square.png100 × 100px',
        '4. 04-wide.png180 × 90px'
      ]);
      data.canvasLabels.forEach((label, index) => assert.match(label, new RegExp(`^${index + 1}枚目、`)));
    });

    await test('drag and drop uses the same Step 1 load path and clears drag affordance', async () => {
      await fresh(page);
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const canvas = document.createElement('canvas');
        canvas.width = 500;
        canvas.height = 300;
        const context = canvas.getContext('2d');
        context.fillStyle = '#ef7d32';
        context.fillRect(0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const file = new File([blob], 'dropped.png', { type: 'image/png' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const zone = document.querySelector('#dropZone');
        zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        const dragging = zone.classList.contains('dragging');
        zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        while (test.stateSnapshot().loadPending || !test.stateSnapshot().single) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return {
          dragging,
          draggingAfterDrop: zone.classList.contains('dragging'),
          snapshot: test.stateSnapshot(),
          caption: document.querySelector('.selection-preview-caption').textContent
        };
      });
      assert.equal(data.dragging, true);
      assert.equal(data.draggingAfterDrop, false);
      assert.equal(data.snapshot.single.name, 'dropped.png');
      assert.equal(data.snapshot.selectionZone.state, 'selected');
      assert.match(data.caption, /dropped\.png/);
    });

    await test('mixed-aspect carousel and boundaries use each image ratio', async () => {
      await fresh(page);
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const specs = [
          [100, 100, '01-square.png', '#f00'],
          [160, 100, '02-wide.png', '#0f0'],
          [100, 160, '03-tall.png', '#00f'],
          [200, 100, '04-wider.png', '#ff0']
        ];
        const files = [];
        for (const [width, height, name, color] of specs) {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          context.fillStyle = color;
          context.fillRect(0, 0, width, height);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          files.push(new File([blob], name, { type: 'image/png' }));
        }
        await test.loadSelection(files);
        const step1Preview = test.stateSnapshot().selectionPreview;
        const step1Captions = Array.from(document.querySelectorAll('.selection-preview-caption')).map((element) => element.textContent);
        test.showStep(3);
        await new Promise(requestAnimationFrame);
        const initialBackings = test.stateSnapshot().step3Backings;
        const carousel = Array.from(document.querySelectorAll('.x-panel')).map((element) => Number(element.style.getPropertyValue('--panel-aspect')));
        test.showPreviewTab('boundaries');
        const boundaryBackings = test.stateSnapshot().step3Backings;
        return {
          carousel,
          boundaries: Array.from(document.querySelectorAll('.boundary-card')).map((card) => Array.from(card.querySelectorAll('.boundary-panel')).map((element) => Number(element.style.getPropertyValue('--panel-aspect')))),
          initialBackings,
          boundaryBackings,
          step1Preview,
          step1Captions,
          pageError: document.querySelector('#loadError').textContent
        };
      });
      const expected = [1, 1.6, 0.625, 2];
      assert.deepEqual(data.carousel, expected);
      assert.deepEqual(data.boundaries, [[1, 1.6], [1.6, 0.625], [0.625, 2]]);
      assert.equal(data.step1Preview.count, 4);
      assert.equal(data.step1Preview.canvases.length, 4);
      data.step1Preview.canvases.forEach((canvas, index) => {
        assert.ok(canvas.width <= 640 && canvas.height <= 640);
        assert.ok(canvas.width * canvas.height <= 400000);
        assert.ok(Math.abs(canvas.width / canvas.height - expected[index]) < 0.02);
      });
      assert.ok(data.step1Captions.every((caption) => /\.png\d+ × \d+px/.test(caption)));
      assert.deepEqual(data.initialBackings, { carousel: 4, full: { width: 1, height: 1 }, boundaries: 0 });
      assert.equal(data.boundaryBackings.carousel, 0);
      assert.deepEqual(data.boundaryBackings.full, { width: 1, height: 1 });
      assert.equal(data.boundaryBackings.boundaries, 6);
      assert.equal(data.pageError, '');
    });

    await test('extreme-aspect stitch preview remains inside canvas budget', async () => {
      await fresh(page);
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const files = [];
        for (let index = 0; index < 4; index += 1) {
          const canvas = document.createElement('canvas');
          canvas.width = 16000;
          canvas.height = 1;
          const context = canvas.getContext('2d');
          context.fillStyle = `hsl(${index * 70} 80% 50%)`;
          context.fillRect(0, 0, canvas.width, canvas.height);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          files.push(new File([blob], `0${index + 1}-extreme.png`, { type: 'image/png' }));
          canvas.width = 1;
        }
        await test.loadSelection(files);
        test.showStep(2);
        const stitch = document.querySelector('#stitchCanvas');
        return { width: stitch.width, height: stitch.height, issue: test.canvasBudgetIssue(stitch.width, stitch.height, 'preview') };
      });
      assert.equal(data.issue, '');
      assert.ok(data.width <= 4096 && data.height <= 4096);
      assert.ok(data.width * data.height <= 8000000);
    });

    await test('Step 3 lazily keeps only the visible preview backing', async () => {
      await fresh(page);
      await makeImageFileInPage(page, 1200, 800, 'lazy-preview.png', '#37a86b');
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        test.showStep(3);
        const carousel = test.stateSnapshot();
        test.showPreviewTab('full');
        const full = test.stateSnapshot();
        test.showPreviewTab('boundaries');
        const boundaries = test.stateSnapshot();
        test.showStep(4);
        const leftStep3 = test.stateSnapshot();
        test.showStep(3);
        const returned = test.stateSnapshot();
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { carousel, full, boundaries, leftStep3, returned };
      });
      assert.deepEqual(data.carousel.step3Backings, { carousel: 4, full: { width: 1, height: 1 }, boundaries: 0 });
      assert.equal(data.full.step3Backings.carousel, 0);
      assert.ok(data.full.step3Backings.full.width > 1 && data.full.step3Backings.full.height > 1);
      assert.equal(data.full.step3Backings.boundaries, 0);
      assert.equal(data.boundaries.step3Backings.carousel, 0);
      assert.deepEqual(data.boundaries.step3Backings.full, { width: 1, height: 1 });
      assert.equal(data.boundaries.step3Backings.boundaries, 6);
      assert.deepEqual(data.leftStep3.step3Backings, { carousel: 0, full: { width: 1, height: 1 }, boundaries: 0 });
      assert.equal(data.returned.activePreviewTab, 'boundaries');
      assert.deepEqual(data.returned.step3Backings, { carousel: 0, full: { width: 1, height: 1 }, boundaries: 6 });
    });

    async function prepareSmallExport() {
      await fresh(page);
      await makeImageFileInPage(page, 600, 400, 'export-source.png');
      await page.evaluate(() => {
        const test = window.__xPanoramaTest;
        test.showStep(2);
        const preset = document.querySelector('#presetSelect');
        preset.value = 'custom';
        document.querySelector('#customWidth').value = '400';
        document.querySelector('#customHeight').value = '400';
        preset.dispatchEvent(new Event('change', { bubbles: true }));
        test.showStep(4);
      });
    }

    async function prepareGeneratedExport() {
      await prepareSmallExport();
      await page.evaluate(() => window.__xPanoramaTest.generateExport());
      const snapshot = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
      assert.equal(snapshot.generatedFileCount, 4);
    }

    await test('partially allocated single-image result URLs are released when URL creation fails', async () => {
      await prepareSmallExport();
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const originalCreateObjectURL = URL.createObjectURL.bind(URL);
        const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
        const created = [];
        const revoked = [];
        URL.createObjectURL = (value) => {
          if (value instanceof Blob && !(value instanceof File) && /^image\//.test(value.type)) {
            if (created.length === 2) throw new Error('synthetic URL allocation failure');
            const url = originalCreateObjectURL(value);
            created.push(url);
            return url;
          }
          return originalCreateObjectURL(value);
        };
        URL.revokeObjectURL = (value) => {
          if (created.includes(value)) revoked.push(value);
          return originalRevokeObjectURL(value);
        };
        try {
          await test.generateExport();
          return { snapshot: test.stateSnapshot(), created, revoked };
        } finally {
          URL.createObjectURL = originalCreateObjectURL;
          URL.revokeObjectURL = originalRevokeObjectURL;
        }
      });
      assert.equal(data.snapshot.generatedFileCount, 0);
      assert.match(data.snapshot.exportError, /synthetic URL allocation failure/);
      assert.equal(data.created.length, 2);
      assert.deepEqual(data.revoked, data.created);
    });

    await test('four-image MIME correction URLs are released when joined export fails', async () => {
      await fresh(page);
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const files = [];
        for (let index = 0; index < 4; index += 1) {
          const canvas = document.createElement('canvas');
          canvas.width = 120;
          canvas.height = 90;
          const context = canvas.getContext('2d');
          context.fillStyle = `hsl(${index * 80} 70% 50%)`;
          context.fillRect(0, 0, canvas.width, canvas.height);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          files.push(new File([blob], `0${index + 1}.bin`, { type: 'application/octet-stream' }));
        }
        const workerCode = `self.onmessage=()=>self.postMessage({type:'error',code:'PROCESSING_ERROR',message:'synthetic joined failure'});`;
        window.__IMAGE_WORKER_URL = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
        const originalCreateObjectURL = URL.createObjectURL.bind(URL);
        const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
        const correctedUrls = [];
        const revokedCorrectedUrls = [];
        URL.createObjectURL = (value) => {
          const url = originalCreateObjectURL(value);
          if (value instanceof Blob && !(value instanceof File) && value.type === 'image/png') correctedUrls.push(url);
          return url;
        };
        URL.revokeObjectURL = (value) => {
          if (correctedUrls.includes(value)) revokedCorrectedUrls.push(value);
          return originalRevokeObjectURL(value);
        };
        try {
          await test.loadSelection(files);
          test.showStep(4);
          await test.generateExport();
          return {
            snapshot: test.stateSnapshot(),
            correctedUrlCount: correctedUrls.length,
            revokedCorrectedUrlCount: revokedCorrectedUrls.length,
            revokedCorrectedUrls
          };
        } finally {
          URL.createObjectURL = originalCreateObjectURL;
          URL.revokeObjectURL = originalRevokeObjectURL;
        }
      });
      assert.equal(data.snapshot.generatedFileCount, 0);
      assert.match(data.snapshot.exportError, /synthetic joined failure/);
      assert.equal(data.correctedUrlCount, 4);
      assert.equal(data.revokedCorrectedUrlCount, 4);
      assert.equal(new Set(data.revokedCorrectedUrls).size, 4);
    });

    await test('worker export succeeds at safe size', async () => {
      await prepareSmallExport();
      const data = await page.evaluate(async () => {
        await window.__xPanoramaTest.generateExport();
        return window.__xPanoramaTest.stateSnapshot();
      });
      assert.equal(data.generatedFileCount, 4);
      assert.equal(data.activeExportId, null);
      assert.equal(data.exportError, '');
    });

    await test('UNSUPPORTED worker falls back to bounded main-thread export', async () => {
      await prepareSmallExport();
      const data = await page.evaluate(async () => {
        const workerCode = `self.onmessage=()=>self.postMessage({type:'error',code:'UNSUPPORTED',message:'synthetic unsupported'});`;
        window.__IMAGE_WORKER_URL = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
        const originalCreateElement = document.createElement.bind(document);
        let canvasCount = 0;
        document.createElement = (name, options) => {
          const element = originalCreateElement(name, options);
          if (name === 'canvas') canvasCount += 1;
          return element;
        };
        try {
          await window.__xPanoramaTest.generateExport();
          return { snapshot: window.__xPanoramaTest.stateSnapshot(), canvasCount };
        } finally {
          document.createElement = originalCreateElement;
        }
      });
      assert.equal(data.snapshot.generatedFileCount, 4);
      assert.equal(data.snapshot.exportError, '');
      assert.equal(data.canvasCount, 1);
    });

    await test('reused split canvases clear transparent pixels for PNG and JPEG', async () => {
      async function renderTransparentPanels(format, forceMain) {
        await fresh(page);
        return page.evaluate(async ({ format, forceMain }) => {
          const test = window.__xPanoramaTest;
          const canvas = document.createElement('canvas');
          canvas.width = 600;
          canvas.height = 400;
          const context = canvas.getContext('2d');
          context.fillStyle = '#e33';
          context.fillRect(100, 0, 100, 400);
          const source = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          await test.loadSelection([new File([source], 'transparent-source.png', { type: 'image/png' })]);
          test.showStep(2);
          const preset = document.querySelector('#presetSelect');
          preset.value = 'custom';
          document.querySelector('#customWidth').value = '400';
          document.querySelector('#customHeight').value = '400';
          preset.dispatchEvent(new Event('change', { bubbles: true }));
          document.querySelector('#formatSelect').value = format;
          test.showStep(4);
          if (forceMain) {
            const workerCode = `self.onmessage=()=>self.postMessage({type:'error',code:'UNSUPPORTED',message:'synthetic unsupported'});`;
            window.__IMAGE_WORKER_URL = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
          }
          await test.generateExport();
          const artifacts = test.generatedArtifacts();
          const samples = [];
          for (const item of artifacts.files) {
            const bitmap = await createImageBitmap(item.blob);
            const sampleCanvas = document.createElement('canvas');
            sampleCanvas.width = bitmap.width;
            sampleCanvas.height = bitmap.height;
            const sampleContext = sampleCanvas.getContext('2d');
            sampleContext.drawImage(bitmap, 0, 0);
            samples.push(Array.from(sampleContext.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data));
            if (typeof bitmap.close === 'function') bitmap.close();
            sampleCanvas.width = 1;
            sampleCanvas.height = 1;
          }
          return { snapshot: test.stateSnapshot(), samples };
        }, { format, forceMain });
      }

      const pngWorker = await renderTransparentPanels('image/png', false);
      const pngMain = await renderTransparentPanels('image/png', true);
      const jpegWorker = await renderTransparentPanels('image/jpeg', false);
      const jpegMain = await renderTransparentPanels('image/jpeg', true);
      for (const result of [pngWorker, pngMain, jpegWorker, jpegMain]) {
        assert.equal(result.snapshot.generatedFileCount, 4);
        assert.equal(result.samples.length, 4);
      }
      for (const result of [pngWorker, pngMain]) {
        assert.equal(result.samples[0][3], 255);
        result.samples.slice(1).forEach((pixel) => assert.equal(pixel[3], 0));
      }
      for (const result of [jpegWorker, jpegMain]) {
        assert.ok(result.samples[0][0] > 150 && result.samples[0][1] < 150 && result.samples[0][2] < 150);
        result.samples.slice(1).forEach((pixel) => {
          assert.ok(pixel[0] > 220 && pixel[1] > 220 && pixel[2] > 220);
          assert.equal(pixel[3], 255);
        });
      }
    });

    await test('RESOURCE_LIMIT worker error never retries on main thread', async () => {
      await prepareSmallExport();
      const data = await page.evaluate(async () => {
        const workerCode = `self.onmessage=()=>self.postMessage({type:'error',code:'RESOURCE_LIMIT',message:'synthetic resource limit'});`;
        window.__IMAGE_WORKER_URL = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
        await window.__xPanoramaTest.generateExport();
        return window.__xPanoramaTest.stateSnapshot();
      });
      assert.equal(data.generatedFileCount, 0);
      assert.match(data.exportError, /synthetic resource limit/);
      assert.equal(data.activeExportId, null);
    });

    await test('ZIP worker creates a valid archive with progress', async () => {
      await prepareGeneratedExport();
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const originalCreateObjectURL = URL.createObjectURL.bind(URL);
        const originalClick = HTMLAnchorElement.prototype.click;
        let capturedZip = null;
        let downloadClicks = 0;
        URL.createObjectURL = (value) => {
          if (value instanceof Blob && value.type === 'application/zip') {
            capturedZip = value;
            return 'blob:synthetic-zip-download';
          }
          return originalCreateObjectURL(value);
        };
        HTMLAnchorElement.prototype.click = function click() { downloadClicks += 1; };
        try {
          await test.saveZip();
          const bytes = new Uint8Array(await capturedZip.arrayBuffer());
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          return {
            snapshot: test.stateSnapshot(),
            downloadClicks,
            size: bytes.length,
            localSignature: view.getUint32(0, true),
            endSignature: view.getUint32(bytes.length - 22, true),
            entryCount: view.getUint16(bytes.length - 12, true)
          };
        } finally {
          URL.createObjectURL = originalCreateObjectURL;
          HTMLAnchorElement.prototype.click = originalClick;
        }
      });
      assert.equal(data.localSignature, 0x04034b50);
      assert.equal(data.endSignature, 0x06054b50);
      assert.equal(data.entryCount, 4);
      assert.ok(data.size > 100);
      assert.equal(data.downloadClicks, 1);
      assert.equal(data.snapshot.activeZipId, null);
      assert.deepEqual(data.snapshot.zipControls, { saveDisabled: false, cancelHidden: true });
      assert.equal(data.snapshot.progress.value, 100);
      assert.match(data.snapshot.progress.text, /ZIPを作成しました/);
    });

    await test('ZIP cancellation settles and ignores delayed worker output', async () => {
      await prepareGeneratedExport();
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const workerCode = `self.onmessage=()=>{self.postMessage({type:'progress',percent:12,text:'synthetic zip'});setTimeout(()=>self.postMessage({type:'done',blob:new Blob(['late'],{type:'application/zip'})}),450);};`;
        window.__ZIP_WORKER_URL = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
        const originalClick = HTMLAnchorElement.prototype.click;
        let downloadClicks = 0;
        HTMLAnchorElement.prototype.click = function click() { downloadClicks += 1; };
        try {
          const pending = test.saveZip();
          await new Promise((resolve) => setTimeout(resolve, 45));
          const running = test.stateSnapshot();
          test.cancelZip();
          await pending;
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { running, settled: test.stateSnapshot(), downloadClicks };
        } finally {
          HTMLAnchorElement.prototype.click = originalClick;
        }
      });
      assert.ok(data.running.activeZipId !== null);
      assert.deepEqual(data.running.zipControls, { saveDisabled: true, cancelHidden: false });
      assert.equal(data.settled.activeZipId, null);
      assert.deepEqual(data.settled.zipControls, { saveDisabled: false, cancelHidden: true });
      assert.equal(data.settled.progress.hidden, true);
      assert.equal(data.downloadClicks, 0);
    });

    await test('project replacement discards a delayed ZIP job', async () => {
      await prepareGeneratedExport();
      const data = await page.evaluate(async () => {
        const test = window.__xPanoramaTest;
        const workerCode = `self.onmessage=()=>setTimeout(()=>self.postMessage({type:'done',blob:new Blob(['late'],{type:'application/zip'})}),450);`;
        window.__ZIP_WORKER_URL = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
        const originalClick = HTMLAnchorElement.prototype.click;
        let downloadClicks = 0;
        HTMLAnchorElement.prototype.click = function click() { downloadClicks += 1; };
        try {
          const pendingZip = test.saveZip();
          await new Promise((resolve) => setTimeout(resolve, 40));
          const canvas = document.createElement('canvas');
          canvas.width = 360;
          canvas.height = 240;
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          await test.loadSelection([new File([blob], 'zip-replacement.png', { type: 'image/png' })]);
          await pendingZip;
          await new Promise((resolve) => setTimeout(resolve, 500));
          return { snapshot: test.stateSnapshot(), downloadClicks };
        } finally {
          HTMLAnchorElement.prototype.click = originalClick;
        }
      });
      assert.equal(data.snapshot.single.name, 'zip-replacement.png');
      assert.equal(data.snapshot.generatedFileCount, 0);
      assert.equal(data.snapshot.activeZipId, null);
      assert.equal(data.downloadClicks, 0);
    });

    await test('project replacement settles and discards delayed export job', async () => {
      await prepareSmallExport();
      const data = await page.evaluate(async () => {
        const workerCode = `self.onmessage=()=>setTimeout(()=>{for(let i=0;i<4;i++)self.postMessage({type:'panel',index:i,blob:new Blob(['x'],{type:'image/jpeg'})});self.postMessage({type:'done'});},500);`;
        window.__IMAGE_WORKER_URL = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
        const pending = window.__xPanoramaTest.generateExport();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        await window.__xPanoramaTest.loadSelection([new File([blob], 'replacement.png', { type: 'image/png' })]);
        await pending;
        await new Promise((resolve) => setTimeout(resolve, 550));
        return {
          snapshot: window.__xPanoramaTest.stateSnapshot(),
          generateDisabled: document.querySelector('#nextButton').disabled,
          cancelHidden: document.querySelector('#cancelExportButton').hidden
        };
      });
      assert.equal(data.snapshot.single.name, 'replacement.png');
      assert.equal(data.snapshot.generatedFileCount, 0);
      assert.equal(data.snapshot.activeExportId, null);
      assert.equal(data.generateDisabled, false);
      assert.equal(data.cancelHidden, true);
    });

    await test('reached-step navigation gates future steps and edit invalidates later steps', async () => {
      await fresh(page);
      await makeImageFileInPage(page, 1200, 800, 'nav-source.png');
      await page.click('#nextButton');
      let data = await page.evaluate(() => ({
        snapshot: window.__xPanoramaTest.stateSnapshot(),
        focus: document.activeElement.id,
        mobile: document.querySelector('#mobileStepCount').textContent,
        step1Disabled: document.querySelector('[data-step-target="1"]').disabled,
        step3Disabled: document.querySelector('[data-step-target="3"]').disabled
      }));
      assert.equal(data.snapshot.step, 2);
      assert.equal(data.snapshot.maxReachedStep, 2);
      assert.equal(data.focus, 'step2Title');
      assert.equal(data.mobile, '2 / 4');
      assert.equal(data.step1Disabled, false);
      assert.equal(data.step3Disabled, true);

      await page.click('#nextButton');
      await page.click('#backButton');
      await page.click('#zoomInButton');
      data = await page.evaluate(() => ({
        snapshot: window.__xPanoramaTest.stateSnapshot(),
        step3Disabled: document.querySelector('[data-step-target="3"]').disabled
      }));
      assert.equal(data.snapshot.step, 2);
      assert.equal(data.snapshot.maxReachedStep, 2);
      assert.equal(data.step3Disabled, true);
    });

    await test('zoom and nudge controls provide 1-pointer and keyboard alternatives', async () => {
      await fresh(page);
      await makeImageFileInPage(page, 1200, 800, 'zoom-source.png');
      await page.evaluate(() => window.__xPanoramaTest.showStep(2));
      const initial = await page.evaluate(() => ({
        snapshot: window.__xPanoramaTest.stateSnapshot(),
        min: document.querySelector('#zoomRange').min,
        step: document.querySelector('#zoomRange').step,
        upDisabled: document.querySelector('[data-nudge="up"]').disabled
      }));
      assert.equal(Math.round(initial.snapshot.zoomPercent), 100);
      assert.equal(initial.min, '100');
      assert.equal(initial.step, '1');
      assert.equal(initial.upDisabled, true);

      await page.click('#zoomInButton');
      const zoomed = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
      assert.equal(Math.round(zoomed.zoomPercent), 105);
      await page.locator('.nudge-settings').evaluate((element) => { element.open = true; });
      await page.click('[data-nudge="up"]');
      const nudged = await page.evaluate(() => ({
        snapshot: window.__xPanoramaTest.stateSnapshot(),
        focusLabel: document.activeElement.getAttribute('aria-label')
      }));
      assert.ok(nudged.snapshot.crop.y > zoomed.crop.y);
      assert.equal(nudged.focusLabel, '画像を上へ移動');

      await page.focus('#editorCanvas');
      const beforeArrow = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot().crop.x);
      await page.keyboard.press('ArrowLeft');
      const afterArrow = await page.evaluate(() => ({ x: window.__xPanoramaTest.stateSnapshot().crop.x, focus: document.activeElement.id }));
      assert.ok(afterArrow.x > beforeArrow);
      assert.equal(afterArrow.focus, 'editorCanvas');
      const beforeShift = afterArrow.x;
      await page.keyboard.press('Shift+ArrowLeft');
      const afterShift = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot().crop.x);
      assert.ok(afterShift - beforeShift > afterArrow.x - beforeArrow);
      const unloadState = await page.evaluate(() => {
        window.dispatchEvent(new Event('beforeunload'));
        return window.__xPanoramaTest.stateSnapshot();
      });
      assert.equal(unloadState.mode, null);
      assert.equal(unloadState.single, null);
    });

    await test('four-image move buttons expose context, announce order, and restore focus', async () => {
      await fresh(page);
      await page.evaluate(async () => {
        async function make(name, color) {
          const canvas = document.createElement('canvas');
          canvas.width = 80; canvas.height = 60;
          const context = canvas.getContext('2d');
          context.fillStyle = color; context.fillRect(0, 0, 80, 60);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          return new File([blob], name, { type: 'image/png' });
        }
        const files = await Promise.all([
          make('01.png', '#b8431d'), make('02.png', '#ddaa28'), make('03.png', '#2c55c7'), make('04.png', '#2f6b46')
        ]);
        await window.__xPanoramaTest.loadSelection(files);
        window.__xPanoramaTest.showStep(2);
      });
      const label = await page.getAttribute('#orderList li:first-child [data-move="right"]', 'aria-label');
      assert.match(label, /01\.png/);
      assert.match(label, /1番目/);
      await page.click('#orderList li:first-child [data-move="right"]');
      const data = await page.evaluate(() => ({
        names: window.__xPanoramaTest.stateSnapshot().four.map((item) => item.name),
        status: document.querySelector('#orderStatus').textContent,
        focus: document.activeElement.getAttribute('aria-label'),
        previewWidth: document.querySelector('#stitchCanvas').width
      }));
      assert.deepEqual(data.names, ['02.png', '01.png', '03.png', '04.png']);
      assert.match(data.status, /01\.pngを2番目へ移動しました/);
      assert.match(data.focus, /01\.png/);
      assert.ok(data.previewWidth > 1);
      const replacedDuringSuggestion = await page.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 240;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        document.querySelector('#suggestOrderButton').click();
        await window.__xPanoramaTest.loadSelection([new File([blob], 'order-replacement.png', { type: 'image/png' })]);
        await new Promise((resolve) => setTimeout(resolve, 80));
        return window.__xPanoramaTest.stateSnapshot();
      });
      assert.equal(replacedDuringSuggestion.single.name, 'order-replacement.png');
      assert.equal(replacedDuringSuggestion.four.length, 0);
    });

    await test('tabs and X carousel have keyboard and button alternatives', async () => {
      await fresh(page);
      await makeImageFileInPage(page, 1200, 800, 'carousel-source.png');
      await page.evaluate(() => window.__xPanoramaTest.showStep(3));
      await page.focus('#previewTabCarousel');
      await page.keyboard.press('ArrowRight');
      let data = await page.evaluate(() => ({
        active: document.activeElement.id,
        carouselHidden: document.querySelector('#previewPaneCarousel').hidden,
        fullHidden: document.querySelector('#previewPaneFull').hidden
      }));
      assert.equal(data.active, 'previewTabFull');
      assert.equal(data.carouselHidden, true);
      assert.equal(data.fullHidden, false);
      await page.keyboard.press('Home');
      await page.click('#carouselNextButton');
      data = await page.evaluate(() => ({ status: document.querySelector('#carouselStatus').textContent, focus: document.activeElement.id }));
      assert.equal(data.status, '2 / 4');
      assert.equal(data.focus, 'carouselNextButton');
    });

    await test('export reports a real 1-of-4 count, locks settings and navigation, then restores after cancel', async () => {
      await prepareSmallExport();
      const data = await page.evaluate(async () => {
        const workerCode = `self.onmessage=()=>{self.postMessage({type:'progress',current:1,total:4,showPercent:false,text:'1 / 4を書き出しました'});setTimeout(()=>{for(let i=0;i<4;i++)self.postMessage({type:'panel',index:i,blob:new Blob(['panel-'+i],{type:'image/png'})});self.postMessage({type:'done'});},500);};`;
        window.__IMAGE_WORKER_URL = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
        const pending = window.__xPanoramaTest.generateExport();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const progress = document.querySelector('#exportProgress');
        const running = {
          activeExportId: window.__xPanoramaTest.stateSnapshot().activeExportId,
          progressHidden: document.querySelector('#progressArea').hidden,
          progressHasValue: progress.hasAttribute('value'),
          progressValue: progress.value,
          progressMax: progress.max,
          progressText: document.querySelector('#progressText').textContent,
          percentHidden: document.querySelector('#progressPercent').hidden,
          formatDisabled: document.querySelector('#formatSelect').disabled,
          qualityDisabled: document.querySelector('#qualityRange').disabled,
          backDisabled: document.querySelector('#backButton').disabled,
          cancelHidden: document.querySelector('#cancelExportButton').hidden
        };
        window.__xPanoramaTest.cancelExport();
        await pending;
        const restored = {
          activeExportId: window.__xPanoramaTest.stateSnapshot().activeExportId,
          progressHidden: document.querySelector('#progressArea').hidden,
          formatDisabled: document.querySelector('#formatSelect').disabled,
          qualityDisabled: document.querySelector('#qualityRange').disabled,
          backDisabled: document.querySelector('#backButton').disabled,
          cancelHidden: document.querySelector('#cancelExportButton').hidden
        };
        return { running, restored };
      });
      assert.notEqual(data.running.activeExportId, null);
      assert.equal(data.running.progressHidden, false);
      assert.equal(data.running.progressHasValue, true);
      assert.equal(data.running.progressValue, 1);
      assert.equal(data.running.progressMax, 4);
      assert.equal(data.running.progressText, '1 / 4を書き出しました');
      assert.equal(data.running.percentHidden, true);
      assert.equal(data.running.formatDisabled, true);
      assert.equal(data.running.qualityDisabled, true);
      assert.equal(data.running.backDisabled, true);
      assert.equal(data.running.cancelHidden, false);
      assert.deepEqual(data.restored, {
        activeExportId: null,
        progressHidden: true,
        formatDisabled: false,
        qualityDisabled: false,
        backDisabled: false,
        cancelHidden: true
      });
    });

    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);

    await context.close();
    context = null;

    const desktopContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    const desktopPage = await desktopContext.newPage();
    await test('desktop save flow keeps the dock primary and ZIP as the selected save strategy', async () => {
      await prepareGeneratedExportInPage(desktopPage, 'desktop-save.png');
      const data = await desktopPage.evaluate(() => ({
        platform: window.__xPanoramaTest.stateSnapshot().savePlatform,
        mode: document.querySelector('#exportResults').dataset.saveMode,
        photoHidden: document.querySelector('#photoSaveCard').hidden,
        fileOpen: document.querySelector('#fileSaveDetails').open,
        zipPrimary: document.querySelector('#zipButton').classList.contains('primary'),
        zipSecondary: document.querySelector('#zipButton').classList.contains('secondary'),
        nextPrimary: document.querySelector('#nextButton').classList.contains('primary'),
        nextText: document.querySelector('#nextButton').textContent,
        optionalHidden: document.querySelector('#optionalShareDetails').hidden,
        status: document.querySelector('#exportStatus').textContent
      }));
      assert.deepEqual(data, {
        platform: 'desktop',
        mode: 'desktop',
        photoHidden: true,
        fileOpen: true,
        zipPrimary: false,
        zipSecondary: true,
        nextPrimary: true,
        nextText: 'ZIPで保存',
        optionalHidden: true,
        status: '書き出しが完了しました。保存方法を選んでください。'
      });
    });
    await desktopContext.close();

    const androidContext = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 412, height: 915 },
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/135.0 Mobile Safari/537.36'
    });
    await androidContext.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {} });
      Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined });
    });
    const androidPage = await androidContext.newPage();
    await test('Android leads with an explained four-file download and keeps recoverable alternatives', async () => {
      await prepareGeneratedExportInPage(androidPage, 'android-save.png');
      let data = await androidPage.evaluate(() => ({
        platform: window.__xPanoramaTest.stateSnapshot().savePlatform,
        mode: document.querySelector('#exportResults').dataset.saveMode,
        photoHidden: document.querySelector('#photoSaveCard').hidden,
        androidCardHidden: document.querySelector('#androidDownloadCard').hidden,
        batchStatusHidden: document.querySelector('#androidDownloadStatus').hidden,
        permissionHelpHidden: document.querySelector('#androidPermissionHelp').hidden,
        fileOpen: document.querySelector('#fileSaveDetails').open,
        fileSummary: document.querySelector('#fileSaveSummary').textContent,
        zipPrimary: document.querySelector('#zipButton').classList.contains('primary'),
        zipSecondary: document.querySelector('#zipButton').classList.contains('secondary'),
        directoryHidden: document.querySelector('#directorySaveCard').hidden,
        nextPrimary: document.querySelector('#nextButton').classList.contains('primary'),
        nextText: document.querySelector('#nextButton').textContent,
        optionalHidden: document.querySelector('#optionalShareDetails').hidden,
        optionalClass: document.querySelector('#optionalShareButton').className
      }));
      assert.equal(data.platform, 'android');
      assert.equal(data.mode, 'android');
      assert.equal(data.photoHidden, true);
      assert.equal(data.androidCardHidden, false);
      assert.equal(data.batchStatusHidden, true);
      assert.equal(data.permissionHelpHidden, true);
      assert.equal(data.fileOpen, false);
      assert.equal(data.fileSummary, '個別再ダウンロード・その他の保存方法');
      assert.equal(data.zipPrimary, false);
      assert.equal(data.zipSecondary, true);
      assert.equal(data.directoryHidden, true);
      assert.equal(data.nextPrimary, true);
      assert.equal(data.nextText, '4枚をダウンロード');
      assert.equal(data.optionalHidden, false);
      assert.match(data.optionalClass, /secondary/);
      assert.doesNotMatch(data.optionalClass, /primary/);

      await androidPage.locator('#nextButton').click();
      await androidPage.waitForFunction(() => document.querySelector('#androidDownloadDialog').open && document.activeElement.id === 'androidDownloadDialogTitle');
      data = await androidPage.evaluate(() => ({
        open: document.querySelector('#androidDownloadDialog').open,
        bodyLocked: document.body.classList.contains('dialog-open'),
        notice: document.querySelector('#androidDownloadDialog').textContent,
        attempts: window.__xPanoramaTest.stateSnapshot().androidDownloadAttempts
      }));
      assert.equal(data.open, true);
      assert.equal(data.bodyLocked, true);
      assert.match(data.notice, /複数ファイルのダウンロード確認/);
      assert.match(data.notice, /［許可］/);
      assert.equal(data.attempts, 0);

      await androidPage.keyboard.press('Escape');
      await androidPage.waitForFunction(() => !document.querySelector('#androidDownloadDialog').open && document.activeElement.id === 'nextButton');

      await androidPage.locator('#nextButton').click();
      await androidPage.waitForFunction(() => document.querySelector('#androidDownloadDialog').open);
      await androidPage.evaluate(() => {
        window.__batchDownloadClicks = [];
        window.__batchSequence = [];
        window.__generatedUrlsBeforeBatch = window.__xPanoramaTest.generatedArtifacts().files.map((item) => item.url);
        document.querySelector('#startAndroidDownloadsButton').addEventListener('click', () => {
          window.__batchSequence.push('handler-end');
        }, { once: true });
        HTMLAnchorElement.prototype.click = function click() {
          window.__batchDownloadClicks.push({ name: this.download });
          window.__batchSequence.push(`download:${this.download}`);
        };
      });
      await androidPage.locator('#startAndroidDownloadsButton').click();
      await androidPage.waitForFunction(() => !document.querySelector('#androidDownloadDialog').open && window.__xPanoramaTest.stateSnapshot().androidDownloadAttempts === 1);
      data = await androidPage.evaluate(() => ({
        clicks: window.__batchDownloadClicks,
        sequence: window.__batchSequence,
        generatedPreserved: JSON.stringify(window.__generatedUrlsBeforeBatch) === JSON.stringify(window.__xPanoramaTest.generatedArtifacts().files.map((item) => item.url)),
        attempts: window.__xPanoramaTest.stateSnapshot().androidDownloadAttempts,
        statusHidden: document.querySelector('#androidDownloadStatus').hidden,
        status: document.querySelector('#androidDownloadStatus').textContent,
        permissionHelpHidden: document.querySelector('#androidPermissionHelp').hidden,
        fileOpen: document.querySelector('#fileSaveDetails').open,
        nextText: document.querySelector('#nextButton').textContent,
        bodyLocked: document.body.classList.contains('dialog-open')
      }));
      assert.equal(data.clicks.length, 4);
      assert.equal(new Set(data.clicks.map((item) => item.name)).size, 4);
      assert.equal(data.sequence.length, 5);
      assert.ok(data.sequence.slice(0, 4).every((item) => item.startsWith('download:')));
      assert.equal(data.sequence[4], 'handler-end');
      assert.equal(data.generatedPreserved, true);
      assert.equal(data.attempts, 1);
      assert.equal(data.statusHidden, false);
      assert.match(data.status, /4件のダウンロードを開始/);
      assert.match(data.status, /画像が足りない場合/);
      assert.equal(data.permissionHelpHidden, false);
      assert.equal(data.fileOpen, true);
      assert.equal(data.nextText, '4枚を再ダウンロード');
      assert.equal(data.bodyLocked, false);
    });
    await androidContext.close();

    const iosContext = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1'
    });
    await iosContext.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {} });
    });
    const iosPage = await iosContext.newPage();
    await test('iOS save branch keeps the dock photo-first and restores focus after Escape', async () => {
      await prepareGeneratedExportInPage(iosPage, 'ios-save.png');
      let data = await iosPage.evaluate(() => ({
        platform: window.__xPanoramaTest.stateSnapshot().savePlatform,
        mode: document.querySelector('#exportResults').dataset.saveMode,
        photoHidden: document.querySelector('#photoSaveCard').hidden,
        fileOpen: document.querySelector('#fileSaveDetails').open,
        sharePrimary: document.querySelector('#shareButton').classList.contains('primary'),
        shareSecondary: document.querySelector('#shareButton').classList.contains('secondary'),
        nextPrimary: document.querySelector('#nextButton').classList.contains('primary'),
        nextText: document.querySelector('#nextButton').textContent,
        zipSecondary: document.querySelector('#zipButton').classList.contains('secondary'),
        optionalHidden: document.querySelector('#optionalShareDetails').hidden
      }));
      assert.deepEqual(data, {
        platform: 'ios',
        mode: 'ios',
        photoHidden: false,
        fileOpen: false,
        sharePrimary: false,
        shareSecondary: true,
        nextPrimary: true,
        nextText: '写真アプリに保存',
        zipSecondary: true,
        optionalHidden: true
      });
      await iosPage.locator('#nextButton').click();
      await iosPage.waitForTimeout(100);
      data = await iosPage.evaluate(() => ({
        open: document.querySelector('#photoSaveDialog').open,
        focus: document.activeElement.id,
        bodyLocked: document.body.classList.contains('dialog-open'),
        generated: Boolean(window.__xPanoramaTest.generatedArtifacts()),
        step: window.__xPanoramaTest.stateSnapshot().step,
        platform: window.__xPanoramaTest.stateSnapshot().savePlatform,
        nextText: document.querySelector('#nextButton').textContent
      }));
      assert.deepEqual(data, { open: true, focus: 'photoDialogTitle', bodyLocked: true, generated: true, step: 4, platform: 'ios', nextText: '写真アプリに保存' });
      await iosPage.keyboard.press('Escape');
      await iosPage.waitForTimeout(100);
      data = await iosPage.evaluate(() => ({
        open: document.querySelector('#photoSaveDialog').open,
        focus: document.activeElement.id,
        bodyLocked: document.body.classList.contains('dialog-open')
      }));
      assert.deepEqual(data, { open: false, focus: 'nextButton', bodyLocked: false });
    });
    await iosContext.close();

    const swContext = await browser.newContext({ serviceWorkers: 'allow' });
    const swPage = await swContext.newPage();
    await test(`service worker ${currentVersion} caches only the scoped static allowlist`, async () => {
      await swPage.goto(`${baseUrl}/blank.html`, { waitUntil: 'load' });
      await swPage.evaluate(() => caches.open('unrelated-app-cache'));
      await swPage.goto(`${baseUrl}/`, { waitUntil: 'load' });
      await swPage.evaluate(() => navigator.serviceWorker.ready);
      await swPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      const dynamicText = await swPage.evaluate(() => fetch('/dynamic-probe.txt').then((response) => response.text()));
      await swPage.evaluate(() => fetch('/app.js?v=unlisted').then((response) => response.text()));
      await swPage.goto(`${baseUrl}/?navigation-probe=1`, { waitUntil: 'load' });
      const cacheState = await swPage.evaluate(async () => {
        const names = await caches.keys();
        const cache = await caches.open(`x-panorama:%2F:${window.__xPanoramaTest.APP_VERSION}`);
        const keys = (await cache.keys()).map((request) => request.url).sort();
        return { names, keys };
      });
      const expected = [
        `${baseUrl}/index.html`,
        `${baseUrl}/styles.css?v=${currentVersion}`,
        `${baseUrl}/core.js?v=${currentVersion}`,
        `${baseUrl}/diagnostics.js?v=${currentVersion}`,
        `${baseUrl}/app.js?v=${currentVersion}`,
        `${baseUrl}/zip.js?v=${currentVersion}`,
        `${baseUrl}/image-worker.js?v=${currentVersion}`,
        `${baseUrl}/manifest.webmanifest?v=${currentVersion}`,
        `${baseUrl}/icons/icon-192.png`,
        `${baseUrl}/icons/icon-512.png`
      ].sort();
      assert.equal(dynamicText, 'dynamic probe');
      assert.ok(cacheState.names.includes(`x-panorama:%2F:${currentVersion}`));
      assert.ok(cacheState.names.includes('unrelated-app-cache'));
      assert.deepEqual(cacheState.keys, expected);
      assert.ok(cacheState.keys.every((url) => !url.includes('dynamic-probe') && !url.includes('navigation-probe') && !url.includes('unlisted')));
    });
    await swContext.close();

    console.log(JSON.stringify({ passed: results.filter((item) => item.status === 'PASS').length, failed: failures.length, results, failures }, null, 2));
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await closeServer().catch(() => {});
  }
})();

