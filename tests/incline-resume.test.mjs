import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeInclineTarget } from '../incline-utils.js';

const range = { min: 0, max: 15, step: 1 };

test('returns stored incline within range', () => {
  assert.equal(resumeInclineTarget({ lastInclinePercent: 4 }, range), 4);
  assert.equal(resumeInclineTarget({ lastInclinePercent: 0 }, range), 0);
});
test('clamps and snaps to range', () => {
  assert.equal(resumeInclineTarget({ lastInclinePercent: 20 }, range), 15);
  assert.equal(resumeInclineTarget({ lastInclinePercent: -3 }, range), 0);
  assert.equal(resumeInclineTarget({ lastInclinePercent: 4.4 }, range), 4);
});
test('skips without stored value, session or incline support', () => {
  assert.equal(resumeInclineTarget({}, range), null);
  assert.equal(resumeInclineTarget({ lastInclinePercent: null }, range), null);
  assert.equal(resumeInclineTarget({ lastInclinePercent: NaN }, range), null);
  assert.equal(resumeInclineTarget(null, range), null);
  assert.equal(resumeInclineTarget({ lastInclinePercent: 4 }, null), null);
});
