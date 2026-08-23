export const DEFAULT_CAMERA_URL = 'http://teslamate2host:1984/api/stream.mjpeg?src=printer_cam';

export function formatDebugTimestamp(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function toSnapshotUrl(value, baseUrl = globalThis.location?.href || 'http://localhost/') {
  const url = new URL(String(value || '').trim(), baseUrl);
  if (url.pathname.endsWith('/api/stream.mjpeg')) {
    url.pathname = url.pathname.replace(/\/api\/stream\.mjpeg$/, '/api/frame.jpeg');
  }
  if (!url.pathname.endsWith('/api/frame.jpeg')) {
    throw new Error('Use a go2rtc MJPEG stream or JPEG frame URL.');
  }
  if (!url.searchParams.has('width') && !url.searchParams.has('w')) {
    url.searchParams.set('width', '640');
  }
  url.searchParams.set('_cameraFrame', Date.now().toString());
  return url.href;
}

export function toMjpegUrl(value, baseUrl = globalThis.location?.href || 'http://localhost/') {
  const url = new URL(String(value || '').trim(), baseUrl);
  if (!url.pathname.endsWith('/api/stream.mjpeg')) return null;
  if (!url.searchParams.has('width') && !url.searchParams.has('w')) {
    url.searchParams.set('width', '640');
  }
  url.searchParams.delete('_cameraFrame');
  return url.href;
}

export function normalizeRegion(region) {
  if (!region || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(region[key]))) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const x = Math.max(0, Math.min(1, region.x));
  const y = Math.max(0, Math.min(1, region.y));
  const width = Math.max(0.02, Math.min(1 - x, region.width));
  const height = Math.max(0.02, Math.min(1 - y, region.height));
  return { x, y, width, height };
}

export class PresenceStabilizer {
  constructor({ presentFrames = 3, absentFrames = 5 } = {}) {
    this.presentFrames = presentFrames;
    this.absentFrames = absentFrames;
    this.reset();
  }

  reset() {
    this.state = 'unknown';
    this.presentCount = 0;
    this.absentCount = 0;
  }

  update(present) {
    if (present) {
      this.presentCount += 1;
      this.absentCount = 0;
    } else {
      this.absentCount += 1;
      this.presentCount = 0;
    }

    const previousState = this.state;
    if (this.presentCount >= this.presentFrames) this.state = 'occupied';
    if (this.absentCount >= this.absentFrames) this.state = 'empty';

    return {
      state: this.state,
      changed: this.state !== previousState,
      progress: present
        ? Math.min(1, this.presentCount / this.presentFrames)
        : Math.min(1, this.absentCount / this.absentFrames),
      count: present ? this.presentCount : this.absentCount,
      required: present ? this.presentFrames : this.absentFrames
    };
  }
}
