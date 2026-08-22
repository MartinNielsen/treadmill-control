import {
  FilesetResolver,
  ObjectDetector
} from './vendor/mediapipe/vision_bundle.mjs';

let detector = null;
let workCanvas = null;
let workContext = null;

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
    scoreThreshold: 0.35,
    categoryAllowlist: ['person']
  });
  self.postMessage({ type: 'ready' });
}

function detectPerson(bitmap, region) {
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

  const result = detector.detect(workCanvas);
  const detection = result.detections?.[0] || null;
  if (!detection) return { present: false, confidence: 0, box: null };

  const confidence = detection.categories?.[0]?.score || 0;
  const box = detection.boundingBox;
  return {
    present: confidence >= 0.35,
    confidence,
    box: box ? {
      x: region.x + (box.originX / sourceWidth) * region.width,
      y: region.y + (box.originY / sourceHeight) * region.height,
      width: (box.width / sourceWidth) * region.width,
      height: (box.height / sourceHeight) * region.height
    } : null
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
      const detection = detectPerson(message.bitmap, message.region);
      self.postMessage({ type: 'result', ...detection });
    }
  } catch (error) {
    if (message.bitmap && typeof message.bitmap.close === 'function') message.bitmap.close();
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
});
