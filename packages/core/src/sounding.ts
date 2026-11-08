import { OPEN_PITCHES, type Voicing } from "./voicing.ts";

/** 鳴る 1 本の弦。`string` は 6〜1（`rootStrings` と同じ）、`midi` は MIDI ノート番号。 */
export type SoundingNote = {
  readonly string: number;
  readonly midi: number;
  /** Hz。A4（MIDI 69）= 440Hz の平均律。 */
  readonly frequency: number;
};

const A4_MIDI = 69;
const A4_FREQUENCY = 440;

/**
 * 押さえ方（カポをナットとみなしたフレット。ADR 0028）とカポから、鳴る弦の高さを低い弦から高い弦の順で返す。
 * 標準チューニング前提。カポは 0 以上の整数を前提にし、検査しない。
 */
export function soundingNotes(voicing: Voicing, capo: number): SoundingNote[] {
  const notes: SoundingNote[] = [];
  voicing.forEach((fret, index) => {
    if (fret === null) return;
    const midi = OPEN_PITCHES[index]! + fret + capo;
    notes.push({
      string: voicing.length - index,
      midi,
      frequency: A4_FREQUENCY * 2 ** ((midi - A4_MIDI) / 12),
    });
  });
  return notes;
}
