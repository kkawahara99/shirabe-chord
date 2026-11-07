import { parseChord } from "./chord.ts";
import { transpose, type PitchClass } from "./pitch-class.ts";

/** 選べるカポの位置。0 はカポなし。 */
export const CAPO_FRETS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

/** 出力の音名。つづりはここで固定する（ADR 0028）。 */
const SPELLING = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

const NATURAL: Readonly<Record<string, PitchClass>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const SYMBOL = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/;

const lowerNote = (letter: string, accidental: string, semitones: number) => {
  const pitchClass = transpose(NATURAL[letter]!, accidental === "#" ? 1 : accidental === "b" ? -1 : 0);
  return SPELLING[transpose(pitchClass, -semitones)]!;
};

/**
 * 記号を半音単位で下げる（負の数は上げる）。ルートとベースだけをずらし、種類とテンションは保つ。
 * 読めない記号と、12 の倍数（ずらさない）のときは、そのまま返す。半音が整数でないときは RangeError。
 */
export function lowerSymbol(symbol: string, semitones: number): string {
  if (!Number.isInteger(semitones)) throw new RangeError(`半音は整数で指定する: ${semitones}`);
  if (semitones % 12 === 0) return symbol; // ずらさないなら、つづりも変えない（D♭ を C♯ にしない）
  if (!parseChord(symbol).ok) return symbol;
  const text = symbol.normalize("NFKC").trim().replaceAll("♯", "#").replaceAll("♭", "b");
  const [, letter, accidental, rest, bassLetter, bassAccidental] = SYMBOL.exec(text)!;
  const bass = bassLetter === undefined ? "" : `/${lowerNote(bassLetter, bassAccidental!, semitones)}`;
  return `${lowerNote(letter!, accidental!, semitones)}${rest}${bass}`;
}
