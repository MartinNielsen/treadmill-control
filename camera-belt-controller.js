export class CameraBeltController {
  constructor({ start, stop, isConnected, isRunning, onState = () => {} }) {
    this.start = start;
    this.stop = stop;
    this.isConnected = isConnected;
    this.isRunning = isRunning;
    this.onState = onState;
    this.armed = false;
    this.presence = 'unknown';
    this.state = 'disarmed';
    this.pending = null;
  }

  setArmed(armed) {
    this.armed = Boolean(armed);
    this.publish(this.armed ? 'watching' : 'disarmed');
    return this.reconcile();
  }

  setConnected(connected) {
    if (!connected) {
      this.publish(this.armed ? 'disconnected' : 'disarmed');
      return Promise.resolve();
    }
    return this.reconcile();
  }

  handlePresence(state) {
    if (state !== 'occupied' && state !== 'empty') return Promise.resolve();
    this.presence = state;
    return this.reconcile();
  }

  handleSignalLost() {
    this.presence = 'unknown';
    if (!this.armed || !this.isConnected() || !this.isRunning()) {
      this.publish(this.armed ? 'waiting' : 'disarmed');
      return Promise.resolve();
    }
    return this.enqueue('stop', 'camera-signal-lost');
  }

  publish(state, detail = {}) {
    this.state = state;
    this.onState({ state, presence: this.presence, ...detail });
  }

  desiredAction() {
    if (!this.armed || !this.isConnected()) return null;
    if (this.presence === 'occupied' && !this.isRunning()) return 'start';
    if (this.presence === 'empty' && this.isRunning()) return 'stop';
    return null;
  }

  reconcile() {
    if (this.pending) return this.pending;
    const action = this.desiredAction();
    if (!action) {
      if (!this.armed) this.publish('disarmed');
      else if (!this.isConnected()) this.publish('disconnected');
      else if (this.presence === 'unknown') this.publish('waiting');
      else this.publish(this.isRunning() ? 'running' : 'stopped');
      return Promise.resolve();
    }
    return this.enqueue(action, 'camera-presence');
  }

  enqueue(action, reason) {
    if (this.pending) return this.pending;
    this.publish(action === 'start' ? 'starting' : 'stopping', { reason });
    const operation = (action === 'start' ? this.start : this.stop)({ reason })
      .then(() => {
        this.publish(this.isRunning() ? 'running' : 'stopped', { reason });
      })
      .catch((error) => {
        this.publish('error', { reason, error });
        throw error;
      });
    this.pending = operation;
    const pending = this.pending;
    this.pending = pending.finally(() => {
        this.pending = null;
        if (this.desiredAction()) this.reconcile().catch(() => {});
      });
    return this.pending;
  }
}
