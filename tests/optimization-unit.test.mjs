import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalRoot = process.env.XPANORAMA_ORIGINAL_ROOT
  || 'C:\\Users\\dream\\Documents\\Codex\\2026-08-20\\k\\work\\x-panorama-pwa-deploy-v0.5.0-rc.3';
const results = [];

async function test(name, callback) {
  try {
    await callback();
    results.push({ name, status: 'PASS' });
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack || error.message || String(error) });
  }
}

function loadDiagnostics(base) {
  const sandbox = {};
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(base, 'core.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(base, 'diagnostics.js'), 'utf8'), sandbox);
  return sandbox.XPanoramaDiagnostics;
}

function loadCore(base = root) {
  const sandbox = {};
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(base, 'core.js'), 'utf8'), sandbox);
  return sandbox.XPanoramaCore;
}

await test('Android keeps direct downloads primary while Directory Picker remains an available secondary strategy', () => {
  const core = loadCore();
  const profile = core.detectPlatformProfile({
    userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36',
    platform: 'Linux armv8l',
    maxTouchPoints: 5
  });
  assert.deepEqual(JSON.parse(JSON.stringify(core.resolveSaveStrategy(profile, { directoryPicker: true }))), {
    primary: 'batch-download',
    secondary: ['directory', 'individual', 'zip', 'share']
  });
  assert.deepEqual(JSON.parse(JSON.stringify(core.resolveSaveStrategy(profile, { directoryPicker: false }))), {
    primary: 'batch-download',
    secondary: ['individual', 'zip', 'share']
  });
});

await test('render contexts request the explicit sRGB color space for Canvas and OffscreenCanvas-compatible contexts', () => {
  const core = loadCore();
  const requests = [];
  const makeCanvas = () => ({
    width: 2,
    height: 2,
    getContext(type, options) {
      requests.push({ type, options });
      return {
        fillStyle: '',
        clearRect() {},
        fillRect() {},
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low'
      };
    }
  });

  assert.ok(core.prepareRenderContext(makeCanvas(), 'image/png'));
  assert.ok(core.prepareRenderContext(makeCanvas(), 'image/jpeg'));
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    { type: '2d', options: { alpha: true, colorSpace: 'srgb' } },
    { type: '2d', options: { alpha: false, colorSpace: 'srgb' } }
  ]);
});

await test('shared diagnostic ImageData preserves all previous results and avoids canvas rereads', () => {
  const width = 80;
  const height = 24;
  const panelWidths = [20, 20, 20, 20];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const edge = x < 3 || x >= width - 3 || y < 2 || y >= height - 2;
      data[offset] = edge ? 0 : (x * 7 + y * 3) % 256;
      data[offset + 1] = edge ? 0 : (x * 2 + y * 11) % 256;
      data[offset + 2] = edge ? 0 : (x * 13 + y) % 256;
      data[offset + 3] = 255;
    }
  }
  const imageData = { data, width, height };
  let oldReads = 0;
  const oldCanvas = {
    width, height,
    getContext() { return { getImageData() { oldReads += 1; return imageData; } }; }
  };
  const before = loadDiagnostics(originalRoot);
  const expected = [
    before.detectUniformBands(oldCanvas),
    before.detectInternalUniformBands(oldCanvas, panelWidths),
    before.seamDetailScores(oldCanvas, panelWidths)
  ];
  assert.equal(oldReads, 3);

  const after = loadDiagnostics(root);
  const actual = [
    after.detectUniformBands(imageData),
    after.detectInternalUniformBands(imageData, panelWidths),
    after.seamDetailScores(imageData, panelWidths)
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
});

await test('ZIP fallback slices blobs into bounded chunks without reading the whole source blob', async () => {
  const messages = [];
  const sandbox = { Blob, TextEncoder, Uint8Array, Uint32Array, DataView, Date, Error, Math, Number };
  sandbox.self = sandbox;
  sandbox.postMessage = (message) => messages.push(message);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'zip.js'), 'utf8'), sandbox);

  const sourceBytes = new Uint8Array(2_500_000).map((_, index) => index % 251);
  const source = new Blob([sourceBytes]);
  const nativeSlice = source.slice.bind(source);
  const sliceRanges = [];
  let sliceCalls = 0;
  Object.defineProperty(source, 'stream', { value: undefined });
  Object.defineProperty(source, 'arrayBuffer', {
    value: async () => { throw new Error('whole-blob arrayBuffer must not be used'); }
  });
  Object.defineProperty(source, 'slice', {
    value: (...args) => { sliceCalls += 1; sliceRanges.push(args); return nativeSlice(...args); }
  });
  await sandbox.onmessage({ data: { type: 'create', files: [{ name: 'sample.bin', blob: source }], timestamp: 0 } });
  const done = messages.find((message) => message.type === 'done');
  assert.ok(done && done.blob instanceof Blob);
  assert.equal(sliceCalls, 3);
  assert.ok(sliceRanges.every(([start, end]) => end - start <= 1_048_576));
  const zipBytes = new Uint8Array(await done.blob.arrayBuffer());
  const signature = zipBytes.subarray(0, 4);
  assert.deepEqual([...signature], [0x50, 0x4b, 0x03, 0x04]);
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const name = new TextDecoder().decode(zipBytes.subarray(30, 30 + nameLength));
  const bodyStart = 30 + nameLength + extraLength;
  assert.equal(name, 'sample.bin');
  assert.equal(view.getUint32(22, true), source.size);
  assert.deepEqual(
    [...zipBytes.subarray(bodyStart, bodyStart + 32)],
    [...new Uint8Array(32).map((_, index) => index % 251)]
  );
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xpanorama-zip-test-'));
  try {
    const zipPath = path.join(temporaryRoot, 'fallback.zip');
    const extractPath = path.join(temporaryRoot, 'extract');
    fs.mkdirSync(extractPath);
    fs.writeFileSync(zipPath, zipBytes);
    const extracted = spawnSync('tar', ['-xf', zipPath, '-C', extractPath], { encoding: 'utf8' });
    assert.equal(extracted.status, 0, extracted.stderr || extracted.stdout);
    assert.deepEqual(fs.readFileSync(path.join(extractPath, 'sample.bin')), Buffer.from(sourceBytes));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

await test('navigation timeout uses cache, while a cache miss still waits for first network response', async () => {
  const listeners = {};
  const sandbox = {
    URL,
    encodeURIComponent,
    Promise,
    console,
    self: null,
    caches: null,
    fetch: null,
    setTimeout: null,
    clearTimeout
  };
  sandbox.self = sandbox;
  sandbox.registration = { scope: 'https://example.test/' };
  sandbox.location = { href: 'https://example.test/sw.js', origin: 'https://example.test' };
  sandbox.clients = { claim: async () => {} };
  sandbox.skipWaiting = () => {};
  sandbox.addEventListener = (name, callback) => { listeners[name] = callback; };
  let requestedDelay = 0;
  sandbox.setTimeout = (callback, delay) => {
    requestedDelay = delay;
    return setTimeout(callback, 0);
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), sandbox);

  const cached = { source: 'cache' };
  sandbox.fetch = () => new Promise(() => {});
  sandbox.caches = { open: async () => ({ match: async () => cached }) };
  const cachedResult = await vm.runInContext('navigationNetworkFirst({})', sandbox);
  assert.equal(cachedResult, cached);
  assert.equal(requestedDelay, 2500);

  const network = { source: 'network' };
  sandbox.fetch = () => new Promise((resolve) => setTimeout(() => resolve(network), 5));
  sandbox.caches = { open: async () => ({ match: async () => undefined }) };
  const networkResult = await vm.runInContext('navigationNetworkFirst({})', sandbox);
  assert.equal(networkResult, network);

  const failure = new Error('offline');
  sandbox.fetch = () => Promise.reject(failure);
  sandbox.caches = { open: async () => ({ match: async () => undefined }) };
  await assert.rejects(vm.runInContext('navigationNetworkFirst({})', sandbox), /offline/);
});

const failures = results.filter((result) => result.status === 'FAIL');
console.log(JSON.stringify({ passed: results.length - failures.length, failed: failures.length, results }, null, 2));
if (failures.length) process.exitCode = 1;
