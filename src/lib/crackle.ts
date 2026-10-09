/**
 * The crackle bed: filtered noise shaped by how much of the field is burning,
 * plus sparse pops. Starts muted; AudioContext is only created on the toggle.
 */
export class Crackle {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private popTimer = 0;
  private target = 0;
  private current = 0;

  get on() {
    return this.ctx !== null;
  }

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    void ctx.resume();
    this.ctx = ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // pink-ish noise
      const w = Math.random() * 2 - 1;
      last = last * 0.94 + w * 0.06;
      d[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1600;
    bp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp).connect(lp).connect(g).connect(ctx.destination);
    src.start();
    this.noise = src;
    this.gain = g;
  }

  stop() {
    this.noise?.stop();
    this.ctx?.close();
    this.ctx = null;
    this.gain = null;
    this.noise = null;
  }

  /** call every frame with the sim's burning fraction 0..1 */
  setLevel(level: number) {
    if (!this.ctx || !this.gain) return;
    this.target = Math.min(1, level);
    this.current += (this.target - this.current) * 0.06;
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(this.current * 0.14, t, 0.08);
    // sparse pops while burning
    if (this.current > 0.02) {
      this.popTimer -= 1 / 60;
      if (this.popTimer <= 0) {
        this.popTimer = 0.08 + Math.random() * 0.6 / (0.2 + this.current);
        this.pop();
      }
    }
  }

  private pop() {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 1400 + Math.random() * 3200;
    const g = ctx.createGain();
    const a = (0.05 + Math.random() * 0.1) * this.current;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.06);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}
