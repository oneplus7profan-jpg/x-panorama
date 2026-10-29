'use strict';

(function attachDiagnostics(global) {
  const Core = global.XPanoramaCore;
  if (!Core) throw new Error('X Panorama core could not be loaded.');

  function lineStats(data, width, height, edge, offset) {
    const values = [];
    const step = Math.max(1, Math.floor((edge === 'left' || edge === 'right' ? height : width) / 420));
    if (edge === 'left' || edge === 'right') {
      const x = edge === 'left' ? offset : width - 1 - offset;
      for (let y = 0; y < height; y += step) {
        const index = (y * width + x) * 4;
        values.push(data[index], data[index + 1], data[index + 2], data[index + 3]);
      }
    } else {
      const y = edge === 'top' ? offset : height - 1 - offset;
      for (let x = 0; x < width; x += step) {
        const index = (y * width + x) * 4;
        values.push(data[index], data[index + 1], data[index + 2], data[index + 3]);
      }
    }
    const count = values.length / 4;
    const mean = [0, 0, 0, 0];
    for (let index = 0; index < values.length; index += 4) {
      mean[0] += values[index];
      mean[1] += values[index + 1];
      mean[2] += values[index + 2];
      mean[3] += values[index + 3];
    }
    mean.forEach((_, index) => { mean[index] /= Math.max(1, count); });
    let variance = 0;
    let blackCount = 0;
    let whiteCount = 0;
    let transparentCount = 0;
    for (let index = 0; index < values.length; index += 4) {
      const r = values[index];
      const g = values[index + 1];
      const b = values[index + 2];
      const a = values[index + 3];
      variance += (r - mean[0]) ** 2 + (g - mean[1]) ** 2 + (b - mean[2]) ** 2 + 0.25 * (a - mean[3]) ** 2;
      if (a < 12) transparentCount += 1;
      else if (Math.max(r, g, b) < 16) blackCount += 1;
      else if (Math.min(r, g, b) > 240) whiteCount += 1;
    }
    return {
      mean,
      std: Math.sqrt(variance / Math.max(1, count * 3.25)),
      blackRatio: blackCount / Math.max(1, count),
      whiteRatio: whiteCount / Math.max(1, count),
      transparentRatio: transparentCount / Math.max(1, count)
    };
  }

  function colorDistance(a, b) {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 + 0.15 * (a[3] - b[3]) ** 2);
  }

  function verticalLineStats(data, width, height, x) {
    const resolvedX = Core.clamp(Math.round(x), 0, width - 1);
    const values = [];
    const step = Math.max(1, Math.floor(height / 420));
    for (let y = 0; y < height; y += step) {
      const index = (y * width + resolvedX) * 4;
      values.push(data[index], data[index + 1], data[index + 2], data[index + 3]);
    }
    const count = values.length / 4;
    const mean = [0, 0, 0, 0];
    for (let index = 0; index < values.length; index += 4) {
      mean[0] += values[index];
      mean[1] += values[index + 1];
      mean[2] += values[index + 2];
      mean[3] += values[index + 3];
    }
    mean.forEach((_, index) => { mean[index] /= Math.max(1, count); });
    let variance = 0;
    let blackCount = 0;
    let whiteCount = 0;
    let transparentCount = 0;
    for (let index = 0; index < values.length; index += 4) {
      const r = values[index];
      const g = values[index + 1];
      const b = values[index + 2];
      const a = values[index + 3];
      variance += (r - mean[0]) ** 2 + (g - mean[1]) ** 2 + (b - mean[2]) ** 2 + 0.25 * (a - mean[3]) ** 2;
      if (a < 12) transparentCount += 1;
      else if (Math.max(r, g, b) < 16) blackCount += 1;
      else if (Math.min(r, g, b) > 240) whiteCount += 1;
    }
    return {
      mean,
      std: Math.sqrt(variance / Math.max(1, count * 3.25)),
      blackRatio: blackCount / Math.max(1, count),
      whiteRatio: whiteCount / Math.max(1, count),
      transparentRatio: transparentCount / Math.max(1, count)
    };
  }

  function uniformKind(stats) {
    if (stats.transparentRatio > 0.97) return '透明';
    if (stats.blackRatio > 0.96) return '黒';
    if (stats.whiteRatio > 0.96) return '白';
    return '単色';
  }

  function scanInternalBand(imageData, width, height, startX, direction, maxScan) {
    const baseline = verticalLineStats(imageData, width, height, startX);
    const kind = uniformKind(baseline);
    const generic = kind === '単色';
    const baselineLimit = generic ? 2.6 : 9.0;
    const lineLimit = generic ? 3.4 : 10.0;
    const colorLimit = generic ? 5.2 : 18.0;
    if (baseline.std > baselineLimit) return null;
    let count = 0;
    for (let offset = 0; offset < maxScan; offset += 1) {
      const stats = verticalLineStats(imageData, width, height, startX + direction * offset);
      let matchesKind = true;
      if (kind === '黒') matchesKind = stats.blackRatio > 0.91;
      else if (kind === '白') matchesKind = stats.whiteRatio > 0.91;
      else if (kind === '透明') matchesKind = stats.transparentRatio > 0.91;
      if (matchesKind && stats.std <= lineLimit && colorDistance(stats.mean, baseline.mean) <= colorLimit) count += 1;
      else break;
    }
    if (count < Math.max(2, Math.ceil(maxScan * 0.01)) || count >= maxScan) return null;
    const nextStats = verticalLineStats(imageData, width, height, startX + direction * count);
    let ratioDrop = false;
    if (kind === '黒') ratioDrop = nextStats.blackRatio < 0.78;
    else if (kind === '白') ratioDrop = nextStats.whiteRatio < 0.78;
    else if (kind === '透明') ratioDrop = nextStats.transparentRatio < 0.78;
    const abruptTransition = ratioDrop || nextStats.std > lineLimit * 1.65 || colorDistance(nextStats.mean, baseline.mean) > (generic ? 13 : 20);
    return abruptTransition ? { count, kind, mean: baseline.mean } : null;
  }

  function readAnalysisPixels(source) {
    if (source && source.data && Number.isFinite(source.width) && Number.isFinite(source.height)) {
      return { data: source.data, width: source.width, height: source.height };
    }
    if (!source || typeof source.getContext !== 'function') {
      throw new TypeError('Diagnostics require an ImageData or canvas source.');
    }
    const context = source.getContext('2d', { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, source.width, source.height);
    return { data: imageData.data, width: source.width, height: source.height };
  }

  function detectInternalUniformBands(source, panelWidths) {
    if (!Array.isArray(panelWidths) || panelWidths.length !== 4) return [];
    const { data, width, height } = readAnalysisPixels(source);
    const bands = [];
    let boundary = 0;
    for (let index = 0; index < panelWidths.length - 1; index += 1) {
      boundary += panelWidths[index];
      const leftMax = Math.max(2, Math.floor(panelWidths[index] * 0.25));
      const rightMax = Math.max(2, Math.floor(panelWidths[index + 1] * 0.25));
      const left = scanInternalBand(data, width, height, boundary - 1, -1, leftMax);
      const right = scanInternalBand(data, width, height, boundary, 1, rightMax);
      if (left) bands.push({ ...left, boundary: index, side: 'left' });
      if (right) bands.push({ ...right, boundary: index, side: 'right' });
    }
    return bands;
  }

  function detectUniformBands(source) {
    const { data, width, height } = readAnalysisPixels(source);
    const edges = ['left', 'right', 'top', 'bottom'];
    const bands = [];
    for (const edge of edges) {
      const dimension = edge === 'left' || edge === 'right' ? width : height;
      const maxScan = Math.max(2, Math.floor(dimension * 0.25));
      const baseline = lineStats(data, width, height, edge, 0);
      const kind = uniformKind(baseline);
      const generic = kind === '単色';
      const baselineLimit = generic ? 2.6 : 9.0;
      const lineLimit = generic ? 3.4 : 10.0;
      const colorLimit = generic ? 5.2 : 18.0;
      if (baseline.std > baselineLimit) continue;
      let count = 0;
      for (let offset = 0; offset < maxScan; offset += 1) {
        const stats = lineStats(data, width, height, edge, offset);
        let matchesKind = true;
        if (kind === '黒') matchesKind = stats.blackRatio > 0.91;
        else if (kind === '白') matchesKind = stats.whiteRatio > 0.91;
        else if (kind === '透明') matchesKind = stats.transparentRatio > 0.91;
        if (matchesKind && stats.std <= lineLimit && colorDistance(stats.mean, baseline.mean) <= colorLimit) count += 1;
        else break;
      }
      if (count < Math.max(2, Math.ceil(dimension * 0.0025))) continue;
      const nextOffset = Math.min(count, dimension - 1);
      const nextStats = lineStats(data, width, height, edge, nextOffset);
      let ratioDrop = false;
      if (kind === '黒') ratioDrop = nextStats.blackRatio < 0.78;
      else if (kind === '白') ratioDrop = nextStats.whiteRatio < 0.78;
      else if (kind === '透明') ratioDrop = nextStats.transparentRatio < 0.78;
      const abruptTransition = ratioDrop || nextStats.std > lineLimit * 1.65 || colorDistance(nextStats.mean, baseline.mean) > (generic ? 13 : 20);
      if (abruptTransition) bands.push({ edge, count, kind, mean: baseline.mean });
    }
    return bands;
  }

  function seamDetailScores(source, panelWidths) {
    const { data, width, height } = readAnalysisPixels(source);
    const scores = [];
    const boundaries = [];
    let cumulative = 0;
    for (let index = 0; index < panelWidths.length - 1; index += 1) {
      cumulative += panelWidths[index];
      boundaries.push(cumulative);
    }
    for (const boundary of boundaries) {
      const x = Core.clamp(Math.round(boundary), 2, width - 3);
      const gradients = [];
      const step = Math.max(1, Math.floor(height / 480));
      for (let y = 1; y < height - 1; y += step) {
        const left = (y * width + x - 2) * 4;
        const right = (y * width + x + 2) * 4;
        const diff = (Math.abs(data[left] - data[right]) + Math.abs(data[left + 1] - data[right + 1]) + Math.abs(data[left + 2] - data[right + 2])) / (255 * 3);
        gradients.push(diff);
      }
      gradients.sort((a, b) => a - b);
      scores.push({
        p90: gradients[Math.floor(gradients.length * 0.9)] || 0,
        average: gradients.reduce((sum, value) => sum + value, 0) / Math.max(1, gradients.length)
      });
    }
    return scores;
  }

  global.XPanoramaDiagnostics = Object.freeze({
    detectUniformBands,
    detectInternalUniformBands,
    seamDetailScores
  });
}(self));
