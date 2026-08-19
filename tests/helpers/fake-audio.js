export class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.value = value; this.events.push(['exp', value, time]); }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
}

export class Node {
  constructor(type) {
    this.type = type;
    this.nodeKind = type;
    this.connections = [];
    this.started = [];
    this.stopped = [];
    this.gain = new Param(1);
    this.frequency = new Param(440);
    this.detune = new Param(0);
    this.Q = new Param(0);
    this.periodicWaves = [];
  }
  connect(dest) { this.connections.push(dest); return dest; }
  disconnect() { this.disconnected = true; }
  start(time = 0) { this.started.push(time); }
  stop(time = 0) { this.stopped.push(time); }
  setPeriodicWave(wave) { this.periodicWaves.push(wave); }
}

export class FakeContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 100;
    this.destination = new Node('destination');
    this.nodes = [];
  }
  make(type) { const node = new Node(type); this.nodes.push(node); return node; }
  createGain() { return this.make('gain'); }
  createOscillator() { return this.make('oscillator'); }
  createBiquadFilter() { return this.make('filter'); }
  createBufferSource() { return this.make('bufferSource'); }
  createDelay(maxDelayTime = 1) {
    const node = this.make('delay');
    node.delayTime = new Param(0);
    node.maxDelayTime = maxDelayTime;
    return node;
  }
  createBuffer(channels, length) {
    return {
      channels,
      length,
      sampleRate: this.sampleRate,
      data: new Float32Array(length),
      getChannelData() { return this.data; }
    };
  }
  createPeriodicWave(real, imag) { return { real, imag }; }
  suspend() { this.suspended = true; return Promise.resolve(); }
}
