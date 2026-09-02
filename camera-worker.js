import {
  FilesetResolver,
  ObjectDetector
} from './vendor/mediapipe/vision_bundle.mjs';
import {
  CAMERA_DETECTOR_SCORE_THRESHOLD,
  CAMERA_PERSON_HOLD_THRESHOLD,
  CAMERA_PERSON_PRESENT_THRESHOLD
} from './camera-utils.js';

let detector = null;
let workCanvas = null;
let workContext = null;
let fingerprintCanvas = null;
let fingerprintContext = null;

async function initialize({ wasmRoot, modelUrl }) {
  // The module build is required inside a module worker. The default loader
  // relies on importScripts(), which module workers intentionally do not expose.
  const vision = await FilesetResolver.forVisionTasks(wasmRoot, true);
  const modelResponse = await fetch(modelUrl);
  if (!modelResponse.ok) throw new Error(`Unable to load person detector (${modelResponse.status}).`);
  const modelAssetBuffer = new Uint8Array(await modelResponse.arrayBuffer());
  detector = await ObjectDetector.createFromOptions(vision, {
    baseOptions: { modelAssetBuffer, delegate: 'CPU' },
    runningMode: 'IMAGE',
    maxResults: 1,
    // Keep near-misses so the UI can distinguish a weak signal from no
    // detection. The higher presence threshold still controls belt starts.
    scoreThreshold: CAMERA_DETECTOR_SCORE_THRESHOLD,
    categoryAllowlist: ['person']
  });
  self.postMessage({ type: 'ready' });
}

function fingerprintCanvasImage() {
  try {
    const width = 16;
    const height = 9;
    if (!fingerprintCanvas) {
      fingerprintCanvas = new OffscreenCanvas(width, height);
      fingerprintContext = fingerprintCanvas.getContext('2d', { alpha: false });
    }
    fingerprintContext.drawImage(workCanvas, 0, 0, width, height);
    const pixels = fingerprintContext.getImageData(0, 0, width, height).data;
    let hash = 2166136261;
    for (const value of pixels) {
      hash ^= value;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  } catch {
    return null;
  }
}

function detectPerson(bitmap, region) {
  const frameWidth = bitmap.width;
  const frameHeight = bitmap.height;
  const sourceX = Math.round(region.x * bitmap.width);
  const sourceY = Math.round(region.y * bitmap.height);
  const sourceWidth = Math.max(1, Math.round(region.width * bitmap.width));
  const sourceHeight = Math.max(1, Math.round(region.height * bitmap.height));

  if (!workCanvas) {
    workCanvas = new OffscreenCanvas(sourceWidth, sourceHeight);
    workContext = workCanvas.getContext('2d', { alpha: false });
  }
  if (workCanvas.width !== sourceWidth) workCanvas.width = sourceWidth;
  if (workCanvas.height !== sourceHeight) workCanvas.height = sourceHeight;
  workContext.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight
  );
  bitmap.close();

  const frameFingerprint = fingerprintCanvasImage();
  const result = detector.detect(workCanvas);
  const detection = result.detections?.[0] || null;
  if (!detection) {
    return {
      present: false,
      supportsPresence: false,
      detected: false,
      confidence: 0,
      box: null,
      frameWidth,
      frameHeight,
      cropWidth: sourceWidth,
      cropHeight: sourceHeight,
      frameFingerprint
    };
  }

  const confidence = detection.categories?.[0]?.score || 0;
  const box = detection.boundingBox;
  return {
    present: confidence >= CAMERA_PERSON_PRESENT_THRESHOLD,
    supportsPresence: confidence >= CAMERA_PERSON_HOLD_THRESHOLD,
    detected: true,
    confidence,
    box: box ? {
      x: region.x + (box.originX / sourceWidth) * region.width,
      y: region.y + (box.originY / sourceHeight) * region.height,
      width: (box.width / sourceWidth) * region.width,
      height: (box.height / sourceHeight) * region.height
    } : null,
    frameWidth,
    frameHeight,
    cropWidth: sourceWidth,
    cropHeight: sourceHeight,
    frameFingerprint
  };
}

self.addEventListener('message', async (event) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      await initialize(message);
      return;
    }
    if (message.type === 'detect') {
      if (!detector) throw new Error('Person detector is not ready.');
      const inferenceStartedAt = Date.now();
      const detection = detectPerson(message.bitmap, message.region);
      self.postMessage({
        type: 'result',
        frameId: message.frameId,
        captureStartedAt: message.captureStartedAt,
        capturedAt: message.capturedAt,
        inferenceStartedAt,
        inferenceFinishedAt: Date.now(),
        ...detection
      });
    }
  } catch (error) {
    if (message.bitmap && typeof message.bitmap.close === 'function') message.bitmap.close();
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
});
