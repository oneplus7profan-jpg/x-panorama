'use strict';

// Browser-level image-quality baselines.  This file intentionally measures
// the current implementation without making any quality decision for it.
// The fixtures are generated in-browser so the test has no external image
// or network dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const appRoot = process.env.XPANORAMA_APP_ROOT || path.resolve(__dirname, '..');
const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = Number(process.env.XPANORAMA_QUALITY_PORT || 8832);
const baseUrl = `http://127.0.0.1:${port}`;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
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

async function openPage(browser, { forceWorkerUnsupported = false } = {}) {
  const context = await browser.newContext({
    serviceWorkers: 'block',
    viewport: { width: 390, height: 844 }
  });
  if (forceWorkerUnsupported) {
    await context.addInitScript(() => {
      // The application treats a constructor failure as the documented
      // WORKER_UNAVAILABLE case and uses its public main-thread path.
      window.Worker = function UnsupportedWorker() {
        throw new DOMException('Worker disabled by image-quality test', 'NotSupportedError');
      };
    });
  }
  const page = await context.newPage();
  await page.goto(`${baseUrl}/?image-quality=${Date.now()}-${Math.random()}`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__xPanoramaTest));
  return { context, page };
}

async function createPatternFile(page, {
  kind = 'opaque',
  width = 640,
  height = 400,
  name = `${kind}-fixture.png`
} = {}) {
  await page.evaluate(async ({ kind, width, height, name }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!context) throw new Error('quality fixture canvas unavailable');

    if (kind === 'transparent') {
      context.clearRect(0, 0, width, height);
      // Deliberate fully-transparent margins, opaque blocks, and a
      // semi-transparent block exercise PNG alpha and JPEG white compositing.
      context.fillStyle = '#e94f64';
      context.fillRect(200, 24, 176, height - 48);
      context.fillStyle = 'rgba(44, 131, 255, 0.5)';
      context.fillRect(392, 76, 160, height - 152);
      context.fillStyle = 'rgba(39, 206, 133, 0.82)';
      context.fillRect(568, 12, 48, height - 24);
    } else {
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#11233f');
      gradient.addColorStop(0.33, '#27a6d9');
      gradient.addColorStop(0.66, '#e5c35c');
      gradient.addColorStop(1, '#ef5a77');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      // Thin lines at several frequencies and orientations.
      for (let x = 3; x < width; x += 7) {
        context.fillStyle = x % 14 === 3 ? 'rgba(255,255,255,.76)' : 'rgba(0,0,0,.52)';
        context.fillRect(x, 0, 1, height);
      }
      for (let y = 5; y < height; y += 11) {
        context.fillStyle = y % 22 === 5 ? 'rgba(255,255,255,.58)' : 'rgba(0,0,0,.42)';
        context.fillRect(0, y, width, 1);
      }

      // High-frequency checkerboard patch.
      const patchX = 28;
      const patchY = 38;
      const cell = 4;
      for (let y = patchY; y < patchY + 144; y += cell) {
        for (let x = patchX; x < patchX + 224; x += cell) {
          context.fillStyle = ((x - patchX) / cell + (y - patchY) / cell) % 2
            ? '#f8f8f8'
            : '#202632';
          context.fillRect(x, y, cell, cell);
        }
      }

      // Text-like seven-segment glyphs avoid platform font rasterization while
      // retaining the high-contrast edges a text/photo fixture needs.
      const glyphs = {
        P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
        A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
        N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
        O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
        R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
        M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001']
      };
      const word = 'PANORAMA';
      const scale = 3;
      let cursor = 292;
      for (const glyph of word) {
        const rows = glyphs[glyph] || glyphs.A;
        rows.forEach((row, rowIndex) => {
          for (let column = 0; column < row.length; column += 1) {
            if (row[column] === '1') {
              context.fillStyle = rowIndex % 2 ? '#fff2a6' : '#321b55';
              context.fillRect(cursor + column * scale, 54 + rowIndex * scale, scale, scale);
            }
          }
        });
        cursor += 21;
      }

      // Deliberate, uniquely colored seam markers make each quarter boundary
      // observable after the 4-way split.
      ['#ff3b30', '#34c759', '#007aff'].forEach((color, index) => {
        context.fillStyle = color;
        context.fillRect((index + 1) * width / 4 - 1, 0, 2, height);
      });
    }

    const reference = context.getImageData(0, 0, width, height);
    window.__xPanoramaQualityReference = {
      width,
      height,
      data: new Uint8ClampedArray(reference.data)
    };
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('quality fixture encoding failed')), 'image/png');
    });
    await window.__xPanoramaTest.loadSelection([new File([blob], name, { type: 'image/png' })]);
  }, { kind, width, height, name });
  await page.waitForFunction(() => {
    const snapshot = window.__xPanoramaTest.stateSnapshot();
    return snapshot.mode === 'single' && !snapshot.loadPending && snapshot.single;
  });
}

async function configureExport(page, { format = 'image/png', quality = 92, width = 640, height = 400 } = {}) {
  const snapshot = await page.evaluate(async ({ format, quality, width, height }) => {
    const test = window.__xPanoramaTest;
    test.showStep(2);
    const preset = document.querySelector('#presetSelect');
    preset.value = 'custom';
    document.querySelector('#customWidth').value = String(width);
    document.querySelector('#customHeight').value = String(height);
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    test.showStep(4);
    const formatSelect = document.querySelector('#formatSelect');
    formatSelect.value = format;
    formatSelect.dispatchEvent(new Event('change', { bubbles: true }));
    const qualityRange = document.querySelector('#qualityRange');
    qualityRange.value = String(quality);
    qualityRange.dispatchEvent(new Event('input', { bubbles: true }));
    qualityRange.dispatchEvent(new Event('change', { bubbles: true }));
    await test.generateExport();
    return test.stateSnapshot();
  }, { format, quality, width, height });
  assert.equal(snapshot.exportError, '', snapshot.exportError);
  assert.equal(snapshot.generatedFileCount, 4);
  return snapshot;
}

async function captureGeneratedPixels(page) {
  return page.evaluate(async () => {
    const generated = window.__xPanoramaTest.generatedArtifacts();
    if (!generated || !generated.files || generated.files.length !== 4) throw new Error('generated panels unavailable');
    const output = [];
    for (const item of generated.files) {
      const bitmap = await createImageBitmap(item.blob);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let binary = '';
        for (let offset = 0; offset < data.length; offset += 0x8000) {
          binary += String.fromCharCode(...data.subarray(offset, Math.min(data.length, offset + 0x8000)));
        }
        output.push({ width: bitmap.width, height: bitmap.height, pixels: btoa(binary) });
      } finally {
        if (typeof bitmap.close === 'function') bitmap.close();
      }
    }
    return output;
  });
}

function comparePixelBuffers(left, right) {
  assert.equal(left.length, right.length);
  let mismatch = 0;
  let sumAbs = 0;
  let maxAbs = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = Math.abs(left[index] - right[index]);
    if (difference) mismatch += 1;
    sumAbs += difference;
    if (difference > maxAbs) maxAbs = difference;
  }
  return {
    bytes: left.length,
    mismatch,
    mismatchRatio: left.length ? mismatch / left.length : 0,
    meanAbs: left.length ? sumAbs / left.length : 0,
    maxAbs
  };
}

async function measureGeneratedAgainstReference(page, { format, quality }) {
  return page.evaluate(async ({ format, quality }) => {
    const generated = window.__xPanoramaTest.generatedArtifacts();
    const reference = window.__xPanoramaQualityReference;
    if (!generated || !reference) throw new Error('quality measurement fixture unavailable');
    const expectedBackground = format === 'image/jpeg';
    const output = [];
    let totalSquaredError = 0;
    let totalAbsoluteError = 0;
    let totalSamples = 0;
    let alphaMismatches = 0;
    let fullyTransparentAlphaMismatches = 0;
    let fullyOpaqueAlphaMismatches = 0;
    let semiTransparentAlphaMismatches = 0;
    let transparentReferencePixels = 0;
    let fullyTransparentReferencePixels = 0;
    let opaqueReferencePixels = 0;
    let outputOpaquePixels = 0;
    let whiteBackgroundSamples = 0;
    let whiteBackgroundInteriorPixels = 0;
    let whiteBackgroundInteriorSamples = 0;

    for (let panelIndex = 0; panelIndex < generated.files.length; panelIndex += 1) {
      const item = generated.files[panelIndex];
      const bitmap = await createImageBitmap(item.blob);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let panelSquaredError = 0;
        let panelAbsoluteError = 0;
        let panelSamples = 0;
        for (let y = 0; y < bitmap.height; y += 1) {
          for (let x = 0; x < bitmap.width; x += 1) {
            const sourceX = panelIndex * bitmap.width + x;
            const sourceOffset = (y * reference.width + sourceX) * 4;
            const outputOffset = (y * bitmap.width + x) * 4;
            const sourceAlpha = reference.data[sourceOffset + 3];
            const expected = expectedBackground
              ? (() => {
                // JPEG has no alpha. Compare against the mathematically
                // expected sRGB white-background composite, including the
                // semi-transparent fixture pixels.
                const alpha = sourceAlpha / 255;
                return [0, 1, 2].map((channel) => Math.round(
                  reference.data[sourceOffset + channel] * alpha + 255 * (1 - alpha)
                ));
              })()
              : [reference.data[sourceOffset], reference.data[sourceOffset + 1], reference.data[sourceOffset + 2]];
            for (let channel = 0; channel < 3; channel += 1) {
              const difference = actual[outputOffset + channel] - expected[channel];
              panelSquaredError += difference * difference;
              panelAbsoluteError += Math.abs(difference);
              totalSquaredError += difference * difference;
              totalAbsoluteError += Math.abs(difference);
            }
            panelSamples += 3;
            totalSamples += 3;
            if (sourceAlpha < 255) transparentReferencePixels += 1;
            if (sourceAlpha === 0) fullyTransparentReferencePixels += 1;
            if (sourceAlpha === 255) opaqueReferencePixels += 1;
            if (actual[outputOffset + 3] === 255) outputOpaquePixels += 1;
            if (sourceAlpha === 0) {
              const interior = sourceX >= 8 && sourceX <= 191 && y >= 8 && y < reference.height - 8;
              if (actual[outputOffset] >= 250 && actual[outputOffset + 1] >= 250 && actual[outputOffset + 2] >= 250) whiteBackgroundSamples += 1;
              if (interior) {
                whiteBackgroundInteriorPixels += 1;
                if (actual[outputOffset] >= 250 && actual[outputOffset + 1] >= 250 && actual[outputOffset + 2] >= 250) whiteBackgroundInteriorSamples += 1;
              }
            }
            if (!expectedBackground && actual[outputOffset + 3] !== sourceAlpha) {
              alphaMismatches += 1;
              if (sourceAlpha === 0) fullyTransparentAlphaMismatches += 1;
              else if (sourceAlpha === 255) fullyOpaqueAlphaMismatches += 1;
              else semiTransparentAlphaMismatches += 1;
            }
          }
        }
        output.push({
          width: bitmap.width,
          height: bitmap.height,
          size: item.blob.size,
          mae: panelSamples ? panelAbsoluteError / panelSamples : 0,
          mse: panelSamples ? panelSquaredError / panelSamples : 0,
          psnr: panelSquaredError === 0 ? null : 10 * Math.log10((255 * 255 * panelSamples) / panelSquaredError),
          psnrInfinite: panelSquaredError === 0
        });
      } finally {
        if (typeof bitmap.close === 'function') bitmap.close();
      }
    }
    return {
      format,
      quality,
      files: output,
      totalBytes: output.reduce((sum, item) => sum + item.size, 0),
      mae: totalSamples ? totalAbsoluteError / totalSamples : 0,
      mse: totalSamples ? totalSquaredError / totalSamples : 0,
      psnr: totalSquaredError === 0 ? null : 10 * Math.log10((255 * 255 * totalSamples) / totalSquaredError),
      psnrInfinite: totalSquaredError === 0,
      alphaMismatches,
      fullyTransparentAlphaMismatches,
      fullyOpaqueAlphaMismatches,
      semiTransparentAlphaMismatches,
      transparentReferencePixels,
      fullyTransparentReferencePixels,
      opaqueReferencePixels,
      outputOpaquePixels,
      whiteBackgroundSamples,
      whiteBackgroundInteriorPixels,
      whiteBackgroundInteriorSamples
    };
  }, { format, quality });
}

async function measureDownsamplingStrategies(page) {
  return page.evaluate(() => {
    const sourceWidth = 2048;
    const sourceHeight = 1024;
    const outputWidth = sourceWidth / 4;
    const outputHeight = sourceHeight / 4;
    const source = document.createElement('canvas');
    source.width = sourceWidth;
    source.height = sourceHeight;
    const sourceContext = source.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('downsampling source canvas unavailable');
    const sourceImage = sourceContext.createImageData(sourceWidth, sourceHeight);

    // Generate an opaque, photo-like stress pattern directly in RGBA. It has
    // smooth gradients, broad tonal blocks, 1-2px lines, and a high-frequency
    // patch, without depending on installed fonts or external image fixtures.
    for (let y = 0; y < sourceHeight; y += 1) {
      for (let x = 0; x < sourceWidth; x += 1) {
        const offset = (y * sourceWidth + x) * 4;
        let red = 24 + (x / (sourceWidth - 1)) * 170 + (y / (sourceHeight - 1)) * 35;
        let green = 34 + (y / (sourceHeight - 1)) * 172 + (x / (sourceWidth - 1)) * 22;
        let blue = 54 + ((x + y) / (sourceWidth + sourceHeight - 2)) * 150;
        // Thin diagonal-ish line families.
        if (x % 19 < 2 || (x + y * 3) % 31 < 2) {
          red = Math.min(255, red + 50);
          green = Math.min(255, green + 50);
          blue = Math.min(255, blue + 50);
        }
        // A high-frequency checkerboard area.
        if (x >= 96 && x < 896 && y >= 96 && y < 704) {
          const checker = ((Math.floor(x / 8) + Math.floor(y / 8)) & 1) === 0;
          red = checker ? 238 : 28;
          green = checker ? 238 : 34;
          blue = checker ? 226 : 48;
        }
        // Text-like block strokes, kept deterministic across browser fonts.
        if (x >= 1024 && x < 1800 && y >= 176 && y < 352) {
          const bar = ((x - 1024) % 116 < 22)
            || ((y - 176) % 58 < 16)
            || (x >= 1024 && x < 1800 && y >= 294 && y < 352 && (x % 83 < 17));
          if (bar) {
            red = 248;
            green = 212;
            blue = 102;
          }
        }
        // Broad dark/light regions exercise low-frequency resampling too.
        if (x >= 320 && x < 1720 && y >= 768 && y < 952 && (Math.floor(x / 64) & 1)) {
          red *= 0.55;
          green *= 0.55;
          blue *= 0.55;
        }
        sourceImage.data[offset] = Math.max(0, Math.min(255, Math.round(red)));
        sourceImage.data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
        sourceImage.data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
        sourceImage.data[offset + 3] = 255;
      }
    }
    sourceContext.putImageData(sourceImage, 0, 0);

    const renderCanvas = (staged) => {
      const started = performance.now();
      let current = source;
      if (staged) {
        for (const scale of [2, 2]) {
          const next = document.createElement('canvas');
          next.width = current.width / scale;
          next.height = current.height / scale;
          const context = next.getContext('2d', { willReadFrequently: true });
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          context.drawImage(current, 0, 0, next.width, next.height);
          current = next;
        }
      } else {
        const next = document.createElement('canvas');
        next.width = outputWidth;
        next.height = outputHeight;
        const context = next.getContext('2d', { willReadFrequently: true });
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(current, 0, 0, next.width, next.height);
        current = next;
      }
      const context = current.getContext('2d', { willReadFrequently: true });
      const pixels = context.getImageData(0, 0, outputWidth, outputHeight).data;
      return { pixels, elapsedMs: performance.now() - started };
    };

    // Exact 4x area averaging is a useful local reference for this integer
    // reduction case, but it is not a perceptual gold standard: real photo
    // resampling kernels, sharpening, gamma and chroma treatment can all
    // legitimately differ from a box average.
    const reference = new Float64Array(outputWidth * outputHeight * 4);
    for (let y = 0; y < outputHeight; y += 1) {
      for (let x = 0; x < outputWidth; x += 1) {
        const destinationOffset = (y * outputWidth + x) * 4;
        const sourceX = x * 4;
        const sourceY = y * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          let sum = 0;
          for (let yy = 0; yy < 4; yy += 1) {
            for (let xx = 0; xx < 4; xx += 1) {
              sum += sourceImage.data[((sourceY + yy) * sourceWidth + sourceX + xx) * 4 + channel];
            }
          }
          reference[destinationOffset + channel] = sum / 16;
        }
      }
    }

    const metrics = (actual) => {
      let absoluteError = 0;
      let squaredError = 0;
      let mismatch = 0;
      let maxAbs = 0;
      const samples = actual.length;
      for (let index = 0; index < samples; index += 1) {
        const difference = actual[index] - reference[index];
        const absolute = Math.abs(difference);
        absoluteError += absolute;
        squaredError += difference * difference;
        if (absolute > 0.5) mismatch += 1;
        if (absolute > maxAbs) maxAbs = absolute;
      }
      const mae = samples ? absoluteError / samples : 0;
      const mse = samples ? squaredError / samples : 0;
      return {
        mae,
        mse,
        psnr: mse === 0 ? null : 10 * Math.log10((255 * 255) / mse),
        psnrInfinite: mse === 0,
        mismatch,
        mismatchRatio: samples ? mismatch / samples : 0,
        maxAbs
      };
    };

    const single = renderCanvas(false);
    const staged = renderCanvas(true);
    let strategyAbsoluteError = 0;
    let strategySquaredError = 0;
    let strategyMismatch = 0;
    let strategyMaxAbs = 0;
    for (let index = 0; index < single.pixels.length; index += 1) {
      const difference = single.pixels[index] - staged.pixels[index];
      const absolute = Math.abs(difference);
      strategyAbsoluteError += absolute;
      strategySquaredError += difference * difference;
      if (absolute > 0.5) strategyMismatch += 1;
      if (absolute > strategyMaxAbs) strategyMaxAbs = absolute;
    }
    const strategySamples = single.pixels.length;
    const strategyMse = strategySamples ? strategySquaredError / strategySamples : 0;
    return {
      source: { width: sourceWidth, height: sourceHeight },
      output: { width: outputWidth, height: outputHeight, scale: 4 },
      reference: { type: '4x integer RGBA area average', limitation: 'not a perceptual or gamma-aware gold standard' },
      singlePass: { elapsedMs: single.elapsedMs, metrics: metrics(single.pixels) },
      stagedHalfReduction: { elapsedMs: staged.elapsedMs, metrics: metrics(staged.pixels) },
      stagedMinusSingle: {
        mae: strategySamples ? strategyAbsoluteError / strategySamples : 0,
        mse: strategyMse,
        psnr: strategyMse === 0 ? null : 10 * Math.log10((255 * 255) / strategyMse),
        psnrInfinite: strategyMse === 0,
        mismatch: strategyMismatch,
        mismatchRatio: strategySamples ? strategyMismatch / strategySamples : 0,
        maxAbs: strategyMaxAbs
      }
    };
  });
}

async function makeBaseJpeg(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 16;
    const context = canvas.getContext('2d');
    context.fillStyle = '#e94f64';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#2778d8';
    context.fillRect(16, 0, 16, 16);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 1));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
}

function jpegSegment(marker, payload) {
  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(0xff00 | marker, 0);
  segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([segment, payload]);
}

function makeExifPayload(orientation) {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  return Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
}

function addMetadataToJpeg(bytes, orientation) {
  const jpeg = Buffer.from(bytes);
  const icc = Buffer.concat([
    Buffer.from('ICC_PROFILE\0', 'ascii'),
    Buffer.from([1, 1]),
    Buffer.from('x-panorama-quality-fixture', 'ascii')
  ]);
  return Buffer.concat([
    jpeg.subarray(0, 2),
    jpegSegment(0xe1, makeExifPayload(orientation)),
    jpegSegment(0xe2, icc),
    jpeg.subarray(2)
  ]);
}

(async () => {
  const results = [];
  const failures = [];
  const measurements = {
    jpeg: [],
    resampling: null,
    workerMainPixelComparison: null,
    pngAlpha: null,
    jpegWhiteBackground: null,
    pngBoundary: null,
    exifIcc: []
  };
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

    await test('opaque deterministic fixture preserves PNG dimensions and split boundaries', async () => {
      const { context, page } = await openPage(browser);
      await createPatternFile(page, { kind: 'opaque' });
      const snapshot = await configureExport(page, { format: 'image/png', width: 640, height: 400 });
      assert.deepEqual(snapshot.output, { width: 640, height: 400, panelWidth: 160 });
      const result = await measureGeneratedAgainstReference(page, { format: 'image/png', quality: 92 });
      assert.equal(result.files.length, 4);
      result.files.forEach((item) => {
        assert.deepEqual({ width: item.width, height: item.height }, { width: 160, height: 400 });
        assert.ok(item.size > 0);
      });
      assert.equal(result.mae, 0, JSON.stringify(result));
      measurements.pngBoundary = result;
      await context.close();
    });

    await test('transparent PNG preserves alpha and JPEG composites transparent pixels over white', async () => {
      const { context, page } = await openPage(browser);
      await createPatternFile(page, { kind: 'transparent' });
      await configureExport(page, { format: 'image/png', width: 640, height: 400 });
      const png = await measureGeneratedAgainstReference(page, { format: 'image/png', quality: 92 });
      // Fully transparent and fully opaque pixels are the stable alpha
      // contract. Semi-transparent compositing is retained as an observation
      // in the JSON baseline because browser Canvas implementations may
      // premultiply it differently.
      assert.equal(png.fullyTransparentAlphaMismatches, 0, JSON.stringify(png));
      assert.equal(png.fullyOpaqueAlphaMismatches, 0, JSON.stringify(png));
      assert.ok(png.fullyTransparentReferencePixels > 0);
      assert.ok(png.opaqueReferencePixels > 0);

      await configureExport(page, { format: 'image/jpeg', quality: 95, width: 640, height: 400 });
      const jpeg = await measureGeneratedAgainstReference(page, { format: 'image/jpeg', quality: 95 });
      assert.equal(jpeg.outputOpaquePixels, jpeg.transparentReferencePixels + jpeg.opaqueReferencePixels);
      assert.equal(jpeg.whiteBackgroundInteriorSamples, jpeg.whiteBackgroundInteriorPixels, JSON.stringify(jpeg));
      measurements.pngAlpha = png;
      measurements.jpegWhiteBackground = jpeg;
      await context.close();
    });

    await test('JPEG quality 92, 95 and 100 produce measured size and quality baselines', async () => {
      const { context, page } = await openPage(browser);
      await createPatternFile(page, { kind: 'opaque' });
      for (const quality of [92, 95, 100]) {
        await configureExport(page, { format: 'image/jpeg', quality, width: 640, height: 400 });
        const result = await measureGeneratedAgainstReference(page, { format: 'image/jpeg', quality });
        assert.equal(result.files.length, 4);
        result.files.forEach((item) => {
          assert.deepEqual({ width: item.width, height: item.height }, { width: 160, height: 400 });
          assert.ok(item.size > 0);
          assert.ok(Number.isFinite(item.mae) && Number.isFinite(item.mse));
        });
        measurements.jpeg.push(result);
      }
      const [quality92, quality95, quality100] = measurements.jpeg;
      assert.ok(quality92.psnr >= 25, JSON.stringify(quality92));
      assert.ok(quality95.psnr >= quality92.psnr, JSON.stringify(measurements.jpeg));
      assert.ok(quality100.psnr >= quality95.psnr, JSON.stringify(measurements.jpeg));
      assert.ok(quality95.totalBytes >= quality92.totalBytes, JSON.stringify(measurements.jpeg));
      assert.ok(quality100.totalBytes >= quality95.totalBytes, JSON.stringify(measurements.jpeg));
      await context.close();
    });

    await test('single-pass and staged half-reduction downsampling meet the same reference floor without choosing a winner', async () => {
      const { context, page } = await openPage(browser);
      const result = await measureDownsamplingStrategies(page);
      assert.deepEqual(result.output, { width: 512, height: 256, scale: 4 });
      for (const strategy of [result.singlePass, result.stagedHalfReduction]) {
        assert.ok(Number.isFinite(strategy.metrics.mae));
        assert.ok(Number.isFinite(strategy.metrics.mse));
        assert.ok(Number.isFinite(strategy.metrics.maxAbs));
        assert.ok(strategy.metrics.mismatch >= 0);
        assert.ok(strategy.metrics.psnrInfinite || strategy.metrics.psnr >= 50, JSON.stringify(strategy));
      }
      assert.ok(Number.isFinite(result.stagedMinusSingle.mae));
      measurements.resampling = result;
      await context.close();
    });

    await test('Worker PNG output and forced UNSUPPORTED main-thread output have matching decoded pixels', async () => {
      const workerPage = await openPage(browser);
      const mainPage = await openPage(browser, { forceWorkerUnsupported: true });
      try {
        await createPatternFile(workerPage.page, { kind: 'opaque', name: 'worker-fixture.png' });
        await createPatternFile(mainPage.page, { kind: 'opaque', name: 'main-fixture.png' });
        await configureExport(workerPage.page, { format: 'image/png', width: 640, height: 400 });
        await configureExport(mainPage.page, { format: 'image/png', width: 640, height: 400 });
        const workerSnapshot = await workerPage.page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
        const mainSnapshot = await mainPage.page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
        assert.equal(workerSnapshot.exportError, '');
        assert.equal(mainSnapshot.exportError, '');
        const workerPixels = await captureGeneratedPixels(workerPage.page);
        const mainPixels = await captureGeneratedPixels(mainPage.page);
        assert.equal(workerPixels.length, mainPixels.length);
        const panels = workerPixels.map((workerItem, index) => {
          const mainItem = mainPixels[index];
          assert.deepEqual({ width: workerItem.width, height: workerItem.height }, { width: mainItem.width, height: mainItem.height });
          const comparison = comparePixelBuffers(
            Buffer.from(workerItem.pixels, 'base64'),
            Buffer.from(mainItem.pixels, 'base64')
          );
          assert.equal(comparison.mismatch, 0, JSON.stringify(comparison));
          return comparison;
        });
        measurements.workerMainPixelComparison = { panels };
      } finally {
        await workerPage.context.close();
        await mainPage.context.close();
      }
    });

    await test('EXIF orientation 6/8 and ICC marker are detected and oriented dimensions are reflected', async () => {
      const { context, page } = await openPage(browser);
      const baseJpeg = await makeBaseJpeg(page);
      for (const orientation of [6, 8]) {
        const bytes = Array.from(addMetadataToJpeg(baseJpeg, orientation));
        const info = await page.evaluate(async ({ bytes, orientation }) => {
          const file = new File([new Uint8Array(bytes)], `orientation-${orientation}.jpg`, { type: 'image/jpeg' });
          return window.__xPanoramaTest.inspectImageFile(file, { enforceInputPolicy: false });
        }, { bytes, orientation });
        assert.equal(info.orientation, orientation);
        assert.deepEqual({ rawWidth: info.rawWidth, rawHeight: info.rawHeight }, { rawWidth: 32, rawHeight: 16 });
        assert.deepEqual({ width: info.width, height: info.height }, { width: 16, height: 32 });
        assert.equal(info.metadata.exif, true);
        assert.equal(info.metadata.icc, true);
        await page.evaluate(async ({ bytes, orientation }) => {
          const file = new File([new Uint8Array(bytes)], `orientation-${orientation}.jpg`, { type: 'image/jpeg' });
          await window.__xPanoramaTest.loadSelection([file]);
        }, { bytes, orientation });
        await page.waitForFunction((orientation) => {
          const snapshot = window.__xPanoramaTest.stateSnapshot();
          return snapshot.single && snapshot.single.orientation === orientation && !snapshot.loadPending;
        }, orientation);
        const snapshot = await page.evaluate(() => window.__xPanoramaTest.stateSnapshot());
        assert.deepEqual({ rawWidth: snapshot.single.rawWidth, rawHeight: snapshot.single.rawHeight }, { rawWidth: 32, rawHeight: 16 });
        assert.deepEqual({ width: snapshot.single.width, height: snapshot.single.height }, { width: 16, height: 32 });
        assert.equal(snapshot.single.metadata.icc, true);
        measurements.exifIcc.push({ orientation, info, state: snapshot.single });
      }
      await context.close();
    });
  } finally {
    if (browser) await browser.close();
    await closeServer();
  }

  console.log(JSON.stringify({
    passed: results.length - failures.length,
    failed: failures.length,
    results,
    measurements
  }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
