const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const appRoot = process.env.XPANORAMA_RC64_ROOT
  || path.resolve(__dirname, '..');
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const screenshotRoot = process.env.XPANORAMA_RC64_SCREENSHOT_ROOT || path.join(path.dirname(appRoot), 'qa-v050-rc4-layout');
const port = Number(process.env.XPANORAMA_RC64_LAYOUT_PORT || 8805);
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
      'Cache-Control': 'no-cache'
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

async function fresh(page) {
  await page.goto(`${baseUrl}/?layout=${Date.now()}-${Math.random()}`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__xPanoramaTest));
}

async function loadOne(page, name = 'layout-source.png') {
  await page.evaluate(async (fileName) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 1200, 800);
    gradient.addColorStop(0, '#b8431d');
    gradient.addColorStop(.5, '#ddaa28');
    gradient.addColorStop(1, '#2c55c7');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1200, 800);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    await window.__xPanoramaTest.loadSelection([new File([blob], fileName, { type: 'image/png' })]);
  }, name);
}

async function metrics(page) {
  return page.evaluate(() => {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const selector = [
      'button',
      'select',
      'input[type="number"]',
      'input[type="range"]',
      'summary',
      'a[href]',
      '.toggle-grid label:has(input[type="checkbox"])',
      '.inline-toggle:has(input[type="checkbox"])'
    ].join(',');
    const targets = Array.from(document.querySelectorAll(selector)).filter(isVisible);
    const identify = (element) => element.id || element.getAttribute('aria-label') || element.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) || element.tagName;
    const undersized = targets
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { target: identify(element), width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 };
      })
      .filter((item) => item.width < 47.5 || item.height < 47.5);
    const actionElements = Array.from(document.querySelectorAll('button, summary, a[href]')).filter(isVisible);
    const clippedActions = actionElements
      .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      .map(identify);
    const shell = document.querySelector('.app-shell').getBoundingClientRect();
    const bottomNav = document.querySelector('.bottom-nav');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      shell: { left: shell.left, right: innerWidth - shell.right, width: shell.width },
      undersized,
      clippedActions,
      bottomNavPosition: getComputedStyle(bottomNav).position,
      bottomNavHidden: bottomNav.hidden,
      visibleTargetCount: targets.length
    };
  });
}

function assertNoHorizontalOverflow(data) {
  assert.ok(data.documentWidth <= data.viewport.width + 1, `document overflow: ${JSON.stringify(data)}`);
  assert.ok(data.bodyWidth <= data.viewport.width + 1, `body overflow: ${JSON.stringify(data)}`);
  assert.deepEqual(data.undersized, []);
  assert.deepEqual(data.clippedActions, []);
  assert.ok(data.visibleTargetCount > 0);
}

(async () => {
  const results = [];
  const failures = [];
  let browser;
  try {
    fs.mkdirSync(screenshotRoot, { recursive: true });
    await listen();
    browser = await chromium.launch({ executablePath: edgePath, headless: true });

    async function test(name, fn) {
      try {
        await fn();
        results.push({ name, status: 'PASS' });
      } catch (error) {
        failures.push({ name, error: error.stack || String(error) });
        results.push({ name, status: 'FAIL' });
      }
    }

    const mobileContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 320, height: 800 } });
    const mobilePage = await mobileContext.newPage();

    await test('320px steps retain 12px margins, 48px targets, labels and no page overflow', async () => {
      await fresh(mobilePage);
      await mobilePage.waitForTimeout(250);
      const states = [];
      states.push({ step: 1, data: await metrics(mobilePage) });
      await mobilePage.screenshot({ path: path.join(screenshotRoot, '320-step1.png'), fullPage: true });
      await loadOne(mobilePage);
      for (const step of [2, 3, 4]) {
        await mobilePage.evaluate((value) => window.__xPanoramaTest.showStep(value), step);
        await mobilePage.waitForTimeout(250);
        states.push({ step, data: await metrics(mobilePage) });
        if (step === 2) await mobilePage.screenshot({ path: path.join(screenshotRoot, '320-step2.png'), fullPage: true });
      }
      states.forEach(({ data }) => assertNoHorizontalOverflow(data));
      assert.ok(states.every(({ data }) => Math.abs(data.shell.left - 12) <= 1 && Math.abs(data.shell.right - 12) <= 1));
      assert.ok(states.every(({ data }) => data.bottomNavPosition === 'sticky'));
      assert.equal(states[0].data.bottomNavHidden, true);
      assert.ok(states.slice(1).every(({ data }) => data.bottomNavHidden === false));
    });

    await test('375px, 390px and 430px mobile widths keep every step overflow-free', async () => {
      for (const width of [375, 390, 430]) {
        const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
        const page = await context.newPage();
        await fresh(page);
        await page.waitForTimeout(100);
        assertNoHorizontalOverflow(await metrics(page));
        if (width === 390) await page.screenshot({ path: path.join(screenshotRoot, '390-step1-empty.png'), fullPage: true });
        await loadOne(page, `mobile-${width}.png`);
        if (width === 390) await page.screenshot({ path: path.join(screenshotRoot, '390-step1-selected.png'), fullPage: true });
        for (const step of [2, 3, 4]) {
          await page.evaluate((value) => window.__xPanoramaTest.showStep(value), step);
          await page.waitForTimeout(100);
          const data = await metrics(page);
          assertNoHorizontalOverflow(data);
          assert.equal(data.bottomNavPosition, 'sticky');
          assert.equal(data.bottomNavHidden, false);
        }
        await context.close();
      }
    });

    await test('200 percent text enlargement keeps primary flow visible without horizontal overflow', async () => {
      await fresh(mobilePage);
      await loadOne(mobilePage, 'zoomed-text.png');
      await mobilePage.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      const states = [];
      for (const step of [1, 2, 3, 4]) {
        await mobilePage.evaluate((value) => window.__xPanoramaTest.showStep(value), step);
        await mobilePage.waitForTimeout(250);
        states.push({ step, data: await metrics(mobilePage) });
      }
      states.forEach(({ data }) => assertNoHorizontalOverflow(data));
      const actions = await mobilePage.evaluate(() => ({
        back: document.querySelector('#backButton').getBoundingClientRect().width,
        next: document.querySelector('#nextButton').getBoundingClientRect().width,
        format: document.querySelector('#formatSelect').getBoundingClientRect().width
      }));
      assert.ok(actions.back >= 48 && actions.next >= 48 && actions.format >= 48);
      await mobilePage.screenshot({ path: path.join(screenshotRoot, '320-200-percent-step4.png'), fullPage: true });
      await mobilePage.locator('#exportSettingsDetails').evaluate((element) => { element.open = true; });
      await mobilePage.focus('#qualityRange');
      await mobilePage.locator('#qualityRange').evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }));
      await mobilePage.waitForTimeout(100);
      const focusProof = await mobilePage.evaluate(() => {
        const control = document.querySelector('#qualityRange').getBoundingClientRect();
        const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
        return { controlTop: control.top, controlBottom: control.bottom, navTop: nav.top };
      });
      assert.ok(focusProof.controlTop >= 0 && focusProof.controlBottom <= focusProof.navTop - 4, JSON.stringify(focusProof));
      await mobilePage.screenshot({ path: path.join(screenshotRoot, '320-200-percent-quality-focus.png'), fullPage: false });
    });

    await test('WCAG text-spacing override does not clip action labels or create page overflow', async () => {
      await fresh(mobilePage);
      await loadOne(mobilePage, 'text-spacing.png');
      await mobilePage.addStyleTag({ content: `
        * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }
        p { margin-bottom: 2em !important; }
      ` });
      for (const step of [1, 2, 3, 4]) {
        await mobilePage.evaluate((value) => window.__xPanoramaTest.showStep(value), step);
        await mobilePage.waitForTimeout(250);
        assertNoHorizontalOverflow(await metrics(mobilePage));
      }
      await mobilePage.screenshot({ path: path.join(screenshotRoot, '320-text-spacing-step4.png'), fullPage: true });
    });

    await test('mobile focus scrolling keeps Step 2 controls and 200 percent Step 4 actions above the sticky dock', async () => {
      async function focusAudit(step, enlarged = false) {
        await fresh(mobilePage);
        await loadOne(mobilePage, `focus-step-${step}.png`);
        if (enlarged) await mobilePage.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await mobilePage.evaluate((value) => window.__xPanoramaTest.showStep(value), step);
        await mobilePage.waitForTimeout(250);
        return mobilePage.evaluate(async () => {
          const panel = document.querySelector('.step-panel.active');
          panel.querySelectorAll('details').forEach((details) => { details.open = true; });
          const selector = 'button, select, input, summary, [tabindex="0"]';
          const elements = Array.from(panel.querySelectorAll(selector)).filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !element.disabled;
          });
          const violations = [];
          const samples = [];
          for (const element of elements) {
            element.focus({ preventScroll: true });
            if (document.activeElement !== element) continue;
            element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const rect = element.getBoundingClientRect();
            const navRect = document.querySelector('.bottom-nav').getBoundingClientRect();
            const name = element.id || element.getAttribute('aria-label') || element.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);
            const sample = {
              name,
              top: rect.top,
              bottom: rect.bottom,
              navTop: navRect.top,
              scrollY,
              maxScroll: document.documentElement.scrollHeight - innerHeight
            };
            samples.push(sample);
            if (rect.top < 0 || rect.bottom > navRect.top - 4) violations.push(sample);
          }
          return { count: samples.length, violations, samples };
        });
      }

      const step2 = await focusAudit(2, false);
      const step4 = await focusAudit(4, true);
      assert.ok(step2.count >= 10, JSON.stringify(step2));
      assert.ok(step4.count >= 3, JSON.stringify(step4));
      assert.deepEqual(step2.violations, []);
      assert.deepEqual(step4.violations, []);
    });

    await mobileContext.close();

    const landscapeContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 844, height: 390 } });
    const landscapePage = await landscapeContext.newPage();
    await test('low landscape releases the fixed bottom action bar', async () => {
      await fresh(landscapePage);
      await landscapePage.waitForTimeout(250);
      const data = await metrics(landscapePage);
      assertNoHorizontalOverflow(data);
      assert.equal(data.bottomNavPosition, 'static');
      await landscapePage.screenshot({ path: path.join(screenshotRoot, 'landscape-step1.png'), fullPage: true });
    });
    await landscapeContext.close();

    const desktopContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    const desktopPage = await desktopContext.newPage();
    await test('desktop caps content at 1200px and gives the editor image about twice the controls width', async () => {
      await fresh(desktopPage);
      await loadOne(desktopPage, 'desktop-layout.png');
      await desktopPage.evaluate(() => window.__xPanoramaTest.showStep(2));
      await desktopPage.waitForTimeout(250);
      const data = await desktopPage.evaluate(() => {
        const shell = document.querySelector('.app-shell').getBoundingClientRect();
        const stage = document.querySelector('.editor-stage-column').getBoundingClientRect();
        const controls = document.querySelector('.editor-controls').getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          shell: { left: shell.left, right: innerWidth - shell.right, width: shell.width },
          stageWidth: stage.width,
          controlsWidth: controls.width
        };
      });
      assert.ok(data.documentWidth <= 1281);
      assert.ok(Math.abs(data.shell.width - 1200) <= 1);
      assert.ok(Math.abs(data.shell.left - 40) <= 1 && Math.abs(data.shell.right - 40) <= 1);
      assert.ok(data.stageWidth >= data.controlsWidth * 1.75, JSON.stringify(data));
      await desktopPage.screenshot({ path: path.join(screenshotRoot, 'desktop-step2.png'), fullPage: true });
    });
    await desktopContext.close();

    const reducedContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const reducedPage = await reducedContext.newPage();
    await test('prefers-reduced-motion reduces all animation and transition durations', async () => {
      await fresh(reducedPage);
      const data = await reducedPage.evaluate(() => {
        const seconds = (value) => value.split(',').map((part) => {
          const text = part.trim();
          if (text.endsWith('ms')) return Number.parseFloat(text) / 1000;
          return Number.parseFloat(text) || 0;
        });
        let maxAnimation = 0;
        let maxTransition = 0;
        for (const element of document.querySelectorAll('*')) {
          const style = getComputedStyle(element);
          maxAnimation = Math.max(maxAnimation, ...seconds(style.animationDuration));
          maxTransition = Math.max(maxTransition, ...seconds(style.transitionDuration));
        }
        return { matches: matchMedia('(prefers-reduced-motion: reduce)').matches, maxAnimation, maxTransition };
      });
      assert.equal(data.matches, true);
      assert.ok(data.maxAnimation <= 0.001, JSON.stringify(data));
      assert.ok(data.maxTransition <= 0.001, JSON.stringify(data));
    });
    await reducedContext.close();

    console.log(JSON.stringify({
      passed: results.filter((item) => item.status === 'PASS').length,
      failed: failures.length,
      screenshotRoot,
      results,
      failures
    }, null, 2));
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack || String(error));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await closeServer().catch(() => {});
  }
})();

