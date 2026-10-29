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
const port = Number(process.env.XPANORAMA_RC64_INTERACTION_PORT || 8803);
const baseUrl = `http://127.0.0.1:${port}`;
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

async function openApp(browser, options = {}) {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
    ...options
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__xPanoramaTest));
  return { context, page };
}

async function loadOne(page, name = 'fractional-crop.png') {
  await page.setInputFiles('#fileInput', path.join(fixtureRoot, name));
  await page.waitForFunction(() => document.querySelector('#dropZone')?.dataset.selectionState === 'selected');
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
    await listen();
    browser = await chromium.launch({ executablePath: edgePath, headless: true });

    await test('current design-system structure exposes explicit selection intents and persistent gesture instructions', async () => {
      const index = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
      const styles = fs.readFileSync(path.join(appRoot, 'styles.css'), 'utf8');
      assert.match(index, /id="chooseSingleImageButton"/);
      assert.match(index, /id="chooseFourImagesButton"/);
      assert.match(index, /id="gestureInstructions"/);
      assert.match(index, /class="bottom-nav action-dock"/);
      assert.ok(index.indexOf('class="tab-row"') < index.indexOf('id="diagnosticsOverview"'));
      assert.match(styles, /#editorCanvas[^}]*max-height:\s*min\(55svh/s);
      assert.doesNotMatch(styles, /\.bottom-nav\s*\{[^}]*position:\s*fixed/s);
    });

    await test('one-image and four-image picker intents are explicit and invalid replacement preserves the current project', async () => {
      const { context, page } = await openApp(browser);
      assert.equal(await page.locator('.bottom-nav').isHidden(), true);
      const [singleChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('#chooseSingleImageButton')
      ]);
      assert.equal(singleChooser.isMultiple(), false);
      await singleChooser.setFiles(path.join(fixtureRoot, 'fractional-crop.png'));
      await page.waitForFunction(() => document.querySelector('#dropZone')?.dataset.selectionState === 'selected');

      const before = await page.evaluate(() => ({
        mode: window.__xPanoramaTest.stateSnapshot().mode,
        title: document.querySelector('#selectionStateTitle').textContent,
        previewCount: document.querySelector('#selectionPreviewGrid').children.length
      }));
      assert.deepEqual(before, { mode: 'single', title: '1枚選択済み', previewCount: 1 });
      assert.equal(await page.locator('.bottom-nav').isVisible(), true);

      await page.evaluate(async () => window.__xPanoramaTest.loadSelection([]));
      const afterCancel = await page.evaluate(() => ({
        mode: window.__xPanoramaTest.stateSnapshot().mode,
        title: document.querySelector('#selectionStateTitle').textContent,
        previewCount: document.querySelector('#selectionPreviewGrid').children.length
      }));
      assert.deepEqual(afterCancel, before);

      await page.click('#changeSelectionModeButton');
      const [fourChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('#chooseFourImagesButton')
      ]);
      assert.equal(fourChooser.isMultiple(), true);
      await fourChooser.setFiles([
        path.join(fixtureRoot, 'same-01.png'),
        path.join(fixtureRoot, 'same-02.png')
      ]);
      await page.waitForFunction(() => document.querySelector('#loadError')?.textContent.includes('4枚'));
      const after = await page.evaluate(() => ({
        mode: window.__xPanoramaTest.stateSnapshot().mode,
        title: document.querySelector('#selectionStateTitle').textContent,
        previewCount: document.querySelector('#selectionPreviewGrid').children.length,
        error: document.querySelector('#loadError').textContent
      }));
      assert.equal(after.mode, 'single');
      assert.equal(after.title, '1枚選択済み');
      assert.equal(after.previewCount, 1);
      assert.match(after.error, /4枚/);
      await context.close();
    });

    await test('drag and pinch avoid move-time layout reads, and the remaining finger cannot pan after pinch end', async () => {
      const { context, page } = await openApp(browser);
      await loadOne(page);
      await page.click('#nextButton');
      await page.click('#zoomInButton');
      const canvas = page.locator('#editorCanvas');
      await canvas.scrollIntoViewIfNeeded();
      const behavior = await page.evaluate(() => {
        const canvas = document.querySelector('#editorCanvas');
        const rect = canvas.getBoundingClientRect();
        let layoutReads = 0;
        canvas.getBoundingClientRect = () => {
          layoutReads += 1;
          return rect;
        };
        canvas.setPointerCapture = () => {};
        canvas.releasePointerCapture = () => {};
        const emit = (type, pointerId, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: 'touch',
          isPrimary: pointerId === 1,
          buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
          clientX: rect.left + x,
          clientY: rect.top + y
        }));

        const beforeDrag = window.__xPanoramaTest.stateSnapshot().crop;
        emit('pointerdown', 1, rect.width * .5, rect.height * .5);
        const dragReadsAfterDown = layoutReads;
        emit('pointermove', 1, rect.width * .5 - 32, rect.height * .5);
        const dragMoveLayoutReads = layoutReads - dragReadsAfterDown;
        emit('pointerup', 1, rect.width * .5 - 32, rect.height * .5);
        const afterDrag = window.__xPanoramaTest.stateSnapshot().crop;

        emit('pointerdown', 1, rect.width * .35, rect.height * .5);
        emit('pointerdown', 2, rect.width * .65, rect.height * .5);
        const pinchReadsAfterDown = layoutReads;
        emit('pointermove', 1, rect.width * .27, rect.height * .5);
        emit('pointermove', 2, rect.width * .73, rect.height * .5);
        const pinchMoveLayoutReads = layoutReads - pinchReadsAfterDown;
        const afterPinch = window.__xPanoramaTest.stateSnapshot().crop;
        emit('pointerup', 2, rect.width * .73, rect.height * .5);
        const remainingMoveReadsAfterEnd = layoutReads;
        emit('pointermove', 1, rect.width * .18, rect.height * .5);
        const remainingMoveLayoutReads = layoutReads - remainingMoveReadsAfterEnd;
        const afterRemainingMove = window.__xPanoramaTest.stateSnapshot().crop;
        emit('pointerup', 1, rect.width * .18, rect.height * .5);
        const afterRelease = window.__xPanoramaTest.stateSnapshot();

        emit('pointerdown', 3, rect.width * .5, rect.height * .5);
        emit('pointermove', 3, rect.width * .5 + 24, rect.height * .5);
        emit('pointerup', 3, rect.width * .5 + 24, rect.height * .5);
        const afterFreshDrag = window.__xPanoramaTest.stateSnapshot().crop;

        emit('pointerdown', 4, rect.width * .5, rect.height * .5);
        emit('pointermove', 4, rect.width * .5 - 18, rect.height * .5);
        emit('pointercancel', 4, rect.width * .5 - 18, rect.height * .5);
        const afterCancel = window.__xPanoramaTest.stateSnapshot();
        emit('pointerdown', 5, rect.width * .5, rect.height * .5);
        emit('pointermove', 5, rect.width * .5 + 18, rect.height * .5);
        emit('pointerup', 5, rect.width * .5 + 18, rect.height * .5);
        const afterPostCancelDrag = window.__xPanoramaTest.stateSnapshot();

        return {
          beforeDrag,
          afterDrag,
          afterPinch,
          afterRemainingMove,
          afterReleaseGesture: afterRelease.gesture,
          afterReleasePointers: afterRelease.pointerCount,
          afterFreshDrag,
          afterCancelGesture: afterCancel.gesture,
          afterCancelPointers: afterCancel.pointerCount,
          afterCancelCrop: afterCancel.crop,
          afterPostCancelGesture: afterPostCancelDrag.gesture,
          afterPostCancelPointers: afterPostCancelDrag.pointerCount,
          afterPostCancelCrop: afterPostCancelDrag.crop,
          dragMoveLayoutReads,
          pinchMoveLayoutReads,
          remainingMoveLayoutReads,
          describedBy: canvas.getAttribute('aria-describedby'),
          instructionsHidden: document.querySelector('#gestureInstructions').hidden,
          touchAction: getComputedStyle(canvas).touchAction
        };
      });
      assert.notDeepEqual(behavior.afterDrag, behavior.beforeDrag);
      assert.equal(behavior.dragMoveLayoutReads, 0);
      assert.notDeepEqual(behavior.afterPinch, behavior.afterDrag);
      assert.equal(behavior.pinchMoveLayoutReads, 0);
      assert.equal(behavior.remainingMoveLayoutReads, 0);
      assert.deepEqual(behavior.afterRemainingMove, behavior.afterPinch);
      assert.equal(behavior.afterReleaseGesture, null);
      assert.equal(behavior.afterReleasePointers, 0);
      assert.notDeepEqual(behavior.afterFreshDrag, behavior.afterRemainingMove);
      assert.equal(behavior.afterCancelGesture, null);
      assert.equal(behavior.afterCancelPointers, 0);
      assert.equal(behavior.afterPostCancelGesture, null);
      assert.equal(behavior.afterPostCancelPointers, 0);
      assert.notDeepEqual(behavior.afterPostCancelCrop, behavior.afterCancelCrop);
      assert.match(behavior.describedBy, /gestureInstructions/);
      assert.equal(behavior.instructionsHidden, false);
      assert.equal(behavior.touchAction, 'none');
      await context.close();
    });

    await test('generated results keep the dock as the only primary save action', async () => {
      const { context, page } = await openApp(browser);
      await loadOne(page);
      await page.evaluate(async () => {
        const preset = document.querySelector('#presetSelect');
        preset.value = 'custom';
        document.querySelector('#customWidth').value = '400';
        document.querySelector('#customHeight').value = '400';
        window.__xPanoramaTest.applyPreset(true);
        window.__xPanoramaTest.showStep(4);
        await window.__xPanoramaTest.generateExport();
      });
      await page.waitForFunction(() => Boolean(window.__xPanoramaTest.generatedArtifacts()));
      const actions = await page.evaluate(() => {
        const visible = (button) => {
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        };
        return {
          primary: Array.from(document.querySelectorAll('button.primary')).filter(visible).map((button) => button.id),
          nextText: document.querySelector('#nextButton').textContent.trim(),
          resultClasses: ['directorySaveButton', 'shareButton', 'zipButton']
            .map((id) => ({ id, className: document.querySelector(`#${id}`).className }))
        };
      });
      assert.deepEqual(actions.primary, ['nextButton']);
      assert.match(actions.nextText, /保存|ダウンロード/);
      actions.resultClasses.forEach(({ className }) => assert.match(className, /secondary/));
      await context.close();
    });

    await test('mobile action dock is in flow, reserves its measured height and keeps one Step 4 primary action', async () => {
      const { context, page } = await openApp(browser);
      await loadOne(page);
      await page.evaluate(() => window.__xPanoramaTest.showStep(4));
      await page.waitForTimeout(50);
      const state = await page.evaluate(() => {
        const dock = document.querySelector('.bottom-nav');
        const visiblePrimary = Array.from(document.querySelectorAll('button.primary')).filter((button) => {
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }).map((button) => ({ id: button.id, text: button.textContent.trim() }));
        return {
          position: getComputedStyle(dock).position,
          dockHeight: dock.getBoundingClientRect().height,
          reserved: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--action-dock-height')),
          visiblePrimary,
          version: window.__xPanoramaTest.APP_VERSION
        };
      });
      assert.equal(state.position, 'sticky');
      assert.ok(state.dockHeight >= 48);
      assert.ok(state.reserved >= state.dockHeight - 1, JSON.stringify(state));
      assert.deepEqual(state.visiblePrimary, [{ id: 'nextButton', text: '4枚を書き出す' }]);
      assert.equal(state.version, currentVersion);
      await context.close();
    });

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

