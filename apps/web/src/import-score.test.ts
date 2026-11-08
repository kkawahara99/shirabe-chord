import {
  buildChordSymbol,
  CHORD_QUALITIES,
  generateVoicings,
  lowerSymbol,
  optimizeSymbols,
  parseChord,
  TENSIONS,
  validateSharedScore,
  type ChordSelection,
  type NoteLetter,
  type NoteSelection,
  type SharedScore,
} from "@shirabe-chord/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { importScore, selectionOf } from "./import-score.ts";

const noteArb: fc.Arbitrary<NoteSelection> = fc.record({
  letter: fc.constantFrom<NoteLetter>("C", "D", "E", "F", "G", "A", "B"),
  accidental: fc.constantFrom("", "#", "b"),
});
const selectionArb: fc.Arbitrary<ChordSelection> = fc
  .record({
    root: noteArb,
    quality: fc.constantFrom(...CHORD_QUALITIES.map((q) => q.names[0]!)),
    tensions: fc.subarray([...TENSIONS]),
    bass: fc.option(noteArb, { nil: null }),
  })
  .filter((selection) => buildChordSymbol(selection).ok);

const symbolOf = (selection: ChordSelection): string => {
  const built = buildChordSymbol(selection);
  if (!built.ok) throw new Error("組み立てられない選択");
  return built.symbol;
};
const parsedOf = (symbol: string) => {
  const parsed = parseChord(symbol);
  if (!parsed.ok) throw new Error(`${symbol} が読めない`);
  return parsed;
};

describe("selectionOf", () => {
  it("任意のコード選択は、記号にして選択に戻すと、同じ構成音になる", () => {
    fc.assert(
      fc.property(selectionArb, (selection) => {
        const symbol = symbolOf(selection);
        const back = selectionOf(symbol);
        expect(back).not.toBeNull();
        expect(parsedOf(symbolOf(back!))).toEqual(parsedOf(symbol));
      }),
      { numRuns: 300 },
    );
  });

  it.each([
    ["Cmaj7", "M7"],
    ["C△7", "M7"],
    ["Dm7(b5)", "m7-5"],
    ["Dø", "m7-5"],
    ["C°", "dim"],
    ["C°7", "dim7"],
    ["C+", "aug"],
  ])("別名 %s は、主名の種類 %s にする", (symbol, quality) => {
    expect(selectionOf(symbol)?.quality).toBe(quality);
  });

  it("♯♭のルート・オンコード・テンションを読める", () => {
    expect(selectionOf("F#m7-5/B")).toEqual({
      root: { letter: "F", accidental: "#" },
      quality: "m7-5",
      tensions: [],
      bass: { letter: "B", accidental: "" },
    });
    expect(selectionOf("Bb7(b9,#11)/Ab")).toEqual({
      root: { letter: "B", accidental: "b" },
      quality: "7",
      tensions: ["b9", "#11"],
      bass: { letter: "A", accidental: "b" },
    });
    expect(selectionOf("C")).toEqual({ root: { letter: "C", accidental: "" }, quality: "", tensions: [], bass: null });
  });

  it.each(["", "H", "Cxyz", "C(9)", "C7(9,b9)", "C/H", "C/E/G"])("読めない記号 %j は null", (symbol) => {
    expect(selectionOf(symbol)).toBeNull();
  });
});

const score = (capo: number, chords: SharedScore["chords"]): SharedScore => ({
  title: "題",
  note: "",
  displayName: "匿名",
  capo,
  chords,
});

describe("importScore", () => {
  const C = { symbol: "C", voicing: [null, 3, 2, 0, 1, 0] } as const;
  const G = { symbol: "G", voicing: [3, 2, 0, 0, 0, 3] } as const;

  it("各コードの押さえ方を、固定した状態で持ち込む。カポも保つ", () => {
    // カポ 2 の「鳴らす名前」は D・A。押さえ方は 2 半音下の形（C・G）
    const imported = importScore(score(2, [{ ...C, symbol: "D" }, { ...G, symbol: "A" }, { ...C, symbol: "D" }]))!;
    expect(imported.capo).toBe(2);
    expect(imported.chords.map(symbolOf)).toEqual(["D", "A", "D"]);
    expect([...imported.pins.keys()]).toEqual([0, 1, 2]);
    expect(imported.pins.get(1)!.voicing).toEqual(G.voicing);
    expect(imported.pins.get(1)!.lowestFret).toBe(2);
  });

  it("読めない記号を含む譜面は持ち込めない", () => {
    expect(importScore(score(0, [C, { symbol: "Hm", voicing: G.voicing }]))).toBeNull();
  });

  it("いまの候補に無い押さえ方のコードは、そのコードの固定だけ外す", () => {
    const unlisted = [null, null, null, 20, 20, 20] as const;
    expect(generateVoicings(parsedOf("C")).some((v) => v.join() === unlisted.join())).toBe(false); // 前提
    const imported = importScore(score(0, [C, { symbol: "C", voicing: unlisted }]))!;
    expect([...imported.pins.keys()]).toEqual([0]);
  });

  it("押さえるフレットが無い押さえ方（開放弦とミュートだけ）のコードは、固定を外す", () => {
    const open = { symbol: "Em", voicing: [0, 2, 2, 0, 0, 0] } as const;
    const onlyOpen = { symbol: "E", voicing: [0, null, null, null, null, 0] } as const;
    const imported = importScore(score(0, [open, onlyOpen]))!;
    // 開放だけの形は固定を外す（候補にあってもなくても、押さえるフレットが無い）
    expect(imported.pins.has(1)).toBe(false);
    expect(imported.pins.has(0)).toBe(true);
  });

  it("持ち込んだ譜面を組み立てると、共有と同じ押さえ方になる（任意の進行・カポ）", () => {
    const POOL = ["C", "Am", "F", "G7", "Dm7", "Em", "Bb", "F#m7-5", "C/E", "D7(b9)", "Cmaj7", "Bm7", "E7", "A"];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...POOL), { minLength: 1, maxLength: 4 }), fc.integer({ min: 0, max: 7 }), (symbols, capo) => {
        const solved = optimizeSymbols(symbols.map((s) => lowerSymbol(s, capo)));
        if (!solved.ok) return;
        const shared = validateSharedScore({
          title: "題",
          capo,
          chords: solved.steps.map((step, i) => ({ symbol: symbols[i], voicing: step.voicing })),
        });
        if (!shared.ok) return; // カポで形の記号が読めない組は共有できない
        const imported = importScore(shared.score)!;
        const again = optimizeSymbols(
          imported.chords.map((chord) => lowerSymbol(symbolOf(chord), imported.capo)),
          { pins: new Map([...imported.pins].map(([position, shape]) => [position, shape.voicing])) },
        );
        expect(again.ok).toBe(true);
        if (again.ok) expect(again.steps.map((step) => step.voicing)).toEqual(solved.steps.map((step) => step.voicing));
      }),
      { numRuns: 15 },
    );
  });
});
