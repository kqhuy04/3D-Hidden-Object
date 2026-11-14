/** Tiny WebAudio synth — no audio assets, everything is generated on the fly. */

type Voice = 'coin' | 'turn' | 'drop' | 'open' | 'reveal' | 'rare' | 'legendary' | 'click';

let ctx: AudioContext | null = null;

function audio(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function unlockAudio(): void {
  audio();
}

function tone(
  freq: number,
  start: number,
  duration: number,
  type: OscillatorType,
  gain: number,
  slideTo?: number,
): void {
  const ac = audio();
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime + start);
  if (slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ac.currentTime + start + duration);
  }
  amp.gain.setValueAtTime(0.0001, ac.currentTime + start);
  amp.gain.exponentialRampToValueAtTime(gain, ac.currentTime + start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(ac.currentTime + start);
  osc.stop(ac.currentTime + start + duration + 0.02);
}

function noise(start: number, duration: number, gain: number, freq: number): void {
  const ac = audio();
  const frames = Math.floor(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  const amp = ac.createGain();
  amp.gain.value = gain;
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(ac.currentTime + start);
}

export function play(voice: Voice): void {
  switch (voice) {
    case 'coin':
      tone(1180, 0, 0.07, 'square', 0.06);
      tone(1560, 0.07, 0.12, 'square', 0.05);
      break;
    case 'turn':
      for (let i = 0; i < 7; i += 1) noise(i * 0.14, 0.05, 0.16, 2200 + i * 120);
      break;
    case 'drop':
      tone(220, 0, 0.22, 'sine', 0.16, 70);
      noise(0.02, 0.14, 0.1, 900);
      break;
    case 'open':
      tone(760, 0, 0.06, 'triangle', 0.08);
      tone(1140, 0.05, 0.16, 'triangle', 0.07);
      break;
    case 'reveal':
      tone(523, 0, 0.12, 'triangle', 0.07);
      tone(659, 0.1, 0.12, 'triangle', 0.07);
      tone(784, 0.2, 0.22, 'triangle', 0.07);
      break;
    case 'rare':
      tone(523, 0, 0.11, 'square', 0.05);
      tone(784, 0.09, 0.11, 'square', 0.05);
      tone(1046, 0.18, 0.16, 'square', 0.05);
      tone(1318, 0.27, 0.34, 'square', 0.05);
      break;
    case 'legendary':
      tone(659, 0, 0.1, 'square', 0.055);
      tone(880, 0.08, 0.1, 'square', 0.055);
      tone(1046, 0.16, 0.1, 'square', 0.055);
      tone(1318, 0.24, 0.14, 'square', 0.055);
      tone(1760, 0.34, 0.5, 'square', 0.05);
      noise(0.34, 0.5, 0.05, 5200);
      break;
    case 'click':
      tone(520, 0, 0.05, 'square', 0.045);
      break;
  }
}
