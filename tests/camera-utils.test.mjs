import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAMERA_EMPTY_CONFIRMATION_FRAMES,
  CAMERA_PRESENT_CONFIRMATION_FRAMES,
  PresenceStabilizer,
  normalizeRegion,
  toMjpegUrl,
  toSnapshotUrl
} from '../camera-utils.js';

test('converts a go2rtc MJPEG stream into a cache-busted JPEG snapshot', () => {
  const result = new URL(toSnapshotUrl(
    'http://camera-host:1984/api/stream.mjpeg?src=printer_cam',
    'http://localhost/'
  ));
  assert.equal(result.pathname, '/api/frame.jpeg');
  assert.equal(result.searchParams.get('src'), 'printer_cam');
  assert.equal(result.searchParams.get('width'), '640');
  assert.ok(result.searchParams.has('_cameraFrame'));
});

test('preserves explicit snapshot sizing', () => {
  const result = new URL(toSnapshotUrl(
    'http://camera-host:1984/api/frame.jpeg?src=printer_cam&w=320',
    'http://localhost/'
  ));
  assert.equal(result.searchParams.get('w'), '320');
  assert.equal(result.searchParams.has('width'), false);
});

test('keeps an MJPEG stream URL persistent and sized for the detector', () => {
  const result = new URL(toMjpegUrl(
    'http://camera-host:1984/api/stream.mjpeg?src=printer_cam&_cameraFrame=123',
    'http://localhost/'
  ));
  assert.equal(result.pathname, '/api/stream.mjpeg');
  assert.equal(result.searchParams.get('src'), 'printer_cam');
  assert.equal(result.searchParams.get('width'), '640');
  assert.equal(result.searchParams.has('_cameraFrame'), false);
});

test('does not convert non-MJPEG URLs into a persistent stream', () => {
  assert.equal(toMjpegUrl('http://camera-host:1984/api/frame.jpeg?src=printer_cam'), null);
});

test('rejects unsupported camera URLs', () => {
  assert.throws(
    () => toSnapshotUrl('rtsp://camera-host/stream1', 'http://localhost/'),
    /go2rtc MJPEG stream or JPEG frame URL/
  );
});

test('normalizes a saved region into the image', () => {
  assert.deepEqual(
    normalizeRegion({ x: -1, y: 0.25, width: 2, height: 2 }),
    { x: 0, y: 0.25, width: 1, height: 0.75 }
  );
});

test('requires consecutive observations before changing stable presence', () => {
  const state = new PresenceStabilizer({ presentFrames: 3, absentFrames: 2 });
  assert.equal(state.update(true).state, 'unknown');
  assert.equal(state.update(false).state, 'unknown');
  assert.equal(state.update(true).state, 'unknown');
  assert.equal(state.update(true).state, 'unknown');
  const occupied = state.update(true);
  assert.equal(occupied.state, 'occupied');
  assert.equal(occupied.changed, true);
  assert.equal(state.update(false).state, 'occupied');
  const empty = state.update(false);
  assert.equal(empty.state, 'empty');
  assert.equal(empty.changed, true);
});

test('requires the longer empty confirmation window used by camera control', () => {
  const state = new PresenceStabilizer({
    presentFrames: CAMERA_PRESENT_CONFIRMATION_FRAMES,
    absentFrames: CAMERA_EMPTY_CONFIRMATION_FRAMES
  });

  for (let index = 0; index < CAMERA_PRESENT_CONFIRMATION_FRAMES; index += 1) {
    state.update(true);
  }
  for (let index = 0; index < CAMERA_EMPTY_CONFIRMATION_FRAMES - 1; index += 1) {
    assert.equal(state.update(false).state, 'occupied');
  }
  const empty = state.update(false);
  assert.equal(empty.state, 'empty');
  assert.equal(empty.changed, true);
});

test('weak person evidence holds an occupied state without confirming a new one', () => {
  const state = new PresenceStabilizer({ presentFrames: 2, absentFrames: 3 });

  state.update(true);
  const occupied = state.update(true);
  assert.equal(occupied.state, 'occupied');

  for (let index = 0; index < 4; index += 1) {
    const weak = state.update(false, { supportsPresence: true });
    assert.equal(weak.state, 'occupied');
    assert.equal(weak.absentCount, 0);
  }

  assert.equal(state.update(false).state, 'occupied');
  assert.equal(state.update(false).state, 'occupied');
  assert.equal(state.update(false).state, 'empty');
});
