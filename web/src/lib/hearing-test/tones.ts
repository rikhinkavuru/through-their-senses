/**
 * Test tones for the in-app hearing test. Each presentation is three 225 ms pulses
 * (pulsed tones are easier to notice near threshold; ASHA 2005), with 25 ms
 * raised-cosine ramps so no click spreads energy to other frequencies. Levels are
 * peak dB re digital full scale; the headphones and volume setting are unknown, which
 * is why the test is referenced to a helper on the same setup.
 */

export type Ear = "left" | "right";

const PULSE = 0.225;
const GAP = 0.225;
const RAMP = 0.025;
export const TONE_SECONDS = 3 * PULSE + 2 * GAP;

export class ToneEngine {
  readonly ctx: AudioContext;
  private merger: ChannelMergerNode;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.merger = this.ctx.createChannelMerger(2);
    this.merger.connect(this.ctx.destination);
  }

  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  private buffer(freq: number, levelDb: number, pulses = 3): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const dur = pulses * PULSE + (pulses - 1) * GAP;
    const n = Math.ceil(dur * sr);
    const buf = this.ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const amp = Math.pow(10, levelDb / 20);
    const ramp = Math.round(RAMP * sr);
    for (let p = 0; p < pulses; p++) {
      const start = Math.round(p * (PULSE + GAP) * sr);
      const len = Math.round(PULSE * sr);
      for (let i = 0; i < len && start + i < n; i++) {
        const env = i < ramp ? 0.5 - 0.5 * Math.cos((Math.PI * i) / ramp) : i >= len - ramp ? 0.5 - 0.5 * Math.cos((Math.PI * (len - i)) / ramp) : 1;
        d[start + i] = amp * env * Math.sin((2 * Math.PI * freq * (start + i)) / sr);
      }
    }
    return buf;
  }

  /**
   * Schedule a tone (or, for a catch trial, silence of the same length).
   * Returns the performance.now() time the sound reaches the ears, as well as the audio clock allows.
   */
  play(freq: number, levelDb: number, ear: Ear | "both", silent = false, pulses = 3): number {
    const lead = 0.06;
    const when = this.ctx.currentTime + lead;
    if (!silent) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer(freq, levelDb, pulses);
      if (ear === "both") {
        src.connect(this.merger, 0, 0);
        src.connect(this.merger, 0, 1);
      } else src.connect(this.merger, 0, ear === "left" ? 0 : 1);
      src.start(when);
    }
    const latency = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return performance.now() + (lead + latency) * 1000;
  }

  close() {
    void this.ctx.close();
  }
}
