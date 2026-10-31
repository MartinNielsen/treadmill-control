import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseFitnessMachineFeature, parseInclinationRange, clampIncline,
  encodeInclineParameter, readTreadmillIncline, presetsWithinRange
} from '../incline-utils.js';

const dvFromHex = (hex) => new DataView(Uint8Array.from(hex.match(/../g).map((b) => parseInt(b, 16))).buffer);

test('parses the X14 feature characteristic as supporting target inclination', () => {
  const f = parseFitnessMachineFeature(dvFromHex('dc5600000f000000'));
  assert.equal(f.targetInclinationSupported, true);
  assert.equal(f.inclinationSupported, true);
});

test('feature without target inclination bit', () => {
  assert.equal(parseFitnessMachineFeature(dvFromHex('0100000001000000')).targetInclinationSupported, false);
  assert.equal(parseFitnessMachineFeature(dvFromHex('0100')), null);
});

test('parses the X14 inclination range', () => {
  assert.deepEqual(parseInclinationRange(dvFromHex('000096000a00')), { min: 0, max: 15, step: 1 });
  assert.equal(parseInclinationRange(dvFromHex('0000')), null);
  assert.deepEqual(parseInclinationRange(dvFromHex('ceff64000500')), { min: -5, max: 10, step: 0.5 });
});

test('clamps and snaps incline to range and step', () => {
  const r = { min: 0, max: 15, step: 1 };
  assert.equal(clampIncline(2.4, r), 2);
  assert.equal(clampIncline(2.6, r), 3);
  assert.equal(clampIncline(-3, r), 0);
  assert.equal(clampIncline(40, r), 15);
  assert.equal(clampIncline(NaN, r), 0);
  assert.equal(clampIncline(1.26, { min: -5, max: 10, step: 0.5 }), 1.5);
});

test('encodes sint16 0.1 % little endian', () => {
  assert.deepEqual([...encodeInclineParameter(2)], [0x14, 0x00]);
  assert.deepEqual([...encodeInclineParameter(15)], [0x96, 0x00]);
  assert.deepEqual([...encodeInclineParameter(-2)], [0xec, 0xff]);
});

test('reads incline from the X14 treadmill data frame', () => {
  assert.equal(readTreadmillIncline(dvFromHex('8c05c800000000140000000000ffffff000000')), 2);
  assert.equal(readTreadmillIncline(dvFromHex('8405c800000000')), null); // bit 3 clear
  assert.equal(readTreadmillIncline(dvFromHex('0800c800ff7f0000')), null); // not available
});

test('presets are clamped and de-duplicated', () => {
  assert.deepEqual(presetsWithinRange({ min: 0, max: 5, step: 1 }), [0, 2, 4, 5]);
});

import { elevationGainIncrement, sessionElevationGain } from '../incline-utils.js';

test('elevation gain accumulates distance deltas times positive incline', () => {
  let gain = 0, prev = 1000;
  for (const [d, inc] of [[1010, 5], [1020, 5], [1030, 0], [1040, -3], [1050, 10]]) {
    gain += elevationGainIncrement(prev, d, inc); prev = d;
  }
  assert.equal(Math.round(gain * 100) / 100, 2);
});

test('elevation gain ignores resets, jumps and missing values', () => {
  assert.equal(elevationGainIncrement(500, 0, 5), 0);
  assert.equal(elevationGainIncrement(0, 5000, 5), 0);
  assert.equal(elevationGainIncrement(null, 10, 5), 0);
  assert.equal(elevationGainIncrement(10, 20, null), 0);
});

test('old sessions without the field count as 0', () => {
  assert.equal(sessionElevationGain({}), 0);
  assert.equal(sessionElevationGain({ elevationGainMeters: 3.4 }), 3.4);
});
