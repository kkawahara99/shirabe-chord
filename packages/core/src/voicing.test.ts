import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ParsedChord } from "./chord.ts";
import { chord, v } from "./test-helpers.ts";
import {
  generateVoicings,
  rootStrings,
  validateVoicing,
  voicingFeatures,
  type Voicing,
  type VoicingFailure,
} from "./voicing.ts";

/** 妥当なら "ok"、そうでなければ理由の種類。 */
function verdict(voicing: unknown, symbol: string): VoicingFailure | "ok" {
  const result = validateVoicing(voicing, chord(symbol));
  return result.ok ? "ok" : result.reason;
}

const key = (voicing: Voicing) => voicing.map((fret) => fret ?? "x").join(",");

const WELL_KNOWN: [string, string][] = [
  ["C", "x32010"],
  ["F", "133211"],
  ["G", "320003"],
  ["Am", "x02210"],
  ["E7", "020100"],
];

describe("validateVoicing: よく知られた押さえ方", () => {
  it.each(WELL_KNOWN)("%s の %s は妥当", (symbol, text) => {
    expect(verdict(v(text), symbol)).toBe("ok");
  });
});

describe("validateVoicing: 条件 1 形", () => {
  const invalid: [string, unknown][] = [
    ["長さ 5", [0, 0, 0, 0, 0]],
    ["長さ 7", [0, 0, 0, 0, 0, 0, 0]],
    ["配列でない（文字列）", "x32010"],
    ["配列でない（オブジェクト）", { 0: 3, length: 6 }],
    ["null", null],
    ["undefined", undefined],
    ["数", 3],
    ["小数", [1.5, 0, 0, 0, 0, 0]],
    ["NaN", [Number.NaN, 0, 0, 0, 0, 0]],
    ["Infinity", [Number.POSITIVE_INFINITY, 0, 0, 0, 0, 0]],
    ["負の数", [-1, 0, 0, 0, 0, 0]],
    ["16", [16, 0, 0, 0, 0, 0]],
    ["数字の文字列", ["3", 0, 0, 0, 0, 0]],
    ["undefined の要素", [undefined, 0, 0, 0, 0, 0]],
    ["穴あき配列", [3, , 0, 0, 0, 0]],
  ];
  it.each(invalid)("%s は invalid-shape", (_name, value) => {
    expect(verdict(value, "C")).toBe("invalid-shape");
  });

  it("失効した Proxy も、例外でなく invalid-shape", () => {
    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();
    expect(verdict(proxy, "C")).toBe("invalid-shape");
  });

  it("0 と 15 は形として通る（ほかの理由で不合格になるのはよい）", () => {
    expect(verdict(v("0 0 0 0 0 15"), "C")).not.toBe("invalid-shape");
  });
});

describe("validateVoicing: 条件 2 鳴らす弦が 3 本以上", () => {
  it("鳴らす弦が 2 本（C の xxxx10）は too-few-strings", () => {
    expect(verdict(v("xxxx10"), "C")).toBe("too-few-strings");
  });
  it("鳴らす弦が 3 本（C の x320xx）は通る", () => {
    expect(verdict(v("x320xx"), "C")).toBe("ok");
  });
});

describe("validateVoicing: 条件 3 鳴らす音", () => {
  it("必須の音（3度）が欠けると wrong-notes（C の x355xx）", () => {
    expect(verdict(v("x355xx"), "C")).toBe("wrong-notes");
  });
  it("構成音の外の音を含むと wrong-notes（C の x32030 は 2弦が D）", () => {
    expect(verdict(v("x32030"), "C")).toBe("wrong-notes");
  });
  it("省略できる音（5度）は、含んでも含まなくてもよい", () => {
    expect(verdict(v("x32010"), "C")).toBe("ok"); // 5度（G）あり
    expect(verdict(v("x325x0"), "C")).toBe("ok"); // 5度なし（C E C E）
  });
});

describe("validateVoicing: 条件 4 最も低い音がベース", () => {
  it("最も低い音が E の C（032010）は wrong-bass", () => {
    expect(verdict(v("032010"), "C")).toBe("wrong-bass");
  });
  it("最も低い音は、弦でなく音の高さで比べる: 6弦が D でも 5弦開放の A の方が低ければ wrong-bass", () => {
    const voicing = v("10 0 12 10 10 x");
    expect(verdict(voicing, "Dm")).toBe("wrong-bass");
    expect(verdict(voicing, "Dm/A")).toBe("ok");
  });
});

describe("validateVoicing: 条件 5 押さえるフレットの差が 3 以下", () => {
  it("差が 4（C の x35510）は wide-span", () => {
    expect(verdict(v("x35510"), "C")).toBe("wide-span");
  });
  it("差が 3（C の x325x0）は通る", () => {
    expect(verdict(v("x325x0"), "C")).toBe("ok");
  });
  it("押さえるフレットが無い（開放とミュートだけの Em7 の 0x0000）は差 0 で通る", () => {
    expect(verdict(v("0x0000"), "Em7")).toBe("ok");
  });
});

describe("validateVoicing: 条件 6 鳴らす弦の間のミュートは 1 本まで", () => {
  it("間のミュートが 2 本（C の x3xx10）は too-many-inner-mutes", () => {
    expect(verdict(v("x3xx10"), "C")).toBe("too-many-inner-mutes");
  });
  it("間のミュートが 1 本（C の x3x010）は通る", () => {
    expect(verdict(v("x3x010"), "C")).toBe("ok");
  });
  it("両端のミュートは数えない（C の x320xx は両端 4 本がミュート）", () => {
    expect(verdict(v("x320xx"), "C")).toBe("ok");
  });
});

describe("validateVoicing: 条件 7 指", () => {
  it("押さえる位置が 5 つでセーハも無い（C の x32553）は too-many-fingers", () => {
    expect(verdict(v("x32553"), "C")).toBe("too-many-fingers");
  });
  it("位置は 6 つでも、セーハで 4 本になる F の 133211 は通る", () => {
    expect(verdict(v("133211"), "F")).toBe("ok");
  });
  it("セーハの範囲に開放弦がある（FM7 の 133210）と、セーハにならず too-many-fingers", () => {
    expect(verdict(v("133210"), "FM7")).toBe("too-many-fingers");
  });
  it("セーハの範囲のミュート（F の 13321x）は指の腹で消せるので通る", () => {
    expect(verdict(v("13321x"), "F")).toBe("ok");
  });
});

describe("validateVoicing: 理由の優先順", () => {
  it("複数の条件を破るときは、番号の小さい方の理由を返す", () => {
    // 鳴らす弦が 2 本で、音もコードの外 → 条件 2 が先
    expect(verdict(v("xxxx01"), "C")).toBe("too-few-strings");
    // 最低音が違い、差も 4 → 条件 4 が先
    expect(verdict(v("035510"), "C")).toBe("wrong-bass");
    // 形が違えば、ほかが何であれ invalid-shape
    expect(verdict([0, 0, 0, 0, 0], "C")).toBe("invalid-shape");
  });
});

describe("validateVoicing: 例外を投げない", () => {
  const chords = ["C", "F", "Bm7-5", "G13", "Dm/A"].map(chord);
  const known = new Set<string>([
    "invalid-shape",
    "too-few-strings",
    "wrong-notes",
    "wrong-bass",
    "wide-span",
    "too-many-inner-mutes",
    "too-many-fingers",
  ]);
  const noise = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.integer({ min: -3, max: 20 }),
    fc.double(),
    fc.string(),
    fc.boolean(),
  );

  it("任意の値を渡しても、例外なく、妥当か既知の理由のどちらかを返す", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.anything(), fc.array(noise, { minLength: 4, maxLength: 8 })),
        fc.constantFrom(...chords),
        (value, target) => {
          const result = validateVoicing(value, target);
          return result.ok || known.has(result.reason);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("形の合う押さえ方（6 弦それぞれ 0〜15 かミュート）なら、invalid-shape にならない", () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.integer({ min: 0, max: 15 }), { nil: null }), {
          minLength: 6,
          maxLength: 6,
        }),
        fc.constantFrom(...chords),
        (value, target) => {
          const result = validateVoicing(value, target);
          return result.ok || result.reason !== "invalid-shape";
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("generateVoicings", () => {
  it.each(WELL_KNOWN)("%s の候補に %s が入る", (symbol, text) => {
    const keys = generateVoicings(chord(symbol)).map(key);
    expect(keys).toContain(key(v(text)));
  });

  it.each(["C", "F", "Bm7-5", "G13"])("%s は候補が 1 件以上ある", (symbol) => {
    expect(generateVoicings(chord(symbol)).length).toBeGreaterThan(0);
  });

  it("必須の音が 6 本の弦に収まらないコード（C7(b9,#9,#11,b13)）は、失敗にせず空の配列", () => {
    expect(generateVoicings(chord("C7(b9,#9,#11,b13)"))).toEqual([]);
  });

  it("押さえるフレットが無い押さえ方は平均 0 なので先頭側に並ぶ（Em7）", () => {
    const first = generateVoicings(chord("Em7"))
      .slice(0, 3)
      .map((voicing) => key(voicing));
    // 6弦が E の開放で、5弦（A）は鳴らせず、間のミュートはこの 1 本まで。辞書順はミュートが最小。
    expect(first).toEqual([
      key(v("0x00xx")),
      key(v("0x000x")),
      key(v("0x0000")),
    ]);
  });

  /** 全探索（フレットを options に限った 6 弦の全組み合わせ）で、妥当なものを集める。 */
  function exhaustive(target: ParsedChord, options: readonly (number | null)[]): Set<string> {
    const n = options.length;
    const found = new Set<string>();
    for (let i = 0; i < n ** 6; i++) {
      const voicing: (number | null)[] = [];
      let rest = i;
      for (let string = 0; string < 6; string++) {
        voicing.push(options[rest % n]!);
        rest = Math.floor(rest / n);
      }
      if (validateVoicing(voicing, target).ok) found.add(key(voicing));
    }
    return found;
  }

  const universes: [string, (number | null)[]][] = [
    ["ミュート・0〜6", [null, 0, 1, 2, 3, 4, 5, 6]],
    ["ミュート・0・4〜9", [null, 0, 4, 5, 6, 7, 8, 9]],
    ["ミュート・0・8〜13", [null, 0, 8, 9, 10, 11, 12, 13]],
    ["ミュート・0・11〜15", [null, 0, 11, 12, 13, 14, 15]],
  ];
  describe.each(["C", "F", "Bm7-5", "G13"])("%s: 全探索との一致", (symbol) => {
    it.each(universes)("フレットを %s に限った全組み合わせの妥当なものと、生成結果が過不足なく一致", (_name, options) => {
      const target = chord(symbol);
      const inUniverse = (voicing: Voicing) => voicing.every((fret) => options.includes(fret));
      const generated = new Set(generateVoicings(target).filter(inUniverse).map(key));
      const expected = exhaustive(target, options);
      expect([...generated].sort()).toEqual([...expected].sort());
    });
  });

  describe("任意のコード記号", () => {
    const roots = ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
    const qualities = [
      "", "m", "7", "M7", "m7", "mM7", "6", "m6", "9", "M9", "m9", "add9", "13",
      "m7-5", "dim", "dim7", "aug", "sus4", "sus2", "7sus4", "7(#9,b13)", "m7(9,13)",
    ];
    const symbols = fc
      .tuple(fc.constantFrom(...roots), fc.constantFrom(...qualities), fc.option(fc.constantFrom(...roots), { nil: undefined }))
      .map(([root, quality, bass]) => `${root}${quality}${bass === undefined ? "" : `/${bass}`}`);

    /** 平均フレット（押さえる位置が無ければ 0）。 */
    const average = (voicing: Voicing) => {
      const pressed = voicing.filter((fret): fret is number => fret !== null && fret > 0);
      return pressed.length === 0 ? 0 : pressed.reduce((a, b) => a + b, 0) / pressed.length;
    };
    /** 並び順の比較。ミュートを最も小さい（-1）とみなして辞書順。 */
    const before = (a: Voicing, b: Voicing) => {
      if (average(a) !== average(b)) return average(a) < average(b);
      for (let string = 0; string < 6; string++) {
        const x = a[string] ?? -1;
        const y = b[string] ?? -1;
        if (x !== y) return x < y;
      }
      return false;
    };

    it("生成した候補はすべて validateVoicing を通り、重複がなく、並び順が正しい", () => {
      fc.assert(
        fc.property(symbols, (symbol) => {
          const target = chord(symbol);
          const voicings = generateVoicings(target);
          const allValid = voicings.every((voicing) => validateVoicing(voicing, target).ok);
          const strictlyOrdered = voicings.every((voicing, i) => i === 0 || before(voicings[i - 1]!, voicing));
          return allValid && strictlyOrdered;
        }),
        { numRuns: 60 },
      );
    });
  });
});

describe("voicingFeatures", () => {
  it("C の x32010 は、3 本・セーハ無・幅 2・最高フレット 3・平均 2・開放 2", () => {
    expect(voicingFeatures(v("x32010"))).toEqual({
      fingers: 3,
      hasBarre: false,
      span: 2,
      highestFret: 3,
      averageFret: 2,
      openStrings: 2,
    });
  });

  it("F の 133211 は、4 本・セーハ有・幅 2・最高フレット 3・平均 11/6・開放 0", () => {
    expect(voicingFeatures(v("133211"))).toEqual({
      fingers: 4,
      hasBarre: true,
      span: 2,
      highestFret: 3,
      averageFret: 11 / 6,
      openStrings: 0,
    });
  });

  it("押さえるフレットが無い 000000 は、0 本・セーハ無・幅 0・最高フレット 0・平均 0・開放 6", () => {
    expect(voicingFeatures(v("000000"))).toEqual({
      fingers: 0,
      hasBarre: false,
      span: 0,
      highestFret: 0,
      averageFret: 0,
      openStrings: 6,
    });
  });

  it("x02222 は、位置が 4 つで足りても、セーハが成り立つのでセーハ有・1 本", () => {
    const features = voicingFeatures(v("x02222"));
    expect(features.hasBarre).toBe(true);
    expect(features.fingers).toBe(1);
  });

  it("セーハの範囲に開放弦がある 133210 は、セーハ無・5 本", () => {
    const features = voicingFeatures(v("133210"));
    expect(features.hasBarre).toBe(false);
    expect(features.fingers).toBe(5);
  });

  it("最も低いフレットの弦が 1 本だけなら、後ろに開放弦が無くてもセーハ無（x3241x）", () => {
    const features = voicingFeatures(v("x3241x"));
    expect(features.hasBarre).toBe(false);
    expect(features.fingers).toBe(4);
  });

  it("セーハの範囲のミュート（13321x）は、セーハ有・4 本", () => {
    const features = voicingFeatures(v("13321x"));
    expect(features.hasBarre).toBe(true);
    expect(features.fingers).toBe(4);
  });
});

describe("rootStrings（ルート音を鳴らす弦）", () => {
  it("ルート音の弦の番号（1〜6、1弦が高音）を昇順で返す", () => {
    expect(rootStrings("C", v("x32010"))).toEqual([2, 5]);
    expect(rootStrings("E", v("022100"))).toEqual([1, 4, 6]);
    expect(rootStrings("F", v("133211"))).toEqual([1, 4, 6]);
  });

  it("オンコードでも、印はルート音の弦で、ベース音の弦ではない", () => {
    expect(rootStrings("C/E", v("032010"))).toEqual([2, 5]);
  });

  it("鳴らさない弦は含めない", () => {
    expect(rootStrings("C", v("x3xxx0"))).toEqual([5]);
    expect(rootStrings("C", v("xxxxxx"))).toEqual([]);
  });

  it.each(["", "H", "C/", "Cxyz"])("読めない記号 %j は空の配列", (symbol) => {
    expect(rootStrings(symbol, v("x32010"))).toEqual([]);
  });

  it("任意のコードの全候補で、戻り値は 1〜6 の昇順・重複なしで、各弦の音がルートと一致する", () => {
    const symbols = ["C", "Am7", "F", "G7", "Bm7-5", "D/F#", "E7(#9,b13)", "Bb", "F#m"];
    for (const symbol of symbols) {
      const parsed = chord(symbol);
      for (const voicing of generateVoicings(parsed)) {
        const strings = rootStrings(symbol, voicing);
        expect(strings).toEqual([...new Set(strings)].sort((a, b) => a - b));
        const expected = voicing.flatMap((fret, i) =>
          fret !== null && ([40, 45, 50, 55, 59, 64][i]! + fret) % 12 === parsed.root ? [6 - i] : [],
        );
        expect(strings).toEqual(expected.sort((a, b) => a - b));
        for (const string of strings) {
          const fret = voicing[6 - string];
          expect(fret).not.toBeNull();
          const pitch = [40, 45, 50, 55, 59, 64][6 - string]! + fret!;
          expect(pitch % 12).toBe(parsed.root);
        }
      }
    }
  });
});
