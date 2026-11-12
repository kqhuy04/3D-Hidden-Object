export class AudioEngine {
  private static instance: AudioEngine | null = null;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private initialized = false;
  /**
   * Master level, applied now if the context exists and remembered if it does
   * not.
   *
   * The context is created on the first user gesture, which happens after the
   * settings screen has already been read — so a volume of zero chosen before
   * the first click has to survive until there is a gain node to apply it to.
   */
  private masterVolume = 0.85;

  private constructor() {}

  public static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  public init(): void {
    if (this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(0.9, this.ctx.currentTime);
      this.sfxGain.connect(this.masterGain);

      this.initialized = true;
    } catch {
      // AudioContext unavailable or blocked by autoplay
    }
  }

  public ensureContext(): void {
    if (!this.initialized) {
      this.init();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  /**
   * Master volume, 0 … 1.
   *
   * Ramped rather than set, because a hard step on a gain node is an audible
   * click — and the slider is dragged, so there would be sixty of them.
   */
  public setMasterVolume(volume: number): void {
    const next = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
    this.masterVolume = next;
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(next, this.ctx.currentTime, 0.02);
  }

  public getMasterVolume(): number {
    return this.masterVolume;
  }

  /**
   * Procedural Camera Shutter Sound: dual click with white noise impulse
   */
  public playShutter(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const t = this.ctx.currentTime;

    // First click: high-frequency pop
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(800, t);
    osc1.frequency.exponentialRampToValueAtTime(150, t + 0.04);
    gain1.gain.setValueAtTime(0.6, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc1.connect(gain1);
    gain1.connect(this.sfxGain);
    osc1.start(t);
    osc1.stop(t + 0.06);

    // Mechanical noise burst
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.035);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(2400, t);
    noiseFilter.Q.setValueAtTime(3.0, t);
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.sfxGain);
    noise.start(t + 0.01);

    // Second click: shutter curtain close (delayed by 65ms)
    const t2 = t + 0.065;
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(500, t2);
    osc2.frequency.exponentialRampToValueAtTime(100, t2 + 0.05);
    gain2.gain.setValueAtTime(0.7, t2);
    gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.06);
    osc2.connect(gain2);
    gain2.connect(this.sfxGain);
    osc2.start(t2);
    osc2.stop(t2 + 0.07);
  }

  /**
   * Positive objective completed fanfare / chime
   */
  public playSuccess(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.sfxGain) return;
      const noteTime = t + idx * 0.075;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.25, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(noteTime);
      osc.stop(noteTime + 0.36);
    });
  }

  /**
   * Failure feedback soft buzz
   */
  public playFailure(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.setValueAtTime(140, t + 0.08);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  /**
   * UI Click / Button tap
   */
  public playClick(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.03);

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.035);
  }

  /**
   * Countdown tick
   */
  public playTick(): void {
    this.ensureContext();
    if (!this.ctx || !this.sfxGain) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}
