import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseChord } from "./chord.ts";
import { lowerSymbol } from "./chord-transpose.ts";
import { transpose, type PitchClass } from "./pitch-class.ts";

describe("lowerSymbol（記号を半音単位で下げる）", () => {
  it.each([
    ["Bb", 3, "G"],
    ["C#m7/G#", 4, "Am7/E"],
    ["F", 0, "F"],
    ["C7(b9)", 3, "A7(b9)"],
    ["Bbm7-5/Ab", 3, "Gm7-5/F"],
  ])("%s を %i 下げると %s", (symbol, semitones, expected) => {
    expect(lowerSymbol(symbol, semitones)).toBe(expected);
  });

  it("つづりは固定: C を 1〜11 下げると B Bb A Ab G F# F E Eb D C#", () => {
    const expected = ["B", "Bb", "A", "Ab", "G", "F#", "F", "E", "Eb", "D", "C#"];
    expect(Array.from({ length: 11 }, (_, i) => lowerSymbol("C", i + 1))).toEqual(expected);
  });

  it("12 下げると同じ音名に戻り、負の数は上げる", () => {
    expect(lowerSymbol("Eb", 12)).toBe("Eb");
    expect(lowerSymbol("C", -2)).toBe("D");
  });

  it("ずらさない（0 や 12 の倍数）ときは、どんなつづりでもそのまま返す", () => {
    for (const symbol of ["Db", "Gb/Bb", "D#m7", "Cb", "E#", "Db7(b9,#11)", "B♭"]) {
      expect(lowerSymbol(symbol, 0)).toBe(symbol);
      expect(lowerSymbol(symbol, 12)).toBe(symbol);
    }
  });

  it("♯・♭で書かれた記号も読み、結果は内部の記号（# と b）で返す", () => {
    expect(lowerSymbol("B♭", 3)).toBe("G");
    expect(lowerSymbol("C♯m7", 1)).toBe("Cm7");
  });

  it.each(["", "H", "Cfoo", "C7(b9,b9)", "C/H", "C/", "Bb/"])("読めない記号 %j はそのまま返す", (symbol) => {
    expect(lowerSymbol(symbol, 3)).toBe(symbol);
  });

  it("半音が整数でないときは RangeError", () => {
    expect(() => lowerSymbol("C", 1.5)).toThrow(RangeError);
    expect(() => lowerSymbol("C", Number.NaN)).toThrow(RangeError);
  });
});

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const QUALITIES = ["", "m", "7", "M7", "m7", "mM7", "6", "m6", "9", "M9", "m9", "add9", "13", "m7-5", "dim", "dim7", "aug", "sus4", "sus2", "7sus4"];
const pitch = fc.integer({ min: 0, max: 11 }).map((n) => n as PitchClass);

describe("lowerSymbol（性質）", () => {
  const symbols = fc.record({
    root: pitch,
    flat: fc.boolean(),
    quality: fc.constantFrom(...QUALITIES),
    tension: fc.constantFrom("", "(b9)", "(9,#11)", "(b9,#9,b13)"),
    bass: fc.option(pitch, { nil: undefined }),
  });

  it("読める任意の記号と半音数で、結果も読め、構成音が半音ぶんずれるだけ（種類とテンションは保たれる）", () => {
    fc.assert(
      fc.property(symbols, fc.integer({ min: -30, max: 30 }), (s, semitones) => {
        const names = s.flat ? FLAT_NAMES : SHARP_NAMES;
        const withTension = ["7", "M7", "m7"].includes(s.quality) ? s.tension : "";
        const symbol = `${names[s.root]}${s.quality}${withTension}${s.bass === undefined ? "" : `/${names[s.bass]}`}`;
        const before = parseChord(symbol);
        const after = parseChord(lowerSymbol(symbol, semitones));
        if (!before.ok) return false;
        if (!after.ok) return false;
        const shift = (pcs: readonly PitchClass[]) => pcs.map((p) => transpose(p, -semitones)).sort((a, b) => a - b);
        return (
          after.root === transpose(before.root, -semitones) &&
          after.bass === transpose(before.bass, -semitones) &&
          after.required.join() === shift(before.required).join() &&
          after.optional.join() === shift(before.optional).join()
        );
      }),
    );
  });

  it("出力の音名は固定のつづり（C C# D Eb E F F# G Ab A Bb B）だけ", () => {
    fc.assert(
      fc.property(pitch, fc.integer({ min: 0, max: 11 }), (root, semitones) => {
        // ずらすとき（12 の倍数でない）だけ固定のつづりになる。ルートもベースも。
        const out = lowerSymbol(`${SHARP_NAMES[root]}/${FLAT_NAMES[root]}`, semitones % 12 === 0 ? 1 : semitones);
        return out.split("/").every((name) => NAMES.includes(name));
      }),
    );
  });
});
