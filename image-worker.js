'use strict';

importScripts('core.js?v=0.5.0-rc.8');
const Core = self.XPanoramaCore;
if (!Core) throw new Error('X Panorama core could not be loaded.');

const DEFAULT_EXPORT_LIMITS = Object.freeze({ maxEdge: 16_384, maxPixels: 48_000_000 });

function workerError(message, code = 'PROCESSING_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertCanvasBudget(width, height, label, limits = DEFAULT_EXPORT_LIMITS) {
  const maxEdge = Number.isFinite(limits && limits.maxEdge) ? limits.maxEdge : DEFAULT_EXPORT_LIMITS.maxEdge;
  const maxPixels = Number.isFinite(limits && limits.maxPixels) ? limits.maxPixels : DEFAULT_EXPORT_LIMITS.maxPixels;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw workerError(`${label}の寸法が不正です。`, 'RESOURCE_LIMIT');
  }
  if (width > maxEdge || height > maxEdge || width * height > maxPixels) {
    throw workerError(`${label}（${Math.round(width)} × ${Math.round(height)}）が安全上限を超えています。`, 'RESOURCE_LIMIT');
  }
}

async function decode(file) {
  if (typeof createImageBitmap !== 'function') throw workerError('ワーカー内の画像読み込みに対応していません。', 'UNSUPPORTED');
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image', colorSpaceConversion: 'default' });
  } catch (_) {
    try {
      return await createImageBitmap(file);
    } catch (error) {
      throw workerError(error && error.message ? error.message : '画像を読み込めませんでした。', 'DECODE_FAILED');
    }
  }
}

function ensureCanvasSupport() {
  if (typeof OffscreenCanvas === 'undefined') throw workerError('このブラウザのバックグラウンド画像処理には対応していません。', 'UNSUPPORTED');
}

function prepareContext(canvas, data) {
  return Core.prepareRenderContext(canvas, data.format, data.render || {});
}

async function splitImage(data) {
  ensureCanvasSupport();
  assertCanvasBudget(data.output.panelWidth, data.output.height, '分割画像', data.limits);
  const bitmap = await decode(data.file);
  let canvas = null;
  try {
    canvas = new OffscreenCanvas(data.output.panelWidth, data.output.height);
    const context = prepareContext(canvas, data);
    if (!context) throw new Error('画像キャンバスを作成できませんでした。');
    for (let index = 0; index < 4; index += 1) {
      if (index > 0) Core.resetRenderContext(canvas, context, data.format, data.render || {});
      const sx = data.crop.x + data.crop.w * index / 4;
      context.drawImage(bitmap, sx, data.crop.y, data.crop.w / 4, data.crop.h, 0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: data.format, quality: data.quality });
      if (!(blob instanceof Blob) || blob.type !== data.format) throw workerError(`panel ${index}のエンコード形式が一致しません。`, 'ENCODE_FAILED');
      self.postMessage({ type: 'panel', index, blob });
      self.postMessage({ type: 'progress', current: index + 1, total: 4, showPercent: false, text: `${index + 1} / 4を書き出しました` });
    }
    self.postMessage({ type: 'done' });
  } finally {
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

async function stitchImages(data) {
  ensureCanvasSupport();
  assertCanvasBudget(data.output.width, data.output.height, '結合画像', data.limits);
  const canvas = new OffscreenCanvas(data.output.width, data.output.height);
  try {
    const context = prepareContext(canvas, data);
    if (!context) throw new Error('結合用キャンバスを作成できませんでした。');
    let x = 0;
    for (let index = 0; index < data.files.length; index += 1) {
      const bitmap = await decode(data.files[index]);
      try {
        const width = data.output.widths[index];
        context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, x, 0, width, data.output.height);
        x += width;
      } finally {
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      }
      self.postMessage({ type: 'progress', text: `${index + 1} / 4を結合しました` });
    }
    self.postMessage({ type: 'progress', text: '結合画像をエンコードしています' });
    const blob = await canvas.convertToBlob({ type: data.format, quality: data.quality });
    if (!(blob instanceof Blob) || blob.type !== data.format) throw workerError('結合画像のエンコード形式が一致しません。', 'ENCODE_FAILED');
    self.postMessage({ type: 'joined', blob });
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

self.onmessage = async (event) => {
  try {
    const data = event.data || {};
    if (data.type === 'split') await splitImage(data);
    else if (data.type === 'stitch') await stitchImages(data);
    else throw workerError('不明な処理です。', 'WORKER_PROTOCOL');
  } catch (error) {
    self.postMessage({
      type: 'error',
      code: error && error.code ? error.code : 'PROCESSING_ERROR',
      message: error && error.message ? error.message : '画像処理に失敗しました。'
    });
  }
};

self.onmessageerror = () => {
  self.postMessage({ type: 'error', code: 'WORKER_PROTOCOL', message: 'ワーカーへの入力を読み取れませんでした。' });
};
