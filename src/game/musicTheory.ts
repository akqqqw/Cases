/**
 * Pure music helpers for the background loop — no WebAudio here, so the
 * progression can be unit tested.
 */
export interface Chord {
  name: string;
  /** MIDI note numbers of the chord. */
  notes: number[];
}

/** A gentle four chord loop in C major: Am — F — C — G. */
export const PROGRESSION: Chord[] = [
  { name: 'Am', notes: [57, 60, 64, 69] },
  { name: 'F', notes: [53, 57, 60, 65] },
  { name: 'C', notes: [48, 55, 60, 64] },
  { name: 'G', notes: [55, 59, 62, 67] },
];

/** Bar length in seconds (25 BPM, one chord per bar — slow and calm). */
export const BAR_SECONDS = 2.4;

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Loops through the progression forever. */
export function nextChordIndex(index: number): number {
  const length = PROGRESSION.length;
  return ((index % length) + length) % length;
}

export function chordAt(step: number): Chord {
  return PROGRESSION[nextChordIndex(step)] as Chord;
}

/** Melody notes played softly on top of every second bar. */
const BELL_STEPS = [0, 2, 4, 6];

/**
 * Two plucked notes of the bar, one octave above the pad — the harp-like
 * arpeggio that turns the chord progression into a melody. The pair walks
 * through the chord in a fixed order, so a bar always sounds like itself.
 */
export function arpeggioNotes(step: number): number[] {
  const chord = chordAt(step);
  const length = chord.notes.length;
  const first = chord.notes[(step * 2) % length] as number;
  const second = chord.notes[(step * 2 + 2) % length] as number;
  return [first + 12, second + 12];
}

/** Off-beat shaker ticks inside a bar, seconds from its start. */
export function shakerTicks(): number[] {
  return [BAR_SECONDS * 0.28, BAR_SECONDS * 0.53, BAR_SECONDS * 0.78];
}

/**
 * Stereo place of a single voice of the loop: the pad spreads across the whole
 * field, the bells stay close to the centre, so the music feels wide but never
 * swims away from the player.
 */
export function voicePan(index: number, count: number): number {
  if (count <= 1) return 0;
  const ratio = (index / (count - 1)) * 2 - 1;
  return Math.round(ratio * 0.45 * 100) / 100;
}

export function bellNote(step: number): number {
  const chord = chordAt(Math.floor(step / 2));
  const offset = BELL_STEPS[step % BELL_STEPS.length] as number;
  return (chord.notes[(offset % chord.notes.length) as number] as number) + 12;
}
