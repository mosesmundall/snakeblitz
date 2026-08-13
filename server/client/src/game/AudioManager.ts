export class AudioManager {
  private context?: AudioContext;
  private master?: GainNode;
  private noiseBuffer?: AudioBuffer;

  unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer();
    }
    if (this.context.state === "suspended") void this.context.resume();
  }

  shot() {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    this.tone(115, 58, 0.075, "square", 0.18, now);
    this.noise(0.055, 0.12, now);
  }

  bodyHit() {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    this.tone(155, 95, 0.055, "triangle", 0.1, now);
    this.noise(0.035, 0.05, now);
  }

  headshot() {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    this.tone(520, 220, 0.08, "square", 0.13, now);
    this.tone(760, 390, 0.055, "triangle", 0.07, now + 0.008);
  }

  explosion() {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    this.noise(0.32, 0.28, now);
    this.tone(72, 34, 0.28, "sawtooth", 0.2, now);
  }

  tankHit() {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    this.noise(0.12, 0.16, now);
    this.tone(96, 52, 0.12, "square", 0.14, now);
  }

  pickup() {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    this.tone(520, 760, 0.08, "sine", 0.1, now);
    this.tone(690, 980, 0.09, "sine", 0.08, now + 0.06);
  }

  waveStart() {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    this.tone(180, 260, 0.14, "sawtooth", 0.08, now);
    this.tone(240, 360, 0.18, "triangle", 0.07, now + 0.09);
  }

  purchase() {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    this.tone(360, 520, 0.08, "triangle", 0.075, now);
    this.tone(520, 760, 0.1, "sine", 0.07, now + 0.055);
    this.tone(760, 940, 0.11, "sine", 0.055, now + 0.11);
  }

  repair() {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    this.tone(170, 230, 0.09, "square", 0.055, now);
    this.tone(230, 330, 0.12, "triangle", 0.06, now + 0.07);
  }

  readyPing() {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    this.tone(430, 620, 0.07, "sine", 0.055, now);
    this.tone(620, 820, 0.09, "sine", 0.05, now + 0.06);
  }

  private ready() {
    return Boolean(this.context && this.master && this.context.state === "running");
  }

  private tone(fromHz: number, toHz: number, duration: number, type: OscillatorType, volume: number, start: number) {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(fromHz, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master!);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(duration: number, volume: number, start: number) {
    if (!this.noiseBuffer) return;
    const context = this.context!;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, start);
    filter.frequency.exponentialRampToValueAtTime(180, start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  private createNoiseBuffer() {
    const context = this.context!;
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}

export const audio = new AudioManager();
