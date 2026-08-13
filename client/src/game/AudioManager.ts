type WeaponTier = "SHELL" | "HEAVY_SHELL" | "ROCKET" | string;

const MUSIC_TRACKS = [
  "/audio/strategic-invasion.mp3",
  "/audio/lost-signal.mp3",
  "/audio/trouble-in-darkness.mp3",
];

export class AudioManager extends EventTarget {
  private context?: AudioContext;
  private sfxMaster?: GainNode;
  private noiseBuffer?: AudioBuffer;
  private sfxBuffers = new Map<string, AudioBuffer>();

  private musicPlayer?: HTMLAudioElement;
  private musicIndex = 0;
  private musicWanted = false;
  private musicEnabled = this.readSetting("snakeBlitzMusic", true);
  private sfxEnabled = this.readSetting("snakeBlitzSfx", true);

  private engineGain?: GainNode;
  private engineFilter?: BiquadFilterNode;
  private engineBase?: OscillatorNode;
  private engineHarmonic?: OscillatorNode;
  private engineNoise?: AudioBufferSourceNode;
  private engineNoiseGain?: GainNode;
  private engineLfo?: OscillatorNode;
  private engineLfoDepth?: GainNode;

  unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.sfxMaster = this.context.createGain();
      this.sfxMaster.gain.value = this.sfxEnabled ? 0.27 : 0;
      this.sfxMaster.connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer();
      this.createSfxBuffers();
      this.createEngine();
    }
    if (this.context.state === "suspended") void this.context.resume();
    if (this.musicWanted && this.musicEnabled) void this.playCurrentTrack();
  }

  beginGameplayAudio() {
    this.musicWanted = true;
    this.unlock();
    if (this.musicEnabled) void this.playCurrentTrack();
  }

  setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    localStorage.setItem("snakeBlitzMusic", enabled ? "1" : "0");
    if (!enabled) this.musicPlayer?.pause();
    else if (this.musicWanted) {
      this.unlock();
      void this.playCurrentTrack();
    }
    this.dispatchEvent(new Event("settingschange"));
  }

  setSfxEnabled(enabled: boolean) {
    this.sfxEnabled = enabled;
    localStorage.setItem("snakeBlitzSfx", enabled ? "1" : "0");
    this.unlock();
    if (this.context && this.sfxMaster) {
      const now = this.context.currentTime;
      this.sfxMaster.gain.cancelScheduledValues(now);
      this.sfxMaster.gain.setTargetAtTime(enabled ? 0.27 : 0, now, 0.025);
    }
    this.dispatchEvent(new Event("settingschange"));
  }

  isMusicEnabled() { return this.musicEnabled; }
  isSfxEnabled() { return this.sfxEnabled; }

  shot(weaponTier: WeaponTier = "SHELL") {
    this.playSfx(weaponTier === "ROCKET" ? "rocket" : weaponTier === "HEAVY_SHELL" ? "heavy" : "shell");
  }

  bodyHit() { this.playSfx("body", 0.72); }
  headshot() { this.playSfx("head", 0.84); }
  explosion() { this.playSfx("explosion", 0.9); }
  tankHit() { this.playSfx("tankHit", 0.85); }
  pickup() { this.playSfx("pickup", 0.75); }
  waveStart() { this.playSfx("wave", 0.78); }
  purchase() { this.playSfx("purchase", 0.68); }
  repair() { this.playSfx("repair", 0.7); }
  readyPing() { this.playSfx("ready", 0.7); }

  /**
   * motion is 0..1 and is derived from authoritative tank movement, so both the
   * driver and gunner hear the same accelerating/decelerating engine.
   */
  setEngineMotion(motion: number, engineLevel: number, active: boolean) {
    if (!this.ready() || !this.engineGain || !this.engineBase || !this.engineHarmonic || !this.engineFilter || !this.engineNoiseGain) return;
    const now = this.context!.currentTime;
    const m = Math.max(0, Math.min(1.25, motion));
    const upgrade = Math.max(0, engineLevel);
    const baseHz = 34 + m * 48 + Math.min(18, upgrade * 2.6);
    const targetGain = active ? 0.055 + m * 0.075 : 0.0001;

    this.engineBase.frequency.cancelScheduledValues(now);
    this.engineBase.frequency.setTargetAtTime(baseHz, now, m > 0.08 ? 0.09 : 0.18);
    this.engineHarmonic.frequency.cancelScheduledValues(now);
    this.engineHarmonic.frequency.setTargetAtTime(baseHz * (2.03 + upgrade * 0.012), now, m > 0.08 ? 0.1 : 0.2);
    this.engineFilter.frequency.cancelScheduledValues(now);
    this.engineFilter.frequency.setTargetAtTime(250 + m * 650 + upgrade * 55, now, 0.12);
    this.engineGain.gain.cancelScheduledValues(now);
    this.engineGain.gain.setTargetAtTime(targetGain, now, m > 0.08 ? 0.08 : 0.22);
    this.engineNoiseGain.gain.cancelScheduledValues(now);
    this.engineNoiseGain.gain.setTargetAtTime(active ? 0.012 + m * 0.028 : 0.0001, now, 0.16);
    if (this.engineLfo) this.engineLfo.frequency.setTargetAtTime(6.2 + m * 4.5 + upgrade * 0.1, now, 0.15);
    if (this.engineLfoDepth) this.engineLfoDepth.gain.setTargetAtTime(active ? 0.009 + m * 0.009 : 0, now, 0.12);
  }

  private playSfx(key: string, volume = 1) {
    if (!this.ready()) return;
    const buffer = this.sfxBuffers.get(key);
    if (!buffer) return;
    const source = this.context!.createBufferSource();
    const gain = this.context!.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain); gain.connect(this.sfxMaster!); source.start();
  }

  private createSfxBuffers() {
    const sr = this.context!.sampleRate;
    const make = (key: string, duration: number, synth: (time: number, p: number, noise: number) => number) => {
      const length = Math.max(1, Math.floor(sr * duration));
      const buffer = this.context!.createBuffer(1, length, sr);
      const out = buffer.getChannelData(0);
      let seed = 0x9e3779b9;
      for (let i = 0; i < length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const noise = (seed / 4294967296) * 2 - 1;
        const time = i / sr, p = i / length;
        out[i] = Math.tanh(synth(time, p, noise) * 1.35) * 0.72;
      }
      this.sfxBuffers.set(key, buffer);
    };
    const cannon = (low0:number, low1:number, noiseAmt:number, crack:number) => (t:number,p:number,n:number) => {
      const env=Math.pow(1-p,3.2), f=low0+(low1-low0)*p;
      const boom=Math.sin(Math.PI*2*f*t)*env;
      const blast=n*noiseAmt*Math.pow(1-p,5.2);
      const mech=Math.sin(Math.PI*2*(920-520*p)*t)*crack*Math.pow(1-p,10);
      return boom*.9+blast+mech;
    };
    make("shell", .30, cannon(92,38,.55,.20));
    make("heavy", .36, cannon(82,32,.68,.22));
    make("rocket", .50, (t,p,n)=>cannon(72,27,.72,.17)(t,p,n)+Math.sin(Math.PI*2*(180-95*p)*t)*.25*Math.pow(1-p,1.8)+n*.12*Math.pow(1-p,1.4));
    make("body", .085, (t,p,n)=>Math.sin(Math.PI*2*(155-70*p)*t)*.6*Math.pow(1-p,3)+n*.22*Math.pow(1-p,5));
    make("head", .12, (t,p,n)=>Math.sin(Math.PI*2*(520+280*p)*t)*.48*Math.pow(1-p,2.4)+Math.sin(Math.PI*2*760*t)*.25*Math.pow(1-p,5)+n*.08*Math.pow(1-p,6));
    make("explosion", .46, (t,p,n)=>Math.sin(Math.PI*2*(72-38*p)*t)*.72*Math.pow(1-p,2)+n*.72*Math.pow(1-p,2.6));
    make("tankHit", .20, (t,p,n)=>Math.sin(Math.PI*2*(100-48*p)*t)*.62*Math.pow(1-p,2.5)+n*.38*Math.pow(1-p,3.5));
    make("pickup", .18, (t,p)=>Math.sin(Math.PI*2*(520+500*p)*t)*.55*Math.pow(1-p,1.5));
    make("wave", .28, (t,p)=>Math.sin(Math.PI*2*(180+190*p)*t)*.48*Math.pow(1-p,1.3)+Math.sin(Math.PI*2*(240+260*p)*t)*.22*Math.pow(1-p,1.8));
    make("purchase", .30, (t,p)=>Math.sin(Math.PI*2*(360+620*p)*t)*.42*Math.pow(1-p,1.4));
    make("repair", .24, (t,p,n)=>Math.sin(Math.PI*2*(170+170*p)*t)*.38*Math.pow(1-p,1.4)+n*.08*Math.pow(1-p,4));
    make("ready", .14, (t,p)=>Math.sin(Math.PI*2*(430+420*p)*t)*.42*Math.pow(1-p,1.6));
  }

  private ready() {
    return Boolean(this.sfxEnabled && this.context && this.sfxMaster && this.context.state === "running");
  }

  private createEngine() {
    const context = this.context!;
    const engineGain = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 320;
    filter.Q.value = 1.25;
    engineGain.gain.value = 0.0001;
    filter.connect(engineGain);
    engineGain.connect(this.sfxMaster!);

    const base = context.createOscillator();
    base.type = "sawtooth";
    base.frequency.value = 34;
    const baseGain = context.createGain();
    baseGain.gain.value = 0.62;
    base.connect(baseGain); baseGain.connect(filter); base.start();

    const harmonic = context.createOscillator();
    harmonic.type = "square";
    harmonic.frequency.value = 69;
    const harmonicGain = context.createGain();
    harmonicGain.gain.value = 0.12;
    harmonic.connect(harmonicGain); harmonicGain.connect(filter); harmonic.start();

    const noise = context.createBufferSource();
    noise.buffer = this.noiseBuffer!;
    noise.loop = true;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 410;
    noiseFilter.Q.value = 0.75;
    const noiseGain = context.createGain();
    noiseGain.gain.value = 0.0001;
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(this.sfxMaster!); noise.start();

    // Slow amplitude pulse gives the stationary engine a 'tugga-tugga' cadence.
    const lfo = context.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 6.2;
    const lfoDepth = context.createGain();
    lfoDepth.gain.value = 0;
    lfo.connect(lfoDepth); lfoDepth.connect(engineGain.gain); lfo.start();

    this.engineGain = engineGain;
    this.engineFilter = filter;
    this.engineBase = base;
    this.engineHarmonic = harmonic;
    this.engineNoise = noise;
    this.engineNoiseGain = noiseGain;
    this.engineLfo = lfo;
    this.engineLfoDepth = lfoDepth;
  }

  private async playCurrentTrack() {
    if (!this.musicEnabled || !this.musicWanted) return;
    if (!this.musicPlayer) this.loadTrack(this.musicIndex);
    if (!this.musicPlayer || !this.musicPlayer.paused) return;
    try { await this.musicPlayer.play(); } catch { /* Browser may require another user gesture; unlock() retries. */ }
  }

  private loadTrack(index: number) {
    this.musicPlayer?.pause();
    const player = new Audio(MUSIC_TRACKS[index % MUSIC_TRACKS.length]);
    player.preload = "auto";
    player.volume = 0.18;
    player.addEventListener("ended", () => {
      this.musicIndex = (this.musicIndex + 1) % MUSIC_TRACKS.length;
      this.loadTrack(this.musicIndex);
      if (this.musicEnabled && this.musicWanted) void this.playCurrentTrack();
    }, { once: true });
    this.musicPlayer = player;
  }

  private tone(fromHz: number, toHz: number, duration: number, type: OscillatorType, volume: number, start: number) {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, fromHz), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.sfxMaster!);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(duration: number, volume: number, start: number, highHz = 900, lowHz = 180) {
    if (!this.noiseBuffer) return;
    const context = this.context!;
    const source = context.createBufferSource();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    source.buffer = this.noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.max(40, highHz), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, lowHz), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxMaster!);
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

  private readSetting(key: string, fallback: boolean) {
    const stored = localStorage.getItem(key);
    if (stored === null) return fallback;
    return stored !== "0";
  }
}

export const audio = new AudioManager();
