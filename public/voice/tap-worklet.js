// Taps the microphone for recording finishes by voice: hands the page the
// sound in tenth-of-a-second blocks, at whatever rate the phone captures.

class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.parts = [];
    this.n = 0;
    // `sampleRate` is the worklet's global: the context's rate.
    this.want = Math.round(sampleRate / 10);
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      this.parts.push(ch.slice());
      this.n += ch.length;
      if (this.n >= this.want) {
        const out = new Float32Array(this.n);
        let o = 0;
        for (const p of this.parts) {
          out.set(p, o);
          o += p.length;
        }
        this.port.postMessage(out, [out.buffer]);
        this.parts = [];
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor('tap', Tap);
