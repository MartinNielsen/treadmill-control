import {
  DEFAULT_CAMERA_URL,
  formatDebugTimestamp,
  CAMERA_EMPTY_CONFIRMATION_FRAMES,
  CAMERA_PRESENT_CONFIRMATION_FRAMES,
  PresenceStabilizer,
  normalizeRegion,
  toMjpegUrl,
  toSnapshotUrl
} from './camera-utils.js';

const CONFIG_KEY = 'treadmillControl:cameraTiming';
const FRAME_INTERVAL_MS = 500;
const PERSON_CONFIRMATION_INTERVAL_MS = 200;
const PREVIEW_REPLACEMENT_DELAY_MS = 300;
const DEFAULT_PREVIEW_SIZE = { width: 640, height: 360 };
const stabilizer = new PresenceStabilizer({
  presentFrames: CAMERA_PRESENT_CONFIRMATION_FRAMES,
  absentFrames: CAMERA_EMPTY_CONFIRMATION_FRAMES
});

const elements = {
  form: document.getElementById('cameraForm'),
  url: document.getElementById('cameraUrl'),
  test: document.getElementById('btnTestCamera'),
  enable: document.getElementById('btnEnableCamera'),
  disable: document.getElementById('btnDisableCamera'),
  fullFrame: document.getElementById('btnCameraFullFrame'),
  previewWrap: document.getElementById('cameraPreviewWrap'),
  canvas: document.getElementById('cameraPreview'),
  status: document.getElementById('cameraStatus'),
  badge: document.getElementById('cameraBadge')
};

const context = elements.canvas.getContext('2d', { alpha: false });
let config = loadConfig();
let worker = null;
let workerReady = false;
let enabled = false;
let inferencePending = false;
let runGeneration = 0;
let frameTimer = null;
let latestFrame = null;
let latestDetection = null;
let dragStart = null;
let mjpegImage = null;
let mjpegUrl = '';
let mjpegReadyPromise = null;
const lastCameraDebugSignatures = new Map();

function cameraDebug(event, detail = {}) {
  const serialized = JSON.stringify(detail);
  if (lastCameraDebugSignatures.get(event) === serialized) return;
  lastCameraDebugSignatures.set(event, serialized);
  const method = event === 'detection' || event === 'stable-state-changed' ? 'info' : 'debug';
  console[method](`[camera ${formatDebugTimestamp()}] ${event} ${serialized}`);
}

elements.url.value = config.url;

function normalizePreviewSize(size) {
  const width = Number(size?.width);
  const height = Number(size?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return { ...DEFAULT_PREVIEW_SIZE };
  }
  return {
    width: Math.min(640, Math.max(1, Math.round(width))),
    height: Math.max(1, Math.round(height))
  };
}

function loadConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return {
      url: typeof stored.url === 'string' && stored.url.trim() ? stored.url : DEFAULT_CAMERA_URL,
      region: normalizeRegion(stored.region),
      previewSize: normalizePreviewSize(stored.previewSize),
      enabled: stored.enabled === true
    };
  } catch (error) {
    console.warn('Unable to load camera timing settings:', error);
    return {
      url: DEFAULT_CAMERA_URL,
      region: normalizeRegion(null),
      previewSize: { ...DEFAULT_PREVIEW_SIZE },
      enabled: false
    };
  }
}

function saveConfig() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn('Unable to save camera timing settings:', error);
  }
}

function setStatus(message, tone = 'idle') {
  elements.status.textContent = `[${formatDebugTimestamp()}] ${message}`;
  elements.badge.textContent = tone === 'active'
    ? 'Person'
    : tone === 'empty'
      ? 'Empty'
      : tone === 'ready'
        ? 'Ready'
        : tone === 'error'
          ? 'Error'
          : enabled ? 'Watching' : 'Off';
  elements.badge.dataset.tone = tone;
}

function updateButtons() {
  elements.enable.hidden = enabled;
  elements.disable.hidden = !enabled;
  elements.url.disabled = enabled;
  elements.test.disabled = enabled;
  elements.fullFrame.disabled = !latestFrame;
}

function getFetchOptions(url) {
  const options = { mode: 'cors', cache: 'no-store', credentials: 'omit' };
  if ('targetAddressSpace' in Request.prototype) {
    const target = new URL(url).hostname;
    options.targetAddressSpace = target === 'localhost' || target === '127.0.0.1' ? 'loopback' : 'local';
  }
  return options;
}

async function fetchFrameBlob() {
  const snapshotUrl = toSnapshotUrl(config.url);
  const response = await fetch(snapshotUrl, getFetchOptions(snapshotUrl));
  if (!response.ok) throw new Error(`Camera returned HTTP ${response.status}.`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error(`Camera returned ${blob.type || 'an unknown format'} instead of JPEG.`);
  return blob;
}

function closeMjpegStream() {
  if (mjpegImage) {
    mjpegImage.onload = null;
    mjpegImage.onerror = null;
    mjpegImage.src = '';
  }
  mjpegImage = null;
  mjpegUrl = '';
  mjpegReadyPromise = null;
}

function ensureMjpegStream(url) {
  if (mjpegImage && mjpegUrl === url) {
    return mjpegReadyPromise || Promise.resolve(mjpegImage);
  }

  closeMjpegStream();
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  mjpegImage = image;
  mjpegUrl = url;
  mjpegReadyPromise = new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('MJPEG stream could not be read.'));
  });
  image.src = url;
  return mjpegReadyPromise;
}

async function getFrameSource() {
  const mjpegUrlForConfig = toMjpegUrl(config.url);
  if (mjpegUrlForConfig) return ensureMjpegStream(mjpegUrlForConfig);
  return fetchFrameBlob();
}

function cameraReadError(error) {
  const message = error?.message || String(error);
  if (/Failed to fetch|Load failed|NetworkError|fetch/i.test(message)) {
    return 'Camera could not be read. Allow local-network access and set api.origin: "*" in go2rtc.';
  }
  return message;
}

function signalCameraLost(reason) {
  cameraDebug('signal-lost', { reason });
  window.dispatchEvent(new CustomEvent('camera-signal-lost', { detail: { reason } }));
}

function drawPreview() {
  if (!latestFrame) return;
  const canvas = elements.canvas;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(latestFrame, 0, 0, canvas.width, canvas.height);

  const region = config.region;
  const x = region.x * canvas.width;
  const y = region.y * canvas.height;
  const width = region.width * canvas.width;
  const height = region.height * canvas.height;
  context.fillStyle = 'rgba(16, 21, 22, 0.42)';
  context.fillRect(0, 0, canvas.width, y);
  context.fillRect(0, y + height, canvas.width, canvas.height - y - height);
  context.fillRect(0, y, x, height);
  context.fillRect(x + width, y, canvas.width - x - width, height);
  context.strokeStyle = '#8ff8e8';
  context.lineWidth = Math.max(2, canvas.width / 240);
  context.strokeRect(x, y, width, height);

  if (latestDetection?.box) {
    const box = latestDetection.box;
    context.strokeStyle = '#2fc66d';
    context.lineWidth = Math.max(3, canvas.width / 180);
    context.strokeRect(box.x * canvas.width, box.y * canvas.height, box.width * canvas.width, box.height * canvas.height);
  }
}

function setPreviewSize(width, height, { forcePersist = false } = {}) {
  const nextSize = normalizePreviewSize({ width, height });
  const changed = config.previewSize.width !== nextSize.width || config.previewSize.height !== nextSize.height;
  elements.canvas.width = nextSize.width;
  elements.canvas.height = nextSize.height;
  if (changed || forcePersist) {
    config.previewSize = nextSize;
    saveConfig();
  }
}

async function showFrame(source) {
  const bitmap = await createImageBitmap(source);
  if (latestFrame) latestFrame.close();
  latestFrame = bitmap;
  const maxWidth = Math.min(640, bitmap.width);
  setPreviewSize(maxWidth, Math.max(1, Math.round(maxWidth * bitmap.height / bitmap.width)), { forcePersist: true });
  elements.previewWrap.hidden = false;
  drawPreview();
  updateButtons();
}

function clearPreview() {
  if (latestFrame) latestFrame.close();
  latestFrame = null;
  latestDetection = null;
  setPreviewSize(config.previewSize.width, config.previewSize.height);
  context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  elements.previewWrap.hidden = false;
  updateButtons();
}

async function testCamera() {
  config.url = elements.url.value.trim();
  config.enabled = false;
  saveConfig();
  clearPreview();
  elements.test.disabled = true;
  setStatus('Loading camera preview…');
  try {
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_REPLACEMENT_DELAY_MS));
    const source = await getFrameSource();
    await showFrame(source);
    setStatus('Camera ready. Drag over the image to select the treadmill area.', 'ready');
  } catch (error) {
    setStatus(cameraReadError(error), 'error');
  } finally {
    updateButtons();
  }
}

function initializeWorker() {
  if (worker) return;
  workerReady = false;
  worker = new Worker(new URL('./camera-worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', (event) => {
    inferencePending = false;
    signalCameraLost('person detector failed');
    setStatus(`Person detector failed: ${event.message}`, 'error');
    scheduleNextFrame(5000);
  });
  worker.postMessage({
    type: 'init',
    wasmRoot: new URL('./vendor/mediapipe/wasm', import.meta.url).href,
    modelUrl: new URL('./vendor/mediapipe/models/efficientdet_lite0.tflite', import.meta.url).href
  });
}

function handleWorkerMessage(event) {
  const message = event.data;
  if (message.type === 'ready') {
    workerReady = true;
    setStatus('Person detector ready. Checking the treadmill…');
    runDetectionCycle();
    return;
  }
  inferencePending = false;
  if (message.type === 'error') {
    signalCameraLost(message.message);
    setStatus(`Person detector failed: ${message.message}`, 'error');
    scheduleNextFrame(5000);
    return;
  }
  if (message.type !== 'result') return;

  latestDetection = message;
  drawPreview();
  const stable = stabilizer.update(message.present);
  const confidence = Math.round(message.confidence * 100);
  const confirmingPerson = message.present && stable.state !== 'occupied';
  const nextDelay = confirmingPerson ? PERSON_CONFIRMATION_INTERVAL_MS : FRAME_INTERVAL_MS;
  if (stable.state === 'occupied') {
    setStatus(`Person detected (${confidence}% confidence). Presence confirmed.`, 'active');
  } else if (stable.state === 'empty') {
    setStatus('Treadmill is empty. Waiting for a person.', 'empty');
  } else {
    const candidate = message.present ? 'Confirming person' : 'Confirming empty treadmill';
    setStatus(`${candidate} (${stable.count}/${stable.required}${message.present ? `, ${confidence}% confidence` : ''})…`);
  }

  if (stable.changed) {
    cameraDebug('stable-state-changed', {
      state: stable.state,
      confidence,
      present: message.present,
      confirmationCount: stable.count,
      confirmationRequired: stable.required
    });
    window.dispatchEvent(new CustomEvent('camera-presence-stable', {
      detail: { state: stable.state, confidence: message.confidence }
    }));
  }
  if (message.present && stable.state === 'occupied') {
    cameraDebug('positive-presence-confirmed', { confidence });
    window.dispatchEvent(new CustomEvent('camera-presence-positive', {
      detail: { state: stable.state, confidence: message.confidence }
    }));
  }
  scheduleNextFrame(nextDelay);
}

function scheduleNextFrame(delay = FRAME_INTERVAL_MS) {
  clearTimeout(frameTimer);
  if (!enabled) return;
  frameTimer = setTimeout(runDetectionCycle, delay);
}

async function runDetectionCycle() {
  if (!enabled || !workerReady || inferencePending) return;
  if (document.hidden) {
    setStatus('Camera timing paused while the app is in the background.');
    scheduleNextFrame(2000);
    return;
  }

  inferencePending = true;
  const generation = runGeneration;
  try {
    const source = await getFrameSource();
    const [previewBitmap, inferenceBitmap] = await Promise.all([
      createImageBitmap(source),
      createImageBitmap(source)
    ]);
    if (!enabled || generation !== runGeneration) {
      previewBitmap.close();
      inferenceBitmap.close();
      inferencePending = false;
      return;
    }
    if (latestFrame) latestFrame.close();
    latestFrame = previewBitmap;
    const maxWidth = Math.min(640, previewBitmap.width);
    setPreviewSize(maxWidth, Math.max(1, Math.round(maxWidth * previewBitmap.height / previewBitmap.width)));
    elements.previewWrap.hidden = false;
    drawPreview();
    updateButtons();
    worker.postMessage({ type: 'detect', bitmap: inferenceBitmap, region: config.region }, [inferenceBitmap]);
  } catch (error) {
    closeMjpegStream();
    inferencePending = false;
    signalCameraLost(cameraReadError(error));
    setStatus(cameraReadError(error), 'error');
    scheduleNextFrame(5000);
  }
}

function enableCameraTiming() {
  config.url = elements.url.value.trim();
  if (!config.url) {
    elements.url.focus();
    elements.url.reportValidity();
    return;
  }
  enabled = true;
  runGeneration += 1;
  config.enabled = true;
  stabilizer.reset();
  latestDetection = null;
  saveConfig();
  updateButtons();
  setStatus('Loading the person detector…');
  initializeWorker();
  if (workerReady) runDetectionCycle();
}

function disableCameraTiming() {
  if (enabled) signalCameraLost('camera timing disabled');
  enabled = false;
  runGeneration += 1;
  config.enabled = false;
  inferencePending = false;
  clearTimeout(frameTimer);
  stabilizer.reset();
  latestDetection = null;
  if (worker) worker.terminate();
  worker = null;
  workerReady = false;
  closeMjpegStream();
  saveConfig();
  updateButtons();
  drawPreview();
  setStatus('Camera timing is off.');
}

function canvasPoint(event) {
  const bounds = elements.canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
  };
}

elements.canvas.addEventListener('pointerdown', (event) => {
  if (!latestFrame) return;
  dragStart = canvasPoint(event);
  elements.canvas.setPointerCapture(event.pointerId);
});

elements.canvas.addEventListener('pointermove', (event) => {
  if (!dragStart) return;
  const point = canvasPoint(event);
  config.region = normalizeRegion({
    x: Math.min(dragStart.x, point.x),
    y: Math.min(dragStart.y, point.y),
    width: Math.abs(point.x - dragStart.x),
    height: Math.abs(point.y - dragStart.y)
  });
  latestDetection = null;
  drawPreview();
});

elements.canvas.addEventListener('pointerup', () => {
  if (!dragStart) return;
  dragStart = null;
  stabilizer.reset();
  saveConfig();
  setStatus(enabled ? 'Treadmill area updated. Rechecking…' : 'Treadmill area saved.', 'ready');
});

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  testCamera();
});
elements.enable.addEventListener('click', enableCameraTiming);
elements.disable.addEventListener('click', disableCameraTiming);
elements.fullFrame.addEventListener('click', () => {
  config.region = normalizeRegion(null);
  latestDetection = null;
  stabilizer.reset();
  saveConfig();
  drawPreview();
  setStatus(enabled ? 'Using the full frame. Rechecking…' : 'Full frame selected.', 'ready');
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && enabled) {
    clearTimeout(frameTimer);
    runDetectionCycle();
  } else if (document.hidden && enabled) {
    stabilizer.reset();
    latestDetection = null;
    closeMjpegStream();
    signalCameraLost('page hidden');
    drawPreview();
  }
});

updateButtons();
setPreviewSize(config.previewSize.width, config.previewSize.height);
elements.previewWrap.hidden = false;
if (config.enabled) enableCameraTiming();
