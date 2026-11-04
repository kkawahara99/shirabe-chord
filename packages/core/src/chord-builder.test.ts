import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildChordSymbol,
  TENSIONS,
  tensionsConflictingWith,
  type Accidental,
  type ChordSelection,
  type NoteLetter,
  type Tension,
} from "./chord-builder.ts";
import { CHORD_QUALITIES, parseChord } from "./chord.ts";

const LETTERS: readonly NoteLetter[] = ["C", "D", "E", "F", "G", "A", "B"];
const ACCIDENTALS: readonly Accidental[] = ["", "#", "b"];
const NOTES = LETTERS.flatMap((letter) => ACCIDENTALS.map((accidental) => ({ letter, accidental })));

// 期待値は parseChord と別に持つ表から作る（ルートからの半音数）。
const EXPECTED_QUALITIES: Readonly<
  Record<string, { required: readonly number[]; optional: readonly number[]; tensionable: boolean }>
> = {
  "": { required: [0, 4], optional: [7], tensionable: false },
  m: { required: [0, 3], optional: [7], tensionable: false },
  aug: { required: [0, 4, 8], optional: [], tensionable: false },
  dim: { required: [0, 3, 6], optional: [], tensionable: false },
  sus2: { required: [0, 2], optional: [7], tensionable: false },
  sus4: { required: [0, 5], optional: [7], tensionable: false },
  "7": { required: [0, 4, 10], optional: [7], tensionable: true },
  M7: { required: [0, 4, 11], optional: [7], tensionable: true },
  m7: { required: [0, 3, 10], optional: [7], tensionable: true },
  mM7: { required: [0, 3, 11], optional: [7], tensionable: false },
  "m7-5": { required: [0, 3, 6, 10], optional: [], tensionable: false },
  dim7: { required: [0, 3, 6, 9], optional: [], tensionable: false },
  "7sus4": { required: [0, 5, 10], optional: [7], tensionable: false },
  "6": { required: [0, 4, 9], optional: [7], tensionable: false },
  m6: { required: [0, 3, 9], optional: [7], tensionable: false },
  "9": { required: [0, 4, 10, 2], optional: [7], tensionable: false },
  M9: { required: [0, 4, 11, 2], optional: [7], tensionable: false },
  m9: { required: [0, 3, 10, 2], optional: [7], tensionable: false },
  add9: { required: [0, 4, 2], optional: [7], tensionable: false },
  "13": { required: [0, 4, 10, 9], optional: [7, 2], tensionable: false },
};

const TENSION_SEMITONES: Readonly<Record<Tension, number>> = {
  b9: 1,
  "9": 2,
  "#9": 3,
  "#11": 6,
  b13: 8,
  "13": 9,
};
const EXPECTED_CONFLICTS = [
  ["9", "b9"],
  ["9", "#9"],
  ["13", "b13"],
] as const;

const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as const;
const pitchClassOf = (note: { letter: NoteLetter; accidental: Accidental }) =>
  (NATURAL[note.letter] + (note.accidental === "#" ? 1 : note.accidental === "b" ? -1 : 0) + 12) % 12;
const ascending = (values: Iterable<number>) => [...new Set(values)].sort((a, b) => a - b);

const hasConflict = (tensions: readonly Tension[]) =>
  EXPECTED_CONFLICTS.some(([a, b]) => tensions.includes(a) && tensions.includes(b));

/** 6 つのテンションの部分集合（順序は TENSIONS の並び）をすべて返す。 */
const ALL_TENSION_SUBSETS: readonly (readonly Tension[])[] = Array.from({ length: 1 << TENSIONS.length }, (_, mask) =>
  TENSIONS.filter((_, i) => (mask & (1 << i)) !== 0),
);

const C_MAJOR: ChordSelection = {
  root: { letter: "C", accidental: "" },
  quality: "",
  tensions: [],
  bass: null,
};

function symbolOf(selection: ChordSelection): string {
  const result = buildChordSymbol(selection);
  if (!result.ok) throw new Error(`組み立てに失敗: ${result.reason}`);
  return result.symbol;
}

describe("CHORD_QUALITIES: 種類の一覧", () => {
  it("20 種で、公開するのは names と tensionable だけ（音程の配列は出さない）", () => {
    expect(CHORD_QUALITIES).toHaveLength(20);
    for (const quality of CHORD_QUALITIES) {
      expect(Object.keys(quality).sort()).toEqual(["names", "tensionable"]);
    }
  });

  it("names[0]（記号に出す名前）は種類ごとに別で、テスト内の表と同じ集まり。三和音の M は空文字", () => {
    const firstNames = CHORD_QUALITIES.map((q) => q.names[0]);
    expect(new Set(firstNames).size).toBe(20);
    expect([...firstNames].sort()).toEqual(Object.keys(EXPECTED_QUALITIES).sort());
    expect(firstNames).toContain("");
  });

  it("テンションを付けられるのは 7・M7・m7 だけ", () => {
    const tensionable = CHORD_QUALITIES.filter((q) => q.tensionable).map((q) => q.names[0]);
    expect(tensionable.sort()).toEqual(["7", "M7", "m7"]);
  });
});

describe("buildChordSymbol: 記号の形", () => {
  it("三和音は種類を付けない（C）。シャープ・フラットは ASCII の # と b", () => {
    expect(symbolOf(C_MAJOR)).toBe("C");
    expect(symbolOf({ ...C_MAJOR, root: { letter: "F", accidental: "#" }, quality: "m7" })).toBe("F#m7");
    expect(symbolOf({ ...C_MAJOR, root: { letter: "B", accidental: "b" }, quality: "7sus4" })).toBe("Bb7sus4");
  });

  it("テンションは括弧の中にカンマ区切り、ベース音は / のあとに付く", () => {
    expect(
      symbolOf({
        root: { letter: "D", accidental: "b" },
        quality: "M7",
        tensions: ["13", "9"],
        bass: { letter: "G", accidental: "" },
      }),
    ).toBe("DbM7(9,13)/G");
  });

  it("ベース音なしならスラッシュを付けない。ベースが根音と同じでもそのまま出す", () => {
    expect(symbolOf(C_MAJOR)).not.toContain("/");
    expect(symbolOf({ ...C_MAJOR, bass: { letter: "C", accidental: "" } })).toBe("C/C");
  });

  it("テンションは b9, 9, #9, #11, b13, 13 の順に並ぶ", () => {
    expect(TENSIONS).toEqual(["b9", "9", "#9", "#11", "b13", "13"]);
    expect(symbolOf({ ...C_MAJOR, quality: "7", tensions: ["13", "#11", "#9", "b9"] })).toBe("C7(b9,#9,#11,13)");
  });

  it("テンションを選ぶ順が違っても、同じ記号になる（性質）", () => {
    const validSubsets = ALL_TENSION_SUBSETS.filter((s) => !hasConflict(s));
    fc.assert(
      fc.property(
        fc.constantFrom(...validSubsets).chain((subset) => {
          // 同じ要素を、ランダムな順に並べ替えたもの。
          const shuffled = fc.shuffledSubarray([...subset], { minLength: subset.length });
          return fc.tuple(fc.constant(subset), shuffled);
        }),
        ([subset, shuffled]) => {
          const a = buildChordSymbol({ ...C_MAJOR, quality: "7", tensions: subset });
          const b = buildChordSymbol({ ...C_MAJOR, quality: "7", tensions: shuffled });
          expect(b).toEqual(a);
        },
      ),
    );
  });

  it("b9 と #9 の同時指定は矛盾ではなく有効", () => {
    expect(symbolOf({ ...C_MAJOR, quality: "7", tensions: ["#9", "b9"] })).toBe("C7(b9,#9)");
  });

  it("同じテンションを 2 回渡しても 1 回にまとめる", () => {
    expect(symbolOf({ ...C_MAJOR, quality: "7", tensions: ["9", "9"] })).toBe("C7(9)");
  });

  it("テンションを付けられない種類に渡しても、無視して記号を作る", () => {
    expect(symbolOf({ ...C_MAJOR, quality: "m", tensions: ["9", "13"] })).toBe("Cm");
    expect(symbolOf({ ...C_MAJOR, quality: "13", tensions: ["b9"] })).toBe("C13");
    expect(symbolOf({ ...C_MAJOR, quality: "m", tensions: ["9", "b9"] })).toBe("Cm"); // 矛盾する組でも失敗にしない
  });
});

describe("buildChordSymbol: 同時に使えないテンションの組", () => {
  it.each(EXPECTED_CONFLICTS)("%s と %s は失敗の値を返し、例外を投げない", (a, b) => {
    expect(buildChordSymbol({ ...C_MAJOR, quality: "7", tensions: [a, b] })).toEqual({
      ok: false,
      reason: "conflicting-tension",
    });
  });

  it("ほかのテンションが混ざっていても失敗する", () => {
    expect(buildChordSymbol({ ...C_MAJOR, quality: "m7", tensions: ["#11", "13", "b13", "b9"] })).toEqual({
      ok: false,
      reason: "conflicting-tension",
    });
  });

  it("tensionsConflictingWith は、同時に選べないテンションを返す", () => {
    expect([...tensionsConflictingWith("9")].sort()).toEqual(["#9", "b9"]);
    expect([...tensionsConflictingWith("b9")]).toEqual(["9"]);
    expect([...tensionsConflictingWith("#9")]).toEqual(["9"]);
    expect([...tensionsConflictingWith("13")]).toEqual(["b13"]);
    expect([...tensionsConflictingWith("b13")]).toEqual(["13"]);
    expect([...tensionsConflictingWith("#11")]).toEqual([]);
  });
});

describe("buildChordSymbol: すべての組み合わせ", () => {
  it("組み立てた記号は parseChord で読め、構成音が選択の意味と一致する（根音 21 × 種類 20 × テンション × ベース 22）", () => {
    let count = 0;
    for (const root of NOTES) {
      for (const quality of CHORD_QUALITIES) {
        const name = quality.names[0]!;
        const expected = EXPECTED_QUALITIES[name]!;
        const tensionChoices = expected.tensionable
          ? ALL_TENSION_SUBSETS.filter((s) => !hasConflict(s))
          : [[] as readonly Tension[]];
        for (const tensions of tensionChoices) {
          for (const bass of [null, ...NOTES]) {
            const result = buildChordSymbol({ root, quality: name, tensions, bass });
            if (!result.ok) throw new Error(`失敗: ${JSON.stringify({ root, name, tensions, bass })}`);
            const parsed = parseChord(result.symbol);
            if (!parsed.ok) throw new Error(`${result.symbol} が読めない: ${parsed.reason}`);

            const rootPc = pitchClassOf(root);
            const bassPc = bass === null ? rootPc : pitchClassOf(bass);
            const required = ascending([
              ...expected.required.map((s) => (rootPc + s) % 12),
              ...tensions.map((t) => (rootPc + TENSION_SEMITONES[t]) % 12),
              bassPc,
            ]);
            const optional = ascending(
              expected.optional.map((s) => (rootPc + s) % 12).filter((pc) => !required.includes(pc)),
            );
            expect({ symbol: result.symbol, required: parsed.required, optional: parsed.optional, bass: parsed.bass }).toEqual({
              symbol: result.symbol,
              required,
              optional,
              bass: bassPc,
            });
            count++;
          }
        }
      }
    }
    // 根音 21 × ベース 22 × (17 種 + 3 種 × 有効なテンションの組 30)
    expect(count).toBe(21 * 22 * (17 + 3 * 30));
  });
});
