import type { Settings } from '../store/gameStore';
import { BAR_SECONDS, arpeggioNotes, bellNote, chordAt, midiToFreq, shakerTicks, voicePan } from './musicTheory';
import { detuneCents } from './juice';

type ToneOptions = {
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  /** Target frequency for a pitch slide. */
  to?: number;
  /** Attack time in seconds. */
  attack?: number;
  /** Stereo place, `-1` (left) … `1` (right). */
  pan?: number;
  /** Pitch offset in cents — the small imperfection that avoids machine-gun taps. */
  detune?: number;
  /** How much of the room (reverb) the sound takes, `0..1`. */
  room?: number;
};

/**
 * Tiny procedural sound engine — no audio files to download, everything is
 * synthesised with the WebAudio API. Sounds are short, soft and pleasant.
 */
class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  /** Warm master chain: compressor keeps bursts from clipping. */
  private compressor: DynamicsCompressorNode | null = null;
  /** Room send: everything that asks for `room` goes through the convolver. */
  private room: GainNode | null = null;
  /** Growing counter behind the tiny pitch imperfections of repeated sounds. */
  private seed = 0;
  private musicTimer: ReturnType<typeof setTimeout> | null = null;
  private musicStep = 0;
  private settings: Settings = { sound: true, music: true, volume: 0.8 };
  /** Set while the platform paused the game (ads, purchase, tab switch). */
  private suspended = false;

  /** Must be called from a user gesture (browsers block audio otherwise). */
  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.volume * 0.5;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 22;
      this.compressor.ratio.value = 3.2;
      this.compressor.attack.value = 0.006;
      this.compressor.release.value = 0.22;

      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.master);

      // A tiny generated room: without it everything sounds dry and "in the
      // browser" instead of warm. The impulse is short noise with a fast decay,
      // so the cost is one small buffer, no audio files.
      const convolver = this.ctx.createConvolver();
      const seconds = 1.6;
      const frames = Math.floor(this.ctx.sampleRate * seconds);
      const impulse = this.ctx.createBuffer(2, frames, this.ctx.sampleRate);
      for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < frames; i += 1) {
          const decay = (1 - i / frames) ** 2.6;
          data[i] = (Math.random() * 2 - 1) * decay;
        }
      }
      convolver.buffer = impulse;
      this.room = this.ctx.createGain();
      this.room.gain.value = 0.26;
      this.room.connect(convolver);
      convolver.connect(this.master);
    }
    if (!this.suspended && this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.settings.music) this.startMusic();
  }

  applySettings(settings: Settings): void {
    this.settings = settings;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(settings.volume * 0.5, this.ctx.currentTime, 0.05);
    }
    if (settings.music) this.startMusic();
    else this.stopMusic();
  }

  private get enabled(): boolean {
    return !this.suspended && this.settings.sound && this.settings.volume > 0.001;
  }

  /**
   * Silences the game while the platform holds it: `game_api_pause` fires for
   * ads, purchase windows and a minimized tab. The context itself is suspended
   * too, so nothing keeps sounding in the background.
   */
  suspend(): void {
    this.suspended = true;
    this.stopMusic();
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /** Counterpart of `suspend()`: the platform gave the game back. */
  restore(): void {
    this.suspended = false;
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.settings.music) this.startMusic();
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  /**
   * One synthesised note. Frequency is given in Hz, everything else is optional:
   * a pan position, a detune in cents, a slice of room (reverb) and the usual
   * envelope shape. Nothing here allocates a node it does not connect.
   */
  private tone(freq: number, duration: number, options: ToneOptions = {}): void {
    if (!this.enabled || !this.ctx || !this.master) return;

    const { type = 'sine', gain = 0.2, delay = 0, to, attack = 0.012, pan = 0, detune = 0, room = 0 } = options;
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();

    osc.type = type;
    const pitch = detune === 0 ? freq : freq * 2 ** (detune / 1200);
    osc.frequency.setValueAtTime(pitch, start);
    if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), start + duration);

    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env);
    this.connect(env, pan, room);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  /**
   * Wires an envelope to the master and, when asked, to the stereo field and the
   * room. `StereoPannerNode` is optional (older Safari): without it the sound
   * simply stays centred instead of failing.
   */
  private connect(env: GainNode, pan: number, room: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    let node: AudioNode = env;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.min(1, Math.max(-1, pan));
      node.connect(panner);
      node = panner;
    }
    node.connect(master);
    if (room > 0 && this.room) {
      const send = ctx.createGain();
      send.gain.value = Math.min(0.6, Math.max(0, room));
      node.connect(send);
      send.connect(this.room);
    }
  }

  /** Next pitch offset in cents — deterministic, small, never the same twice. */
  private nextDetune(spread = 7): number {
    this.seed += 1;
    return detuneCents(this.seed, spread);
  }

  private noise(duration: number, gain = 0.12, delay = 0, options: { pan?: number; room?: number; tone?: number } = {}): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const frames = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;

    const source = this.ctx.createBufferSource();
    const env = this.ctx.createGain();
    env.gain.value = gain;
    let node: AudioNode = source;
    if (options.tone !== undefined) {
      // A low-passed noise reads as "shaker" instead of "static".
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = options.tone;
      source.connect(filter);
      node = filter;
    }
    node.connect(env);
    this.connect(env, options.pan ?? 0, options.room ?? 0);
    source.start(this.ctx.currentTime + delay);
  }

  /** Taking a product off the shelf: a soft wooden "tock" with a rising tail. */
  pickup(pan = 0): void {
    this.tone(520, 0.09, { type: 'sine', gain: 0.16, to: 760, pan, detune: this.nextDetune() });
  }

  /** Putting it back down: the same "tock", one octave lower and rounder. */
  drop(pan = 0): void {
    this.tone(440, 0.1, { type: 'triangle', gain: 0.16, to: 300, pan, detune: this.nextDetune() });
  }

  invalid(): void {
    this.tone(180, 0.14, { type: 'square', gain: 0.07, to: 130, room: 0.1 });
    this.tone(240, 0.1, { type: 'sine', gain: 0.06, delay: 0.02, to: 170 });
  }

  tap(): void {
    this.tone(680, 0.06, { type: 'sine', gain: 0.12, room: 0.12 });
  }

  /** Opening / closing a screen: a short two-note gesture, not a click. */
  uiOpen(): void {
    this.tone(620, 0.09, { type: 'sine', gain: 0.1, room: 0.15 });
    this.tone(930, 0.11, { type: 'sine', gain: 0.08, delay: 0.05, room: 0.15 });
  }

  uiClose(): void {
    this.tone(700, 0.09, { type: 'sine', gain: 0.09, room: 0.15 });
    this.tone(470, 0.11, { type: 'sine', gain: 0.08, delay: 0.05, room: 0.15 });
  }

  /** The level is dealt onto the shelves. */
  levelStart(): void {
    this.noise(0.5, 0.07, 0, { tone: 1800, room: 0.3 });
    [523.25, 659.25, 880].forEach((freq, index) => {
      this.tone(freq, 0.22, { type: 'triangle', gain: 0.12, delay: index * 0.07, room: 0.25 });
    });
  }

  /** `step` raises the pitch for chained matches — very satisfying. */
  match(step = 0, pan = 0): void {
    const base = 523.25 * 2 ** (Math.min(step, 6) / 12) * 2 ** (this.nextDetune(5) / 1200);
    this.tone(base, 0.16, { type: 'triangle', gain: 0.2, delay: 0, pan, room: 0.2 });
    this.tone(base * 1.25, 0.16, { type: 'triangle', gain: 0.18, delay: 0.06, pan: pan * 0.7, room: 0.2 });
    this.tone(base * 1.5, 0.22, { type: 'sine', gain: 0.16, delay: 0.12, pan: pan * 0.4, room: 0.25 });
    this.noise(0.12, 0.05, 0, { pan, tone: 5200 });
  }

  hint(): void {
    this.tone(880, 0.1, { type: 'sine', gain: 0.12, room: 0.3 });
    this.tone(1180, 0.12, { type: 'sine', gain: 0.1, delay: 0.08, room: 0.3 });
  }

  undo(): void {
    this.tone(600, 0.12, { type: 'sine', gain: 0.14, to: 320, room: 0.12 });
  }

  /** Deep thump for a bomb blast, plus the ringing tail of the shock. */
  boom(): void {
    this.tone(160, 0.5, { type: 'sawtooth', gain: 0.22, to: 45, attack: 0.005, room: 0.35 });
    this.tone(90, 0.6, { type: 'sine', gain: 0.2, to: 35, attack: 0.008, room: 0.3 });
    this.noise(0.42, 0.16, 0, { tone: 900, room: 0.35 });
    this.noise(0.7, 0.05, 0.05, { tone: 340, room: 0.4 });
  }

  /** Soft chime for a blast pay-off / bonus. */
  sparkle(pan = 0): void {
    this.tone(1320, 0.12, { type: 'sine', gain: 0.1, pan, room: 0.3 });
    this.tone(1760, 0.14, { type: 'sine', gain: 0.08, delay: 0.05, pan: pan * 0.6, room: 0.3 });
  }

  /** Golden triple: a rising shimmer, brighter than a normal match. */
  golden(pan = 0): void {
    [1046.5, 1318.5, 1568, 2093].forEach((freq, index) => {
      this.tone(freq, 0.2, { type: 'sine', gain: 0.1, delay: index * 0.05, pan, room: 0.35 });
    });
  }

  /** Ice cracking and melting away. */
  iceMelt(pan = 0): void {
    this.tone(1568, 0.14, { type: 'triangle', gain: 0.09, to: 1174, pan, room: 0.3 });
    this.noise(0.24, 0.05, 0.02, { pan, tone: 6800, room: 0.25 });
  }

  star(index: number): void {
    const notes = [659.25, 830.61, 987.77];
    const freq = notes[Math.min(index, notes.length - 1)] as number;
    this.tone(freq, 0.24, { type: 'triangle', gain: 0.18, room: 0.3 });
    this.tone(freq * 2, 0.18, { type: 'sine', gain: 0.08, delay: 0.05, room: 0.3 });
  }

  win(): void {
    const melody = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    melody.forEach((freq, i) => {
      this.tone(freq, 0.32, { type: 'triangle', gain: 0.2, delay: i * 0.12 });
      this.tone(freq / 2, 0.3, { type: 'sine', gain: 0.1, delay: i * 0.12 });
    });
    this.noise(0.3, 0.06, 0.1);
  }

  lose(): void {
    const melody = [392, 349.23, 261.63];
    melody.forEach((freq, i) => this.tone(freq, 0.38, { type: 'triangle', gain: 0.16, delay: i * 0.16 }));
  }

  // ------------------------------------------------------------- background

  /** Starts the calm background loop (no-op when the context is not ready). */
  startMusic(): void {
    if (this.suspended) return;
    if (!this.ctx || !this.musicGain || this.musicTimer !== null) return;
    if (!this.settings.music || this.settings.volume <= 0.001) return;

    this.musicGain.gain.setTargetAtTime(0.16, this.ctx.currentTime, 1.2);

    const tick = (): void => {
      const ctx = this.ctx;
      const target = this.musicGain;
      if (!ctx || !target) {
        this.musicTimer = null;
        return;
      }

      this.playBar(this.musicStep);
      this.musicStep += 1;
      this.musicTimer = setTimeout(tick, BAR_SECONDS * 1000);
    };

    tick();
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.ctx && this.musicGain) {
      this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    }
  }

  /**
   * Plays one bar of the loop: a slowly opening chord pad spread across the
   * stereo field, a small arpeggio walking on top of it, a bell every second bar
   * and a soft shaker on the off-beats. The whole accompaniment is generated,
   * which is why the loop never repeats exactly — `nextDetune()` shifts every
   * voice by a few cents.
   */
  private playBar(step: number): void {
    const ctx = this.ctx;
    const music = this.musicGain;
    if (!ctx || !music) return;

    const start = ctx.currentTime;
    const chord = chordAt(step);

    for (const [index, midi] of chord.notes.entries()) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'sine';
      osc.frequency.value = midiToFreq(midi) * 2 ** (this.nextDetune(3) / 1200);
      filter.type = 'lowpass';
      filter.frequency.value = 1200;

      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(0.12, start + 0.9);
      env.gain.linearRampToValueAtTime(0.0001, start + BAR_SECONDS + 0.6);

      osc.connect(filter);
      filter.connect(env);
      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = voicePan(index, chord.notes.length);
        env.connect(panner);
        panner.connect(music);
      } else {
        env.connect(music);
      }
      osc.start(start);
      osc.stop(start + BAR_SECONDS + 0.7);
    }

    // Harp-like plucks: quiet, short, placed between the chord changes.
    arpeggioNotes(step).forEach((midi, index) => {
      const at = start + 0.35 + index * BAR_SECONDS * 0.32;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(midi) * 2 ** (this.nextDetune(4) / 1200);
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(0.05, at + 0.04);
      env.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
      osc.connect(env);
      env.connect(music);
      osc.start(at);
      osc.stop(at + 1.2);
    });

    // Shaker: filtered noise on the off-beats, alternating pan left / right.
    shakerTicks().forEach((offset, index) => {
      const frames = Math.floor(ctx.sampleRate * 0.06);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3;
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 5200;
      const env = ctx.createGain();
      env.gain.value = 0.03;
      source.buffer = buffer;
      source.connect(filter);
      filter.connect(env);
      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = index % 2 === 0 ? 0.32 : -0.32;
        env.connect(panner);
        panner.connect(music);
      } else {
        env.connect(music);
      }
      source.start(start + offset);
    });

    if (step % 2 === 0) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(bellNote(step)) * 2 ** (this.nextDetune(3) / 1200);
      env.gain.setValueAtTime(0.0001, start + 0.4);
      env.gain.linearRampToValueAtTime(0.06, start + 0.5);
      env.gain.exponentialRampToValueAtTime(0.0001, start + BAR_SECONDS + 0.4);
      osc.connect(env);
      env.connect(music);
      osc.start(start + 0.4);
      osc.stop(start + BAR_SECONDS + 0.5);
    }
  }
}

export const audio = new GameAudio();
