(function (global) {
  'use strict';

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function coreError(message, code = 'PROCESSING_ERROR') {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function createLimits(constrainedDevice) {
    return Object.freeze({
      customMinEdge: 400,
      customMaxEdge: 16_000,
      inputHeaderBytes: 1_048_576,
      inputMaxEdge: 16_384,
      inputMaxPixels: constrainedDevice ? 40_000_000 : 50_000_000,
      inputEstimatedPeakBytes: (constrainedDevice ? 224 : 320) * 1024 * 1024,
      // An 8K export necessarily holds a full 33.2MP decode plus an output
      // panel and encoded blobs. Keep loading conservative, but give the
      // explicitly requested export operation enough room for that peak.
      exportEstimatedPeakBytes: (constrainedDevice ? 384 : 512) * 1024 * 1024,
      retainedPreviewMaxEdge: 2_560,
      retainedPreviewMaxPixels: 4_000_000,
      selectionPreviewThumbMaxEdge: 640,
      selectionPreviewThumbMaxPixels: 400_000,
      previewCanvasMaxEdge: 4_096,
      previewCanvasMaxPixels: 8_000_000,
      exportPanelMaxEdge: constrainedDevice ? 12_288 : 16_384,
      exportPanelMaxPixels: constrainedDevice ? 24_000_000 : 48_000_000,
      exportJoinedMaxEdge: 16_384,
      exportJoinedMaxPixels: constrainedDevice ? 40_000_000 : 80_000_000
    });
  }

  function fitDimensionsWithinBudget(width, height, maxEdge, maxPixels) {
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    const edgeScale = Math.min(1, maxEdge / Math.max(safeWidth, safeHeight));
    const pixelScale = Math.min(1, Math.sqrt(maxPixels / (safeWidth * safeHeight)));
    const scale = Math.min(edgeScale, pixelScale);
    return {
      width: Math.max(1, Math.round(safeWidth * scale)),
      height: Math.max(1, Math.round(safeHeight * scale)),
      scale
    };
  }

  function allocateWidths(totalWidth, weights) {
    const target = Math.max(1, Math.round(totalWidth));
    const safeWeights = weights.map((value) => Math.max(0, Number(value) || 0));
    const totalWeight = safeWeights.reduce((sum, value) => sum + value, 0);
    if (!safeWeights.length) return [];
    if (totalWeight <= 0) return allocateWidths(target, safeWeights.map(() => 1));
    const base = target >= safeWeights.length ? 1 : 0;
    const distributable = Math.max(0, target - base * safeWeights.length);
    let cumulativeWeight = 0;
    let previousBoundary = 0;
    return safeWeights.map((weight, index) => {
      cumulativeWeight += weight;
      const boundary = index === safeWeights.length - 1
        ? distributable
        : Math.round(distributable * cumulativeWeight / totalWeight);
      const width = base + Math.max(0, boundary - previousBoundary);
      previousBoundary = boundary;
      return width;
    });
  }

  function maxCropForAspect(width, height, aspect) {
    if (width / height >= aspect) {
      const cropHeight = height;
      const cropWidth = cropHeight * aspect;
      return { x: (width - cropWidth) / 2, y: 0, w: cropWidth, h: cropHeight };
    }
    const cropWidth = width;
    const cropHeight = cropWidth / aspect;
    return { x: 0, y: (height - cropHeight) / 2, w: cropWidth, h: cropHeight };
  }

  function sanitizeBaseName(name) {
    const normalized = String(name || 'image').normalize('NFC');
    const withoutExtension = normalized.replace(/\.[^.]+$/, '');
    let safe = withoutExtension
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
      .trim()
      .replace(/[ .]+$/g, '');
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(safe)) safe = `_${safe}`;
    safe = Array.from(safe).slice(0, 120).join('').replace(/[ .]+$/g, '');
    return safe || 'image';
  }

  function extensionForType(type) {
    if (type === 'image/png') return 'png';
    if (type === 'image/webp') return 'webp';
    return 'jpg';
  }

  function normalizeImageMime(type) {
    const normalized = String(type || '').split(';', 1)[0].trim().toLowerCase();
    // Android content providers frequently report an unknown binary type. The
    // header signature is authoritative, so treat these values as unknown
    // instead of rejecting an otherwise valid JPEG/PNG/WebP.
    if (!normalized || normalized === 'application/octet-stream' || normalized === 'binary/octet-stream') return '';
    if (normalized === 'image/jpg' || normalized === 'image/pjpeg') return 'image/jpeg';
    return normalized;
  }

  function imageTypeForExtension(name) {
    const match = String(name || '').normalize('NFC').match(/\.([^.\s]+)$/);
    if (!match) return '';
    const extension = match[1].toLowerCase();
    if (extension === 'jpg' || extension === 'jpeg' || extension === 'jpe' || extension === 'jfif') return 'image/jpeg';
    if (extension === 'png') return 'image/png';
    if (extension === 'webp') return 'image/webp';
    return 'unsupported';
  }

  function asciiAt(bytes, start, length) {
    let value = '';
    const end = Math.min(bytes.length, start + length);
    for (let index = Math.max(0, start); index < end; index += 1) value += String.fromCharCode(bytes[index]);
    return value;
  }

  function parseTiffMetadata(bytes, tiffStart, availableLength) {
    const result = { orientation: 1, hasGps: false };
    const end = Math.min(bytes.length, tiffStart + availableLength);
    if (tiffStart < 0 || tiffStart + 8 > end) return result;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const byteOrder = asciiAt(bytes, tiffStart, 2);
    const littleEndian = byteOrder === 'II';
    if (!littleEndian && byteOrder !== 'MM') return result;
    const read16 = (offset) => (offset >= tiffStart && offset + 2 <= end ? view.getUint16(offset, littleEndian) : null);
    const read32 = (offset) => (offset >= tiffStart && offset + 4 <= end ? view.getUint32(offset, littleEndian) : null);
    if (read16(tiffStart + 2) !== 42) return result;
    const ifdOffset = read32(tiffStart + 4);
    if (!Number.isFinite(ifdOffset)) return result;
    const ifdStart = tiffStart + ifdOffset;
    const entryCount = read16(ifdStart);
    if (!Number.isFinite(entryCount) || entryCount > 4096) return result;
    for (let index = 0; index < entryCount; index += 1) {
      const entry = ifdStart + 2 + index * 12;
      if (entry + 12 > end) break;
      const tag = read16(entry);
      const type = read16(entry + 2);
      const count = read32(entry + 4);
      if (tag === 0x0112 && type === 3 && count === 1) {
        const orientation = read16(entry + 8);
        if (orientation >= 1 && orientation <= 8) result.orientation = orientation;
      }
      if (tag === 0x8825) result.hasGps = true;
    }
    return result;
  }

  function orientedDimensions(width, height, orientation) {
    return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
  }

  function inspectJpegHeader(bytes) {
    let offset = 2;
    let width = 0;
    let height = 0;
    let orientation = 1;
    const metadata = { exif: false, xmp: false, icc: false, gps: false };
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 3 < bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) break;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2) break;
      const payloadStart = offset + 2;
      const payloadLength = length - 2;
      const payloadEnd = payloadStart + payloadLength;
      if (payloadEnd > bytes.length) break;
      if (sofMarkers.has(marker) && payloadLength >= 6) {
        height = (bytes[payloadStart + 1] << 8) | bytes[payloadStart + 2];
        width = (bytes[payloadStart + 3] << 8) | bytes[payloadStart + 4];
      } else if (marker === 0xe1) {
        const signature = asciiAt(bytes, payloadStart, Math.min(payloadLength, 40));
        if (signature.startsWith('Exif\u0000\u0000')) {
          metadata.exif = true;
          const parsed = parseTiffMetadata(bytes, payloadStart + 6, payloadLength - 6);
          orientation = parsed.orientation;
          metadata.gps = parsed.hasGps;
        }
        if (signature.includes('http://ns.adobe.com/xap/1.0/')) metadata.xmp = true;
      } else if (marker === 0xe2 && asciiAt(bytes, payloadStart, 12).startsWith('ICC_PROFILE')) metadata.icc = true;
      offset = payloadEnd;
    }
    if (!width || !height) throw coreError('JPEGの寸法情報を読み取れません。ファイルが破損している可能性があります。', 'INVALID_IMAGE');
    const oriented = orientedDimensions(width, height, orientation);
    return { type: 'image/jpeg', extension: 'jpg', rawWidth: width, rawHeight: height, width: oriented.width, height: oriented.height, orientation, metadata };
  }

  function inspectPngHeader(bytes) {
    if (bytes.length < 24 || asciiAt(bytes, 12, 4) !== 'IHDR') throw coreError('PNGのヘッダーが不正です。ファイルが破損している可能性があります。', 'INVALID_IMAGE');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (!width || !height) throw coreError('PNGの寸法情報が不正です。', 'INVALID_IMAGE');
    let orientation = 1;
    const metadata = { exif: false, xmp: false, icc: false, gps: false };
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset, false);
      const type = asciiAt(bytes, offset + 4, 4);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > bytes.length) break;
      if (type === 'eXIf') {
        metadata.exif = true;
        const parsed = parseTiffMetadata(bytes, dataStart, length);
        orientation = parsed.orientation;
        metadata.gps = parsed.hasGps;
      } else if (type === 'iCCP') metadata.icc = true;
      else if ((type === 'iTXt' || type === 'tEXt' || type === 'zTXt') && asciiAt(bytes, dataStart, Math.min(length, 96)).includes('XML:com.adobe.xmp')) metadata.xmp = true;
      offset = dataEnd + 4;
      if (type === 'IEND') break;
    }
    const oriented = orientedDimensions(width, height, orientation);
    return { type: 'image/png', extension: 'png', rawWidth: width, rawHeight: height, width: oriented.width, height: oriented.height, orientation, metadata };
  }

  function inspectWebpHeader(bytes) {
    if (bytes.length < 30 || asciiAt(bytes, 8, 4) !== 'WEBP') throw coreError('WebPのヘッダーが不正です。ファイルが破損している可能性があります。', 'INVALID_IMAGE');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let width = 0;
    let height = 0;
    let orientation = 1;
    const metadata = { exif: false, xmp: false, icc: false, gps: false };
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = asciiAt(bytes, offset, 4);
      const length = view.getUint32(offset + 4, true);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataStart > bytes.length) break;
      if (type === 'VP8X' && length >= 10 && dataStart + 10 <= bytes.length) {
        width = 1 + bytes[dataStart + 4] + (bytes[dataStart + 5] << 8) + (bytes[dataStart + 6] << 16);
        height = 1 + bytes[dataStart + 7] + (bytes[dataStart + 8] << 8) + (bytes[dataStart + 9] << 16);
      } else if (type === 'VP8L' && length >= 5 && dataStart + 5 <= bytes.length && bytes[dataStart] === 0x2f) {
        width = 1 + bytes[dataStart + 1] + ((bytes[dataStart + 2] & 0x3f) << 8);
        height = 1 + (bytes[dataStart + 2] >> 6) + (bytes[dataStart + 3] << 2) + ((bytes[dataStart + 4] & 0x0f) << 10);
      } else if (type === 'VP8 ' && length >= 10 && dataStart + 10 <= bytes.length
        && bytes[dataStart + 3] === 0x9d && bytes[dataStart + 4] === 0x01 && bytes[dataStart + 5] === 0x2a) {
        width = view.getUint16(dataStart + 6, true) & 0x3fff;
        height = view.getUint16(dataStart + 8, true) & 0x3fff;
      } else if (type === 'EXIF' && dataEnd <= bytes.length) {
        metadata.exif = true;
        const tiffStart = asciiAt(bytes, dataStart, 6) === 'Exif\u0000\u0000' ? dataStart + 6 : dataStart;
        const parsed = parseTiffMetadata(bytes, tiffStart, Math.max(0, dataEnd - tiffStart));
        orientation = parsed.orientation;
        metadata.gps = parsed.hasGps;
      } else if (type === 'XMP ') metadata.xmp = true;
      else if (type === 'ICCP') metadata.icc = true;
      if (dataEnd > bytes.length) break;
      offset = dataEnd + (length % 2);
    }
    if (!width || !height) throw coreError('WebPの寸法情報を読み取れません。ファイルが破損している可能性があります。', 'INVALID_IMAGE');
    const oriented = orientedDimensions(width, height, orientation);
    return { type: 'image/webp', extension: 'webp', rawWidth: width, rawHeight: height, width: oriented.width, height: oriented.height, orientation, metadata };
  }

  function inspectImageHeader(bytes) {
    if (bytes.length >= 8 && bytes[0] === 0x89 && asciiAt(bytes, 1, 3) === 'PNG'
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return inspectPngHeader(bytes);
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpegHeader(bytes);
    if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return inspectWebpHeader(bytes);
    throw coreError('JPEG、PNG、WebPとして読み取れません。ファイルが破損しているか、未対応の形式です。', 'INVALID_IMAGE');
  }

  function renderSettingsFor(format, supplied = {}) {
    return {
      alpha: typeof supplied.alpha === 'boolean' ? supplied.alpha : format === 'image/png',
      background: typeof supplied.background === 'string' ? supplied.background : (format === 'image/jpeg' ? '#ffffff' : null),
      imageSmoothingEnabled: supplied.imageSmoothingEnabled !== false,
      imageSmoothingQuality: supplied.imageSmoothingQuality === 'low' || supplied.imageSmoothingQuality === 'medium'
        ? supplied.imageSmoothingQuality
        : 'high'
    };
  }

  function resetRenderContext(canvas, context, format, supplied = {}) {
    const settings = renderSettingsFor(format, supplied);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (settings.background) {
      context.fillStyle = settings.background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingEnabled = settings.imageSmoothingEnabled;
    context.imageSmoothingQuality = settings.imageSmoothingQuality;
    return context;
  }

  function prepareRenderContext(canvas, format, supplied = {}) {
    const settings = renderSettingsFor(format, supplied);
    const context = canvas.getContext('2d', { alpha: settings.alpha, colorSpace: 'srgb' });
    if (!context) return null;
    return resetRenderContext(canvas, context, format, supplied);
  }

  function detectPlatformProfile(navigatorLike) {
    const appleMobile = /iPad|iPhone|iPod/.test(navigatorLike.userAgent)
      || (navigatorLike.platform === 'MacIntel' && navigatorLike.maxTouchPoints > 1);
    const kind = appleMobile ? 'ios' : (/Android/i.test(navigatorLike.userAgent) ? 'android' : 'desktop');
    return Object.freeze({ kind, appleMobile, mobile: kind !== 'desktop' });
  }

  function resolveSaveStrategy(profile, capabilities) {
    if (profile.kind === 'ios') return { primary: 'share-to-photos', secondary: ['individual', 'zip'] };
    if (profile.kind === 'android') {
      return capabilities.directoryPicker
        ? { primary: 'batch-download', secondary: ['directory', 'individual', 'zip', 'share'] }
        : { primary: 'batch-download', secondary: ['individual', 'zip', 'share'] };
    }
    return { primary: 'zip', secondary: ['individual', 'joined'] };
  }

  global.XPanoramaCore = Object.freeze({
    clamp,
    coreError,
    createLimits,
    fitDimensionsWithinBudget,
    allocateWidths,
    maxCropForAspect,
    sanitizeBaseName,
    extensionForType,
    normalizeImageMime,
    imageTypeForExtension,
    inspectImageHeader,
    renderSettingsFor,
    resetRenderContext,
    prepareRenderContext,
    detectPlatformProfile,
    resolveSaveStrategy
  });
}(self));
