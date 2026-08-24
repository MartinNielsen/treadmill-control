import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraBeltController } from '../camera-belt-controller.js';

function createHarness({ startDelay = 0, ensureRunning = null } = {}) {
  let connected = true;
  let running = false;
  const commands = [];
  const states = [];
  let releaseStart;

  const start = () => new Promise((resolve) => {
    commands.push('start');
    const finish = () => {
      running = true;
      resolve();
    };
    if (startDelay) releaseStart = finish;
    else finish();
  });
  const stop = async () => {
    commands.push('stop');
    running = false;
  };
  const controller = new CameraBeltController({
    start,
    stop,
    ensureRunning,
    isConnected: () => connected,
    isRunning: () => running,
    onState: (state) => states.push(state.state)
  });

  return {
    controller,
    commands,
    states,
    releaseStart: () => releaseStart?.(),
    setConnected: (value) => { connected = value; }
  };
}

test('stable presence starts and stops the belt once per state change', async () => {
  const harness = createHarness();
  harness.controller.setArmed(true);

  await harness.controller.handlePresence('occupied');
  assert.deepEqual(harness.commands, ['start']);

  await harness.controller.handlePresence('occupied');
  assert.deepEqual(harness.commands, ['start']);

  await harness.controller.handlePresence('empty');
  assert.deepEqual(harness.commands, ['start', 'stop']);
  assert.equal(harness.states.at(-1), 'stopped');
});

test('a presence change during start is reconciled after the start completes', async () => {
  const harness = createHarness({ startDelay: 1 });
  harness.controller.setArmed(true);
  const startPromise = harness.controller.handlePresence('occupied');
  const emptyPromise = harness.controller.handlePresence('empty');

  harness.releaseStart();
  await startPromise;
  await emptyPromise;
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(harness.commands, ['start', 'stop']);
});

test('repeated positive presence can reconcile a running belt', async () => {
  const repairs = [];
  const harness = createHarness({
    ensureRunning: async () => {
      repairs.push('ensure-running');
    }
  });
  harness.controller.setArmed(true);

  await harness.controller.handlePresence('occupied');
  await harness.controller.handlePresence('occupied');

  assert.deepEqual(harness.commands, ['start']);
  assert.deepEqual(repairs, ['ensure-running']);
});

test('camera signal loss stops a running belt and disarms only when requested', async () => {
  const harness = createHarness();
  harness.controller.setArmed(true);
  await harness.controller.handlePresence('occupied');
  await harness.controller.handleSignalLost();

  assert.deepEqual(harness.commands, ['start', 'stop']);
  assert.equal(harness.states.at(-1), 'stopped');
});

test('disconnected automation never starts the belt', async () => {
  const harness = createHarness();
  harness.setConnected(false);
  harness.controller.setArmed(true);
  await harness.controller.handlePresence('occupied');

  assert.deepEqual(harness.commands, []);
  assert.equal(harness.states.at(-1), 'disconnected');
});
