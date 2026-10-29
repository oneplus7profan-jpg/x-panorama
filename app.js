(function () {
  'use strict';

  const Core = window.XPanoramaCore;
  if (!Core) throw new Error('X Panorama core could not be loaded.');
  const Diagnostics = window.XPanoramaDiagnostics;
  if (!Diagnostics) throw new Error('X Panorama diagnostics could not be loaded.');
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clamp = Core.clamp;
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });
  const APP_VERSION = '0.5.0-rc.8';
  const DRAG_THRESHOLD_PX = 8;
  const ICON_PATHS = Object.freeze({
    plus: '<path d="M12 5v14M5 12h14"/>',
    loading: '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v6h-6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    left: '<path d="m14 6-6 6 6 6"/>',
    right: '<path d="m10 6 6 6-6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    warning: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4M12 17h.01"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m5 17 4-4 3 3 2-2 5 3"/>'
  });

  function iconMarkup(name, className = 'icon') {
    return `<svg class="${className}" viewBox="0 0 24 24" focusable="false" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.clock}</svg>`;
  }
  function detectCapabilities() {
    return {
      directoryPicker: window.isSecureContext === true && typeof window.showDirectoryPicker === 'function'
    };
  }

  function resolveSaveStrategy(profile = platformProfile, capabilities = detectCapabilities()) {
    return Core.resolveSaveStrategy(profile, capabilities);
  }

  const platformProfile = Core.detectPlatformProfile(navigator);
  const isAppleMobile = platformProfile.appleMobile;
  const savePlatform = platformProfile.kind;
  const reportedDeviceMemory = Number(navigator.deviceMemory) || null;
  const constrainedDevice = savePlatform !== 'desktop' || (reportedDeviceMemory !== null && reportedDeviceMemory <= 4);
  const LIMITS = Core.createLimits(constrainedDevice);
  // Preview limits are operation-wide in four-image mode. Keeping each proxy
  // at most 2MP makes the retained preview set no larger than 8MP in total.
  const FOUR_IMAGE_TOTAL_PREVIEW_PIXELS = 8_000_000;
  const FOUR_IMAGE_MAX_PREVIEW_PIXELS_PER_IMAGE = 2_000_000;
  const MEMORY_BYTES_PER_PIXEL = 4;
  const OPERATION_SAFETY_MARGIN = 1.2;
  const MIN_DEGRADED_PREVIEW_PIXELS = 512_000;

  const els = {
    fileInput: $('#fileInput'),
    dropZone: $('#dropZone'),
    selectionIntentActions: $('#selectionIntentActions'),
    chooseSingleImageButton: $('#chooseSingleImageButton'),
    chooseFourImagesButton: $('#chooseFourImagesButton'),
    chooseImagesButton: $('#chooseImagesButton'),
    changeSelectionModeButton: $('#changeSelectionModeButton'),
    selectionModeBadge: $('#selectionModeBadge'),
    selectionStateIcon: $('#selectionStateIcon'),
    selectionStateTitle: $('#selectionStateTitle'),
    selectionStateDetail: $('#selectionStateDetail'),
    selectionPreview: $('#selectionPreview'),
    selectionPreviewStatus: $('#selectionPreviewStatus'),
    selectionPreviewGrid: $('#selectionPreviewGrid'),
    loadError: $('#loadError'),
    installButton: $('#installButton'),
    updateNotice: $('#updateNotice'),
    applyUpdateButton: $('#applyUpdateButton'),
    mobileStepCount: $('#mobileStepCount'),
    mobileStepName: $('#mobileStepName'),
    mobileStepBar: $('#mobileStepBar'),
    mobileCompletedSteps: $('#mobileCompletedSteps'),
    mobileCompletedList: $('#mobileCompletedList'),
    backButton: $('#backButton'),
    nextButton: $('#nextButton'),
    bottomNav: $('.bottom-nav'),
    replaceImagesButton: $('#replaceImagesButton'),
    step2Description: $('#step2Description'),
    singleEditor: $('#singleEditor'),
    fourEditor: $('#fourEditor'),
    presetSelect: $('#presetSelect'),
    adjustmentDetails: $('#adjustmentDetails'),
    adjustmentSummary: $('#adjustmentSummary'),
    customSizeFields: $('#customSizeFields'),
    customWidth: $('#customWidth'),
    customHeight: $('#customHeight'),
    customSizeAlert: $('#customSizeAlert'),
    editorCanvas: $('#editorCanvas'),
    gestureHint: $('#gestureHint'),
    adjustmentStatus: $('#adjustmentStatus'),
    zoomRange: $('#zoomRange'),
    zoomValue: $('#zoomValue'),
    zoomOutButton: $('#zoomOutButton'),
    zoomInButton: $('#zoomInButton'),
    fitButton: $('#fitButton'),
    centerButton: $('#centerButton'),
    resetButton: $('#resetButton'),
    guideSeams: $('#guideSeams'),
    guideCenters: $('#guideCenters'),
    guideSafe: $('#guideSafe'),
    guideThirds: $('#guideThirds'),
    subjectGuide: $('#subjectGuide'),
    seamGuideStatus: $('#seamGuideStatus'),
    cropInfo: $('#cropInfo'),
    suggestOrderButton: $('#suggestOrderButton'),
    undoOrderButton: $('#undoOrderButton'),
    orderList: $('#orderList'),
    orderStatus: $('#orderStatus'),
    orderError: $('#orderError'),
    stitchCanvas: $('#stitchCanvas'),
    fourInfo: $('#fourInfo'),
    carouselPreview: $('#carouselPreview'),
    carouselPrevButton: $('#carouselPrevButton'),
    carouselNextButton: $('#carouselNextButton'),
    carouselStatus: $('#carouselStatus'),
    fullPreviewCanvas: $('#fullPreviewCanvas'),
    boundaryPreview: $('#boundaryPreview'),
    boundaryGapToggle: $('#boundaryGapToggle'),
    rerunDiagnosticsButton: $('#rerunDiagnosticsButton'),
    diagnosticsOverview: $('#diagnosticsOverview'),
    diagnosticsOverviewIcon: $('#diagnosticsOverviewIcon'),
    diagnosticsSummary: $('#diagnosticsSummary'),
    diagnosticsDetails: $('#diagnosticsDetails'),
    diagnosticsList: $('#diagnosticsList'),
    exportDescription: $('#exportDescription'),
    exportSettingsDetails: $('#exportSettingsDetails'),
    exportSettingsSummary: $('#exportSettingsSummary'),
    formatSelect: $('#formatSelect'),
    qualityField: $('#qualityField'),
    qualityRange: $('#qualityRange'),
    qualityValue: $('#qualityValue'),
    exportSummary: $('#exportSummary'),
    exportSafetyAlert: $('#exportSafetyAlert'),
    exportState: $('#exportState'),
    cancelExportButton: $('#cancelExportButton'),
    progressArea: $('#progressArea'),
    progressText: $('#progressText'),
    progressPercent: $('#progressPercent'),
    exportProgress: $('#exportProgress'),
    exportError: $('#exportError'),
    exportResults: $('#exportResults'),
    androidDownloadCard: $('#androidDownloadCard'),
    androidDownloadButton: $('#androidDownloadButton'),
    androidDownloadStatus: $('#androidDownloadStatus'),
    androidPermissionHelp: $('#androidPermissionHelp'),
    directorySaveCard: $('#directorySaveCard'),
    directorySaveDescription: $('#directorySaveDescription'),
    directorySaveButton: $('#directorySaveButton'),
    retryDirectorySaveButton: $('#retryDirectorySaveButton'),
    photoSaveCard: $('#photoSaveCard'),
    photoSaveTitle: $('#photoSaveTitle'),
    saveCardIcon: $('#saveCardIcon'),
    shareButton: $('#shareButton'),
    photoSaveSupportText: $('#photoSaveSupportText'),
    photoFallbackButton: $('#photoFallbackButton'),
    fileSaveDetails: $('#fileSaveDetails'),
    fileSaveSummary: $('#fileSaveSummary'),
    fileSaveTitle: $('#fileSaveTitle'),
    fileSaveDescription: $('#fileSaveDescription'),
    zipButton: $('#zipButton'),
    cancelZipButton: $('#cancelZipButton'),
    joinedDownloadButton: $('#joinedDownloadButton'),
    fileResultList: $('#fileResultList'),
    optionalShareDetails: $('#optionalShareDetails'),
    optionalShareButton: $('#optionalShareButton'),
    exportStatus: $('#exportStatus'),
    androidDownloadDialog: $('#androidDownloadDialog'),
    androidDownloadDialogTitle: $('#androidDownloadDialogTitle'),
    closeAndroidDownloadDialogButton: $('#closeAndroidDownloadDialogButton'),
    startAndroidDownloadsButton: $('#startAndroidDownloadsButton'),
    cancelAndroidDownloadsButton: $('#cancelAndroidDownloadsButton'),
    photoSaveDialog: $('#photoSaveDialog'),
    photoDialogLead: $('#photoDialogLead'),
    closePhotoDialogButton: $('#closePhotoDialogButton'),
    shareGuideView: $('#shareGuideView'),
    fallbackMethodsView: $('#fallbackMethodsView'),
    openShareSheetButton: $('#openShareSheetButton'),
    showFallbackMethodsButton: $('#showFallbackMethodsButton'),
    backToShareGuideButton: $('#backToShareGuideButton'),
    fallbackImageList: $('#fallbackImageList')
  };

  const state = {
    step: 1,
    maxReachedStep: 1,
    mode: null,
    single: null,
    four: [],
    crop: null,
    maxCrop: null,
    aspect: 3 / 2,
    preset: 'standard',
    guides: { seams: true, centers: false, safe: true, thirds: false, subject: 'none' },
    pointers: new Map(),
    gesture: null,
    editorRenderPending: false,
    previewDirty: true,
    previewRenderRevision: { carousel: -1, full: -1, boundaries: -1 },
    activePreviewTab: 'carousel',
    carouselIndex: 0,
    selectionPreviewRevision: -1,
    diagnosticsDirty: true,
    diagnosticsGeneration: 0,
    diagnosticsStatus: 'idle',
    diagnosticsHasCompleted: false,
    diagnosticsWarningCount: 0,
    diagnosticsErrorCount: 0,
    activeExport: null,
    exportGeneration: 0,
    activeZip: null,
    zipGeneration: 0,
    activeDirectorySave: null,
    directorySaveGeneration: 0,
    directorySaveSession: null,
    exportStale: false,
    gestureHintDismissed: false,
    loadGeneration: 0,
    loadPending: false,
    projectRevision: 0,
    generated: null,
    deferredInstallPrompt: null,
    draggedOrderIndex: null,
    orderSuggestion: null,
    orderBeforeSuggestion: null,
    pickerOriginStep: 1,
    selectionIntent: null,
    selectionIntentChooserOpen: false,
    dialogReturnFocus: null,
    serviceWorkerRegistration: null,
    waitingServiceWorker: null,
    hadServiceWorkerController: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
    updateRequested: false,
    updateReloading: false,
    updateDeferred: false,
    activeShare: false,
    customInputTimer: null,
    adjustmentAnnouncementTimer: null,
    lastAdjustmentAnnouncement: '',
    stepScrollPositions: { 1: 0, 2: 0, 3: 0, 4: 0 },
    navigationHistoryReady: false,
    actionDockResizeObserver: null,
    editSession: null,
    directoryPickerMode: 'default',
    androidDownloadAttempts: 0,
    qualityEditActive: false,
    wheelEndTimer: null,
    wheelViewport: null
  };

  function setAlert(element, message) {
    element.textContent = message || '';
    element.hidden = !message;
  }

  function humanBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
  }

  function appError(message, code = 'PROCESSING_ERROR') {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  const fitDimensionsWithinBudget = Core.fitDimensionsWithinBudget;
  const allocateWidths = Core.allocateWidths;

  function canvasLimits(kind = 'export-panel') {
    if (kind === 'preview') return { maxEdge: LIMITS.previewCanvasMaxEdge, maxPixels: LIMITS.previewCanvasMaxPixels };
    if (kind === 'export-joined') return { maxEdge: LIMITS.exportJoinedMaxEdge, maxPixels: LIMITS.exportJoinedMaxPixels };
    return { maxEdge: LIMITS.exportPanelMaxEdge, maxPixels: LIMITS.exportPanelMaxPixels };
  }

  function canvasBudgetIssue(width, height, kind = 'export-panel') {
    const { maxEdge, maxPixels } = canvasLimits(kind);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      return 'キャンバス寸法が不正です。';
    }
    if (width > maxEdge || height > maxEdge) {
      return `キャンバスの一辺が安全上限 ${maxEdge.toLocaleString()}px を超えます。`;
    }
    if (width * height > maxPixels) {
      return `キャンバスの総画素数が安全上限 ${maxPixels.toLocaleString()}px を超えます。`;
    }
    return '';
  }

  function assertCanvasBudget(width, height, label, kind = 'export-panel') {
    const issue = canvasBudgetIssue(width, height, kind);
    if (issue) throw appError(`${label}（${Math.round(width)} × ${Math.round(height)}）を作成できません。${issue}`, 'RESOURCE_LIMIT');
  }

  function rgbaBytes(width, height) {
    const safeWidth = Number(width);
    const safeHeight = Number(height);
    if (!Number.isFinite(safeWidth) || !Number.isFinite(safeHeight) || safeWidth < 1 || safeHeight < 1) return 0;
    return Math.ceil(safeWidth * safeHeight * MEMORY_BYTES_PER_PIXEL);
  }

  function fitPreviewDimensions(width, height, maxPixels) {
    const fitted = fitDimensionsWithinBudget(width, height, LIMITS.retainedPreviewMaxEdge, maxPixels);
    if (fitted.width * fitted.height <= maxPixels) return fitted;
    // Core fitting rounds to the nearest pixel. Correct the rare one-pixel
    // overshoot so aggregate preview budgets remain hard upper bounds.
    const correction = Math.sqrt(maxPixels / (fitted.width * fitted.height));
    return {
      width: Math.max(1, Math.floor(fitted.width * correction)),
      height: Math.max(1, Math.floor(fitted.height * correction)),
      scale: fitted.scale * correction
    };
  }

  function memoryImageShape(image) {
    if (!image) return null;
    const width = Number(image.width || image.rawWidth || image.drawableWidth);
    const height = Number(image.height || image.rawHeight || image.drawableHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
    const previewWidth = Number(image.previewWidth || image.drawableWidth || width);
    const previewHeight = Number(image.previewHeight || image.drawableHeight || height);
    return {
      rawBytes: rgbaBytes(width, height),
      previewBytes: rgbaBytes(previewWidth, previewHeight)
    };
  }

  function sumMemoryImages(images, { raw = false, preview = true } = {}) {
    const list = Array.isArray(images) ? images : (images ? [images] : []);
    return list.reduce((total, image) => {
      const shape = memoryImageShape(image);
      if (!shape) return total;
      const rawBytes = raw || image.includeRaw === true || image.rawDecoded === true ? shape.rawBytes : 0;
      const previewBytes = preview && image.includePreview !== false ? shape.previewBytes : 0;
      return total + rawBytes + previewBytes;
    }, 0);
  }

  function sumMemoryCanvases(canvases) {
    const list = Array.isArray(canvases) ? canvases : (canvases ? [canvases] : []);
    return list.reduce((total, canvas) => {
      if (!canvas) return total;
      const count = Math.max(1, Math.round(Number(canvas.count) || 1));
      return total + rgbaBytes(canvas.width, canvas.height) * count;
    }, 0);
  }

  function sumMemoryBlobs(blobs) {
    const list = Array.isArray(blobs) ? blobs : (blobs ? [blobs] : []);
    return list.reduce((total, blob) => {
      if (blob instanceof Blob) return total + Math.max(0, Number(blob.size) || 0);
      return total + Math.max(0, Number(blob && (blob.estimatedBytes || blob.size)) || 0);
    }, 0);
  }

  /**
   * Estimate the peak RGBA memory of one operation. Browser/GPU decode caches
   * are not observable, so this intentionally uses a coarse 4-bytes-per-pixel
   * model plus a 1.2x safety margin and the existing device-dependent budget.
   */
  function estimateOperationPeak({
    retainedImages = [],
    decodingImage = null,
    replacementImages = [],
    outputCanvases = [],
    stagingCanvases = [],
    generatedBlobs = [],
    otherBuffers = 0,
    safetyMargin = OPERATION_SAFETY_MARGIN,
    budgetBytes = LIMITS.inputEstimatedPeakBytes
  } = {}) {
    const breakdown = {
      retainedPreviewBytes: sumMemoryImages(retainedImages, { preview: true }),
      decodingBytes: sumMemoryImages(decodingImage, { raw: true, preview: true }),
      replacementBytes: sumMemoryImages(replacementImages, { raw: false, preview: true }),
      outputCanvasBytes: sumMemoryCanvases(outputCanvases),
      stagingCanvasBytes: sumMemoryCanvases(stagingCanvases),
      generatedBlobBytes: sumMemoryBlobs(generatedBlobs),
      otherBytes: Math.max(0, Number(otherBuffers) || 0)
    };
    const rawBytes = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    const margin = Number.isFinite(Number(safetyMargin)) && Number(safetyMargin) >= 1
      ? Number(safetyMargin)
      : OPERATION_SAFETY_MARGIN;
    const estimatedBytes = Math.ceil(rawBytes * margin);
    const resolvedBudgetBytes = Number.isFinite(Number(budgetBytes)) && Number(budgetBytes) > 0
      ? Number(budgetBytes)
      : LIMITS.inputEstimatedPeakBytes;
    return {
      rawBytes,
      estimatedBytes,
      bytes: estimatedBytes,
      budgetBytes: resolvedBudgetBytes,
      safetyMargin: margin,
      withinBudget: estimatedBytes <= resolvedBudgetBytes,
      breakdown
    };
  }

  function operationMemoryMessage(decision, action = 'この処理') {
    if (!decision || decision.withinBudget) return '';
    return `${action}の推定ピークメモリーは${humanBytes(decision.estimatedBytes)}で、安全上限${humanBytes(decision.budgetBytes)}を超えます。より小さい画像を使用する、一度に扱う画像数を減らす、または結合画像ではなく個別保存を使用してください。`;
  }

  function assertOperationMemory(decision, action = 'この処理') {
    const message = operationMemoryMessage(decision, action);
    if (message) throw appError(message, 'RESOURCE_LIMIT');
    return decision;
  }

  function previewMemoryShape(info, maxPixels) {
    const fitted = fitPreviewDimensions(info.width, info.height, maxPixels);
    return { ...info, drawableWidth: fitted.width, drawableHeight: fitted.height };
  }

  function currentRetainedAssets() {
    if (state.mode === 'single' && state.single) return [state.single];
    return state.mode === 'four' ? state.four.slice() : [];
  }

  function estimateImageLoadPeak(info, retainedImages, replacementImages, maxPixels) {
    return estimateOperationPeak({
      retainedImages,
      decodingImage: previewMemoryShape(info, maxPixels),
      replacementImages
    });
  }

  function chooseImagePreviewBudget(info, retainedImages, replacementImages, requestedPixels) {
    const candidates = [
      requestedPixels,
      Math.min(requestedPixels, 1_000_000),
      Math.min(requestedPixels, MIN_DEGRADED_PREVIEW_PIXELS)
    ].filter((value, index, values) => value > 0 && values.indexOf(value) === index);
    let lastDecision = null;
    for (const maxPixels of candidates) {
      const decision = estimateImageLoadPeak(info, retainedImages, replacementImages, maxPixels);
      lastDecision = decision;
      if (decision.withinBudget) return { maxPixels, decision };
    }
    return { maxPixels: candidates[candidates.length - 1] || requestedPixels, decision: lastDecision };
  }

  function normalizeCustomSize(commit = false) {
    const rawWidth = Number(els.customWidth.value);
    const rawHeight = Number(els.customHeight.value);
    const fallbackWidth = 6480;
    const fallbackHeight = 4320;
    let width = Number.isFinite(rawWidth) && rawWidth > 0 ? Math.round(rawWidth) : fallbackWidth;
    let height = Number.isFinite(rawHeight) && rawHeight > 0 ? Math.round(rawHeight) : fallbackHeight;
    width = clamp(width, LIMITS.customMinEdge, LIMITS.customMaxEdge);
    width = Math.max(4, Math.floor(width / 4) * 4);
    height = clamp(height, LIMITS.customMinEdge, LIMITS.customMaxEdge);
    if (commit) {
      els.customWidth.value = String(width);
      els.customHeight.value = String(height);
      [els.customWidth, els.customHeight].forEach((input) => {
        input.setCustomValidity('');
        input.removeAttribute('aria-invalid');
      });
    }
    return { width, height, panelWidth: width / 4, aspect: width / height };
  }

  function customDraftIsValid() {
    const width = Number(els.customWidth.value);
    const height = Number(els.customHeight.value);
    return Number.isFinite(width) && Number.isFinite(height)
      && width >= LIMITS.customMinEdge && width <= LIMITS.customMaxEdge
      && height >= LIMITS.customMinEdge && height <= LIMITS.customMaxEdge;
  }

  function updateCustomDraftValidity() {
    const valid = customDraftIsValid();
    const message = valid ? '' : `${LIMITS.customMinEdge}～${LIMITS.customMaxEdge}の数値を入力してください。`;
    [els.customWidth, els.customHeight].forEach((input) => {
      input.setCustomValidity(message);
      if (valid) input.removeAttribute('aria-invalid');
      else input.setAttribute('aria-invalid', 'true');
    });
    setAlert(els.customSizeAlert, message);
    if (!valid && els.adjustmentDetails) els.adjustmentDetails.open = true;
    return valid;
  }

  function activeGuideSummary() {
    const labels = [];
    if (state.guides.seams) labels.push('4分割線');
    if (state.guides.centers) labels.push('中心');
    if (state.guides.safe) labels.push('境界注意帯');
    if (state.guides.thirds) labels.push('三分割線');
    if (state.guides.subject !== 'none') labels.push(state.guides.subject === 'panel2' ? '主役2枚目' : '主役3枚目');
    return labels.length ? labels.join('・') : 'ガイドなし';
  }

  function updateAdjustmentSummary() {
    if (!els.adjustmentSummary || state.mode !== 'single') return;
    const output = getResolvedOutputSize();
    const ratio = `${Math.round(output.width / output.height * 100) / 100}:1`;
    els.adjustmentSummary.textContent = `${ratio}｜全体 ${output.width} × ${output.height}｜各 ${output.panelWidth} × ${output.height}｜${activeGuideSummary()}`;
  }

  function setExportState(message) {
    els.exportState.textContent = message;
  }

  function setElementIcon(element, name, className = 'icon') {
    if (element) element.innerHTML = iconMarkup(name, className);
  }

  function setDiagnosticsState(status, {
    summary = null,
    warningCount = state.diagnosticsWarningCount,
    errorCount = state.diagnosticsErrorCount
  } = {}) {
    const resolved = ['idle', 'running', 'passed', 'warning', 'failed'].includes(status) ? status : 'idle';
    state.diagnosticsStatus = resolved;
    state.diagnosticsWarningCount = warningCount;
    state.diagnosticsErrorCount = errorCount;
    els.diagnosticsOverview.dataset.status = resolved;
    setElementIcon(els.diagnosticsOverviewIcon, {
      idle: 'clock',
      running: 'loading',
      passed: 'check',
      warning: 'warning',
      failed: 'error'
    }[resolved]);
    if (typeof summary === 'string') els.diagnosticsSummary.textContent = summary;
    const running = resolved === 'running';
    $('.diagnostics-card').setAttribute('aria-busy', String(running));
    els.diagnosticsOverview.setAttribute('aria-busy', String(running));
    els.rerunDiagnosticsButton.disabled = running;
  }

  function markDiagnosticsDirty(message = '調整内容が変わりました。確認画面で再検査します。') {
    state.diagnosticsDirty = true;
    setDiagnosticsState('idle', { summary: message, warningCount: 0, errorCount: 0 });
  }

  function adjustmentAnnouncementText() {
    if (!state.single || !state.crop) return '';
    const centerX = Math.round(((state.crop.x + state.crop.w / 2) / Math.max(1, state.single.width)) * 100);
    const centerY = Math.round(((state.crop.y + state.crop.h / 2) / Math.max(1, state.single.height)) * 100);
    return `構図を調整しました。拡大率${Math.round(getZoomPercent())}%。使用範囲の中心は横${centerX}%、縦${centerY}%です。`;
  }

  function queueAdjustmentAnnouncement({ immediate = false } = {}) {
    if (!els.adjustmentStatus || state.step !== 2 || state.mode !== 'single') return;
    if (state.adjustmentAnnouncementTimer) clearTimeout(state.adjustmentAnnouncementTimer);
    const announce = () => {
      state.adjustmentAnnouncementTimer = null;
      const message = adjustmentAnnouncementText();
      if (!message) return;
      if (message === state.lastAdjustmentAnnouncement) {
        els.adjustmentStatus.textContent = '';
        requestAnimationFrame(() => { els.adjustmentStatus.textContent = message; });
      } else {
        els.adjustmentStatus.textContent = message;
      }
      state.lastAdjustmentAnnouncement = message;
    };
    state.adjustmentAnnouncementTimer = setTimeout(announce, immediate ? 0 : 450);
  }

  function clearAdjustmentAnnouncement() {
    if (state.adjustmentAnnouncementTimer) clearTimeout(state.adjustmentAnnouncementTimer);
    state.adjustmentAnnouncementTimer = null;
    state.lastAdjustmentAnnouncement = '';
    if (els.adjustmentStatus) els.adjustmentStatus.textContent = '';
  }

  function dismissGestureHint() {
    if (state.gestureHintDismissed) return;
    state.gestureHintDismissed = true;
    els.gestureHint.hidden = true;
  }

  function restoreGestureHint() {
    state.gestureHintDismissed = false;
    els.gestureHint.hidden = false;
  }

  function sanitizeBaseName(name) {
    return Core.sanitizeBaseName(name);
  }

  function extensionForType(type) {
    return Core.extensionForType(type);
  }

  function normalizeImageMime(type) {
    return Core.normalizeImageMime(type);
  }

  function imageTypeForExtension(name) {
    return Core.imageTypeForExtension(name);
  }

  function inspectImageHeader(bytes) {
    return Core.inspectImageHeader(bytes);
  }

  function preflightImagePolicy(info) {
    const pixels = info.width * info.height;
    const retained = fitDimensionsWithinBudget(info.width, info.height, LIMITS.retainedPreviewMaxEdge, LIMITS.retainedPreviewMaxPixels);
    const estimatedPeakBytes = Math.ceil(pixels * 4 * 1.35 + retained.width * retained.height * 4);
    if (info.width > LIMITS.inputMaxEdge || info.height > LIMITS.inputMaxEdge) {
      throw appError(`画像（${info.width.toLocaleString()} × ${info.height.toLocaleString()}）の一辺が入力の安全上限 ${LIMITS.inputMaxEdge.toLocaleString()}px を超えています。`, 'RESOURCE_LIMIT');
    }
    if (pixels > LIMITS.inputMaxPixels || estimatedPeakBytes > LIMITS.inputEstimatedPeakBytes) {
      throw appError(`画像（${info.width.toLocaleString()} × ${info.height.toLocaleString()}）は大きすぎます。推定ピークメモリー ${humanBytes(estimatedPeakBytes)} が安全上限を超えます。`, 'RESOURCE_LIMIT');
    }
    return { pixels, estimatedPeakBytes, retained };
  }

  async function inspectImageFile(file, { validateName = true, enforceInputPolicy = true } = {}) {
    if (!file || typeof file.slice !== 'function') throw appError('画像ファイルを読み取れません。', 'INVALID_IMAGE');
    const headerBlob = file.slice(0, Math.min(file.size, LIMITS.inputHeaderBytes));
    const bytes = new Uint8Array(await headerBlob.arrayBuffer());
    const info = inspectImageHeader(bytes);
    const declaredType = normalizeImageMime(file.type);
    if (declaredType && declaredType !== info.type) {
      throw appError(`ファイルのMIME形式（${declaredType}）と実データ（${info.type}）が一致しません。`, 'TYPE_MISMATCH');
    }
    if (validateName) {
      const extensionType = imageTypeForExtension(file.name);
      // The signature has already proved that the bytes are a supported image.
      // Known supported extensions must agree; unknown extensions are common
      // with Android providers and are normalized to the detected signature at
      // export time. A fake JPEG still fails in inspectImageHeader above.
      if (extensionType && extensionType !== 'unsupported' && extensionType !== info.type) {
        throw appError(`拡張子の形式（${extensionType}）と実データ（${info.type}）が一致しません。`, 'TYPE_MISMATCH');
      }
    }
    return enforceInputPolicy ? { ...info, ...preflightImagePolicy(info) } : info;
  }

  async function verifyEncodedBlob(blob, expectedType, expectedWidth, expectedHeight, label) {
    if (!(blob instanceof Blob)) throw appError(`${label}がBlobではありません。`, 'ENCODE_FAILED');
    const info = await inspectImageFile(blob, { validateName: false, enforceInputPolicy: false });
    if (info.type !== expectedType || normalizeImageMime(blob.type) !== expectedType) {
      throw appError(`${label}の実形式またはMIMEが${expectedType}と一致しません。`, 'ENCODE_FAILED');
    }
    if (info.width !== expectedWidth || info.height !== expectedHeight) {
      throw appError(`${label}の寸法が不正です（${info.width} × ${info.height}）。`, 'ENCODE_FAILED');
    }
    return info;
  }

  async function decodeFullDrawable(file, objectUrl = null) {
    if ('createImageBitmap' in window) {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', colorSpaceConversion: 'default' });
        return { drawable: bitmap, width: bitmap.width, height: bitmap.height, closable: true, ownedUrl: null };
      } catch (_) {
        try {
          const bitmap = await createImageBitmap(file);
          return { drawable: bitmap, width: bitmap.width, height: bitmap.height, closable: true, ownedUrl: null };
        } catch (_) {
          // Fall through to HTMLImageElement.
        }
      }
    }

    const image = new Image();
    image.decoding = 'async';
    const ownedUrl = objectUrl ? null : URL.createObjectURL(file);
    image.src = objectUrl || ownedUrl;
    try {
      if (image.decode) await image.decode();
      else await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('画像を読み込めませんでした。'));
      });
    } catch (error) {
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      throw error;
    }
    return { drawable: image, width: image.naturalWidth, height: image.naturalHeight, closable: false, ownedUrl };
  }

  function releaseDecoded(decoded) {
    if (!decoded) return;
    if (decoded.closable && decoded.drawable && typeof decoded.drawable.close === 'function') decoded.drawable.close();
    if (decoded.ownedUrl) URL.revokeObjectURL(decoded.ownedUrl);
  }

  async function decodePreviewAsset(file, objectUrl, info, { maxPixels = LIMITS.retainedPreviewMaxPixels } = {}) {
    const fitted = fitPreviewDimensions(info.width, info.height, maxPixels);
    if ('createImageBitmap' in window) {
      const options = { imageOrientation: 'from-image', colorSpaceConversion: 'default' };
      if (fitted.scale < 0.9999) {
        options.resizeWidth = fitted.width;
        options.resizeHeight = fitted.height;
        options.resizeQuality = 'high';
      }
      try {
        const bitmap = await createImageBitmap(file, options);
        if (fitted.scale < 0.9999 && (bitmap.width !== fitted.width || bitmap.height !== fitted.height)) {
          if (typeof bitmap.close === 'function') bitmap.close();
          throw appError('縮小デコードが適用されませんでした。', 'RESIZE_DECODE_UNAVAILABLE');
        }
        return {
          drawable: bitmap,
          width: info.width,
          height: info.height,
          drawableWidth: bitmap.width,
          drawableHeight: bitmap.height,
          closable: true
        };
      } catch (_) {
        // Fall back to the full decoder and a bounded canvas below.
      }
    }

    const full = await decodeFullDrawable(file, objectUrl);
    if (fitted.scale >= 0.9999) {
      return {
        drawable: full.drawable,
        width: info.width,
        height: info.height,
        drawableWidth: full.width,
        drawableHeight: full.height,
        closable: full.closable
      };
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = fitted.width;
      canvas.height = fitted.height;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw appError('プレビュー用キャンバスを作成できませんでした。', 'RESOURCE_LIMIT');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(full.drawable, 0, 0, full.width, full.height, 0, 0, fitted.width, fitted.height);

      let drawable = canvas;
      let closable = false;
      if ('createImageBitmap' in window) {
        try {
          drawable = await createImageBitmap(canvas);
          closable = true;
          canvas.width = 1;
          canvas.height = 1;
        } catch (_) {
          // The canvas itself is a valid bounded preview drawable.
        }
      }
      releaseDecoded(full);
      return {
        drawable,
        width: info.width,
        height: info.height,
        drawableWidth: fitted.width,
        drawableHeight: fitted.height,
        closable
      };
    } catch (error) {
      releaseDecoded(full);
      throw error;
    }
  }

  function drawAssetRegion(context, asset, sx, sy, sw, sh, dx, dy, dw, dh) {
    const scaleX = asset.drawableWidth / asset.width;
    const scaleY = asset.drawableHeight / asset.height;
    context.drawImage(asset.drawable, sx * scaleX, sy * scaleY, sw * scaleX, sh * scaleY, dx, dy, dw, dh);
  }

  function drawWholeAsset(context, asset, dx, dy, dw, dh) {
    context.drawImage(asset.drawable, 0, 0, asset.drawableWidth, asset.drawableHeight, dx, dy, dw, dh);
  }

  function drawAssetContain(context, asset, dx, dy, dw, dh) {
    const scale = Math.min(dw / asset.width, dh / asset.height);
    const width = Math.max(1, asset.width * scale);
    const height = Math.max(1, asset.height * scale);
    drawWholeAsset(context, asset, dx + (dw - width) / 2, dy + (dh - height) / 2, width, height);
  }

  function releaseCanvas(canvas, clearInlineSize = false) {
    if (!canvas) return;
    canvas.width = 1;
    canvas.height = 1;
    if (clearInlineSize) {
      canvas.style.removeProperty('width');
      canvas.style.removeProperty('height');
    }
  }

  function releaseCanvasesIn(root) {
    if (!root) return;
    root.querySelectorAll('canvas').forEach((canvas) => releaseCanvas(canvas));
  }

  function disposeAsset(asset) {
    if (!asset || asset.disposed) return;
    asset.disposed = true;
    if (asset.closable && asset.drawable && typeof asset.drawable.close === 'function') asset.drawable.close();
    else if (asset.drawable instanceof HTMLCanvasElement) releaseCanvas(asset.drawable);
    if (asset.url) URL.revokeObjectURL(asset.url);
  }

  function releaseGeneratedFileUrls(files) {
    for (const item of files || []) {
      if (item && item.url && !item.borrowedUrl) URL.revokeObjectURL(item.url);
    }
  }

  function currentSelectionAssets() {
    if (state.mode === 'single' && state.single) return [state.single];
    if (state.mode === 'four' && state.four.length === 4) return state.four;
    return [];
  }

  function renderSelectionZone({ announce } = {}) {
    const assets = currentSelectionAssets();
    const hasProject = assets.length === 1 || assets.length === 4;
    const replacing = state.loadPending && hasProject;
    const viewState = state.loadPending ? (replacing ? 'replacing' : 'loading') : (hasProject ? 'selected' : 'empty');
    const showIntentChoices = !hasProject || state.selectionIntentChooserOpen;

    els.dropZone.dataset.selectionState = viewState;
    els.dropZone.setAttribute('aria-busy', state.loadPending ? 'true' : 'false');
    els.selectionIntentActions.hidden = !showIntentChoices;
    els.chooseImagesButton.hidden = !hasProject || showIntentChoices;
    els.changeSelectionModeButton.hidden = !hasProject || showIntentChoices || state.loadPending;
    els.chooseSingleImageButton.disabled = state.loadPending;
    els.chooseFourImagesButton.disabled = state.loadPending;
    els.chooseImagesButton.disabled = state.loadPending;
    els.chooseSingleImageButton.classList.toggle('primary', !hasProject);
    els.chooseSingleImageButton.classList.toggle('secondary', hasProject);
    els.chooseImagesButton.textContent = state.loadPending
      ? '画像を読み込み中…'
      : (state.mode === 'four' ? '別の4枚を選ぶ' : '別の1枚を選ぶ');
    els.selectionModeBadge.hidden = !hasProject;
    els.selectionModeBadge.textContent = state.mode === 'four' ? '4枚を並べる' : '1枚から4分割';

    if (viewState === 'empty') {
      setElementIcon(els.selectionStateIcon, 'plus');
      els.selectionStateTitle.textContent = '作り方を選択';
      els.selectionStateDetail.textContent = 'JPEG / PNG / WebPに対応しています。';
    } else if (viewState === 'loading') {
      setElementIcon(els.selectionStateIcon, 'loading');
      els.selectionStateTitle.textContent = '画像を読み込み中';
      els.selectionStateDetail.textContent = '読み込みが終わるまで、この画面のままお待ちください。';
    } else {
      setElementIcon(els.selectionStateIcon, 'check');
      els.selectionStateTitle.textContent = `${assets.length}枚選択済み`;
      els.selectionStateDetail.textContent = replacing
        ? '現在の画像を維持したまま、別の画像を読み込んでいます…'
        : 'サムネイル、ファイル名、寸法を確認できます。';
    }

    els.selectionPreview.hidden = !(hasProject && state.step === 1);
    if (typeof announce === 'string') els.selectionPreviewStatus.textContent = announce;
  }

  function openImagePicker(intent = state.mode || 'single') {
    const normalizedIntent = intent === 'four' ? 'four' : 'single';
    state.pickerOriginStep = state.step;
    state.selectionIntent = normalizedIntent;
    els.fileInput.multiple = normalizedIntent === 'four';
    els.fileInput.value = '';
    els.fileInput.click();
  }

  function releaseSelectionPreview({ hide = true } = {}) {
    releaseCanvasesIn(els.selectionPreviewGrid);
    els.selectionPreviewGrid.innerHTML = '';
    els.selectionPreviewGrid.className = 'selection-preview-grid';
    state.selectionPreviewRevision = -1;
    els.selectionPreview.hidden = hide;
  }

  function renderSelectionPreview() {
    if (state.step !== 1 || !state.mode) {
      releaseSelectionPreview();
      return;
    }
    releaseSelectionPreview({ hide: false });
    const assets = currentSelectionAssets();
    els.selectionPreviewGrid.classList.add(state.mode === 'single' ? 'single' : 'four');

    assets.forEach((asset, index) => {
      const figure = document.createElement('figure');
      figure.className = 'selection-preview-item';
      const media = document.createElement('div');
      media.className = 'selection-preview-media';
      const canvas = document.createElement('canvas');
      const fitted = fitDimensionsWithinBudget(
        asset.width,
        asset.height,
        LIMITS.selectionPreviewThumbMaxEdge,
        LIMITS.selectionPreviewThumbMaxPixels
      );
      canvas.width = fitted.width;
      canvas.height = fitted.height;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${index + 1}枚目、${asset.name}、${asset.width} × ${asset.height}px`);
      const context = canvas.getContext('2d', { alpha: false });
      if (context) {
        context.fillStyle = '#05070a';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        drawAssetContain(context, asset, 0, 0, canvas.width, canvas.height);
      }
      media.append(canvas);

      const caption = document.createElement('figcaption');
      caption.className = 'selection-preview-caption';
      const name = document.createElement('strong');
      name.textContent = `${index + 1}. ${asset.name}`;
      name.title = asset.name;
      const dimensions = document.createElement('small');
      dimensions.textContent = `${asset.width} × ${asset.height}px`;
      caption.append(name, dimensions);
      figure.append(media, caption);
      els.selectionPreviewGrid.append(figure);
    });
    state.selectionPreviewRevision = state.projectRevision;
  }

  function ensureSelectionPreview() {
    if (state.step !== 1 || !state.mode) return;
    if (state.selectionPreviewRevision !== state.projectRevision || !els.selectionPreviewGrid.children.length) renderSelectionPreview();
  }

  function zipJobIsCurrent(job) {
    return Boolean(
      job
      && state.activeZip === job
      && !job.cancelled
      && job.revision === state.projectRevision
      && job.generated === state.generated
    );
  }

  function assertZipJobCurrent(job) {
    if (!zipJobIsCurrent(job)) throw appError('保存内容が変更されたため、古いZIP処理を破棄しました。', 'CANCELLED');
  }

  function setZipControlsIdle() {
    els.zipButton.disabled = false;
    els.cancelZipButton.hidden = true;
    updateNavigation();
  }

  function directorySaveSupported() {
    return savePlatform === 'android' && detectCapabilities().directoryPicker;
  }

  function cancelActiveDirectorySave() {
    const job = state.activeDirectorySave;
    if (!job) return false;
    job.cancelled = true;
    state.activeDirectorySave = null;
    return true;
  }

  function resetDirectorySaveSession() {
    cancelActiveDirectorySave();
    state.directorySaveSession = null;
  }

  function cancelActiveZip({ hideProgress = true } = {}) {
    const job = state.activeZip;
    if (!job) return false;
    job.cancelled = true;
    const cancellation = appError('ZIP作成を中止しました。', 'CANCELLED');
    if (job.reject) job.reject(cancellation);
    else if (job.worker) job.worker.terminate();
    job.worker = null;
    job.reject = null;
    if (state.activeZip === job) state.activeZip = null;
    setZipControlsIdle();
    if (hideProgress) els.progressArea.hidden = true;
    return true;
  }

  function clearGenerated() {
    const hasGeneratedOutput = Boolean(state.generated);
    const hasSaveUiState = !els.exportResults.hidden
      || els.fileResultList.childElementCount > 0
      || els.fallbackImageList.childElementCount > 0
      || !els.joinedDownloadButton.hidden
      || !els.androidDownloadCard.hidden
      || !els.androidDownloadStatus.hidden
      || !els.androidPermissionHelp.hidden
      || !els.directorySaveCard.hidden
      || !els.retryDirectorySaveButton.hidden
      || els.fileSaveDetails.open
      || Boolean(els.androidDownloadDialog && els.androidDownloadDialog.open)
      || Boolean(els.photoSaveDialog && els.photoSaveDialog.open);
    if (!hasGeneratedOutput && !hasSaveUiState && !state.activeZip && !state.directorySaveSession) return false;
    cancelActiveZip();
    resetDirectorySaveSession();
    if (els.androidDownloadDialog && els.androidDownloadDialog.open) els.androidDownloadDialog.close();
    if (els.photoSaveDialog && els.photoSaveDialog.open) els.photoSaveDialog.close();
    if (hasGeneratedOutput) {
      releaseGeneratedFileUrls(state.generated.files);
      if (state.generated.joined && state.generated.joined.url) URL.revokeObjectURL(state.generated.joined.url);
    }
    if (hasGeneratedOutput) {
      state.exportStale = true;
      setExportState('再書き出しが必要です。条件が変更されました。');
    }
    state.generated = null;
    state.directoryPickerMode = 'default';
    state.androidDownloadAttempts = 0;
    els.exportResults.hidden = true;
    els.fileResultList.innerHTML = '';
    els.fallbackImageList.innerHTML = '';
    els.joinedDownloadButton.hidden = true;
    els.fileSaveDetails.open = false;
    els.androidDownloadCard.hidden = true;
    els.androidDownloadStatus.hidden = true;
    els.androidDownloadStatus.textContent = '';
    els.androidPermissionHelp.hidden = true;
    els.androidPermissionHelp.open = false;
    els.androidDownloadButton.textContent = '4枚をダウンロード';
    els.directorySaveCard.hidden = true;
    els.retryDirectorySaveButton.hidden = true;
    return true;
  }

  function exportJobIsCurrent(job) {
    return Boolean(job && state.activeExport === job && !job.cancelled && job.revision === state.projectRevision);
  }

  function assertExportJobCurrent(job) {
    if (!exportJobIsCurrent(job)) throw appError('書き出し条件が変更されたため、古い処理結果を破棄しました。', 'CANCELLED');
  }

  function setExportControlsIdle() {
    els.formatSelect.disabled = false;
    els.qualityRange.disabled = false;
    els.cancelExportButton.hidden = true;
    updateExportSummary();
    updateNavigation();
  }

  function beginQualityEdit() {
    if (state.qualityEditActive) return;
    state.qualityEditActive = true;
    cancelActiveExport();
    clearGenerated();
  }

  function endQualityEdit() {
    if (!state.qualityEditActive) return;
    state.qualityEditActive = false;
    updateExportSummary();
    updateNavigation();
  }

  function cancelActiveExport({ hideProgress = true } = {}) {
    const job = state.activeExport;
    if (!job) return false;
    job.cancelled = true;
    const cancellation = appError('書き出しを中止しました。', 'CANCELLED');
    if (job.reject) job.reject(cancellation);
    else if (job.worker) job.worker.terminate();
    job.worker = null;
    job.reject = null;
    if (state.activeExport === job) state.activeExport = null;
    setExportControlsIdle();
    if (hideProgress) els.progressArea.hidden = true;
    return true;
  }

  function resetProject({ invalidateLoad = true, deferUi = false } = {}) {
    cancelActiveExport();
    releaseSelectionPreview();
    releaseAllStep3Previews();
    releaseCanvas(els.editorCanvas, true);
    releaseCanvas(els.stitchCanvas, true);
    if (state.customInputTimer) clearTimeout(state.customInputTimer);
    state.customInputTimer = null;
    if (state.wheelEndTimer) clearTimeout(state.wheelEndTimer);
    state.wheelEndTimer = null;
    state.wheelViewport = null;
    state.editSession = null;
    state.qualityEditActive = false;
    clearAdjustmentAnnouncement();
    state.projectRevision += 1;
    if (invalidateLoad) state.loadGeneration += 1;
    state.loadPending = false;
    state.maxReachedStep = 1;
    state.orderSuggestion = null;
    state.orderBeforeSuggestion = null;
    state.selectionIntent = null;
    state.selectionIntentChooserOpen = false;
    state.directoryPickerMode = 'default';
    disposeAsset(state.single);
    state.four.forEach(disposeAsset);
    clearGenerated();
    state.mode = null;
    state.single = null;
    state.four = [];
    state.crop = null;
    state.maxCrop = null;
    state.pointers.clear();
    state.gesture = null;
    state.previewDirty = true;
    state.previewRenderRevision = { carousel: -1, full: -1, boundaries: -1 };
    state.diagnosticsDirty = true;
    state.diagnosticsHasCompleted = false;
    state.diagnosticsWarningCount = 0;
    state.diagnosticsErrorCount = 0;
    state.diagnosticsGeneration += 1;
    setDiagnosticsState('idle', { summary: '確認画面で画像を検査します。', warningCount: 0, errorCount: 0 });
    els.fileInput.value = '';
    setAlert(els.loadError, '');
    setAlert(els.exportError, '');
    state.exportStale = false;
    setExportState('未生成');
    if (!deferUi) {
      renderSelectionZone({ announce: '' });
      updateNavigation();
    }
  }

  async function loadSelection(fileList, expectedIntent = state.selectionIntent) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setAlert(els.loadError, '');
    const expectedCount = expectedIntent === 'single' ? 1 : (expectedIntent === 'four' ? 4 : null);
    if ((expectedCount !== null && files.length !== expectedCount) || (expectedCount === null && ![1, 4].includes(files.length))) {
      const requirement = expectedCount === 1 ? '1枚' : (expectedCount === 4 ? '4枚' : '1枚または4枚');
      setAlert(els.loadError, `${requirement}を選択してください。現在は${files.length}枚選択されています。現在の画像は変更していません。`);
      return;
    }
    cancelActiveZip();
    const generation = state.loadGeneration + 1;
    state.loadGeneration = generation;
    state.loadPending = true;
    renderSelectionZone({ announce: state.mode ? '別の画像を読み込んでいます。' : '画像を読み込んでいます。' });
    updateNavigation();
    const assets = [];
    let assetsAdopted = false;

    try {
      const sorted = files.slice().sort((a, b) => collator.compare(a.name, b.name));
      const inspected = [];
      for (const file of sorted) {
        inspected.push({ file, info: await inspectImageFile(file) });
        if (generation !== state.loadGeneration) throw appError('新しい画像選択が開始されました。', 'STALE_LOAD');
      }
      const replacementImages = currentRetainedAssets();
      const requestedPreviewPixels = sorted.length === 4
        ? FOUR_IMAGE_MAX_PREVIEW_PIXELS_PER_IMAGE
        : LIMITS.retainedPreviewMaxPixels;
      for (const { file, info } of inspected) {
        const previewBudget = chooseImagePreviewBudget(info, assets, replacementImages, requestedPreviewPixels);
        assertOperationMemory(
          previewBudget.decision,
          sorted.length === 4 ? '4枚画像の読み込み' : '画像の読み込み'
        );
        const url = URL.createObjectURL(file);
        let decoded;
        try {
          decoded = await decodePreviewAsset(file, url, info, { maxPixels: previewBudget.maxPixels });
        } catch (error) {
          URL.revokeObjectURL(url);
          throw error;
        }
        assets.push({
          file,
          url,
          name: file.name,
          orderId: `${generation}-${assets.length + 1}`,
          detectedType: info.type,
          extension: info.extension,
          orientation: info.orientation,
          rawWidth: info.rawWidth,
          rawHeight: info.rawHeight,
          metadata: { ...info.metadata },
          estimatedPeakBytes: info.estimatedPeakBytes,
          operationPeakBytes: previewBudget.decision.estimatedBytes,
          ...decoded
        });
        if (generation !== state.loadGeneration) throw appError('新しい画像選択が開始されました。', 'STALE_LOAD');
        await nextFrame();
      }

      if (sorted.length === 4) {
        const retainedPixels = assets.reduce((sum, item) => sum + item.drawableWidth * item.drawableHeight, 0);
        if (retainedPixels > FOUR_IMAGE_TOTAL_PREVIEW_PIXELS) {
          throw appError('4枚のプレビュー合計が安全上限を超えました。より小さい画像を使用するか、一度に扱う画像数を減らしてください。', 'RESOURCE_LIMIT');
        }
      }

      if (generation !== state.loadGeneration) throw appError('新しい画像選択が開始されました。', 'STALE_LOAD');
      resetProject({ invalidateLoad: false, deferUi: true });
      state.loadPending = false;

      if (assets.length === 1) {
        state.mode = 'single';
        state.single = assets[0];
        state.preset = 'standard';
        els.presetSelect.value = 'standard';
        state.aspect = 3 / 2;
        initializeCrop();
        restoreGestureHint();
      } else {
        state.mode = 'four';
        state.four = assets;
        state.aspect = (assets.reduce((sum, item) => sum + item.width / item.height, 0) / assets.length) * 4;
      }

      assetsAdopted = true;
      state.selectionIntent = null;
      state.selectionIntentChooserOpen = false;
      state.maxReachedStep = 1;
      renderSelectionZone({ announce: `${assets.length}枚の画像を選択しました。` });
      renderSelectionPreview();
      state.previewDirty = true;
      markDiagnosticsDirty('確認画面で画像を検査します。');
      if (state.step !== 1) showStep(1, { historyAction: 'replace', restoreScroll: true });
      updateNavigation();
      requestAnimationFrame(() => els.chooseImagesButton.focus());
    } catch (error) {
      if (!assetsAdopted) assets.forEach(disposeAsset);
      if (generation !== state.loadGeneration || error.code === 'STALE_LOAD') return;
      console.error(error);
      if (assetsAdopted) resetProject({ invalidateLoad: false });
      state.loadPending = false;
      state.selectionIntent = null;
      state.selectionIntentChooserOpen = false;
      els.fileInput.value = '';
      renderSelectionZone({ announce: '' });
      ensureSelectionPreview();
      setAlert(els.loadError, error && error.message ? error.message : '画像の読み込みに失敗しました。');
      updateNavigation();
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[char]));
  }

  function maxCropForAspect(width, height, aspect) {
    return Core.maxCropForAspect(width, height, aspect);
  }

  function initializeCrop() {
    if (!state.single) return;
    state.maxCrop = maxCropForAspect(state.single.width, state.single.height, state.aspect);
    state.crop = { ...state.maxCrop };
    invalidateAfterEdit();
    endEditSession();
  }

  function changeAspect(newAspect) {
    if (!state.single || !Number.isFinite(newAspect) || newAspect <= 0) return;
    const oldMax = state.maxCrop || maxCropForAspect(state.single.width, state.single.height, state.aspect);
    const oldCrop = state.crop || oldMax;
    const zoomRatio = clamp(oldCrop.w / oldMax.w, 0.02, 1);
    const centerX = oldCrop.x + oldCrop.w / 2;
    const centerY = oldCrop.y + oldCrop.h / 2;

    state.aspect = newAspect;
    state.maxCrop = maxCropForAspect(state.single.width, state.single.height, state.aspect);
    const width = state.maxCrop.w * zoomRatio;
    const height = width / state.aspect;
    state.crop = clampCrop({ x: centerX - width / 2, y: centerY - height / 2, w: width, h: height });
    invalidateAfterEdit();
    endEditSession();
    resizeAndRenderEditor();
  }

  function minCropWidth() {
    if (!state.single || !state.maxCrop) return 64;
    const byWidth = Math.max(64, state.single.width * 0.035);
    const byHeight = Math.max(64, state.single.height * 0.035) * state.aspect;
    return Math.min(state.maxCrop.w, Math.max(byWidth, byHeight));
  }

  function clampCrop(candidate) {
    if (!state.single || !state.maxCrop) return candidate;
    let width = clamp(candidate.w, minCropWidth(), state.maxCrop.w);
    let height = width / state.aspect;
    if (height > state.maxCrop.h) {
      height = state.maxCrop.h;
      width = height * state.aspect;
    }
    const x = clamp(candidate.x, 0, Math.max(0, state.single.width - width));
    const y = clamp(candidate.y, 0, Math.max(0, state.single.height - height));
    return { x, y, w: width, h: height };
  }

  function getZoomPercent() {
    if (!state.crop || !state.maxCrop || !state.crop.w) return 100;
    return clamp((state.maxCrop.w / state.crop.w) * 100, 100, getMaxZoomPercent());
  }

  function getMaxZoomPercent() {
    if (!state.maxCrop) return 100;
    return Math.max(100, Math.floor((state.maxCrop.w / Math.max(1, minCropWidth())) * 100));
  }

  function updateZoomControls({ interactive = false } = {}) {
    if (!els.zoomRange || !state.crop || !state.maxCrop) return;
    const max = getMaxZoomPercent();
    const value = Math.round(getZoomPercent());
    const rangeValue = String(clamp(value, 100, max));
    const valueText = `${value}%`;
    if (!interactive && els.zoomRange.max !== String(max)) els.zoomRange.max = String(max);
    if (els.zoomRange.value !== rangeValue) els.zoomRange.value = rangeValue;
    if (els.zoomValue.value !== valueText) els.zoomValue.value = valueText;
    if (els.zoomValue.textContent !== valueText) els.zoomValue.textContent = valueText;
    // During a live gesture, avoid the nudge-button query and the disabled
    // state writes that can force style/layout work before the next pointer
    // event. The full control state is synchronized when the gesture ends.
    if (interactive) return;
    els.zoomOutButton.disabled = value <= 100;
    els.zoomInButton.disabled = value >= max;
    $$('[data-nudge]').forEach((button) => {
      const direction = button.dataset.nudge;
      const epsilon = 0.5;
      if (direction === 'up') button.disabled = state.crop.y >= state.single.height - state.crop.h - epsilon;
      else if (direction === 'down') button.disabled = state.crop.y <= epsilon;
      else if (direction === 'left') button.disabled = state.crop.x >= state.single.width - state.crop.w - epsilon;
      else button.disabled = state.crop.x <= epsilon;
    });
  }

  function setZoomPercent(percent, { finalize = false } = {}) {
    if (!state.crop || !state.maxCrop) return;
    const resolved = clamp(Number(percent) || 100, 100, getMaxZoomPercent());
    const centerX = state.crop.x + state.crop.w / 2;
    const centerY = state.crop.y + state.crop.h / 2;
    const width = state.maxCrop.w / (resolved / 100);
    const height = width / state.aspect;
    state.crop = clampCrop({ x: centerX - width / 2, y: centerY - height / 2, w: width, h: height });
    dismissGestureHint();
    invalidateAfterEdit();
    if (finalize) endEditSession({ announce: true });
  }

  function nudgeImage(direction, fraction = 0.01) {
    if (!state.crop) return;
    const dx = state.crop.w * fraction;
    const dy = state.crop.h * fraction;
    const candidate = { ...state.crop };
    if (direction === 'up') candidate.y += dy;
    else if (direction === 'down') candidate.y -= dy;
    else if (direction === 'left') candidate.x += dx;
    else if (direction === 'right') candidate.x -= dx;
    const next = clampCrop(candidate);
    if (next.x === state.crop.x && next.y === state.crop.y) {
      updateZoomControls();
      return;
    }
    state.crop = next;
    dismissGestureHint();
    invalidateAfterEdit();
    queueAdjustmentAnnouncement();
    endEditSession();
  }

  function getResolvedOutputSize() {
    if (state.mode !== 'single') {
      if (!state.four.length) return { width: 0, height: 0, panelWidth: 0 };
      const targetHeight = Math.min(...state.four.map((item) => item.height));
      const widths = state.four.map((item) => Math.max(1, Math.round(item.width * targetHeight / item.height)));
      return { width: widths.reduce((sum, value) => sum + value, 0), height: targetHeight, panelWidth: null, widths };
    }

    let width;
    let height;
    if (state.preset === 'standard') {
      width = 6480; height = 4320;
    } else if (state.preset === 'vrchat8k') {
      width = 7680; height = 4320;
    } else if (state.preset === 'source') {
      width = Math.max(4, Math.floor(state.crop.w / 4) * 4);
      height = Math.max(1, Math.round(width / state.aspect));
      if (height > state.crop.h) {
        height = Math.max(1, Math.floor(state.crop.h));
        width = Math.max(4, Math.floor((height * state.aspect) / 4) * 4);
        height = Math.max(1, Math.round(width / state.aspect));
      }
    } else {
      const custom = normalizeCustomSize(false);
      width = custom.width;
      height = custom.height;
    }
    return { width, height, panelWidth: width / 4 };
  }

  function beginEditSession() {
    if (state.editSession && state.editSession.active) return state.editSession;
    if (state.editSession) state.editSession = null;
    state.projectRevision += 1;
    state.maxReachedStep = Math.min(state.maxReachedStep, 2);
    cancelActiveExport();
    state.previewDirty = true;
    // Keep the continuous path free of hidden-panel and navigation DOM work.
    // These are synchronized once, after the fingers/mouse are released.
    state.diagnosticsDirty = true;
    state.diagnosticsGeneration += 1;
    state.editSession = { active: true, framePending: false, frameId: null };
    return state.editSession;
  }

  function queueEditSessionFrame() {
    const session = state.editSession;
    if (!session || session.framePending) return;
    session.framePending = true;
    session.frameId = requestAnimationFrame(() => {
      session.framePending = false;
      session.frameId = null;
      if (state.editSession !== session) return;
      updateZoomControls({ interactive: true });
      renderEditor();
    });
  }

  function endEditSession({ announce = false } = {}) {
    const session = state.editSession;
    if (!session) return;
    session.active = false;
    if (session.framePending && session.frameId !== null) cancelAnimationFrame(session.frameId);
    session.framePending = false;
    session.frameId = null;
    if (state.crop) state.crop = clampCrop(state.crop);
    updateZoomControls();
    updateCropInfo();
    // Flush one final visual frame after a gesture. This replaces the many
    // per-move navigation/DOM rebuilds while preserving the final crop.
    renderEditor();
    markDiagnosticsDirty();
    clearGenerated();
    updateNavigation();
    state.editSession = null;
    if (announce) queueAdjustmentAnnouncement({ immediate: true });
  }

  function invalidateAfterEdit() {
    beginEditSession();
    queueEditSessionFrame();
  }

  function scheduleEditorRender() {
    if (state.editorRenderPending) return;
    state.editorRenderPending = true;
    requestAnimationFrame(() => {
      state.editorRenderPending = false;
      renderEditor();
    });
  }

  function resizeAndRenderEditor() {
    if (!state.single || els.singleEditor.hidden) return;
    const availableWidth = Math.max(1, els.editorCanvas.parentElement.clientWidth || 600);
    const maxDisplayHeight = Math.max(240, Math.min((window.innerHeight || 800) * 0.72, 900));
    let displayWidth = availableWidth;
    let displayHeight = displayWidth / state.aspect;
    if (displayHeight > maxDisplayHeight) {
      displayHeight = maxDisplayHeight;
      displayWidth = displayHeight * state.aspect;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const fitted = fitDimensionsWithinBudget(
      displayWidth * dpr,
      displayHeight * dpr,
      LIMITS.previewCanvasMaxEdge,
      LIMITS.previewCanvasMaxPixels
    );
    const pixelWidth = fitted.width;
    const pixelHeight = fitted.height;
    if (els.editorCanvas.width !== pixelWidth || els.editorCanvas.height !== pixelHeight) {
      els.editorCanvas.width = pixelWidth;
      els.editorCanvas.height = pixelHeight;
    }
    els.editorCanvas.style.width = `${Math.max(1, Math.round(displayWidth))}px`;
    els.editorCanvas.style.height = `${Math.max(1, Math.round(displayHeight))}px`;
    els.editorCanvas.style.aspectRatio = String(state.aspect);
    renderEditor();
  }

  function renderEditor() {
    if (!state.single || !state.crop || els.singleEditor.hidden) return;
    const canvas = els.editorCanvas;
    const context = canvas.getContext('2d', { alpha: false });
    context.save();
    context.fillStyle = '#05070a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = state.editSession && state.editSession.active ? 'medium' : 'high';
    drawAssetRegion(
      context,
      state.single,
      state.crop.x, state.crop.y, state.crop.w, state.crop.h,
      0, 0, canvas.width, canvas.height
    );

    const lineWidth = Math.max(1, canvas.width / 1000);
    if (state.guides.safe) {
      context.fillStyle = 'rgba(255, 103, 123, .13)';
      const safeWidth = canvas.width * 0.012;
      [0.25, 0.5, 0.75].forEach((fraction) => context.fillRect(canvas.width * fraction - safeWidth / 2, 0, safeWidth, canvas.height));
    }
    if (state.guides.seams) {
      context.strokeStyle = 'rgba(255,255,255,.9)';
      context.lineWidth = lineWidth;
      [0.25, 0.5, 0.75].forEach((fraction) => {
        const x = Math.round(canvas.width * fraction) + 0.5;
        context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
      });
    }
    if (state.guides.centers) {
      context.strokeStyle = 'rgba(122,167,255,.88)';
      context.setLineDash([8 * lineWidth, 7 * lineWidth]);
      context.lineWidth = lineWidth;
      [0.125, 0.375, 0.625, 0.875].forEach((fraction) => {
        const x = canvas.width * fraction;
        context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
      });
      context.setLineDash([]);
    }
    if (state.guides.subject !== 'none') {
      const fraction = state.guides.subject === 'panel2' ? 0.375 : 0.625;
      const x = canvas.width * fraction;
      context.fillStyle = 'rgba(122,167,255,.10)';
      context.fillRect(x - canvas.width * 0.018, 0, canvas.width * 0.036, canvas.height);
      context.strokeStyle = 'rgba(122,167,255,.98)';
      context.lineWidth = lineWidth * 2;
      context.setLineDash([10 * lineWidth, 6 * lineWidth]);
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
      context.setLineDash([]);
    }
    if (state.guides.seams) {
      context.font = `${Math.max(15, canvas.width * 0.022)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      for (let index = 0; index < 4; index += 1) {
        const x = canvas.width * ((index + 0.5) / 4);
        const y = Math.max(18, canvas.height * 0.055);
        const radius = Math.max(13, canvas.width * 0.018);
        context.fillStyle = 'rgba(0,0,0,.58)';
        context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
        context.fillStyle = 'rgba(255,255,255,.95)';
        context.fillText(String(index + 1), x, y + 1);
      }
    }
    if (state.guides.thirds) {
      context.strokeStyle = 'rgba(255,211,122,.72)';
      context.lineWidth = lineWidth;
      [1 / 3, 2 / 3].forEach((fraction) => {
        context.beginPath(); context.moveTo(canvas.width * fraction, 0); context.lineTo(canvas.width * fraction, canvas.height); context.stroke();
        context.beginPath(); context.moveTo(0, canvas.height * fraction); context.lineTo(canvas.width, canvas.height * fraction); context.stroke();
      });
    }
    context.restore();
  }

  function updateCropInfo() {
    if (!state.single || !state.crop) return;
    const output = getResolvedOutputSize();
    const scale = Math.max(output.width / state.crop.w, output.height / state.crop.h);
    els.cropInfo.innerHTML = [
      ['元画像', `${state.single.width} × ${state.single.height}`],
      ['使用範囲', `約${Math.round(state.crop.w)} × ${Math.round(state.crop.h)}`],
      ['出力', `${output.width} × ${output.height} → ${output.panelWidth} × ${output.height} × 4`],
      ['構図の拡大率', `${Math.round(getZoomPercent())}%（全体に合わせる＝100%）`],
      ['出力倍率', scale > 1.001 ? `${scale.toFixed(2)}倍に拡大して書き出し` : '元の使用範囲を拡大せず書き出し']
    ].map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join('');
    updateAdjustmentSummary();
  }

  function applyPreset(commitCustom = false) {
    state.preset = els.presetSelect.value;
    els.customSizeFields.hidden = state.preset !== 'custom';
    let aspect = state.aspect;
    if (state.preset === 'standard' || state.preset === 'source') aspect = 3 / 2;
    if (state.preset === 'vrchat8k') aspect = 16 / 9;
    if (state.preset === 'custom') {
      const custom = normalizeCustomSize(commitCustom);
      aspect = custom.aspect;
    }
    changeAspect(aspect);
    updateCropInfo();
  }

  function canvasPoint(event, viewport = null) {
    const rect = viewport || els.editorCanvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  function beginDrag(pointerId, point) {
    state.gesture = {
      type: 'pending-drag',
      pointerId,
      startPoint: point,
      startCrop: { ...state.crop },
      viewport: { left: point.left, top: point.top, width: point.width, height: point.height }
    };
  }

  function beginPinch() {
    const points = Array.from(state.pointers.values());
    if (points.length < 2) return;
    const a = points[0];
    const b = points[1];
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const sourcePoint = points[0];
    const viewport = {
      left: sourcePoint.left,
      top: sourcePoint.top,
      width: sourcePoint.width,
      height: sourcePoint.height
    };
    const anchor = {
      x: state.crop.x + (midpoint.x / viewport.width) * state.crop.w,
      y: state.crop.y + (midpoint.y / viewport.height) * state.crop.h
    };
    state.gesture = { type: 'pinch', startCrop: { ...state.crop }, startMidpoint: midpoint, startDistance: distance, anchor, viewport };
    els.editorCanvas.classList.add('dragging');
  }

  function handlePointerDown(event) {
    if (!state.single || !state.crop) return;
    event.preventDefault();
    if (state.gesture && state.gesture.type === 'awaiting-all-release') return;
    if (!state.pointers.has(event.pointerId) && state.pointers.size >= 2) return;
    try { els.editorCanvas.setPointerCapture(event.pointerId); } catch (_) { /* Pointer capture is best-effort. */ }
    const point = canvasPoint(event);
    state.pointers.set(event.pointerId, point);
    if (state.pointers.size === 1) beginDrag(event.pointerId, point);
    else if (state.pointers.size === 2) beginPinch();
  }

  function handlePointerMove(event) {
    if (!state.pointers.has(event.pointerId) || !state.gesture) return;
    if (state.gesture.type === 'awaiting-all-release') return;
    event.preventDefault();
    const point = canvasPoint(event, state.gesture.viewport);
    state.pointers.set(event.pointerId, point);

    if (state.pointers.size >= 2) {
      if (state.gesture.type !== 'pinch') beginPinch();
      const viewport = state.gesture.viewport;
      const points = Array.from(state.pointers.values());
      const a = points[0];
      const b = points[1];
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const scale = distance / state.gesture.startDistance;
      let width = state.gesture.startCrop.w / scale;
      width = clamp(width, minCropWidth(), state.maxCrop.w);
      let height = width / state.aspect;
      if (height > state.maxCrop.h) {
        height = state.maxCrop.h;
        width = height * state.aspect;
      }
      const candidate = {
        x: state.gesture.anchor.x - (midpoint.x / viewport.width) * width,
        y: state.gesture.anchor.y - (midpoint.y / viewport.height) * height,
        w: width,
        h: height
      };
      state.crop = clampCrop(candidate);
      dismissGestureHint();
      beginEditSession();
      queueEditSessionFrame();
      return;
    }

    if (state.gesture.type === 'pending-drag' && state.gesture.pointerId === event.pointerId) {
      const distance = Math.hypot(point.x - state.gesture.startPoint.x, point.y - state.gesture.startPoint.y);
      if (distance < DRAG_THRESHOLD_PX) return;
      state.gesture.type = 'drag';
      els.editorCanvas.classList.add('dragging');
    }

    if (state.gesture.type === 'drag' && state.gesture.pointerId === event.pointerId) {
      const dx = point.x - state.gesture.startPoint.x;
      const dy = point.y - state.gesture.startPoint.y;
      const candidate = {
        ...state.gesture.startCrop,
        x: state.gesture.startCrop.x - dx * state.gesture.startCrop.w / state.gesture.viewport.width,
        y: state.gesture.startCrop.y - dy * state.gesture.startCrop.h / state.gesture.viewport.height
      };
      state.crop = clampCrop(candidate);
      dismissGestureHint();
      beginEditSession();
      queueEditSessionFrame();
    }
  }

  function handlePointerEnd(event) {
    if (!state.pointers.has(event.pointerId)) return;
    const completedGestureType = state.gesture && state.gesture.type;
    state.pointers.delete(event.pointerId);
    try {
      if (els.editorCanvas.hasPointerCapture && els.editorCanvas.hasPointerCapture(event.pointerId)) {
        els.editorCanvas.releasePointerCapture(event.pointerId);
      }
    } catch (_) { /* Capture may already have been released by the browser. */ }
    if (state.pointers.size === 0) {
      state.gesture = null;
      els.editorCanvas.classList.remove('dragging');
      if (completedGestureType === 'drag' || completedGestureType === 'pinch') endEditSession({ announce: true });
    } else if (state.pointers.size === 1) {
      if (completedGestureType === 'pinch' || completedGestureType === 'awaiting-all-release') {
        if (completedGestureType === 'pinch') endEditSession({ announce: true });
        state.gesture = { type: 'awaiting-all-release' };
        els.editorCanvas.classList.remove('dragging');
      } else {
        const [pointerId, point] = state.pointers.entries().next().value;
        beginDrag(pointerId, point);
      }
    }
  }

  function handleWheel(event) {
    if (!state.single || !state.crop) return;
    event.preventDefault();
    const point = state.wheelViewport
      ? canvasPoint(event, state.wheelViewport)
      : canvasPoint(event);
    if (!state.wheelViewport) {
      state.wheelViewport = {
        left: point.left,
        top: point.top,
        width: point.width,
        height: point.height
      };
    }
    const factor = Math.exp(event.deltaY * 0.0012);
    let width = clamp(state.crop.w * factor, minCropWidth(), state.maxCrop.w);
    let height = width / state.aspect;
    if (height > state.maxCrop.h) {
      height = state.maxCrop.h;
      width = height * state.aspect;
    }
    const anchorX = state.crop.x + (point.x / point.width) * state.crop.w;
    const anchorY = state.crop.y + (point.y / point.height) * state.crop.h;
    const next = clampCrop({
      x: anchorX - (point.x / point.width) * width,
      y: anchorY - (point.y / point.height) * height,
      w: width,
      h: height
    });
    if (next.x === state.crop.x && next.y === state.crop.y && next.w === state.crop.w) {
      if (!state.wheelEndTimer) state.wheelViewport = null;
      return;
    }
    state.crop = next;
    dismissGestureHint();
    beginEditSession();
    queueEditSessionFrame();
    if (state.wheelEndTimer) clearTimeout(state.wheelEndTimer);
    state.wheelEndTimer = setTimeout(() => {
      state.wheelEndTimer = null;
      state.wheelViewport = null;
      endEditSession({ announce: true });
    }, 120);
  }

  function renderOrderList({ focusOrderId = null, focusMove = null } = {}) {
    els.orderList.innerHTML = '';
    const busy = Boolean(state.orderSuggestion);
    els.orderList.setAttribute('aria-busy', String(busy));
    state.four.forEach((item, index) => {
      const card = document.createElement('li');
      card.className = 'order-card';
      card.draggable = !busy;
      card.dataset.index = String(index);
      card.dataset.orderId = item.orderId;
      card.innerHTML = `
        <div class="order-number">${index + 1}</div>
        <canvas class="order-thumb" width="144" height="176" role="img" aria-label="${index + 1}番目、${escapeHtml(item.name)}のサムネイル"></canvas>
        <div class="order-meta"><strong>${escapeHtml(item.name)}</strong><small>${item.width} × ${item.height}</small></div>
        <div class="order-buttons">
          <button type="button" data-move="left" aria-label="${escapeHtml(item.name)}を${index + 1}番目から左へ移動" ${busy || index === 0 ? 'disabled' : ''}>${iconMarkup('left')}</button>
          <button type="button" data-move="right" aria-label="${escapeHtml(item.name)}を${index + 1}番目から右へ移動" ${busy || index === state.four.length - 1 ? 'disabled' : ''}>${iconMarkup('right')}</button>
        </div>`;
      const thumbnail = $('.order-thumb', card);
      const thumbnailContext = thumbnail.getContext('2d', { alpha: false });
      if (thumbnailContext) drawAssetCover(thumbnailContext, item, 0, 0, thumbnail.width, thumbnail.height);
      card.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-move]');
        if (!button) return;
        const current = Number(card.dataset.index);
        const target = button.dataset.move === 'left' ? current - 1 : current + 1;
        moveOrder(current, target);
      });
      card.addEventListener('dragstart', (event) => {
        if (state.orderSuggestion) { event.preventDefault(); return; }
        state.draggedOrderIndex = Number(card.dataset.index);
      });
      card.addEventListener('dragover', (event) => { event.preventDefault(); card.classList.add('drag-over'); });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', (event) => {
        event.preventDefault();
        card.classList.remove('drag-over');
        const target = Number(card.dataset.index);
        if (Number.isInteger(state.draggedOrderIndex)) moveOrder(state.draggedOrderIndex, target);
      });
      els.orderList.append(card);
    });
    if (focusOrderId) {
      const card = Array.from(els.orderList.children).find((item) => item.dataset.orderId === focusOrderId);
      if (!card) return;
      const preferred = card.querySelector(`button[data-move="${focusMove}"]`);
      const fallback = card.querySelector('button[data-move]:not(:disabled)');
      (preferred && !preferred.disabled ? preferred : fallback || card).focus();
    }
  }

  function moveOrder(from, to, { preserveUndo = false } = {}) {
    if (state.orderSuggestion || from === to || from < 0 || to < 0 || from >= state.four.length || to >= state.four.length) return;
    const [item] = state.four.splice(from, 1);
    state.four.splice(to, 0, item);
    state.draggedOrderIndex = null;
    if (!preserveUndo) {
      state.orderBeforeSuggestion = null;
      els.undoOrderButton.hidden = true;
    }
    const direction = to < from ? 'left' : 'right';
    invalidateFourOrder({
      announcement: `${item.name}を${to + 1}番目へ移動しました。現在の順番は${state.four.map((entry) => entry.name).join('、')}です。`,
      focusOrderId: item.orderId,
      focusMove: direction
    });
  }

  function invalidateFourOrder({ announcement = '', focusOrderId = null, focusMove = null } = {}) {
    state.projectRevision += 1;
    state.maxReachedStep = Math.min(state.maxReachedStep, 2);
    cancelActiveExport();
    state.aspect = state.four.reduce((sum, item) => sum + item.width / item.height, 0);
    state.previewDirty = true;
    markDiagnosticsDirty();
    state.diagnosticsGeneration += 1;
    clearGenerated();
    renderOrderList({ focusOrderId, focusMove });
    renderStitchPreview();
    if (announcement) els.orderStatus.textContent = announcement;
    updateNavigation();
  }

  function drawAssetCover(context, asset, dx, dy, dw, dh) {
    const sourceAspect = asset.width / asset.height;
    const targetAspect = dw / dh;
    let sx = 0; let sy = 0; let sw = asset.width; let sh = asset.height;
    if (sourceAspect > targetAspect) {
      sw = asset.height * targetAspect;
      sx = (asset.width - sw) / 2;
    } else if (sourceAspect < targetAspect) {
      sh = asset.width / targetAspect;
      sy = (asset.height - sh) / 2;
    }
    drawAssetRegion(context, asset, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function renderStitchPreview() {
    if (state.mode !== 'four' || !state.four.length) return;
    const previewHeight = 520;
    const widthWeights = state.four.map((item) => previewHeight * item.width / item.height);
    const totalWidth = widthWeights.reduce((sum, value) => sum + value, 0);
    const fitted = fitDimensionsWithinBudget(totalWidth, previewHeight, LIMITS.previewCanvasMaxEdge, LIMITS.previewCanvasMaxPixels);
    const drawWidths = allocateWidths(fitted.width, widthWeights);
    els.stitchCanvas.width = fitted.width;
    els.stitchCanvas.height = fitted.height;
    els.stitchCanvas.style.width = `${fitted.width}px`;
    els.stitchCanvas.style.height = `${fitted.height}px`;
    const context = els.stitchCanvas.getContext('2d', { alpha: false });
    let x = 0;
    state.four.forEach((item, index) => {
      drawWholeAsset(context, item, x, 0, drawWidths[index], fitted.height);
      x += drawWidths[index];
    });
    const sameDimensions = state.four.every((item) => item.width === state.four[0].width && item.height === state.four[0].height);
    els.fourInfo.innerHTML = `${sameDimensions ? '4枚の寸法は一致しています。' : '4枚の寸法が異なります。結合時は高さをそろえて縮小します。'}<br>現在の順番：${state.four.map((item, index) => `${index + 1}. ${escapeHtml(item.name)}`).join(' / ')}`;
  }

  async function edgeDescriptor(item, side) {
    const canvas = document.createElement('canvas');
    const height = 160;
    const width = 12;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const stripWidth = Math.max(2, Math.round(item.width * 0.012));
    const sx = side === 'left' ? 0 : item.width - stripWidth;
    drawAssetRegion(context, item, sx, 0, stripWidth, item.height, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  }

  function descriptorDistance(a, b) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < a.length; i += 4) {
      const ar = a[i]; const ag = a[i + 1]; const ab = a[i + 2];
      const br = b[i]; const bg = b[i + 1]; const bb = b[i + 2];
      const al = (ar + ag + ab) / 3;
      const bl = (br + bg + bb) / 3;
      sum += (ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2 + 0.35 * (al - bl) ** 2;
      count += 4;
    }
    return sum / Math.max(1, count);
  }

  function permutations(items) {
    if (items.length <= 1) return [items.slice()];
    const result = [];
    items.forEach((item, index) => {
      const rest = items.slice(0, index).concat(items.slice(index + 1));
      permutations(rest).forEach((tail) => result.push([item, ...tail]));
    });
    return result;
  }

  async function suggestOrder() {
    if (state.four.length !== 4 || state.orderSuggestion) return;
    setAlert(els.orderError, '');
    const token = {};
    const revision = state.projectRevision;
    const snapshot = state.four.slice();
    state.orderSuggestion = token;
    els.suggestOrderButton.disabled = true;
    els.suggestOrderButton.setAttribute('aria-busy', 'true');
    els.suggestOrderButton.textContent = '境界を比較しています…';
    els.orderStatus.textContent = '境界を比較しています。';
    renderOrderList();
    const suggestionIsCurrent = () => state.orderSuggestion === token
      && revision === state.projectRevision
      && state.four.length === snapshot.length
      && state.four.every((item, index) => item === snapshot[index] && !item.disposed);
    try {
      const descriptors = new Map();
      for (const item of snapshot) {
        if (!suggestionIsCurrent()) return;
        const left = await edgeDescriptor(item, 'left');
        if (!suggestionIsCurrent()) return;
        const right = await edgeDescriptor(item, 'right');
        if (!suggestionIsCurrent()) return;
        descriptors.set(item, { left, right });
        await nextFrame();
        if (!suggestionIsCurrent()) return;
      }
      let best = null;
      let bestCost = Infinity;
      for (const order of permutations(snapshot)) {
        let cost = 0;
        for (let i = 0; i < order.length - 1; i += 1) {
          cost += descriptorDistance(descriptors.get(order[i]).right, descriptors.get(order[i + 1]).left);
        }
        if (cost < bestCost) { bestCost = cost; best = order; }
      }
      if (!suggestionIsCurrent()) return;
      if (best) {
        state.orderBeforeSuggestion = snapshot;
        state.four = best;
        state.orderSuggestion = null;
        els.undoOrderButton.hidden = false;
        invalidateFourOrder({ announcement: `並び順を提案しました。現在の順番は${best.map((item) => item.name).join('、')}です。` });
      }
    } catch (error) {
      if (state.orderSuggestion !== token) return;
      console.error(error);
      setAlert(els.orderError, '並び順の提案に失敗しました。左右の移動ボタンで順番を変更してください。');
      els.orderStatus.textContent = '並び順を提案できませんでした。';
    } finally {
      if (state.orderSuggestion === token) state.orderSuggestion = null;
      if (!state.orderSuggestion) {
        els.suggestOrderButton.disabled = false;
        els.suggestOrderButton.removeAttribute('aria-busy');
        els.suggestOrderButton.textContent = '境界から並び順を提案';
        renderOrderList();
      }
    }
  }

  function undoSuggestedOrder() {
    if (!state.orderBeforeSuggestion || state.orderSuggestion) return;
    state.four = state.orderBeforeSuggestion;
    state.orderBeforeSuggestion = null;
    els.undoOrderButton.hidden = true;
    invalidateFourOrder({ announcement: `提案前の順番へ戻しました。現在の順番は${state.four.map((item) => item.name).join('、')}です。` });
  }

  function createPanelCanvas(index, width = 480) {
    const canvas = document.createElement('canvas');
    const panelAspect = getPanelAspect(index);
    const fitted = fitDimensionsWithinBudget(width, width / panelAspect, LIMITS.previewCanvasMaxEdge, LIMITS.previewCanvasMaxPixels);
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    drawPanelToCanvas(canvas, index);
    return canvas;
  }

  function getPanelAspect(index = 0) {
    if (state.mode === 'single') return state.aspect / 4;
    const item = state.four[index] || state.four[0];
    return item ? item.width / item.height : 3 / 8;
  }

  function drawPanelToCanvas(canvas, index) {
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#05070a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (state.mode === 'single') {
      const sx = state.crop.x + (state.crop.w * index / 4);
      const sw = state.crop.w / 4;
      drawAssetRegion(context, state.single, sx, state.crop.y, sw, state.crop.h, 0, 0, canvas.width, canvas.height);
    } else {
      const item = state.four[index];
      if (item) drawAssetCover(context, item, 0, 0, canvas.width, canvas.height);
    }
  }

  function releaseStep3Preview(name) {
    if (name === 'carousel') {
      releaseCanvasesIn(els.carouselPreview);
      els.carouselPreview.innerHTML = '';
    } else if (name === 'full') {
      releaseCanvas(els.fullPreviewCanvas, true);
    } else if (name === 'boundaries') {
      releaseCanvasesIn(els.boundaryPreview);
      els.boundaryPreview.innerHTML = '';
    }
    if (Object.prototype.hasOwnProperty.call(state.previewRenderRevision, name)) state.previewRenderRevision[name] = -1;
  }

  function releaseAllStep3Previews(except = null) {
    ['carousel', 'full', 'boundaries'].forEach((name) => {
      if (name !== except) releaseStep3Preview(name);
    });
  }

  function previewHasBacking(name) {
    if (name === 'carousel') return els.carouselPreview.querySelectorAll('canvas').length === 4;
    if (name === 'full') return els.fullPreviewCanvas.width > 1 && els.fullPreviewCanvas.height > 1;
    if (name === 'boundaries') return els.boundaryPreview.querySelectorAll('canvas').length === 6;
    return false;
  }

  function renderPreviewTab(name, { force = false } = {}) {
    if (!state.mode || state.step !== 3 || !Object.prototype.hasOwnProperty.call(state.previewRenderRevision, name)) return;
    if (state.previewDirty) {
      releaseAllStep3Previews();
      state.previewDirty = false;
    } else {
      releaseAllStep3Previews(name);
    }
    if (force) releaseStep3Preview(name);
    if (state.previewRenderRevision[name] === state.projectRevision && previewHasBacking(name)) return;
    if (name === 'carousel') renderCarouselPreview();
    else if (name === 'full') renderFullPreview();
    else renderBoundaryPreview();
    state.previewRenderRevision[name] = state.projectRevision;
  }

  function renderCarouselPreview() {
    els.carouselPreview.innerHTML = '';
    for (let index = 0; index < 4; index += 1) {
      const holder = document.createElement('div');
      holder.className = 'x-panel';
      holder.setAttribute('role', 'group');
      holder.setAttribute('aria-roledescription', 'スライド');
      holder.setAttribute('aria-label', `${index + 1} / 4`);
      holder.style.setProperty('--panel-aspect', String(getPanelAspect(index)));
      const canvas = createPanelCanvas(index, 480);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${index + 1}枚目の出力プレビュー`);
      holder.append(canvas);
      els.carouselPreview.append(holder);
    }
    els.carouselPreview.scrollLeft = 0;
    state.carouselIndex = 0;
    updateCarouselControls(false);
  }

  function updateCarouselControls(announce = true) {
    state.carouselIndex = clamp(state.carouselIndex, 0, 3);
    els.carouselPrevButton.disabled = state.carouselIndex === 0;
    els.carouselNextButton.disabled = state.carouselIndex === 3;
    const text = `${state.carouselIndex + 1} / 4`;
    if (announce || els.carouselStatus.textContent !== text) els.carouselStatus.textContent = text;
  }

  function moveCarousel(delta, returnFocus = null) {
    const next = clamp(state.carouselIndex + delta, 0, 3);
    if (next === state.carouselIndex) return;
    state.carouselIndex = next;
    const slide = els.carouselPreview.children[next];
    if (slide) {
      const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      els.carouselPreview.scrollTo({ left: slide.offsetLeft - els.carouselPreview.offsetLeft, behavior: reduced ? 'auto' : 'smooth' });
    }
    updateCarouselControls();
    if (returnFocus) returnFocus.focus();
  }

  function renderFullPreview() {
    const canvas = els.fullPreviewCanvas;
    const desiredHeight = state.mode === 'single' ? Math.round(1500 / state.aspect) : 600;
    let desiredWidth;
    if (state.mode === 'single') desiredWidth = 1500;
    else desiredWidth = state.four.reduce((sum, item) => sum + Math.round(desiredHeight * item.width / item.height), 0);
    const fitted = fitDimensionsWithinBudget(desiredWidth, desiredHeight, LIMITS.previewCanvasMaxEdge, LIMITS.previewCanvasMaxPixels);
    const previewWidth = fitted.width;
    const previewHeight = fitted.height;
    canvas.width = previewWidth;
    canvas.height = previewHeight;
    canvas.style.width = `${previewWidth}px`;
    canvas.style.height = `${previewHeight}px`;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#05070a';
    context.fillRect(0, 0, previewWidth, previewHeight);
    if (state.mode === 'single') {
      drawAssetRegion(context, state.single, state.crop.x, state.crop.y, state.crop.w, state.crop.h, 0, 0, previewWidth, previewHeight);
    } else {
      const widthWeights = state.four.map((item) => item.width / item.height);
      const drawWidths = allocateWidths(previewWidth, widthWeights);
      let x = 0;
      state.four.forEach((item, index) => {
        const width = drawWidths[index];
        drawWholeAsset(context, item, x, 0, width, previewHeight);
        x += width;
      });
    }
  }

  function renderBoundaryPreview() {
    els.boundaryPreview.innerHTML = '';
    const withGap = els.boundaryGapToggle.checked;
    for (let boundary = 0; boundary < 3; boundary += 1) {
      const card = document.createElement('article');
      card.className = 'boundary-card';
      card.innerHTML = `<h4>${boundary + 1}｜${boundary + 2} の境界</h4>`;
      const pair = document.createElement('div');
      pair.className = `boundary-pair ${withGap ? 'with-gap' : 'no-gap'}`;
      [boundary, boundary + 1].forEach((index) => {
        const holder = document.createElement('div');
        holder.className = 'boundary-panel';
        holder.style.setProperty('--panel-aspect', String(getPanelAspect(index)));
        holder.append(createPanelCanvas(index, 360));
        pair.append(holder);
      });
      card.append(pair);
      els.boundaryPreview.append(card);
    }
  }

  function renderAnalysisCanvas(maxWidth = 1024) {
    const canvas = document.createElement('canvas');
    if (state.mode === 'single') {
      const desiredWidth = Math.min(maxWidth, Math.max(320, Math.round(state.crop.w)));
      const fitted = fitDimensionsWithinBudget(desiredWidth, desiredWidth / state.aspect, LIMITS.previewCanvasMaxEdge, LIMITS.previewCanvasMaxPixels);
      canvas.width = fitted.width;
      canvas.height = fitted.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      drawAssetRegion(context, state.single, state.crop.x, state.crop.y, state.crop.w, state.crop.h, 0, 0, canvas.width, canvas.height);
      canvas.__xPanelWidths = allocateWidths(canvas.width, [1, 1, 1, 1]);
      return canvas;
    }
    const desiredHeight = 640;
    const widthWeights = state.four.map((item) => desiredHeight * item.width / item.height);
    const rawWidth = widthWeights.reduce((sum, value) => sum + value, 0);
    const fitted = fitDimensionsWithinBudget(
      Math.min(rawWidth, maxWidth),
      desiredHeight * Math.min(1, maxWidth / Math.max(1, rawWidth)),
      LIMITS.previewCanvasMaxEdge,
      LIMITS.previewCanvasMaxPixels
    );
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const drawWidths = allocateWidths(canvas.width, widthWeights);
    canvas.__xPanelWidths = drawWidths.slice();
    let x = 0;
    state.four.forEach((item, index) => {
      const width = drawWidths[index];
      drawWholeAsset(context, item, x, 0, width, canvas.height);
      x += width;
    });
    return canvas;
  }

  function diagnosticItem(kind, text) {
    const icon = kind === 'ok' ? 'check' : kind === 'warn' ? 'warning' : 'error';
    return `<div class="diagnostic ${kind}"><span class="mark" aria-hidden="true">${iconMarkup(icon)}</span><span>${text}</span></div>`;
  }

  async function runDiagnostics() {
    if (!state.mode) return;
    const generation = state.diagnosticsGeneration + 1;
    const revision = state.projectRevision;
    state.diagnosticsGeneration = generation;
    setDiagnosticsState('running', { summary: '画像を検査しています…', warningCount: 0, errorCount: 0 });
    els.diagnosticsDetails.open = true;
    els.diagnosticsList.innerHTML = `<div class="diagnostic loading"><span class="mark" aria-hidden="true">${iconMarkup('loading')}</span><span>画像を検査しています…</span></div>`;
    updateNavigation();
    let analysis = null;

    try {
      await nextFrame();
      if (generation !== state.diagnosticsGeneration || revision !== state.projectRevision || state.step !== 3) return;
      const items = [];
      analysis = renderAnalysisCanvas(1024);
      const analysisContext = analysis.getContext('2d', { willReadFrequently: true });
      if (!analysisContext) throw appError('診断用キャンバスを読み取れませんでした。', 'DIAGNOSTICS_RUNTIME');
      // All three diagnostics inspect the same pixels. Read them once and
      // share ImageData; diagnostics.js keeps the canvas API as a fallback.
      const analysisImageData = analysisContext.getImageData(0, 0, analysis.width, analysis.height);
      const bands = Diagnostics.detectUniformBands(analysisImageData);
      const panelWidths = Array.isArray(analysis.__xPanelWidths)
        ? analysis.__xPanelWidths
        : allocateWidths(analysis.width, [1, 1, 1, 1]);
      const internalBands = Diagnostics.detectInternalUniformBands(analysisImageData, panelWidths);
      const output = getResolvedOutputSize();

      if (state.mode === 'single') {
        const budgetIssue = canvasBudgetIssue(output.panelWidth, output.height, 'export');
        items.push(diagnosticItem('ok', `出力は ${output.width} × ${output.height}、各画像は ${output.panelWidth} × ${output.height} です。`));
        if (output.width % 4 !== 0) items.push(diagnosticItem('error', '全体幅が4で割り切れません。'));
        const scale = Math.max(output.width / state.crop.w, output.height / state.crop.h);
        if (scale > 1.05) items.push(diagnosticItem('warn', `元の使用範囲から約${scale.toFixed(2)}倍に拡大して書き出します。細部が甘くなる可能性があります。`));
        else items.push(diagnosticItem('ok', '大きなアップスケールは発生しません。'));
        if (output.panelWidth * output.height > 35_000_000 || output.height > 10_000) {
          items.push(diagnosticItem('warn', '各パネルが非常に大きいため、スマホでは書き出し時にメモリー不足になる可能性があります。'));
        }
        if (budgetIssue) items.push(diagnosticItem('error', `この寸法では書き出せません。${budgetIssue}`));
      } else {
        const sameDimensions = state.four.every((item) => item.width === state.four[0].width && item.height === state.four[0].height);
        const budgetIssue = canvasBudgetIssue(output.width, output.height, 'export-joined');
        items.push(diagnosticItem(sameDimensions ? 'ok' : 'warn', sameDimensions ? '4枚の寸法と縦横比は一致しています。' : '4枚の寸法が一致しません。結合時は高さをそろえて縮小します。'));
        items.push(diagnosticItem('ok', `結合画像は約 ${output.width} × ${output.height} になります。`));
        if (budgetIssue) items.push(diagnosticItem('warn', `結合画像は安全上限を超えるため省略されます。元の4枚は保存できます。${budgetIssue}`));
      }

      if (bands.length === 0) {
        items.push(diagnosticItem('ok', '端部に明確な黒帯・白帯・単色帯は検出されませんでした。'));
      } else {
        const edgeNames = { left: '左端', right: '右端', top: '上端', bottom: '下端' };
        for (const band of bands) {
          const scale = (band.edge === 'left' || band.edge === 'right') ? output.width / analysis.width : output.height / analysis.height;
          items.push(diagnosticItem('warn', `${edgeNames[band.edge]}に約${Math.max(1, Math.round(band.count * scale))}pxの${band.kind}に近い均一な帯があります。意図した余白か確認してください。`));
        }
      }

      for (let boundary = 0; boundary < 3; boundary += 1) {
        const matches = internalBands.filter((band) => band.boundary === boundary);
        if (!matches.length) continue;
        const descriptions = matches.map((band) => {
          const panelIndex = band.side === 'left' ? boundary : boundary + 1;
          const outputPanelWidth = output.widths ? output.widths[panelIndex] : output.panelWidth;
          const scale = outputPanelWidth / Math.max(1, panelWidths[panelIndex]);
          const sideLabel = band.side === 'left' ? `${boundary + 1}枚目側` : `${boundary + 2}枚目側`;
          return `${sideLabel}に約${Math.max(1, Math.round(band.count * scale))}pxの${band.kind}に近い均一な帯`;
        });
        items.push(diagnosticItem('warn', `${boundary + 1}｜${boundary + 2}の境界で、${descriptions.join('、')}があります。意図した余白か確認してください。`));
      }

      const seamScores = Diagnostics.seamDetailScores(analysisImageData, panelWidths);
      seamScores.forEach((score, index) => {
        if (score.p90 > 0.36 && score.average > 0.07) {
          items.push(diagnosticItem('warn', `${index + 1}｜${index + 2}の境界付近に強い輪郭が多くあります。目・口・指・装飾が切れていないか境界表示で確認してください。`));
        }
      });
      items.push(diagnosticItem('ok', 'X風表示は端末やX側の更新で変わるため、最終投稿画面でも並び順を確認してください。'));

      releaseCanvas(analysis);
      analysis = null;
      if (generation !== state.diagnosticsGeneration || revision !== state.projectRevision || state.step !== 3) return;
      els.diagnosticsList.innerHTML = items.join('');
      const warningCount = items.filter((item) => item.includes('diagnostic warn')).length;
      const errorCount = items.filter((item) => item.includes('diagnostic error')).length;
      state.diagnosticsDirty = false;
      state.diagnosticsHasCompleted = true;
      if (errorCount) {
        setDiagnosticsState('failed', {
          summary: `検査結果：エラー ${errorCount}件、警告 ${warningCount}件。詳細を確認してください。`,
          warningCount,
          errorCount
        });
        els.diagnosticsDetails.open = true;
      } else if (warningCount) {
        setDiagnosticsState('warning', {
          summary: `検査結果：警告 ${warningCount}件。保存は続行できます。詳細を確認してください。`,
          warningCount,
          errorCount: 0
        });
        els.diagnosticsDetails.open = true;
      } else {
        setDiagnosticsState('passed', {
          summary: '検査結果：問題は見つかりませんでした。',
          warningCount: 0,
          errorCount: 0
        });
        els.diagnosticsDetails.open = false;
      }
    } catch (error) {
      if (generation !== state.diagnosticsGeneration || revision !== state.projectRevision || state.step !== 3) return;
      console.error(error);
      state.diagnosticsDirty = true;
      state.diagnosticsHasCompleted = true;
      els.diagnosticsList.innerHTML = diagnosticItem('error', '自動検査を完了できませんでした。画像は手動で確認し、必要なら再検査してください。');
      els.diagnosticsDetails.open = true;
      setDiagnosticsState('failed', {
        summary: '自動検査を完了できませんでした。再検査できます。',
        warningCount: 0,
        errorCount: 1
      });
    } finally {
      if (analysis) releaseCanvas(analysis);
      if (generation === state.diagnosticsGeneration) {
        $('.diagnostics-card').setAttribute('aria-busy', 'false');
        els.diagnosticsOverview.setAttribute('aria-busy', 'false');
        els.rerunDiagnosticsButton.disabled = false;
        updateNavigation();
      }
    }
  }

  function prepareStep2() {
    els.singleEditor.hidden = state.mode !== 'single';
    els.fourEditor.hidden = state.mode !== 'four';
    if (state.mode === 'single') {
      els.step2Description.textContent = '画像をドラッグ・ピンチして、4分割される位置を決めます。';
      els.presetSelect.value = state.preset;
      els.customSizeFields.hidden = state.preset !== 'custom';
      updateCropInfo();
      updateZoomControls();
      requestAnimationFrame(resizeAndRenderEditor);
    } else if (state.mode === 'four') {
      els.step2Description.textContent = '左から右への順番を整え、結合状態を確認します。';
      renderOrderList();
      renderStitchPreview();
    }
  }

  function prepareStep3() {
    renderPreviewTab(state.activePreviewTab);
    if (state.diagnosticsDirty) runDiagnostics();
  }

  function metadataLabels(asset) {
    if (!asset || !asset.metadata) return [];
    const labels = [];
    if (asset.metadata.gps) labels.push('GPS位置情報');
    if (asset.metadata.exif) labels.push('EXIF');
    if (asset.metadata.xmp) labels.push('XMP');
    if (asset.metadata.icc) labels.push('ICCプロファイル');
    return labels;
  }

  function metadataSafetyMessage(budgetIssue = '') {
    const messages = [];
    if (budgetIssue) messages.push(state.mode === 'four' ? `結合画像は省略されます。${budgetIssue}` : budgetIssue);
    if (state.mode === 'single' && state.single) {
      const labels = metadataLabels(state.single);
      if (labels.length || state.single.orientation !== 1) {
        messages.push(`元画像で${labels.length ? labels.join('・') : '向き情報'}を検出しました。分割画像は向きを画素へ反映して再エンコードし、元のGPS・EXIF・XMP・ICCはコピーしません。色はブラウザのCanvas色管理に従います。`);
      }
    } else if (state.mode === 'four') {
      const labels = Array.from(new Set(state.four.flatMap(metadataLabels)));
      const detected = labels.length ? `検出：${labels.join('・')}。` : '';
      messages.push(`4枚の個別画像は元データをそのまま保存するため、メタデータも保持されます。${detected}結合画像へ元のGPS・EXIF・XMP・ICCはコピーしません。`);
    }
    return messages.join(' ');
  }

  function updateExportSummary() {
    const output = getResolvedOutputSize();
    const format = els.formatSelect.value;
    const extension = extensionForType(format);
    const qualityText = format === 'image/jpeg' ? `品質${els.qualityRange.value}` : '可逆圧縮';
    if (state.mode === 'single') {
      const budgetIssue = canvasBudgetIssue(output.panelWidth, output.height, 'export');
      els.exportDescription.textContent = '4枚を順番付きで生成します。画像内には隙間・角丸・番号を追加しません。';
      els.exportSettingsSummary.textContent = `${extension.toUpperCase()}・${qualityText}・各 ${output.panelWidth} × ${output.height}`;
      els.exportSummary.innerHTML = [
        ['全体', `${output.width} × ${output.height}`],
        ['各画像', `${output.panelWidth} × ${output.height} × 4`],
        ['安全確認', budgetIssue ? `書き出し不可：${budgetIssue}` : '安全上限内'],
        ['形式', extension.toUpperCase()],
        ['処理', '端末内のみ']
      ].map(([label, value]) => `<div class="summary-row"><span>${label}</span><strong>${value}</strong></div>`).join('');
      setAlert(els.exportSafetyAlert, metadataSafetyMessage(budgetIssue ? `安全上限：${budgetIssue}` : ''));
    } else {
      const budgetIssue = canvasBudgetIssue(output.width, output.height, 'export-joined');
      els.exportDescription.textContent = '4枚は元データのまま現在の順番で共有・ZIP化し、レタッチ用の結合画像も生成します。';
      els.exportSettingsSummary.textContent = `${extension.toUpperCase()}・${qualityText}・各画像は元データ`;
      els.exportSummary.innerHTML = [
        ['4枚', '再圧縮せず順番だけ整理'],
        ['結合画像', budgetIssue ? `省略：${budgetIssue}` : `${output.width} × ${output.height}`],
        ['結合形式', extension.toUpperCase()],
        ['処理', '端末内のみ']
      ].map(([label, value]) => `<div class="summary-row"><span>${label}</span><strong>${value}</strong></div>`).join('');
      setAlert(els.exportSafetyAlert, metadataSafetyMessage(budgetIssue ? `安全上限：${budgetIssue}` : ''));
    }
    els.qualityField.hidden = format !== 'image/jpeg';
  }

  function updateNavigation() {
    const hasProject = Boolean(state.mode);
    const busy = Boolean(state.activeExport || state.activeZip || state.activeDirectorySave || state.activeShare);
    const initialDiagnosticsRunning = state.diagnosticsStatus === 'running' && !state.diagnosticsHasCompleted;
    const stepNames = ['画像', '調整', '確認', '保存'];

    els.formatSelect.disabled = busy;
    els.qualityRange.disabled = busy;
    [
      els.androidDownloadButton,
      els.startAndroidDownloadsButton,
      els.directorySaveButton,
      els.retryDirectorySaveButton,
      els.shareButton,
      els.optionalShareButton,
      els.openShareSheetButton,
      els.photoFallbackButton,
      els.zipButton,
      els.joinedDownloadButton
    ].forEach((button) => { button.disabled = busy; });

    els.backButton.disabled = state.step === 1 || busy;
    if (state.step === 1) {
      els.nextButton.disabled = !hasProject || state.loadPending || busy;
      els.nextButton.textContent = '調整へ';
      els.nextButton.hidden = false;
    } else if (state.step === 2) {
      const invalidCustomDraft = state.mode === 'single' && state.preset === 'custom' && !customDraftIsValid();
      els.nextButton.disabled = !hasProject || invalidCustomDraft || busy;
      els.nextButton.textContent = '確認へ';
      els.nextButton.hidden = false;
    } else if (state.step === 3) {
      els.nextButton.disabled = !hasProject || busy || initialDiagnosticsRunning;
      els.nextButton.textContent = initialDiagnosticsRunning ? '検査中…' : '保存へ';
      els.nextButton.hidden = false;
    } else {
      els.nextButton.hidden = false;
      if (busy) {
        els.nextButton.disabled = true;
        els.nextButton.textContent = state.activeDirectorySave ? '保存中…' : '書き出し中…';
      } else if (!state.generated || state.exportStale) {
        const budgetIssue = hasProject && state.mode === 'single'
          ? canvasBudgetIssue(getResolvedOutputSize().panelWidth, getResolvedOutputSize().height, 'export')
          : '';
        els.nextButton.disabled = !hasProject || Boolean(budgetIssue);
        els.nextButton.textContent = state.exportStale ? '再書き出し' : '4枚を書き出す';
      } else if (savePlatform === 'android') {
        els.nextButton.disabled = false;
        els.nextButton.textContent = state.androidDownloadAttempts > 0 ? '4枚を再ダウンロード' : '4枚をダウンロード';
      } else if (savePlatform === 'ios') {
        els.nextButton.disabled = false;
        els.nextButton.textContent = '写真アプリに保存';
      } else {
        els.nextButton.disabled = false;
        els.nextButton.textContent = 'ZIPで保存';
      }
    }
    // Before an image exists both actions are inert and compete with the two
    // meaningful selection choices. Reveal the dock once there is a next step.
    els.bottomNav.hidden = state.step === 1 && !hasProject;
    els.nextButton.setAttribute('aria-busy', String(busy || initialDiagnosticsRunning));
    els.bottomNav.style.gridTemplateColumns = state.step === 4 ? 'minmax(100px,.7fr) minmax(150px,1.3fr)' : 'minmax(100px,.7fr) minmax(150px,1.3fr)';

    els.mobileStepCount.textContent = `${state.step} / 4`;
    els.mobileStepName.textContent = stepNames[state.step - 1];
    els.mobileStepBar.style.width = `${state.step * 25}%`;
    els.mobileCompletedList.innerHTML = '';
    for (let value = 1; value <= state.maxReachedStep; value += 1) {
      if (value === state.step) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.dataset.mobileStepTarget = String(value);
      button.textContent = `${value}. ${stepNames[value - 1]}へ戻る`;
      button.disabled = busy;
      els.mobileCompletedList.append(button);
    }
    els.mobileCompletedSteps.hidden = els.mobileCompletedList.children.length === 0;

    $$('[data-step-indicator]').forEach((indicator) => {
      const value = Number(indicator.dataset.stepIndicator);
      const button = $('button[data-step-target]', indicator);
      indicator.classList.toggle('active', value === state.step);
      indicator.classList.toggle('done', value < state.step && value <= state.maxReachedStep);
      indicator.classList.toggle('reached', value <= state.maxReachedStep);
      button.disabled = busy || value > state.maxReachedStep || value === state.step;
      if (value === state.step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
      if (value > state.maxReachedStep) button.setAttribute('aria-label', `${stepNames[value - 1]}、未到達`);
      else button.removeAttribute('aria-label');
    });
    syncUpdateControl();
    requestAnimationFrame(updateActionDockMetrics);
  }

  function updateActionDockMetrics() {
    if (!els.bottomNav) return;
    const height = Math.ceil(els.bottomNav.getBoundingClientRect().height);
    if (height > 0) document.documentElement.style.setProperty('--action-dock-height', `${height}px`);
  }

  function setupActionDockMetrics() {
    updateActionDockMetrics();
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(updateActionDockMetrics);
      observer.observe(els.bottomNav);
      state.actionDockResizeObserver = observer;
    }
  }

  function canAdvanceFromCurrentStep() {
    if (!state.mode || state.loadPending || state.activeExport || state.activeZip || state.activeDirectorySave || state.activeShare) return false;
    if (state.step === 2 && state.mode === 'single' && state.preset === 'custom' && !customDraftIsValid()) return false;
    if (state.step === 3 && state.diagnosticsStatus === 'running' && !state.diagnosticsHasCompleted) return false;
    return state.step < 4;
  }

  function historyStateForStep(step) {
    return { ...(history.state || {}), xPanorama: true, xPanoramaStep: step };
  }

  function initializeStepHistory() {
    if (!window.history || typeof history.replaceState !== 'function') return;
    try {
      if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
      history.replaceState(historyStateForStep(state.step), '', location.href);
      state.navigationHistoryReady = true;
    } catch (error) {
      console.warn('Step history:', error);
      state.navigationHistoryReady = false;
    }
  }

  function pushStepHistory(step) {
    if (!state.navigationHistoryReady || !window.history || typeof history.pushState !== 'function') return;
    try {
      history.pushState(historyStateForStep(step), '', location.href);
    } catch (error) {
      console.warn('Step history:', error);
    }
  }

  function replaceStepHistory(step) {
    if (!state.navigationHistoryReady || !window.history || typeof history.replaceState !== 'function') return;
    try {
      history.replaceState(historyStateForStep(step), '', location.href);
    } catch (error) {
      console.warn('Step history:', error);
    }
  }

  function navigateToStep(step, { focusHeading = true } = {}) {
    showStep(step, { userInitiated: true, focusHeading, historyAction: 'push', restoreScroll: true });
  }

  function navigateBackInStepHistory() {
    if (state.step <= 1 || activeJobInProgress()) return;
    const current = history.state;
    if (state.navigationHistoryReady && current && current.xPanorama === true && Number(current.xPanoramaStep) === state.step) {
      history.back();
      return;
    }
    showStep(state.step - 1, { userInitiated: true, focusHeading: true, historyAction: 'replace', restoreScroll: true });
  }

  function cancelWorkForHistoryNavigation() {
    const exportCancelled = cancelActiveExport();
    const zipCancelled = cancelActiveZip();
    const directoryCancelled = cancelActiveDirectorySave();
    if (exportCancelled || zipCancelled || directoryCancelled) {
      setExportState('処理を中止して前の工程へ戻りました。');
      els.progressArea.hidden = true;
      updateNavigation();
    }
  }

  function handleStepHistoryPop(event) {
    const requestedStep = Number(event.state && event.state.xPanoramaStep);
    if (!event.state || event.state.xPanorama !== true || !Number.isInteger(requestedStep)) return;
    cancelWorkForHistoryNavigation();
    const targetStep = clamp(requestedStep, 1, Math.max(1, state.maxReachedStep));
    if (targetStep !== requestedStep) replaceStepHistory(targetStep);
    showStep(targetStep, { focusHeading: true, historyAction: 'none', restoreScroll: true });
  }

  function handleBottomNext() {
    if (state.step !== 4) {
      navigateToStep(state.step + 1);
      return;
    }
    if (state.activeExport || state.activeZip || state.activeDirectorySave || state.activeShare) return;
    if (!state.generated || state.exportStale) {
      generateExport();
    } else if (savePlatform === 'android') {
      openAndroidDownloadDialog();
    } else if (savePlatform === 'ios') {
      openPhotoSaveDialog(false);
    } else {
      saveZip();
    }
  }

  function showStep(step, {
    userInitiated = false,
    focusHeading = false,
    historyAction = 'none',
    restoreScroll = false
  } = {}) {
    if (step < 1 || step > 4) return;
    if (userInitiated) {
      if (state.activeExport || state.activeZip || state.activeDirectorySave || state.activeShare) return;
      if (step > state.maxReachedStep) {
        if (step !== state.step + 1 || !canAdvanceFromCurrentStep()) {
          if (state.step === 2 && state.mode === 'single' && state.preset === 'custom' && !customDraftIsValid()) {
            updateCustomDraftValidity();
            const invalid = [els.customWidth, els.customHeight].find((input) => input.getAttribute('aria-invalid') === 'true');
            if (invalid) invalid.focus();
          }
          return;
        }
        state.maxReachedStep = step;
      }
    } else if (step > state.maxReachedStep) {
      state.maxReachedStep = step;
    }
    const previousStep = state.step;
    state.stepScrollPositions[previousStep] = Math.max(0, window.scrollY || window.pageYOffset || 0);
    if (previousStep === 1 && step !== 1) releaseSelectionPreview();
    if (previousStep === 3 && step !== 3) {
      releaseAllStep3Previews();
      state.diagnosticsGeneration += 1;
      if (state.diagnosticsStatus === 'running') markDiagnosticsDirty();
    }
    state.step = step;
    $$('.step-panel').forEach((panel) => panel.classList.toggle('active', Number(panel.dataset.step) === step));
    if (step === 1) {
      renderSelectionZone();
      ensureSelectionPreview();
    }
    if (step === 2) prepareStep2();
    if (step === 3) prepareStep3();
    if (step === 4) updateExportSummary();
    if (historyAction === 'push' && step !== previousStep) pushStepHistory(step);
    else if (historyAction === 'replace') replaceStepHistory(step);
    updateNavigation();
    const targetScroll = restoreScroll ? (state.stepScrollPositions[step] || 0) : 0;
    if (focusHeading) {
      const heading = $(`.step-panel[data-step="${step}"] h2`);
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
    // Some mobile engines still scroll a programmatically focused heading into
    // view even when preventScroll is requested. Restore the saved reading
    // position after focus so browser/back navigation does not jump to the top.
    window.scrollTo({ top: targetScroll, behavior: 'auto' });
    if (restoreScroll) {
      requestAnimationFrame(() => {
        if (state.step === step) window.scrollTo({ top: targetScroll, behavior: 'auto' });
      });
    }
  }

  function setProgress(value, text, { max = 100, showPercent = Number.isFinite(value) && max === 100 } = {}) {
    els.progressArea.hidden = false;
    els.progressText.textContent = text;
    if (Number.isFinite(value)) {
      const resolvedMax = Math.max(1, Number(max) || 100);
      const resolvedValue = clamp(Number(value), 0, resolvedMax);
      els.exportProgress.max = resolvedMax;
      els.exportProgress.value = resolvedValue;
      if (showPercent) {
        els.progressPercent.hidden = false;
        els.progressPercent.textContent = `${Math.round((resolvedValue / resolvedMax) * 100)}%`;
      } else {
        els.progressPercent.hidden = true;
        els.progressPercent.textContent = '';
      }
    } else {
      els.exportProgress.removeAttribute('value');
      els.progressPercent.hidden = true;
      els.progressPercent.textContent = '';
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('画像のエンコードに失敗しました。')), type, quality);
    });
  }

  function renderSettingsFor(format) {
    return Core.renderSettingsFor(format);
  }

  function prepareRenderContext(canvas, format) {
    return Core.prepareRenderContext(canvas, format);
  }

  function estimateEncodedBlobBytes(width, height, format) {
    const pixels = Math.max(1, Number(width) || 1) * Math.max(1, Number(height) || 1);
    // Lossless output can approach the RGBA source size for noisy images.
    // Include modest container overhead instead of assuming photographic
    // compression, so the raised 8K limit remains a meaningful safety check.
    const factor = format === 'image/png' || format === 'image/webp' ? 4.1 : 1.2;
    return Math.ceil(pixels * factor);
  }

  function estimateExportOperation(snapshot, output, format, { joined = false } = {}) {
    if (!snapshot || !output) return estimateOperationPeak();
    if (snapshot.mode === 'single') {
      return estimateOperationPeak({
        retainedImages: currentRetainedAssets(),
        // The retained preview already accounts for the proxy. Full export
        // decoding adds the raw bitmap, not a second preview bitmap.
        decodingImage: { ...state.single, includeRaw: true, includePreview: false },
        outputCanvases: [{ width: output.panelWidth, height: output.height }],
        generatedBlobs: Array.from({ length: 4 }, () => ({
          estimatedBytes: estimateEncodedBlobBytes(output.panelWidth, output.height, format)
        })),
        budgetBytes: LIMITS.exportEstimatedPeakBytes
      });
    }
    const largest = snapshot.items.reduce((candidate, item) => {
      if (!candidate || item.width * item.height > candidate.width * candidate.height) return item;
      return candidate;
    }, null);
    return estimateOperationPeak({
      retainedImages: currentRetainedAssets(),
      decodingImage: largest ? { ...largest, includeRaw: true, includePreview: false } : null,
      outputCanvases: joined ? [{ width: output.width, height: output.height }] : [],
      stagingCanvases: joined ? [{ width: output.width, height: output.height }] : [],
      generatedBlobs: snapshot.items.map((item) => item.file).concat(joined ? [{
        estimatedBytes: estimateEncodedBlobBytes(output.width, output.height, format)
      }] : []),
      budgetBytes: LIMITS.exportEstimatedPeakBytes
    });
  }

  async function splitOnMainThread(format, quality, output, snapshot, job) {
    assertCanvasBudget(output.panelWidth, output.height, '分割画像');
    assertOperationMemory(estimateExportOperation(snapshot, output, format), '分割画像の書き出し');
    const decoded = await decodeFullDrawable(snapshot.file);
    const results = [];
    let canvas = null;
    try {
      canvas = document.createElement('canvas');
      canvas.width = output.panelWidth;
      canvas.height = output.height;
      const context = prepareRenderContext(canvas, format);
      if (!context) throw appError('分割画像用キャンバスを作成できませんでした。', 'RESOURCE_LIMIT');
      for (let index = 0; index < 4; index += 1) {
        assertExportJobCurrent(job);
        setProgress(null, `${index + 1} / 4を書き出しています`);
        if (index > 0) Core.resetRenderContext(canvas, context, format);
        const sx = snapshot.crop.x + snapshot.crop.w * index / 4;
        context.drawImage(decoded.drawable, sx, snapshot.crop.y, snapshot.crop.w / 4, snapshot.crop.h, 0, 0, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas, format, quality);
        assertExportJobCurrent(job);
        results.push(blob);
        setProgress(index + 1, `${index + 1} / 4を書き出しました`, { max: 4, showPercent: false });
        await nextFrame();
      }
      return results;
    } finally {
      releaseCanvas(canvas);
      releaseDecoded(decoded);
    }
  }

  async function stitchOnMainThread(format, quality, output, snapshot, job) {
    assertCanvasBudget(output.width, output.height, '結合画像', 'export-joined');
    assertOperationMemory(estimateExportOperation(snapshot, output, format, { joined: true }), '結合画像の書き出し');
    const canvas = document.createElement('canvas');
    canvas.width = output.width;
    canvas.height = output.height;
    try {
      const context = prepareRenderContext(canvas, format);
      if (!context) throw appError('結合画像用キャンバスを作成できませんでした。', 'RESOURCE_LIMIT');
      let x = 0;
      for (let index = 0; index < snapshot.items.length; index += 1) {
        assertExportJobCurrent(job);
        const item = snapshot.items[index];
        const decoded = await decodeFullDrawable(item.file);
        const width = output.widths[index];
        try {
          assertExportJobCurrent(job);
          context.drawImage(decoded.drawable, 0, 0, decoded.width, decoded.height, x, 0, width, output.height);
        } finally {
          releaseDecoded(decoded);
        }
        x += width;
      }
      const blob = await canvasToBlob(canvas, format, quality);
      assertExportJobCurrent(job);
      return blob;
    } finally {
      releaseCanvas(canvas);
    }
  }

  function runWorkerJob(message, job) {
    return new Promise((resolve, reject) => {
      let worker;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (worker) worker.terminate();
        if (job.worker === worker) job.worker = null;
        job.reject = null;
        callback(value);
      };
      try {
        worker = new Worker(window.__IMAGE_WORKER_URL || `image-worker.js?v=${APP_VERSION}`);
      } catch (error) {
        reject(appError(error.message || 'ワーカーを起動できませんでした。', 'WORKER_UNAVAILABLE'));
        return;
      }
      job.worker = worker;
      job.reject = (error) => finish(reject, error);
      const panels = [];
      worker.onmessage = (event) => {
        if (!exportJobIsCurrent(job)) {
          finish(reject, appError('古い書き出し処理を破棄しました。', 'CANCELLED'));
          return;
        }
        const data = event.data || {};
        if (data.type === 'progress') {
          const hasCount = Number.isFinite(data.current) && Number.isFinite(data.total);
          setProgress(
            hasCount ? data.current : (Number.isFinite(data.percent) ? data.percent : null),
            data.text || '処理しています',
            { max: hasCount ? data.total : 100, showPercent: Boolean(data.showPercent) }
          );
        }
        else if (data.type === 'panel') {
          if (message.type !== 'split' || !Number.isInteger(data.index) || data.index < 0 || data.index > 3 || !(data.blob instanceof Blob)) {
            finish(reject, appError('画像ワーカーから不正なpanel応答を受信しました。', 'WORKER_PROTOCOL'));
            return;
          }
          if (panels[data.index] instanceof Blob) {
            finish(reject, appError(`画像ワーカーからpanel ${data.index}が重複して返されました。`, 'WORKER_PROTOCOL'));
            return;
          }
          if (normalizeImageMime(data.blob.type) !== message.format) {
            finish(reject, appError(`画像ワーカーのpanel ${data.index}の形式が一致しません。`, 'WORKER_PROTOCOL'));
            return;
          }
          panels[data.index] = data.blob;
        } else if (data.type === 'joined') {
          if (message.type !== 'stitch' || !(data.blob instanceof Blob) || normalizeImageMime(data.blob.type) !== message.format) {
            finish(reject, appError('画像ワーカーから不正なjoined応答を受信しました。', 'WORKER_PROTOCOL'));
            return;
          }
          finish(resolve, data.blob);
        } else if (data.type === 'done') {
          const missing = [0, 1, 2, 3].filter((index) => !(panels[index] instanceof Blob));
          if (message.type !== 'split' || missing.length) {
            finish(reject, appError(`画像ワーカーの4枚出力が欠落しています${missing.length ? `（panel ${missing.join(', ')}）` : ''}。`, 'WORKER_PROTOCOL'));
            return;
          }
          finish(resolve, panels);
        } else if (data.type === 'error') {
          finish(reject, appError(data.message || 'ワーカー処理に失敗しました。', data.code || 'PROCESSING_ERROR'));
        } else {
          finish(reject, appError(`画像ワーカーから不明な応答（${String(data.type || 'typeなし')}）を受信しました。`, 'WORKER_PROTOCOL'));
        }
      };
      worker.onerror = (event) => finish(reject, appError(event.message || 'ワーカー処理が停止しました。', 'WORKER_RUNTIME'));
      worker.onmessageerror = () => finish(reject, appError('画像ワーカーの応答を読み取れませんでした。', 'WORKER_PROTOCOL'));
      try {
        worker.postMessage(message);
      } catch (error) {
        finish(reject, appError(error.message || 'ワーカーへ処理を渡せませんでした。', 'WORKER_UNAVAILABLE'));
      }
    });
  }

  function canFallbackFromWorker(error) {
    return error && ['UNSUPPORTED', 'WORKER_UNAVAILABLE'].includes(error.code);
  }

  function makeExportSnapshot(format, quality, output) {
    if (state.mode === 'single') {
      return {
        mode: 'single',
        file: state.single.file,
        name: state.single.name,
        crop: { ...state.crop },
        format,
        quality,
        output: { ...output }
      };
    }
    return {
      mode: 'four',
      items: state.four.map((item) => ({
        file: item.file,
        name: item.name,
        url: item.url,
        width: item.width,
        height: item.height,
        detectedType: item.detectedType,
        extension: item.extension,
        metadata: { ...item.metadata }
      })),
      format,
      quality,
      output: { ...output, widths: output.widths.slice() }
    };
  }

  async function generateExport() {
    if (!state.mode) return;
    cancelActiveExport();
    clearGenerated();
    state.exportStale = false;
    setExportState('生成中：4枚を書き出しています。');
    setAlert(els.exportError, '');
    const job = {
      id: state.exportGeneration + 1,
      revision: state.projectRevision,
      cancelled: false,
      worker: null,
      reject: null
    };
    state.exportGeneration = job.id;
    state.activeExport = job;
    els.cancelExportButton.hidden = false;
    els.formatSelect.disabled = true;
    els.qualityRange.disabled = true;
    updateNavigation();
    els.exportResults.hidden = true;
    const format = els.formatSelect.value;
    const quality = Number(els.qualityRange.value) / 100;
    const extension = extensionForType(format);
    const output = getResolvedOutputSize();
    const snapshot = makeExportSnapshot(format, quality, output);
    let generatedFiles = null;
    let generatedFilesAdopted = false;

    try {
      if (snapshot.mode === 'single') {
        assertCanvasBudget(output.panelWidth, output.height, '分割画像');
        assertOperationMemory(estimateExportOperation(snapshot, output, format), '分割画像の書き出し');
        let blobs;
        try {
          blobs = await runWorkerJob({
            type: 'split',
            file: snapshot.file,
            crop: snapshot.crop,
            output: { width: output.width, height: output.height, panelWidth: output.panelWidth },
            format,
            quality,
            render: renderSettingsFor(format),
            limits: canvasLimits('export-panel')
          }, job);
        } catch (workerError) {
          console.warn('Worker fallback:', workerError);
          assertExportJobCurrent(job);
          if (!canFallbackFromWorker(workerError)) throw workerError;
          blobs = await splitOnMainThread(format, quality, output, snapshot, job);
        }
        assertExportJobCurrent(job);
        for (let index = 0; index < blobs.length; index += 1) {
          await verifyEncodedBlob(blobs[index], format, output.panelWidth, output.height, `panel ${index}`);
          assertExportJobCurrent(job);
        }
        const base = sanitizeBaseName(snapshot.name);
        const files = [];
        generatedFiles = files;
        blobs.forEach((blob, index) => {
          const name = `${base}_X-panorama_${String(index + 1).padStart(2, '0')}.${extension}`;
          files.push({ name, blob, url: URL.createObjectURL(blob) });
        });
        state.generated = { files, joined: null, zipName: `${base}_X-panorama.zip` };
        generatedFilesAdopted = true;
      } else {
        setProgress(null, '4枚の順番を整理しています');
        const base = sanitizeBaseName(snapshot.items[0].name).replace(/[_-]?0?1$/i, '') || 'panorama';
        const files = [];
        generatedFiles = files;
        snapshot.items.forEach((item, index) => {
          const name = `${base}_X-panorama_${String(index + 1).padStart(2, '0')}.${item.extension}`;
          const declaredType = normalizeImageMime(item.file.type);
          if (declaredType === item.detectedType) {
            files.push({ name, blob: item.file, url: item.url, borrowedUrl: true });
            return;
          }
          const typedBlob = item.file.slice(0, item.file.size, item.detectedType);
          files.push({ name, blob: typedBlob, url: URL.createObjectURL(typedBlob), borrowedUrl: false });
        });
        const budgetIssue = canvasBudgetIssue(output.width, output.height, 'export-joined');
        const operationIssue = operationMemoryMessage(
          estimateExportOperation(snapshot, output, format, { joined: true }),
          '結合画像の書き出し'
        );
        let joinedBlob = null;
        if (!budgetIssue && !operationIssue) {
          try {
            joinedBlob = await runWorkerJob({
              type: 'stitch',
              files: snapshot.items.map((item) => item.file),
              output,
              format,
              quality,
              render: renderSettingsFor(format),
              limits: canvasLimits('export-joined')
            }, job);
          } catch (workerError) {
            console.warn('Worker fallback:', workerError);
            assertExportJobCurrent(job);
            if (!canFallbackFromWorker(workerError)) throw workerError;
            setProgress(null, '結合画像を書き出しています');
            joinedBlob = await stitchOnMainThread(format, quality, output, snapshot, job);
          }
        } else {
          const reason = budgetIssue || operationIssue;
          setAlert(els.exportError, `結合画像（${output.width} × ${output.height}）は安全上限を超えるため省略しました。元の4枚は保存・共有できます。${reason}`);
        }
        assertExportJobCurrent(job);
        if (joinedBlob) await verifyEncodedBlob(joinedBlob, format, output.width, output.height, 'joined出力');
        assertExportJobCurrent(job);
        const joinedName = `${base}_joined.${extension}`;
        state.generated = {
          files,
          joined: joinedBlob ? { name: joinedName, blob: joinedBlob, url: URL.createObjectURL(joinedBlob) } : null,
          zipName: `${base}_X-panorama.zip`
        };
        generatedFilesAdopted = true;
        setProgress(100, '準備が完了しました');
      }
      renderExportResults();
    } catch (error) {
      if (!generatedFilesAdopted) releaseGeneratedFileUrls(generatedFiles);
      if (error.code !== 'CANCELLED') {
        console.error(error);
        setAlert(els.exportError, error.message || '書き出しに失敗しました。');
        els.progressArea.hidden = true;
        setExportState('失敗：書き出しを完了できませんでした。');
      } else {
        setExportState('未生成');
      }
    } finally {
      if (state.activeExport === job) {
        if (job.worker) job.worker.terminate();
        job.worker = null;
        job.reject = null;
        state.activeExport = null;
        setExportControlsIdle();
      }
    }
  }

  function generatedShareFiles(items = state.generated ? state.generated.files : []) {
    return items.map((item) => new File([item.blob], item.name, { type: item.blob.type || 'application/octet-stream' }));
  }

  function canShareFiles(files) {
    if (!navigator.share || !navigator.canShare || !files.length) return false;
    try {
      return navigator.canShare({ files });
    } catch (_) {
      return false;
    }
  }

  function setPhotoDialogView(view) {
    const fallback = view === 'fallback';
    els.shareGuideView.hidden = fallback;
    els.fallbackMethodsView.hidden = !fallback;
    if (!fallback) {
      els.photoDialogLead.textContent = isAppleMobile
        ? '共有シートから写真ライブラリへの保存操作を選びます。'
        : '共有シートから画像の保存先を選びます。';
    }
  }

  function renderFallbackImageList() {
    els.fallbackImageList.innerHTML = '';
    if (!state.generated) return;

    state.generated.files.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'fallback-image-card';

      const meta = document.createElement('div');
      meta.className = 'fallback-image-meta';
      const name = document.createElement('strong');
      name.textContent = `${index + 1}. ${item.name}`;
      const size = document.createElement('small');
      size.textContent = humanBytes(item.blob.size);
      meta.append(name, size);

      const imageWrap = document.createElement('div');
      imageWrap.className = 'fallback-image-wrap';
      const image = document.createElement('img');
      image.src = item.url;
      image.alt = `分割画像 ${index + 1}`;
      image.draggable = false;
      image.loading = 'lazy';
      imageWrap.append(image);

      const actions = document.createElement('div');
      actions.className = 'fallback-image-actions';
      const shareOne = document.createElement('button');
      shareOne.type = 'button';
      shareOne.className = 'primary';
      shareOne.textContent = 'この1枚を共有';
      shareOne.addEventListener('click', () => shareSingleGenerated(index, shareOne));

      const openImage = document.createElement('a');
      openImage.className = 'secondary-link';
      openImage.href = item.url;
      openImage.target = '_blank';
      openImage.rel = 'noopener';
      openImage.textContent = '画像だけを開く';
      actions.append(shareOne, openImage);

      const tip = document.createElement('p');
      tip.className = 'fallback-tip';
      tip.textContent = isAppleMobile
        ? 'iPhoneでは画像を長押しし、「写真に保存」を選ぶ方法も使えます。'
        : '画像を長押し、または右クリックして端末へ保存できます。';

      card.append(meta, imageWrap, actions, tip);
      els.fallbackImageList.append(card);
    });
  }

  function openPhotoSaveDialog(preferFallback = false) {
    if (!state.generated) return;
    if (!isAppleMobile) return;
    setAlert(els.exportError, '');
    const files = generatedShareFiles();
    const useFallback = preferFallback || !canShareFiles(files);
    if (useFallback) renderFallbackImageList();
    setPhotoDialogView(useFallback ? 'fallback' : 'guide');
    if (preferFallback) {
      els.photoDialogLead.textContent = '1枚ずつ共有するか、画像を長押しして写真アプリへ保存できます。';
    } else if (useFallback) {
      els.photoDialogLead.textContent = 'このブラウザでは4枚をまとめて共有できません。1枚ずつ保存してください。';
    }
    if (typeof els.photoSaveDialog.showModal !== 'function') {
      setAlert(els.exportError, 'このブラウザでは写真アプリ向けの保存案内を開けません。ZIPまたは1枚ずつの保存を使用してください。');
      els.fileSaveDetails.open = true;
      return;
    }
    state.dialogReturnFocus = document.activeElement;
    if (!els.photoSaveDialog.open) els.photoSaveDialog.showModal();
    document.body.classList.add('dialog-open');
    requestAnimationFrame(() => $('#photoDialogTitle').focus());
  }

  function closePhotoSaveDialog() {
    if (!els.photoSaveDialog.open) return;
    els.photoSaveDialog.close();
  }

  function openAndroidDownloadDialog() {
    if (!state.generated || savePlatform !== 'android' || state.activeExport || state.activeZip || state.activeDirectorySave || state.activeShare) return;
    setAlert(els.exportError, '');
    if (typeof els.androidDownloadDialog.showModal !== 'function') {
      setAlert(els.exportError, 'このブラウザでは4枚ダウンロードの事前案内を開けません。下の個別ダウンロードまたはZIP保存を使用してください。');
      els.fileSaveDetails.open = true;
      els.fileResultList.querySelector('a')?.focus({ preventScroll: true });
      return;
    }
    state.dialogReturnFocus = document.activeElement;
    if (!els.androidDownloadDialog.open) els.androidDownloadDialog.showModal();
    document.body.classList.add('dialog-open');
    requestAnimationFrame(() => els.androidDownloadDialogTitle.focus());
  }

  function closeAndroidDownloadDialog() {
    if (!els.androidDownloadDialog.open) return;
    els.androidDownloadDialog.close();
  }

  function restoreDialogFocus() {
    document.body.classList.remove('dialog-open');
    const target = state.dialogReturnFocus;
    state.dialogReturnFocus = null;
    if (!target || !target.isConnected || typeof target.focus !== 'function') return;
    const focusTarget = () => {
      if (!target.isConnected) return;
      try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
    };
    focusTarget();
    if (document.activeElement !== target) requestAnimationFrame(focusTarget);
  }

  function setButtonHierarchy(button, hierarchy) {
    button.classList.remove('primary', 'secondary', 'tertiary', 'ghost');
    button.classList.add(hierarchy);
  }

  function nameWithSuffix(name, suffix) {
    const point = name.lastIndexOf('.');
    return point > 0 ? `${name.slice(0, point)}_${suffix}${name.slice(point)}` : `${name}_${suffix}`;
  }

  async function directoryNamesWithoutConflicts(directoryHandle, originalNames) {
    for (let suffix = 1; suffix < 10_000; suffix += 1) {
      const names = suffix === 1 ? originalNames : originalNames.map((name) => nameWithSuffix(name, suffix));
      let collision = false;
      for (const name of names) {
        try {
          await directoryHandle.getFileHandle(name, { create: false });
          collision = true;
          break;
        } catch (error) {
          if (!error || error.name !== 'NotFoundError') throw error;
        }
      }
      if (!collision) return names;
    }
    throw appError('保存先に利用できる連番ファイル名が見つかりませんでした。', 'NAME_COLLISION');
  }

  function directoryPickerOptions(mode) {
    if (mode === 'mode-only') return { mode: 'readwrite' };
    if (mode === 'bare') return undefined;
    return { id: 'x-panorama-export', mode: 'readwrite', startIn: 'pictures' };
  }

  function markDirectoryPickerModeError(error, mode) {
    if (error && typeof error === 'object') {
      try { error.directoryPickerOptionMode = mode; } catch (_) { /* Host errors can be non-extensible. */ }
    }
    return error;
  }

  function requestDirectoryHandle(mode = state.directoryPickerMode) {
    const resolvedMode = ['default', 'mode-only', 'bare'].includes(mode) ? mode : 'default';
    let result;
    try {
      // Keep this call in the click handler's synchronous turn. A fallback is
      // only attempted for a synchronous TypeError, preserving activation.
      result = window.showDirectoryPicker(directoryPickerOptions(resolvedMode));
    } catch (error) {
      if (error && error.name === 'TypeError' && resolvedMode === 'default') {
        return requestDirectoryHandle('mode-only');
      }
      if (error && error.name === 'TypeError' && resolvedMode === 'mode-only') {
        return requestDirectoryHandle('bare');
      }
      throw markDirectoryPickerModeError(error, resolvedMode);
    }
    return Promise.resolve(result).catch((error) => {
      // An asynchronous TypeError is deliberately not retried. The next
      // explicit click will use the simpler mode selected in the catch path.
      throw markDirectoryPickerModeError(error, resolvedMode);
    });
  }

  async function saveGeneratedToDirectory({ retry = false } = {}) {
    if (!state.generated || !directorySaveSupported() || state.activeExport || state.activeZip || state.activeDirectorySave) return;
    const job = {
      id: state.directorySaveGeneration + 1,
      revision: state.projectRevision,
      generated: state.generated,
      cancelled: false,
      handle: null,
      names: null,
      verified: new Set()
    };
    state.directorySaveGeneration = job.id;
    state.activeDirectorySave = job;
    els.directorySaveButton.disabled = true;
    els.retryDirectorySaveButton.disabled = true;
    updateNavigation();
    setAlert(els.exportError, '');
    try {
      if (retry && state.directorySaveSession && state.directorySaveSession.generated === state.generated) {
        job.handle = state.directorySaveSession.handle;
        job.names = state.directorySaveSession.names.slice();
        job.verified = new Set(state.directorySaveSession.verified);
      } else {
        // This is deliberately the first asynchronous API after the click: it must retain user activation.
        job.handle = await requestDirectoryHandle();
        if (job.cancelled) return;
        job.names = await directoryNamesWithoutConflicts(job.handle, job.generated.files.map((item) => item.name));
      }
      const failures = [];
      for (let index = 0; index < job.generated.files.length; index += 1) {
        if (job.cancelled) return;
        if (job.verified.has(index)) continue;
        const item = job.generated.files[index];
        setExportState(`保存中 ${job.verified.size} / 4`);
        setProgress(job.verified.size, `保存中 ${job.verified.size} / 4`, { max: 4, showPercent: false });
        try {
          // The API has no exclusive create. We preflight every candidate above, then avoid overwrite by naming all four together.
          const fileHandle = await job.handle.getFileHandle(job.names[index], { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(item.blob);
          await writable.close();
          const written = await fileHandle.getFile();
          if (written.size !== item.blob.size) throw appError(`${job.names[index]} のサイズ確認に失敗しました。`, 'VERIFY_FAILED');
          job.verified.add(index);
        } catch (error) {
          failures.push({ index, error });
        }
      }
      if (job.cancelled) return;
      state.directorySaveSession = { handle: job.handle, names: job.names.slice(), verified: new Set(job.verified), generated: job.generated };
      const count = job.verified.size;
      if (count === 4) {
        setProgress(4, '4 / 4枚を保存しました', { max: 4, showPercent: false });
        setExportState('保存成功：選択したフォルダに4枚を保存しました。');
        els.retryDirectorySaveButton.hidden = true;
        els.directorySaveDescription.textContent = '選択したフォルダに4枚を保存しました。写真アプリへの反映時刻は端末側により異なります。';
      } else {
        setExportState(`部分成功：${count} / 4枚を保存しました。未保存分を再試行できます。`);
        els.retryDirectorySaveButton.hidden = false;
        els.directorySaveDescription.textContent = `${count} / 4枚を選択したフォルダに保存しました。未保存分だけ再試行できます。`;
        const reason = failures[0] && failures[0].error && failures[0].error.message;
        setAlert(els.exportError, `${count} / 4枚を保存しました。${reason ? ` ${reason}` : ''} 個別保存も利用できます。`);
      }
    } catch (error) {
      if (error && error.name === 'AbortError') {
        setExportState('生成済み：保存先の選択を取り消しました。');
      } else if (error && error.name === 'TypeError' && error.directoryPickerOptionMode) {
        const failedMode = error.directoryPickerOptionMode;
        state.directoryPickerMode = failedMode === 'default'
          ? 'mode-only'
          : failedMode === 'mode-only' ? 'bare' : 'bare';
        setExportState('フォルダ保存の互換モードを選べます。もう一度押して再試行してください。');
        els.directorySaveDescription.textContent = 'このブラウザは標準オプションに対応していません。フォルダ保存をもう一度押すと簡易モードで試せます。個別保存とZIPも利用できます。';
        setAlert(els.exportError, 'フォルダ保存の互換オプションに対応していません。もう一度押すと簡易モードで試せます。');
        els.fileSaveDetails.open = true;
      } else if (error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        console.warn('Directory picker permission:', error);
        setExportState('フォルダ保存の権限を確認できませんでした。');
        setAlert(els.exportError, 'フォルダ保存は許可されませんでした。個別保存またはZIP保存を使用してください。');
        els.fileSaveDetails.open = true;
      } else {
        console.error(error);
        setExportState('失敗：フォルダへの保存を完了できませんでした。');
        setAlert(els.exportError, `${error && error.message ? error.message : 'フォルダへの保存に失敗しました。'} 個別保存を利用できます。`);
        els.fileSaveDetails.open = true;
      }
    } finally {
      if (state.activeDirectorySave === job) {
        state.activeDirectorySave = null;
        els.directorySaveButton.disabled = false;
        els.retryDirectorySaveButton.disabled = false;
        updateNavigation();
      }
    }
  }

  function renderExportResults() {
    if (!state.generated) return;

    state.androidDownloadAttempts = 0;
    const saveStrategy = resolveSaveStrategy();
    const shareFiles = generatedShareFiles();
    const supportsMultipleShare = canShareFiles(shareFiles);
    const linkLabel = savePlatform === 'ios' ? 'ファイルに保存' : 'この1枚をダウンロード';

    els.fileResultList.innerHTML = '';
    state.generated.files.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'file-result';
      row.innerHTML = `
        <span class="file-number">${index + 1}</span>
        <span class="file-meta"><strong>${escapeHtml(item.name)}</strong><small>${humanBytes(item.blob.size)}</small></span>
        <a href="${item.url}" download="${escapeHtml(item.name)}">${linkLabel}</a>`;
      $('a', row).addEventListener('click', () => { els.exportStatus.textContent = `${item.name}のダウンロードを開始しました。`; });
      els.fileResultList.append(row);
    });

    els.exportResults.dataset.saveMode = savePlatform;
    els.shareButton.disabled = false;
    els.androidDownloadCard.hidden = true;
    els.androidDownloadStatus.hidden = true;
    els.androidDownloadStatus.textContent = '';
    els.androidPermissionHelp.hidden = true;
    els.androidPermissionHelp.open = false;
    els.androidDownloadButton.textContent = '4枚をダウンロード';
    setButtonHierarchy(els.directorySaveButton, 'secondary');
    setButtonHierarchy(els.shareButton, 'secondary');
    setButtonHierarchy(els.zipButton, 'secondary');
    els.optionalShareDetails.hidden = true;
    els.optionalShareDetails.open = false;

    if (saveStrategy.primary === 'share-to-photos') {
      els.androidDownloadCard.hidden = true;
      els.directorySaveCard.hidden = true;
      els.photoSaveCard.hidden = false;
      els.photoSaveTitle.textContent = '写真アプリへ保存';
      setElementIcon(els.saveCardIcon, 'image');
      setButtonHierarchy(els.shareButton, 'secondary');
      els.shareButton.textContent = supportsMultipleShare ? '写真アプリに保存' : '1枚ずつ写真に保存';
      els.photoSaveSupportText.textContent = supportsMultipleShare
        ? '共有シートから「4枚の画像を保存」を選びます。'
        : 'この環境では4枚一括共有が使えないため、1枚ずつ保存します。';
      els.photoFallbackButton.hidden = false;
      els.fileSaveDetails.open = false;
      els.fileSaveSummary.textContent = 'ファイルに保存';
      els.fileSaveTitle.textContent = 'ファイルに保存';
      setButtonHierarchy(els.zipButton, 'secondary');
      els.zipButton.textContent = '4枚をZIPで保存';
      els.joinedDownloadButton.textContent = '結合画像をファイルに保存';
    } else if (savePlatform === 'android') {
      els.photoSaveCard.hidden = true;
      els.androidDownloadCard.hidden = false;
      const useDirectorySave = directorySaveSupported();
      els.directorySaveCard.hidden = !useDirectorySave;
      els.directorySaveButton.hidden = false;
      els.retryDirectorySaveButton.hidden = !Boolean(state.directorySaveSession && state.directorySaveSession.verified.size < 4);
      els.directorySaveDescription.textContent = useDirectorySave
        ? '保存先のフォルダを選び、4枚を同じ連番で保存します。既存ファイルは上書きしません。'
        : '';
      // Direct downloads are the familiar Android default. The directory
      // picker remains available as an advanced fallback when supported.
      els.fileSaveDetails.open = false;
      els.fileSaveSummary.textContent = '個別再ダウンロード・その他の保存方法';
      els.fileSaveTitle.textContent = '個別再ダウンロードとその他の保存';
      els.fileSaveDescription.textContent = useDirectorySave
        ? '画像が足りない場合は1枚ずつ再ダウンロードできます。保存先フォルダの指定やZIP保存も選べます。'
        : '画像が足りない場合は、下の4つのボタンからその画像だけ再ダウンロードできます。ZIP保存も選べます。';
      setButtonHierarchy(els.zipButton, 'secondary');
      els.zipButton.textContent = '4枚をZIPで保存（1ファイル）';
      els.joinedDownloadButton.textContent = '結合画像を保存';
      els.optionalShareDetails.hidden = !supportsMultipleShare;
      els.optionalShareButton.textContent = '4枚を共有';
    } else {
      els.androidDownloadCard.hidden = true;
      els.directorySaveCard.hidden = true;
      els.photoSaveCard.hidden = true;
      els.fileSaveDetails.open = true;
      els.fileSaveSummary.textContent = 'ファイルに保存';
      els.fileSaveTitle.textContent = 'ファイルに保存';
      setButtonHierarchy(els.zipButton, 'secondary');
      els.zipButton.textContent = 'ZIPで保存';
      els.joinedDownloadButton.textContent = '結合画像を保存';
    }

    els.joinedDownloadButton.hidden = !state.generated.joined;
    els.exportResults.hidden = false;
    setProgress(100, '準備が完了しました');
    setExportState('生成済み：保存方法を選んでください。');
    els.exportStatus.textContent = '書き出しが完了しました。保存方法を選んでください。';
    requestAnimationFrame(() => {
      els.exportResults.scrollIntoView({ block: 'start', behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      els.nextButton.focus({ preventScroll: true });
    });
  }

  async function shareGenerated() {
    if (!state.generated || state.activeExport || state.activeZip || state.activeDirectorySave) return;
    const files = generatedShareFiles();
    setAlert(els.exportError, '');
    state.activeShare = true;
    updateNavigation();
    try {
      if (!navigator.share) throw new Error('このブラウザは画像ファイルの共有に対応していません。');
      if (!canShareFiles(files)) throw new Error('この端末では4枚をまとめて共有できません。');
      await navigator.share({
        files,
        title: 'X 4枚パノラマ'
      });
      els.exportStatus.textContent = '共有シートを開きました。';
      closePhotoSaveDialog();
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      if (isAppleMobile) {
        els.photoDialogLead.textContent = `${error.message || '共有に失敗しました。'} 1枚ずつの保存を試してください。`;
        renderFallbackImageList();
        setPhotoDialogView('fallback');
      } else {
        setAlert(els.exportError, `${error.message || '共有に失敗しました。'} ZIP保存または個別保存を使用してください。`);
        els.fileSaveDetails.open = true;
      }
    } finally {
      state.activeShare = false;
      updateNavigation();
    }
  }

  async function shareSingleGenerated(index, button) {
    if (!state.generated || !state.generated.files[index]) return;
    const file = generatedShareFiles([state.generated.files[index]])[0];
    const originalLabel = button ? button.textContent : '';
    state.activeShare = true;
    updateNavigation();
    try {
      if (!navigator.share) throw new Error('このブラウザは画像ファイルの共有に対応していません。画像を長押しして保存してください。');
      if (!canShareFiles([file])) throw new Error('この画像を共有できません。画像を長押しして保存してください。');
      if (button) {
        button.disabled = true;
        button.textContent = '共有シートを開いています…';
      }
      await navigator.share({ files: [file], title: file.name });
    } catch (error) {
      if (!error || error.name !== 'AbortError') {
        els.photoDialogLead.textContent = error.message || '1枚の共有に失敗しました。画像を長押しして保存してください。';
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
      state.activeShare = false;
      updateNavigation();
    }
  }

  function triggerDownload(blob, name, { announce = true } = {}) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    if (announce) els.exportStatus.textContent = `${name}のダウンロードを開始しました。`;
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  function startAndroidBatchDownloads() {
    if (!state.generated || savePlatform !== 'android' || state.activeExport || state.activeZip || state.activeDirectorySave || state.activeShare) return;
    const files = state.generated.files.slice(0, 4);
    if (files.length !== 4) {
      closeAndroidDownloadDialog();
      setAlert(els.exportError, '4枚の画像を準備できませんでした。もう一度書き出してください。');
      return;
    }

    // Keep all four synthetic link clicks in the explicit button activation.
    // Chrome may request the site's automatic-download permission after the
    // first file, and does not expose the final per-file result to the page.
    files.forEach((item) => triggerDownload(item.blob, item.name, { announce: false }));
    state.androidDownloadAttempts += 1;
    closeAndroidDownloadDialog();
    els.androidDownloadButton.textContent = '4枚を再ダウンロード';
    els.androidDownloadStatus.textContent = '4件のダウンロードを開始しました。Chromeから確認が表示された場合は［許可］を選んでください。画像が足りない場合は、下からその画像だけ再ダウンロードできます。';
    els.androidDownloadStatus.hidden = false;
    els.androidPermissionHelp.hidden = false;
    els.fileSaveDetails.open = true;
    els.exportStatus.textContent = '4件のダウンロードを開始しました。4枚そろっていることを確認してください。';
    updateNavigation();
  }

  function runZipWorker(files, job) {
    return new Promise((resolve, reject) => {
      let worker;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (worker) worker.terminate();
        if (job.worker === worker) job.worker = null;
        job.reject = null;
        callback(value);
      };
      try {
        worker = new Worker(window.__ZIP_WORKER_URL || `zip.js?v=${APP_VERSION}`);
      } catch (error) {
        reject(appError(error.message || 'ZIPワーカーを起動できませんでした。', 'ZIP_WORKER_UNAVAILABLE'));
        return;
      }
      job.worker = worker;
      job.reject = (error) => finish(reject, error);
      worker.onmessage = (event) => {
        if (!zipJobIsCurrent(job)) {
          finish(reject, appError('古いZIP処理を破棄しました。', 'CANCELLED'));
          return;
        }
        const data = event.data || {};
        if (data.type === 'progress') setProgress(Number.isFinite(data.percent) ? data.percent : null, data.text || 'ZIPを作成しています', { showPercent: Boolean(data.showPercent) });
        else if (data.type === 'done') {
          if (!(data.blob instanceof Blob)) {
            finish(reject, appError('ZIPワーカーから正しいデータを受信できませんでした。', 'ZIP_WORKER_RUNTIME'));
          } else {
            finish(resolve, data.blob);
          }
        } else if (data.type === 'error') {
          finish(reject, appError(data.message || 'ZIPの作成に失敗しました。', data.code || 'ZIP_ERROR'));
        } else {
          finish(reject, appError('ZIPワーカーから不明な応答を受信しました。', 'ZIP_WORKER_RUNTIME'));
        }
      };
      worker.onerror = (event) => finish(reject, appError(event.message || 'ZIPワーカーが停止しました。', 'ZIP_WORKER_RUNTIME'));
      worker.onmessageerror = () => finish(reject, appError('ZIPワーカーの応答を読み取れませんでした。', 'ZIP_WORKER_RUNTIME'));
      try {
        worker.postMessage({
          type: 'create',
          timestamp: Date.now(),
          files: files.map((item) => ({ name: item.name, blob: item.blob }))
        });
      } catch (error) {
        finish(reject, appError(error.message || 'ZIPワーカーへ処理を渡せませんでした。', 'ZIP_WORKER_UNAVAILABLE'));
      }
    });
  }

  async function saveZip() {
    if (!state.generated || state.activeExport || state.activeZip || state.activeDirectorySave) return;
    const generatedFiles = state.generated.files || [];
    const generatedBytes = generatedFiles.reduce((sum, item) => sum + (Number(item.blob && item.blob.size) || 0), 0);
    const zipMemory = estimateOperationPeak({
      retainedImages: currentRetainedAssets(),
      generatedBlobs: generatedFiles.map((item) => item.blob),
      // The ZIP result and central directory coexist with the input blobs.
      otherBuffers: Math.ceil(generatedBytes * 1.05) + 64 * 1024,
      budgetBytes: LIMITS.exportEstimatedPeakBytes
    });
    if (!zipMemory.withinBudget) {
      setExportState('個別保存を利用してください。');
      setAlert(els.exportError, `${operationMemoryMessage(zipMemory, 'ZIP作成')} 個別保存なら続行できます。`);
      els.fileSaveDetails.open = true;
      return;
    }
    cancelActiveZip();
    setAlert(els.exportError, '');
    const job = {
      id: state.zipGeneration + 1,
      revision: state.projectRevision,
      generated: state.generated,
      cancelled: false,
      worker: null,
      reject: null
    };
    state.zipGeneration = job.id;
    state.activeZip = job;
    els.zipButton.disabled = true;
    els.cancelZipButton.hidden = false;
    updateNavigation();
    try {
      setProgress(null, 'ZIPを作成しています');
      const blob = await runZipWorker(job.generated.files, job);
      assertZipJobCurrent(job);
      triggerDownload(blob, job.generated.zipName || 'X-panorama.zip');
      setProgress(100, 'ZIPを作成しました');
      els.exportStatus.textContent = 'ZIPを作成し、ダウンロードを開始しました。';
    } catch (error) {
      if (error.code !== 'CANCELLED') {
        console.error(error);
        const fallback = error.code === 'ZIP_WORKER_UNAVAILABLE'
          ? ' この環境ではメイン画面上で巨大ZIPを代替作成しません。下の個別保存を使用してください。'
          : '';
        setAlert(els.exportError, `${error.message || 'ZIPの作成に失敗しました。'}${fallback}`);
        if (fallback) els.fileSaveDetails.open = true;
        els.progressArea.hidden = true;
      }
    } finally {
      if (state.activeZip === job) {
        if (job.worker) job.worker.terminate();
        job.worker = null;
        job.reject = null;
        state.activeZip = null;
        setZipControlsIdle();
      }
    }
  }

  function cancelZip() {
    cancelActiveZip();
  }

  function cancelExport() {
    cancelActiveExport();
  }

  function activatePreviewTab(tab, { focus = false } = {}) {
    if (!tab) return;
    const name = tab.dataset.previewTab;
    state.activePreviewTab = name;
    $$('.tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    $$('.preview-pane').forEach((pane) => {
      const active = pane.dataset.previewPane === name;
      pane.classList.toggle('active', active);
      pane.setAttribute('aria-hidden', String(!active));
      pane.hidden = !active;
      pane.tabIndex = 0;
    });
    if (focus) tab.focus();
    renderPreviewTab(name);
  }

  function setupTabs() {
    const tabs = $$('.tab');
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activatePreviewTab(tab));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        else nextIndex = (index + 1) % tabs.length;
        activatePreviewTab(tabs[nextIndex], { focus: true });
      });
    });
    activatePreviewTab(tabs.find((tab) => tab.classList.contains('active')) || tabs[0]);
  }

  function showUpdateNotice(waitingWorker = null) {
    if (waitingWorker) state.waitingServiceWorker = waitingWorker;
    els.updateNotice.hidden = false;
    syncUpdateControl();
  }

  function activeJobInProgress() {
    return Boolean(state.loadPending || state.activeExport || state.activeZip || state.activeDirectorySave || state.activeShare);
  }

  function syncUpdateControl() {
    if (!els.applyUpdateButton || els.updateNotice.hidden || state.updateRequested) return;
    const active = activeJobInProgress();
    els.applyUpdateButton.disabled = active;
    if (active) els.applyUpdateButton.textContent = '処理完了後に更新';
    else if (state.updateDeferred) els.applyUpdateButton.textContent = '処理が完了しました。更新する';
    else els.applyUpdateButton.textContent = '更新する';
  }

  function setupPwa() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (state.updateRequested && !state.updateReloading) {
          if (activeJobInProgress()) {
            state.updateRequested = false;
            state.updateDeferred = true;
            showUpdateNotice();
            return;
          }
          state.updateReloading = true;
          location.reload();
          return;
        }
        if (state.hadServiceWorkerController) showUpdateNotice();
        state.hadServiceWorkerController = true;
      });

      window.addEventListener('load', async () => {
        try {
          const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
          state.serviceWorkerRegistration = registration;
          if (registration.waiting && navigator.serviceWorker.controller) showUpdateNotice(registration.waiting);
          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller && registration.waiting) {
                showUpdateNotice(registration.waiting);
              }
            });
          });
          registration.update().catch(() => {});
        } catch (error) {
          console.warn('Service worker:', error);
        }
      });
    }

    els.applyUpdateButton.addEventListener('click', () => {
      if (activeJobInProgress()) {
        state.updateDeferred = true;
        syncUpdateControl();
        return;
      }
      state.updateDeferred = false;
      if (state.waitingServiceWorker) {
        state.updateRequested = true;
        els.applyUpdateButton.disabled = true;
        els.applyUpdateButton.textContent = '更新しています…';
        state.waitingServiceWorker.postMessage({ type: 'SKIP_WAITING' });
        state.waitingServiceWorker = null;
        return;
      }
      location.reload();
    });

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.deferredInstallPrompt = event;
      els.installButton.hidden = false;
    });
    els.installButton.addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) return;
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      els.installButton.hidden = true;
    });
    window.addEventListener('appinstalled', () => { els.installButton.hidden = true; });
  }

  function bindEvents() {
    window.addEventListener('popstate', handleStepHistoryPop);
    $$('a[href="#app"]').forEach((link) => link.addEventListener('click', (event) => {
      event.preventDefault();
      const main = $('#app');
      window.scrollTo({ top: 0, behavior: 'auto' });
      if (main) main.focus({ preventScroll: true });
    }));
    document.addEventListener('focusin', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || els.bottomNav.contains(target) || els.photoSaveDialog.open) return;
      requestAnimationFrame(() => {
        const dockPosition = getComputedStyle(els.bottomNav).position;
        if (!['fixed', 'sticky'].includes(dockPosition) || document.activeElement !== target) return;
        const targetRect = target.getBoundingClientRect();
        const navRect = els.bottomNav.getBoundingClientRect();
        const clearance = 8;
        if (targetRect.bottom > navRect.top - clearance || targetRect.top < clearance) {
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
        }
      });
    });

    els.chooseSingleImageButton.addEventListener('click', () => openImagePicker('single'));
    els.chooseFourImagesButton.addEventListener('click', () => openImagePicker('four'));
    els.chooseImagesButton.addEventListener('click', () => openImagePicker(state.mode || 'single'));
    els.changeSelectionModeButton.addEventListener('click', () => {
      state.selectionIntentChooserOpen = true;
      renderSelectionZone({ announce: '入力方法を選択してください。現在の画像は維持されます。' });
      requestAnimationFrame(() => els.chooseSingleImageButton.focus());
    });
    els.dropZone.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.target.closest('button, input, a, summary')) return;
      if (!state.mode || state.selectionIntentChooserOpen) return;
      openImagePicker(state.mode);
    });
    els.fileInput.addEventListener('change', () => {
      if (!els.fileInput.files || els.fileInput.files.length === 0) return;
      loadSelection(els.fileInput.files, state.selectionIntent);
    });
    ['dragenter', 'dragover'].forEach((name) => els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      els.dropZone.classList.add('dragging');
      els.selectionStateDetail.textContent = 'ここに1枚または4枚の画像をドロップしてください。';
    }));
    els.dropZone.addEventListener('dragleave', (event) => {
      event.preventDefault();
      if (!event.relatedTarget || !els.dropZone.contains(event.relatedTarget)) {
        els.dropZone.classList.remove('dragging');
        renderSelectionZone();
      }
    });
    els.dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      els.dropZone.classList.remove('dragging');
      if (event.dataTransfer && event.dataTransfer.files.length) loadSelection(event.dataTransfer.files);
    });

    els.backButton.addEventListener('click', navigateBackInStepHistory);
    els.nextButton.addEventListener('click', handleBottomNext);
    $$('[data-step-target]').forEach((button) => button.addEventListener('click', () => {
      navigateToStep(Number(button.dataset.stepTarget));
    }));
    els.mobileCompletedList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-mobile-step-target]');
      if (!button) return;
      els.mobileCompletedSteps.open = false;
      navigateToStep(Number(button.dataset.mobileStepTarget));
    });
    els.replaceImagesButton.addEventListener('click', () => openImagePicker(state.mode || 'single'));

    els.presetSelect.addEventListener('change', () => { applyPreset(true); updateNavigation(); });
    [els.customWidth, els.customHeight].forEach((input) => {
      input.addEventListener('input', () => {
        if (state.preset !== 'custom') return;
        if (state.customInputTimer) clearTimeout(state.customInputTimer);
        state.customInputTimer = null;
        if (!updateCustomDraftValidity()) {
          updateNavigation();
          return;
        }
        updateNavigation();
        state.customInputTimer = setTimeout(() => {
          state.customInputTimer = null;
          applyPreset(false);
        }, 180);
      });
      input.addEventListener('change', () => {
        if (state.preset !== 'custom') return;
        if (state.customInputTimer) clearTimeout(state.customInputTimer);
        state.customInputTimer = null;
        normalizeCustomSize(true);
        applyPreset(true);
        updateNavigation();
      });
    });
    els.fitButton.addEventListener('click', () => {
      state.crop = { ...state.maxCrop };
      dismissGestureHint();
      invalidateAfterEdit();
      endEditSession({ announce: true });
    });
    els.centerButton.addEventListener('click', () => {
      state.crop = clampCrop({ ...state.crop, x: (state.single.width - state.crop.w) / 2, y: (state.single.height - state.crop.h) / 2 });
      dismissGestureHint();
      invalidateAfterEdit();
      endEditSession({ announce: true });
    });
    els.resetButton.addEventListener('click', () => { dismissGestureHint(); initializeCrop(); queueAdjustmentAnnouncement({ immediate: true }); });
    els.zoomRange.addEventListener('input', () => setZoomPercent(els.zoomRange.value));
    els.zoomRange.addEventListener('change', () => endEditSession({ announce: true }));
    els.zoomOutButton.addEventListener('click', () => setZoomPercent(getZoomPercent() - 5, { finalize: true }));
    els.zoomInButton.addEventListener('click', () => setZoomPercent(getZoomPercent() + 5, { finalize: true }));
    $$('[data-nudge]').forEach((button) => button.addEventListener('click', () => nudgeImage(button.dataset.nudge, 0.01)));
    [els.guideSeams, els.guideCenters, els.guideSafe, els.guideThirds, els.subjectGuide].forEach((input) => input.addEventListener('change', () => {
      state.guides = {
        seams: els.guideSeams.checked,
        centers: els.guideCenters.checked,
        safe: els.guideSafe.checked,
        thirds: els.guideThirds.checked,
        subject: els.subjectGuide.value
      };
      els.seamGuideStatus.textContent = `4分割線：${state.guides.seams ? 'オン' : 'オフ'}`;
      dismissGestureHint();
      updateAdjustmentSummary();
      scheduleEditorRender();
    }));

    els.editorCanvas.addEventListener('pointerdown', handlePointerDown);
    els.editorCanvas.addEventListener('pointermove', handlePointerMove);
    els.editorCanvas.addEventListener('pointerup', handlePointerEnd);
    els.editorCanvas.addEventListener('pointercancel', handlePointerEnd);
    els.editorCanvas.addEventListener('lostpointercapture', handlePointerEnd);
    els.editorCanvas.addEventListener('wheel', handleWheel, { passive: false });
    els.editorCanvas.addEventListener('keydown', (event) => {
      const directionByKey = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const direction = directionByKey[event.key];
      if (!direction) return;
      event.preventDefault();
      nudgeImage(direction, event.shiftKey ? 0.05 : 0.01);
    });

    els.suggestOrderButton.addEventListener('click', suggestOrder);
    els.undoOrderButton.addEventListener('click', undoSuggestedOrder);
    els.boundaryGapToggle.addEventListener('change', () => {
      state.previewRenderRevision.boundaries = -1;
      if (state.step === 3 && state.activePreviewTab === 'boundaries') renderPreviewTab('boundaries', { force: true });
    });
    els.rerunDiagnosticsButton.addEventListener('click', runDiagnostics);
    els.carouselPrevButton.addEventListener('click', () => moveCarousel(-1, els.carouselPrevButton));
    els.carouselNextButton.addEventListener('click', () => moveCarousel(1, els.carouselNextButton));
    els.carouselPreview.addEventListener('scroll', () => {
      if (state.carouselScrollFrame) cancelAnimationFrame(state.carouselScrollFrame);
      state.carouselScrollFrame = requestAnimationFrame(() => {
        state.carouselScrollFrame = null;
        const slides = Array.from(els.carouselPreview.children);
        if (!slides.length) return;
        let closest = 0;
        let distance = Infinity;
        slides.forEach((slide, index) => {
          const delta = Math.abs(slide.offsetLeft - els.carouselPreview.scrollLeft);
          if (delta < distance) { distance = delta; closest = index; }
        });
        if (closest !== state.carouselIndex) {
          state.carouselIndex = closest;
          updateCarouselControls();
        }
      });
    }, { passive: true });
    setupTabs();

    els.formatSelect.addEventListener('change', () => { cancelActiveExport(); clearGenerated(); updateExportSummary(); updateNavigation(); });
    els.qualityRange.addEventListener('input', () => {
      beginQualityEdit();
      els.qualityValue.textContent = els.qualityRange.value;
    });
    els.qualityRange.addEventListener('change', endQualityEdit);
    els.cancelExportButton.addEventListener('click', cancelExport);
    els.shareButton.addEventListener('click', () => {
      if (isAppleMobile) openPhotoSaveDialog(false);
      else shareGenerated();
    });
    els.photoFallbackButton.addEventListener('click', () => openPhotoSaveDialog(true));
    els.optionalShareButton.addEventListener('click', shareGenerated);
    els.openShareSheetButton.addEventListener('click', shareGenerated);
    els.showFallbackMethodsButton.addEventListener('click', () => { renderFallbackImageList(); setPhotoDialogView('fallback'); });
    els.backToShareGuideButton.addEventListener('click', () => setPhotoDialogView('guide'));
    els.closePhotoDialogButton.addEventListener('click', closePhotoSaveDialog);
    els.photoSaveDialog.addEventListener('click', (event) => {
      if (event.target === els.photoSaveDialog) closePhotoSaveDialog();
    });
    els.photoSaveDialog.addEventListener('close', () => { setPhotoDialogView('guide'); restoreDialogFocus(); });
    els.photoSaveDialog.addEventListener('cancel', () => { document.body.classList.remove('dialog-open'); });
    els.androidDownloadButton.addEventListener('click', openAndroidDownloadDialog);
    els.closeAndroidDownloadDialogButton.addEventListener('click', closeAndroidDownloadDialog);
    els.cancelAndroidDownloadsButton.addEventListener('click', closeAndroidDownloadDialog);
    els.startAndroidDownloadsButton.addEventListener('click', startAndroidBatchDownloads);
    els.androidDownloadDialog.addEventListener('click', (event) => {
      if (event.target === els.androidDownloadDialog) closeAndroidDownloadDialog();
    });
    els.androidDownloadDialog.addEventListener('close', restoreDialogFocus);
    els.androidDownloadDialog.addEventListener('cancel', () => { document.body.classList.remove('dialog-open'); });
    els.zipButton.addEventListener('click', saveZip);
    els.directorySaveButton.addEventListener('click', () => saveGeneratedToDirectory());
    els.retryDirectorySaveButton.addEventListener('click', () => saveGeneratedToDirectory({ retry: true }));
    els.cancelZipButton.addEventListener('click', cancelZip);
    els.joinedDownloadButton.addEventListener('click', () => {
      if (state.generated && state.generated.joined) triggerDownload(state.generated.joined.blob, state.generated.joined.name);
    });

    window.addEventListener('resize', () => {
      if (state.step === 2 && state.mode === 'single') resizeAndRenderEditor();
    });
    window.addEventListener('beforeunload', () => {
      if (state.actionDockResizeObserver) state.actionDockResizeObserver.disconnect();
      cancelActiveZip();
      cancelActiveDirectorySave();
      releaseSelectionPreview();
      releaseAllStep3Previews();
      const single = state.single;
      const four = state.four.slice();
      state.projectRevision += 1;
      state.diagnosticsGeneration += 1;
      state.orderSuggestion = null;
      state.mode = null;
      state.single = null;
      state.four = [];
      disposeAsset(single);
      four.forEach(disposeAsset);
      clearGenerated();
    });
  }

  /* TEST_HOOKS_START */
  // Keep this block to preserve the existing browser-test contract.
  window.__xPanoramaTest = {
    APP_VERSION,
    DRAG_THRESHOLD_PX,
    LIMITS,
    FOUR_IMAGE_TOTAL_PREVIEW_PIXELS,
    FOUR_IMAGE_MAX_PREVIEW_PIXELS_PER_IMAGE,
    maxCropForAspect,
    clamp,
    sanitizeBaseName,
    extensionForType,
    fitDimensionsWithinBudget,
    allocateWidths,
    canvasBudgetIssue,
    estimateOperationPeak,
    chooseImagePreviewBudget,
    normalizeCustomSize,
    customDraftIsValid,
    getResolvedOutputSize,
    applyPreset,
    loadSelection,
    showStep,
    runDiagnostics,
    generateExport,
    cancelExport,
    saveZip,
    cancelZip,
    saveGeneratedToDirectory,
    openAndroidDownloadDialog,
    startAndroidBatchDownloads,
    shareGenerated,
    directorySaveSupported,
    detectCapabilities,
    resolveSaveStrategy,
    showUpdateNotice,
    activeJobInProgress,
    resetProject,
    inspectImageFile,
    generatedArtifacts() {
      return state.generated;
    },
    showPreviewTab(name) {
      activatePreviewTab($(`.tab[data-preview-tab="${name}"]`));
    },
    stateSnapshot() {
      return {
        step: state.step,
        maxReachedStep: state.maxReachedStep,
        mode: state.mode,
        loadGeneration: state.loadGeneration,
        loadPending: state.loadPending,
        projectRevision: state.projectRevision,
        editSession: state.editSession ? { active: state.editSession.active, framePending: state.editSession.framePending } : null,
        aspect: state.aspect,
        crop: state.crop ? { ...state.crop } : null,
        zoomPercent: state.crop ? getZoomPercent() : null,
        gesture: state.gesture ? { type: state.gesture.type } : null,
        pointerCount: state.pointers.size,
        selectionIntent: state.selectionIntent,
        savePlatform,
        platformProfile: { ...platformProfile },
        saveStrategy: resolveSaveStrategy(),
        pwa: {
          waiting: Boolean(state.waitingServiceWorker),
          updateRequested: state.updateRequested,
          updateDeferred: state.updateDeferred,
          updateReloading: state.updateReloading,
          noticeHidden: els.updateNotice.hidden,
          buttonDisabled: els.applyUpdateButton.disabled,
          buttonText: els.applyUpdateButton.textContent
        },
        resourceProfile: { constrainedDevice, reportedDeviceMemory, limits: { ...LIMITS } },
        activeExportId: state.activeExport ? state.activeExport.id : null,
        activeZipId: state.activeZip ? state.activeZip.id : null,
        activeDirectorySaveId: state.activeDirectorySave ? state.activeDirectorySave.id : null,
        directoryPickerMode: state.directoryPickerMode,
        androidDownloadAttempts: state.androidDownloadAttempts,
        directorySave: state.directorySaveSession ? {
          names: state.directorySaveSession.names.slice(),
          verified: Array.from(state.directorySaveSession.verified).sort((a, b) => a - b)
        } : null,
        activePreviewTab: state.activePreviewTab,
        diagnostics: {
          status: state.diagnosticsStatus,
          dirty: state.diagnosticsDirty,
          hasCompleted: state.diagnosticsHasCompleted,
          warningCount: state.diagnosticsWarningCount,
          errorCount: state.diagnosticsErrorCount,
          summary: els.diagnosticsSummary.textContent,
          busy: els.diagnosticsOverview.getAttribute('aria-busy')
        },
        history: {
          ready: state.navigationHistoryReady,
          step: Number(history.state && history.state.xPanoramaStep) || null,
          scrollPositions: { ...state.stepScrollPositions }
        },
        adjustmentStatus: els.adjustmentStatus ? els.adjustmentStatus.textContent : '',
        previewRenderRevision: { ...state.previewRenderRevision },
        single: state.single ? {
          name: state.single.name,
          width: state.single.width,
          height: state.single.height,
          drawableWidth: state.single.drawableWidth,
          drawableHeight: state.single.drawableHeight,
          detectedType: state.single.detectedType,
          extension: state.single.extension,
          orientation: state.single.orientation,
          rawWidth: state.single.rawWidth,
          rawHeight: state.single.rawHeight,
          metadata: { ...state.single.metadata },
          estimatedPeakBytes: state.single.estimatedPeakBytes,
          operationPeakBytes: state.single.operationPeakBytes
        } : null,
        four: state.four.map((item) => ({
          name: item.name,
          width: item.width,
          height: item.height,
          drawableWidth: item.drawableWidth,
          drawableHeight: item.drawableHeight,
          detectedType: item.detectedType,
          extension: item.extension,
          orientation: item.orientation,
          metadata: { ...item.metadata }
        })),
        fourPreviewPixels: state.four.reduce((sum, item) => sum + (item.drawableWidth * item.drawableHeight), 0),
        orderStatus: els.orderStatus.textContent,
        generated: Boolean(state.generated),
        generatedFileCount: state.generated ? state.generated.files.length : 0,
        hasJoined: Boolean(state.generated && state.generated.joined),
        output: state.mode ? getResolvedOutputSize() : null,
        exportError: els.exportError.textContent,
        editorCanvas: { width: els.editorCanvas.width, height: els.editorCanvas.height },
        stitchCanvas: { width: els.stitchCanvas.width, height: els.stitchCanvas.height },
        selectionZone: {
          state: els.dropZone.dataset.selectionState,
          busy: els.dropZone.getAttribute('aria-busy'),
          title: els.selectionStateTitle.textContent,
          detail: els.selectionStateDetail.textContent,
          buttonText: els.chooseImagesButton.textContent,
          modeBadge: els.selectionModeBadge.textContent,
          intentChoicesHidden: els.selectionIntentActions.hidden
        },
        selectionPreview: {
          hidden: els.selectionPreview.hidden,
          busy: els.dropZone.getAttribute('aria-busy'),
          status: els.selectionPreviewStatus.textContent,
          count: els.selectionPreviewGrid.children.length,
          canvases: Array.from(els.selectionPreviewGrid.querySelectorAll('canvas')).map((canvas) => ({
            width: canvas.width,
            height: canvas.height,
            label: canvas.getAttribute('aria-label')
          }))
        },
        step3Backings: {
          carousel: els.carouselPreview.querySelectorAll('canvas').length,
          full: { width: els.fullPreviewCanvas.width, height: els.fullPreviewCanvas.height },
          boundaries: els.boundaryPreview.querySelectorAll('canvas').length
        },
        zipControls: {
          saveDisabled: els.zipButton.disabled,
          cancelHidden: els.cancelZipButton.hidden
        },
        progress: {
          hidden: els.progressArea.hidden,
          value: els.exportProgress.value,
          text: els.progressText.textContent
        }
      };
    }
  };
  /* TEST_HOOKS_END */

  initializeStepHistory();
  bindEvents();
  setupActionDockMetrics();
  setupPwa();
  renderSelectionZone();
  updateNavigation();
}());
