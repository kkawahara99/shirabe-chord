import fc from "fast-check";
import { parseChord, type ParsedChord } from "./chord.ts";
import type { Voicing } from "./voicing.ts";

/** "x32010"（1 文字 1 弦）か "10 0 12 10 10 x"（空白区切り）を、6弦から1弦の順の押さえ方にする。 */
export function v(text: string): Voicing {
  const tokens = text.includes(" ") ? text.split(" ") : [...text];
  return tokens.map((token) => (token === "x" ? null : Number(token)));
}

/** 押さえ方を "x32010" の形に戻す（フレットが 2 桁のときは空白区切り）。 */
export function show(voicing: Voicing): string {
  const tokens = voicing.map((fret) => fret ?? "x");
  return tokens.some((token) => String(token).length > 1) ? tokens.join(" ") : tokens.join("");
}

export function chord(symbol: string): ParsedChord {
  const result = parseChord(symbol);
  if (!result.ok) throw new Error(`${symbol} が読めない: ${result.reason}`);
  return result;
}

const ROOTS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const QUALITIES = [
  "", "m", "7", "M7", "m7", "mM7", "6", "m6", "9", "M9", "m9", "add9", "13", "m7-5", "dim", "dim7",
  "aug", "sus4", "sus2", "7sus4", "7(9)", "7(b9)", "m7(9)", "M7(13)", "7(#11)", "7(9,13)",
];
const SLASH_CHORDS = ["C/G", "D/F#", "G/B", "Am/E", "F/C", "Em7/B", "C7/Bb", "Dm7/C", "G7/F", "Bb/D"];

/** どれも押さえ方が 1 つ以上あるコード記号。オンコード・テンション付きを含む。 */
export const chordSymbols: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.tuple(fc.constantFrom(...ROOTS), fc.constantFrom(...QUALITIES)).map(([r, q]) => r + q), weight: 5 },
  { arbitrary: fc.constantFrom(...SLASH_CHORDS), weight: 1 },
);
