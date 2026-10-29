'use strict';

const encoder = new TextEncoder();
const ZIP_BLOB_CHUNK_SIZE = 1_048_576;
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}

function zipError(message, code = 'ZIP_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function reportProgress(percent, text) {
  const resolved = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
  self.postMessage({ type: 'progress', percent: resolved, showPercent: resolved !== null, text });
}

function updateCrc32(crc, bytes) {
  let value = crc;
  for (let index = 0; index < bytes.length; index += 1) {
    value = crcTable[(value ^ bytes[index]) & 0xff] ^ (value >>> 8);
  }
  return value;
}

async function crc32Blob(blob, onProgress) {
  let crc = 0xffffffff;
  let processed = 0;
  if (blob && typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        crc = updateCrc32(crc, bytes);
        processed += bytes.byteLength;
        if (onProgress) onProgress(blob.size ? processed / blob.size : 1);
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    for (let offset = 0; offset < blob.size; offset += ZIP_BLOB_CHUNK_SIZE) {
      const chunkBlob = blob.slice(offset, Math.min(blob.size, offset + ZIP_BLOB_CHUNK_SIZE));
      const chunk = new Uint8Array(await chunkBlob.arrayBuffer());
      crc = updateCrc32(crc, chunk);
      processed += chunk.byteLength;
      if (onProgress) onProgress(blob.size ? processed / blob.size : 1);
    }
  }
  if (onProgress) onProgress(1);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(value) {
  const d = new Date(value || Date.now());
  const year = Math.max(1980, d.getFullYear());
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const date = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

function localHeader(nameBytes, crc, size, stamp) {
  const out = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  out.set(nameBytes, 30);
  return out;
}

function centralHeader(nameBytes, crc, size, offset, stamp) {
  const out = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, stamp.time, true);
  view.setUint16(14, stamp.date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  out.set(nameBytes, 46);
  return out;
}

function endRecord(count, centralSize, centralOffset) {
  const out = new Uint8Array(22);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return out;
}

async function createZip(data) {
  const files = Array.isArray(data.files) ? data.files : [];
  if (!files.length) throw zipError('ZIPに入れるファイルがありません。', 'INVALID_INPUT');
  if (files.length > 65535) throw zipError('ZIPのファイル数が上限を超えています。', 'ZIP32_LIMIT');

  const parts = [];
  const centralParts = [];
  const stamp = dosDateTime(data.timestamp);
  let offset = 0;
  let centralSize = 0;
  reportProgress(2, 'ZIP作成を開始しています');

  for (let index = 0; index < files.length; index += 1) {
    const item = files[index] || {};
    const blob = item.blob instanceof Blob ? item.blob : new Blob([item.blob || new Uint8Array()]);
    if (blob.size > 0xffffffff) throw zipError('4GBを超えるファイルはZIPにできません。', 'ZIP32_LIMIT');
    const nameBytes = encoder.encode(item.name || `file-${index + 1}`);
    if (nameBytes.length > 65535) throw zipError('ZIP内のファイル名が長すぎます。', 'ZIP32_LIMIT');
    const crc = await crc32Blob(blob, (fraction) => {
      const percent = 5 + ((index + fraction) / files.length) * 85;
      reportProgress(percent, `${index + 1}/${files.length}をZIPへ追加しています`);
    });
    const local = localHeader(nameBytes, crc, blob.size, stamp);
    const central = centralHeader(nameBytes, crc, blob.size, offset, stamp);
    if (offset + local.byteLength + blob.size > 0xffffffff) throw zipError('ZIP全体がZIP32の上限を超えています。', 'ZIP32_LIMIT');
    parts.push(local, blob);
    centralParts.push(central);
    offset += local.byteLength + blob.size;
    centralSize += central.byteLength;
  }

  if (offset + centralSize + 22 > 0xffffffff) throw zipError('ZIP全体がZIP32の上限を超えています。', 'ZIP32_LIMIT');
  reportProgress(94, 'ZIPを仕上げています');
  parts.push(...centralParts, endRecord(files.length, centralSize, offset));
  const blob = new Blob(parts, { type: 'application/zip' });
  reportProgress(100, 'ZIPを作成しました');
  self.postMessage({ type: 'done', blob });
}

self.onmessage = async (event) => {
  try {
    const data = event.data || {};
    if (data.type !== 'create') throw zipError('不明なZIP処理です。', 'INVALID_INPUT');
    await createZip(data);
  } catch (error) {
    self.postMessage({
      type: 'error',
      code: error && error.code ? error.code : 'ZIP_ERROR',
      message: error && error.message ? error.message : 'ZIPの作成に失敗しました。'
    });
  }
};

self.onmessageerror = () => {
  self.postMessage({ type: 'error', code: 'INVALID_INPUT', message: 'ZIPワーカーへの入力を読み取れませんでした。' });
};
