import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseChord, type ChordParseFailure, type ParsedChord } from "./chord.ts";
import { transpose, type PitchClass } from "./pitch-class.ts";

const PC = {
  C: 0,
  Db: 1,
  D: 2,
  Eb: 3,
  E: 4,
  F: 5,
  Gb: 6,
  G: 7,
  Ab: 8,
  A: 9,
  Bb: 10,
  B: 11,
} as const;
type NoteName = keyof typeof PC;

/** 音名の並びを、昇順のピッチクラスの配列にする。 */
function pcs(...names: NoteName[]): PitchClass[] {
  return names.map((n) => PC[n] as PitchClass).sort((a, b) => a - b);
}

function parsed(symbol: string): ParsedChord {
  const result = parseChord(symbol);
  if (!result.ok) {
    throw new Error(`${symbol} が失敗した: ${result.reason}`);
  }
  return result;
}

function failure(symbol: string): ChordParseFailure {
  const result = parseChord(symbol);
  if (result.ok) {
    throw new Error(`${symbol} が成功してしまった`);
  }
  return result.reason;
}

describe("parseChord: 種類ごとの構成音（C 基準）", () => {
  const cases: [string, NoteName[], NoteName[]][] = [
    ["C", ["C", "E"], ["G"]],
    ["Cm", ["C", "Eb"], ["G"]],
    ["C7", ["C", "E", "Bb"], ["G"]],
    ["CM7", ["C", "E", "B"], ["G"]],
    ["Cmaj7", ["C", "E", "B"], ["G"]],
    ["C△7", ["C", "E", "B"], ["G"]],
    ["Cm7", ["C", "Eb", "Bb"], ["G"]],
    ["CmM7", ["C", "Eb", "B"], ["G"]],
    ["C6", ["C", "E", "A"], ["G"]],
    ["Cm6", ["C", "Eb", "A"], ["G"]],
    ["C9", ["C", "E", "Bb", "D"], ["G"]],
    ["CM9", ["C", "E", "B", "D"], ["G"]],
    ["Cm9", ["C", "Eb", "Bb", "D"], ["G"]],
    ["Cadd9", ["C", "E", "D"], ["G"]],
    ["C13", ["C", "E", "Bb", "A"], ["G", "D"]],
    ["Cm7-5", ["C", "Eb", "Gb", "Bb"], []],
    ["Cm7(b5)", ["C", "Eb", "Gb", "Bb"], []],
    ["Cø", ["C", "Eb", "Gb", "Bb"], []],
    ["Cdim", ["C", "Eb", "Gb"], []],
    ["C°", ["C", "Eb", "Gb"], []],
    ["Cdim7", ["C", "Eb", "Gb", "A"], []],
    ["C°7", ["C", "Eb", "Gb", "A"], []],
    ["Caug", ["C", "E", "Ab"], []],
    ["C+", ["C", "E", "Ab"], []],
    ["Csus4", ["C", "F"], ["G"]],
    ["Csus2", ["C", "D"], ["G"]],
    ["C7sus4", ["C", "F", "Bb"], ["G"]],
  ];

  it.each(cases)("%s の必須と省略", (symbol, required, optional) => {
    const chord = parsed(symbol);
    expect(chord.root).toBe(PC.C);
    expect(chord.bass).toBe(PC.C);
    expect(chord.required).toEqual(pcs(...required));
    expect(chord.optional).toEqual(pcs(...optional));
  });

  it("13 は 11度を含めない（3度とぶつかる）", () => {
    const chord = parsed("C13");
    expect([...chord.required, ...chord.optional]).not.toContain(PC.F);
  });

  it("m7-5 の 5度（Gb）は必須で、省略できる音に入らない", () => {
    const chord = parsed("Cm7-5");
    expect(chord.required).toContain(PC.Gb);
    expect(chord.optional).not.toContain(PC.G);
  });
});

describe("parseChord: テンションの括弧", () => {
  it.each<[string, NoteName]>([
    ["C7(b9)", "Db"],
    ["C7(9)", "D"],
    ["C7(#9)", "Eb"],
    ["C7(#11)", "Gb"],
    ["C7(b13)", "Ab"],
    ["C7(13)", "A"],
  ])("%s は %s を必須に加える", (symbol, added) => {
    const chord = parsed(symbol);
    expect(chord.required).toEqual(pcs("C", "E", "Bb", added));
    expect(chord.optional).toEqual(pcs("G"));
  });

  it("複数のテンションは全部が必須（7(b9,b13)）", () => {
    expect(parsed("C7(b9,b13)").required).toEqual(pcs("C", "E", "Bb", "Db", "Ab"));
  });

  it("b9 と #9 の同時指定は可", () => {
    expect(parsed("C7(b9,#9)").required).toEqual(pcs("C", "E", "Bb", "Db", "Eb"));
  });

  it("m7 にも付けられる", () => {
    expect(parsed("Cm7(b9)").required).toEqual(pcs("C", "Eb", "Bb", "Db"));
  });

  it("M7 にも付けられる（別名の maj7 も同じ）", () => {
    expect(parsed("CM7(#11)").required).toEqual(pcs("C", "E", "B", "Gb"));
    expect(parsed("Cmaj7(#11)")).toEqual(parsed("CM7(#11)"));
  });

  it("3度と同じ音になるテンション（m7(#9)）は重複させず必須に 1 つだけ入る", () => {
    expect(parsed("Cm7(#9)").required).toEqual(pcs("C", "Eb", "Bb"));
  });

  it.each(["C9(b9)", "C13(b13)", "Cm(b9)", "Cdim(b9)", "C(b9)", "Cm7-5(b9)"])(
    "7・m7・M7 以外に付けた %s は invalid-tension",
    (symbol) => {
      expect(failure(symbol)).toBe("invalid-tension");
    },
  );

  it.each(["C7(b5)", "C7(#5)", "C7(11)", "C7()", "C7(b9,)", "C7(b9", "C7b9)", "C7(b9)(9)", "C7(b9, b13)"])(
    "括弧の中身が一覧外か書式が不正な %s は invalid-tension",
    (symbol) => {
      expect(failure(symbol)).toBe("invalid-tension");
    },
  );

  it("種類が読めないときは括弧があっても unsupported-quality", () => {
    expect(failure("Cfoo(b9)")).toBe("unsupported-quality");
  });

  it.each(["C7(9,9)", "C7(b9,b9)", "C7(13,13)"])("重複した %s は duplicate-tension", (symbol) => {
    expect(failure(symbol)).toBe("duplicate-tension");
  });

  it.each(["C7(9,b9)", "C7(9,#9)", "C7(13,b13)", "C7(b9,9)", "C7(#9,9)", "C7(b13,13)"])(
    "同じ度数の変化しない形と変化した形の同時指定 %s は conflicting-tension",
    (symbol) => {
      expect(failure(symbol)).toBe("conflicting-tension");
    },
  );
});

describe("parseChord: オンコード", () => {
  it("C/E: ベースは E。E は 3度なので必須のまま", () => {
    const chord = parsed("C/E");
    expect(chord.root).toBe(PC.C);
    expect(chord.bass).toBe(PC.E);
    expect(chord.required).toEqual(pcs("C", "E"));
    expect(chord.optional).toEqual(pcs("G"));
  });

  it("Am7/G: ベースが 7度（構成音）", () => {
    const chord = parsed("Am7/G");
    expect(chord.root).toBe(PC.A);
    expect(chord.bass).toBe(PC.G);
    expect(chord.required).toEqual(pcs("A", "C", "G"));
    expect(chord.optional).toEqual(pcs("E"));
  });

  it("C/D: ベースが構成音でなくても、必須に加わる", () => {
    const chord = parsed("C/D");
    expect(chord.bass).toBe(PC.D);
    expect(chord.required).toEqual(pcs("C", "E", "D"));
    expect(chord.optional).toEqual(pcs("G"));
  });

  it("C/G: 省略できる G がベースなら必須に寄せ、省略できる音から除く", () => {
    const chord = parsed("C/G");
    expect(chord.required).toEqual(pcs("C", "E", "G"));
    expect(chord.optional).toEqual([]);
  });

  it("C13/D: 省略できる 9度がベースなら必須に寄せる（5度は省略できるまま）", () => {
    const chord = parsed("C13/D");
    expect(chord.required).toEqual(pcs("C", "E", "Bb", "A", "D"));
    expect(chord.optional).toEqual(pcs("G"));
  });

  it("C/C: ベースはルートと同じ", () => {
    const chord = parsed("C/C");
    expect(chord.bass).toBe(PC.C);
    expect(chord.required).toEqual(pcs("C", "E"));
  });

  it("テンションの括弧とオンコードを併用できる（G7(b9)/B）", () => {
    const chord = parsed("G7(b9)/B");
    expect(chord.root).toBe(PC.G);
    expect(chord.bass).toBe(PC.B);
    // B は 3度と同じ音なので二重に入らず、b9（Ab）が加わる。
    expect(chord.required).toEqual(pcs("G", "B", "F", "Ab"));
    expect(chord.optional).toEqual(pcs("D"));
  });

  it("ベースの判定が種類より先: C6/9 のように / を含む書き方は invalid-bass", () => {
    expect(failure("C6/9")).toBe("invalid-bass");
  });

  it("ベースの ♭ 表記（C/B♭）も読める", () => {
    expect(parsed("C/B♭")).toEqual(parsed("C/Bb"));
  });

  it.each(["C/", "C/H", "C/E/G", "C/Ex", "C/e", "C//E", "C/#E"])(
    "ベースが不正な %s は invalid-bass",
    (symbol) => {
      expect(failure(symbol)).toBe("invalid-bass");
    },
  );
});

describe("parseChord: ルートと表記ゆれ", () => {
  it.each<[string, number]>([
    ["C", 0],
    ["C#", 1],
    ["Db", 1],
    ["D", 2],
    ["D#", 3],
    ["Eb", 3],
    ["E", 4],
    ["Fb", 4],
    ["E#", 5],
    ["F", 5],
    ["F#", 6],
    ["Gb", 6],
    ["G", 7],
    ["G#", 8],
    ["Ab", 8],
    ["A", 9],
    ["A#", 10],
    ["Bb", 10],
    ["B", 11],
    ["B#", 0],
    ["Cb", 11],
  ])("ルート %s は %i", (name, pc) => {
    const chord = parsed(name);
    expect(chord.root).toBe(pc);
    expect(chord.bass).toBe(pc);
    expect(chord.required).toContain(pc);
  });

  it("異名同音（C#m7 と Dbm7）は同じ結果", () => {
    expect(parsed("C#m7")).toEqual(parsed("Dbm7"));
  });

  it("♯・♭ は #・b と同じ", () => {
    expect(parsed("C♯m7")).toEqual(parsed("C#m7"));
    expect(parsed("B♭")).toEqual(parsed("Bb"));
    expect(parsed("G7(♭9)")).toEqual(parsed("G7(b9)"));
  });

  it("全角の英数字・記号は正規化して読む", () => {
    expect(parsed("Ａｍ７")).toEqual(parsed("Am7"));
    expect(parsed("Ｃ／Ｅ")).toEqual(parsed("C/E"));
    expect(parsed("Ｇ７（♭９）")).toEqual(parsed("G7(b9)"));
    expect(parsed("Ｃ＃ｍ")).toEqual(parsed("C#m"));
  });

  it("前後の空白（全角空白・改行を含む）は除く", () => {
    expect(parsed("  Am7 \n")).toEqual(parsed("Am7"));
    expect(parsed("　C　")).toEqual(parsed("C"));
  });

  it.each(["H7", "c", "#C", "7", "/E", "あ", "1m"])("不正なルート %s は invalid-root", (symbol) => {
    expect(failure(symbol)).toBe("invalid-root");
  });
});

describe("parseChord: 失敗は例外でなく値で返る", () => {
  it.each(["", "   ", "　", "\n"])("空（%j）は empty", (symbol) => {
    expect(failure(symbol)).toBe("empty");
  });

  it.each([
    "C11",
    "Cm11",
    "CM",
    "Cmaj",
    "CMaj7",
    "Cmaj9",
    "Csus",
    "C7sus",
    "C9sus4",
    "Cdim9",
    "Cm7 5",
    "C m7",
    "C7b9",
    "Cx",
  ])("一覧にない種類 %s は unsupported-quality", (symbol) => {
    expect(failure(symbol)).toBe("unsupported-quality");
  });

  it.each(["😀", "\u0000", "C\ud800", "\ud800", "C😀", "C\u0000", "ｃ"])(
    "読めない文字（%j）でも例外を投げず失敗を返す",
    (symbol) => {
      expect(() => parseChord(symbol)).not.toThrow();
      expect(parseChord(symbol).ok).toBe(false);
    },
  );
});

// --- 性質（プロパティベース） ---

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;

const QUALITY_SUFFIXES = [
  "", "m", "7", "M7", "maj7", "△7", "m7", "mM7", "6", "m6", "9", "M9", "m9", "add9", "13",
  "m7-5", "m7(b5)", "ø", "dim", "°", "dim7", "°7", "aug", "+", "sus4", "sus2", "7sus4",
] as const;
const TENSIONABLE = ["7", "m7", "M7", "maj7", "△7"];

const anyPitchClass = fc.integer({ min: 0, max: 11 }).map((n) => n as PitchClass);

/** 変化しない形と変化した形がぶつからない、重複のないテンションの組み合わせ。 */
const tensionList = fc
  .record({
    nine: fc.constantFrom<string[]>([], ["9"], ["b9"], ["#9"], ["b9", "#9"]),
    sharp11: fc.boolean(),
    thirteen: fc.constantFrom<string[]>([], ["13"], ["b13"]),
  })
  .map(({ nine, sharp11, thirteen }) => [...nine, ...(sharp11 ? ["#11"] : []), ...thirteen])
  .chain((list) => fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length }));

/** 読める記号の構成要素。ルートとベースはピッチクラスで持ち、綴りは後で決める。 */
const validParts = fc.record({
  root: anyPitchClass,
  flat: fc.boolean(),
  quality: fc.constantFrom(...QUALITY_SUFFIXES),
  tensions: tensionList,
  bass: fc.option(anyPitchClass, { nil: undefined }),
});
type ValidParts = {
  root: PitchClass;
  flat: boolean;
  quality: string;
  tensions: string[];
  bass: PitchClass | undefined;
};

function spell(parts: ValidParts, overrides: Partial<ValidParts> = {}): string {
  const p = { ...parts, ...overrides };
  const names = p.flat ? FLAT_NAMES : SHARP_NAMES;
  const tension =
    TENSIONABLE.includes(p.quality) && p.tensions.length > 0 ? `(${p.tensions.join(",")})` : "";
  const bass = p.bass === undefined ? "" : `/${names[p.bass]}`;
  return `${names[p.root]}${p.quality}${tension}${bass}`;
}

describe("parseChord（性質）", () => {
  it("任意の文字列で例外を投げない", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        const r = parseChord(s);
        return r.ok === true || r.ok === false;
      }),
    );
  });

  it("記号の部品を並べただけの文字列でも例外を投げない", () => {
    const piece = fc.constantFrom(
      "C", "m", "7", "(", ")", "b", "#", "9", "13", "/", "E", "sus4", "add", ",", "M", "dim", " ", "０",
    );
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 12 }), (pieces) => {
        const r = parseChord(pieces.join(""));
        return r.ok === true || r.ok === false;
      }),
    );
  });

  it("読める記号は必ず成功する", () => {
    fc.assert(fc.property(validParts, (parts) => parseChord(spell(parts)).ok));
  });

  it("ルートとベースを半音ずらすと、root・bass・必須・省略が同じだけずれる", () => {
    fc.assert(
      fc.property(validParts, fc.integer({ min: -30, max: 30 }), (parts, n) => {
        const base = parsed(spell(parts));
        const shifted = parsed(
          spell(parts, {
            root: transpose(parts.root, n),
            bass: parts.bass === undefined ? undefined : transpose(parts.bass, n),
          }),
        );
        const shift = (list: readonly PitchClass[]) =>
          list.map((p) => transpose(p, n)).sort((a, b) => a - b);
        expect(shifted.root).toBe(transpose(base.root, n));
        expect(shifted.bass).toBe(transpose(base.bass, n));
        expect(shifted.required).toEqual(shift(base.required));
        expect(shifted.optional).toEqual(shift(base.optional));
      }),
    );
  });

  it("成功時の不変条件: 重ならない・ルートとベースは必須・昇順で重複なし・省略は 5度（13 だけ 9度も）", () => {
    fc.assert(
      fc.property(validParts, (parts) => {
        const chord = parsed(spell(parts));
        const strictlyAscending = (list: readonly PitchClass[]) =>
          list.every((p, i) => i === 0 || list[i - 1]! < p);
        // 9度を省略できるのは 13 だけ。ほかは完全 5度だけ。
        const allowedOptional =
          parts.quality === "13"
            ? [transpose(chord.root, 7), transpose(chord.root, 2)]
            : [transpose(chord.root, 7)];
        expect(chord.required.filter((p) => chord.optional.includes(p))).toEqual([]);
        expect(chord.required).toContain(chord.root);
        expect(chord.required).toContain(chord.bass);
        expect(chord.optional).not.toContain(chord.root);
        expect(strictlyAscending(chord.required)).toBe(true);
        expect(strictlyAscending(chord.optional)).toBe(true);
        expect(chord.optional.every((p) => allowedOptional.includes(p))).toBe(true);
      }),
    );
  });

  it("異名同音のルート名（# 側と b 側）なら、同じ種類・括弧・ベースで結果が等しい", () => {
    fc.assert(
      fc.property(validParts, (parts) => {
        expect(parseChord(spell(parts, { flat: false }))).toEqual(
          parseChord(spell(parts, { flat: true })),
        );
      }),
    );
  });
});
