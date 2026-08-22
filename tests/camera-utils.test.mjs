import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PresenceStabilizer,
  normalizeRegion,
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
