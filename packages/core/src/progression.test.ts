import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_PROGRESSION_CHORDS, optimizeProgression, optimizeSymbols, splitProgression } from "./progression.ts";
import { chord, chordSymbols, show } from "./test-helpers.ts";
import { generateVoicings, validateVoicing } from "./voicing.ts";

/** 成功を期待して、選ばれた押さえ方を "x32010" の形で返す。 */
function picked(text: string): string[] {
  const result = optimizeProgression(text);
  if (!result.ok) throw new Error(`${text} が失敗: ${JSON.stringify(result)}`);
  return result.steps.map((step) => show(step.voicing));
}

describe("splitProgression: 進行の分割", () => {
  it("空白で分ける", () => {
    expect(splitProgression("C Am F G")).toEqual(["C", "Am", "F", "G"]);
  });

  it("`|`・改行・タブ・全角空白でも分ける。空白なしの `|` も分ける", () => {
    expect(splitProgression("C Am | F G7\nDm7\tG7　CM7")).toEqual([
      "C", "Am", "F", "G7", "Dm7", "G7", "CM7",
    ]);
    expect(splitProgression("C|Am")).toEqual(["C", "Am"]);
  });

  it("全角の `｜` や全角の英数字でも、半角と同じに扱う", () => {
    expect(splitProgression("C｜Am　Ｆ")).toEqual(["C", "Am", "F"]);
  });

  it("連続した区切りや先頭・末尾の区切りは、空の記号を作らない", () => {
    expect(splitProgression("| C  ||  Am \n\n |")).toEqual(["C", "Am"]);
  });
});

describe("optimizeProgression: 入力の上限と失敗", () => {
  it.each(["", "   ", " | \n | "])("空入力・区切りだけ（%j）は empty", (text) => {
    expect(optimizeProgression(text)).toEqual({ ok: false, reason: "empty" });
  });

  it("1000 文字ちょうどは受理し、1001 文字は too-long", () => {
    expect(optimizeProgression("C" + " ".repeat(999)).ok).toBe(true);
    expect(optimizeProgression("C" + " ".repeat(1000))).toEqual({ ok: false, reason: "too-long" });
  });

  it("64 コードちょうどは受理し、65 コードは too-many-chords", () => {
    expect(optimizeProgression(Array(64).fill("C").join(" ")).ok).toBe(true);
    expect(optimizeProgression(Array(65).fill("C").join(" "))).toEqual({
      ok: false,
      reason: "too-many-chords",
    });
  });

  it("文字数超過とコード数超過が両方なら、文字数超過を返す", () => {
    const text = Array(65).fill("C").join(" ") + " ".repeat(1000);
    expect(optimizeProgression(text)).toEqual({ ok: false, reason: "too-long" });
  });

  it("読めない記号は全部まとめて、何番目か（0 始まり）・記号・理由の種類を付けて返す", () => {
    expect(optimizeProgression("C H Am Cfoo")).toEqual({
      ok: false,
      reason: "invalid-chords",
      chords: [
        { index: 1, symbol: "H", reason: "invalid-root" },
        { index: 3, symbol: "Cfoo", reason: "unsupported-quality" },
      ],
    });
  });

  it("押さえ方が 0 件のコードは no-voicing として返す", () => {
    expect(optimizeProgression("C C7(b9,#9,#11)")).toEqual({
      ok: false,
      reason: "invalid-chords",
      chords: [{ index: 1, symbol: "C7(b9,#9,#11)", reason: "no-voicing" }],
    });
  });

  it("読めない記号と 0 件のコードが混ざっても、順番どおり全部返す", () => {
    const result = optimizeProgression("C7(b9,#9,#11) X C");
    expect(result).toEqual({
      ok: false,
      reason: "invalid-chords",
      chords: [
        { index: 0, symbol: "C7(b9,#9,#11)", reason: "no-voicing" },
        { index: 1, symbol: "X", reason: "invalid-root" },
      ],
    });
  });

  it("どんな文字列でも例外を投げず、成功か失敗のどちらかを返す（性質）", () => {
    const chordish = fc
      .array(fc.constantFrom("C", "Am", "G7", "/", "(", ")", "b9", "|", " ", "\n", "X", "😀"), {
        maxLength: 40,
      })
      .map((parts) => parts.join(""));
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 1100 }), fc.string({ unit: "binary" }), chordish), (text) => {
        const result = optimizeProgression(text);
        expect(typeof result.ok).toBe("boolean");
      }),
    );
  });
});

describe("optimizeProgression: 選び方と戻り値", () => {
  it("同じコードが続くと、同じ押さえ方が選ばれる", () => {
    for (const text of ["C C C", "C C F", "Am Am Am Am"]) {
      const steps = picked(text);
      const names = text.split(" ");
      names.forEach((name, i) => {
        if (i > 0 && name === names[i - 1]) expect(steps[i]).toBe(steps[i - 1]);
      });
    }
  });

  it("前後に別のコードがあっても、同じコードが続くと同じ押さえ方が選ばれる", () => {
    // 押さえるフレットが無い押さえ方（Em7 の 0x0000 など）を挟んでも、位置が飛ばないこと。
    for (const text of ["Em7 Em7 C7", "C7 Em7 Em7", "A7sus4 A7sus4 F", "F A7sus4 A7sus4 G6 G6"]) {
      const names = text.split(" ");
      const steps = picked(text);
      names.forEach((name, i) => {
        if (i > 0 && name === names[i - 1]) expect(steps[i]).toBe(steps[i - 1]);
      });
    }
  });

  it("どんな進行でも、隣り合う同じコードは同じ押さえ方（性質）", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("Em7", "E7sus4", "G6", "A7sus4", "C7", "F", "Am"), { minLength: 2, maxLength: 8 }), (list) => {
        const steps = picked(list.join(" "));
        list.forEach((name, i) => {
          if (i > 0 && name === list[i - 1]) expect(steps[i]).toBe(steps[i - 1]);
        });
      }),
      { numRuns: 30 },
    );
  });

  it("同じコードを n 回（1〜8）並べると、全部同じ押さえ方（性質）", () => {
    fc.assert(
      fc.property(chordSymbols, fc.integer({ min: 1, max: 8 }), (symbol, n) => {
        const steps = picked(Array(n).fill(symbol).join(" "));
        expect(new Set(steps).size).toBe(1);
      }),
      { numRuns: 50 },
    );
  });

  it("同じ入力は毎回同じ結果（性質）", () => {
    fc.assert(
      fc.property(fc.array(chordSymbols, { minLength: 1, maxLength: 8 }), (list) => {
        const text = list.join(" ");
        expect(optimizeProgression(text)).toEqual(optimizeProgression(text));
      }),
      { numRuns: 30 },
    );
  });

  it("各コードに、記号（全角は半角にそろえた綴り）・押さえ方・候補の中での位置が付く", () => {
    const result = optimizeProgression("Cmaj7 CM7 C△7");
    if (!result.ok) throw new Error("失敗");
    expect(result.steps.map((step) => step.symbol)).toEqual(["Cmaj7", "CM7", "C△7"]);
    const wide = optimizeProgression("Ｃ　Ａｍ");
    expect(wide.ok && wide.steps.map((step) => step.symbol)).toEqual(["C", "Am"]);
    for (const step of result.steps) {
      expect(step.voicing).toEqual(generateVoicings(chord(step.symbol))[step.candidateIndex]);
    }
    expect(Number.isFinite(result.totalCost)).toBe(true);
  });

  it("選ばれた押さえ方はすべて validateVoicing を通る（性質）", () => {
    fc.assert(
      fc.property(fc.array(chordSymbols, { minLength: 1, maxLength: 8 }), (list) => {
        const result = optimizeProgression(list.join(" "));
        if (!result.ok) throw new Error("失敗");
        result.steps.forEach((step) => {
          expect(validateVoicing(step.voicing, chord(step.symbol))).toEqual({ ok: true });
        });
      }),
      { numRuns: 30 },
    );
  });

  it("64 コードの進行（種類を混ぜる）も成功し、64 個返る", () => {
    const list = Array.from({ length: 64 }, (_, i) => `${"CDEFGAB"[i % 7]}${["", "m", "7", "M7", "m7", "sus4", "13"][(i * 3) % 7]}`);
    const result = optimizeProgression(list.join(" "));
    expect(result.ok && result.steps.length).toBe(64);
  });
});

// 重みを変えたらここも変わる（6弦から1弦の順。x はミュート）。
describe("optimizeProgression: 代表の進行", () => {
  it("C Am F G", () => {
    expect(picked("C Am F G")).toEqual(["x32010", "x02210", "133211", "320003"]);
  });

  it("Dm7 G7 CM7", () => {
    expect(picked("Dm7 G7 CM7")).toEqual(["xx0211", "320001", "x32000"]);
  });

  it("C Am | F G7（`|` が入っても同じ並び）", () => {
    expect(picked("C Am | F G7")).toEqual(["x32010", "x02210", "133211", "320001"]);
  });
});

describe("optimizeSymbols: 記号の配列から選ぶ", () => {
  it("空の配列は empty", () => {
    expect(optimizeSymbols([])).toEqual({ ok: false, reason: "empty" });
  });

  it("64 個ちょうどは受理し、65 個は too-many-chords", () => {
    expect(MAX_PROGRESSION_CHORDS).toBe(64);
    expect(optimizeSymbols(Array(64).fill("C")).ok).toBe(true);
    expect(optimizeSymbols(Array(65).fill("C"))).toEqual({ ok: false, reason: "too-many-chords" });
  });

  it("連結すると 1000 文字を超える記号の列でも、64 個以内なら結果を返す（文字数は検査しない）", () => {
    const symbols = Array(64).fill("F#m7(b9,#9,#11)/Bb");
    expect(symbols.join(" ").length).toBeGreaterThan(1000);
    const result = optimizeSymbols(symbols);
    expect(result.ok && result.steps.length).toBe(64);
  });

  it("読めない記号と押さえ方が無い記号を、番号（0 始まり）・記号・理由つきで全部返す", () => {
    expect(optimizeSymbols(["C", "H", "C7(b9,#9,#11)"])).toEqual({
      ok: false,
      reason: "invalid-chords",
      chords: [
        { index: 1, symbol: "H", reason: "invalid-root" },
        { index: 2, symbol: "C7(b9,#9,#11)", reason: "no-voicing" },
      ],
    });
  });

  it("splitProgression で分けた結果を渡すと、optimizeProgression と同じ結果（成功・失敗とも。性質）", () => {
    const piece = fc.oneof(chordSymbols, fc.constantFrom("H", "Cxyz", "C7(b9,#9,#11)", "|", "C7(9,b9)"));
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 10 }), fc.constantFrom(" ", "\n", " | "), (list, separator) => {
        const text = list.join(separator);
        expect(optimizeSymbols(splitProgression(text))).toEqual(optimizeProgression(text));
      }),
      { numRuns: 50 },
    );
  });
});
