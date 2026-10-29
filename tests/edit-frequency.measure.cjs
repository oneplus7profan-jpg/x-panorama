'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const beforeRoot = process.env.XPANORAMA_BEFORE_ROOT
  || 'C:\\Users\\dream\\Documents\\Codex\\2026-08-20\\k\\work\\x-panorama-pwa-deploy-v0.5.0-rc.3';
const afterRoot = process.env.XPANORAMA_AFTER_ROOT || path.resolve(__dirname, '..');

async function measure(browser, appRoot, port) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, baseUrl);
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const target = path.resolve(appRoot, relative);
    if (!target.startsWith(path.resolve(appRoot))) return response.writeHead(403).end();
    fs.readFile(target, (error, body) => {
      if (error) return response.writeHead(404).end();
      const type = path.extname(target) === '.js' ? 'text/javascript' : path.extname(target) === '.css' ? 'text/css' : 'text/html';
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(body);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__xPanoramaTest));
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 400;
      const context = canvas.getContext('2d');
      context.fillStyle = '#4c8cff';
      context.fillRect(0, 0, 600, 400);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      await window.__xPanoramaTest.loadSelection([new File([blob], 'frequency.png', { type: 'image/png' })]);
      window.__xPanoramaTest.showStep(2);
    });
    const editor = page.locator('#editorCanvas');
    const box = await editor.boundingBox();
    const dragBefore = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot().projectRevision);
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5, { steps: 30 });
    await page.mouse.up();
    const dragAfter = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot().projectRevision);

    const wheelBefore = dragAfter;
    await page.evaluate(() => {
      const canvas = document.querySelector('#editorCanvas');
      const rect = canvas.getBoundingClientRect();
      for (let index = 0; index < 20; index += 1) {
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -5, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
      }
    });
    await page.waitForTimeout(180);
    const wheelAfter = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot().projectRevision);

    const qualityMutations = await page.evaluate(async () => {
      const target = document.querySelector('#mobileCompletedList');
      let mutations = 0;
      const observer = new MutationObserver((records) => { mutations += records.length; });
      observer.observe(target, { childList: true, subtree: true });
      const range = document.querySelector('#qualityRange');
      for (let value = 70; value < 90; value += 1) {
        range.value = String(value);
        range.dispatchEvent(new Event('input', { bubbles: true }));
      }
      range.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      observer.disconnect();
      return mutations;
    });
    return { dragRevisionDelta: dragAfter - dragBefore, wheelRevisionDelta: wheelAfter - wheelBefore, qualityNavigationMutations: qualityMutations };
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: edgePath, headless: true });
  try {
    const before = await measure(browser, beforeRoot, 8840);
    const after = await measure(browser, afterRoot, 8841);
    console.log(JSON.stringify({ before, after }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
