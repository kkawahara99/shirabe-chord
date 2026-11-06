import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_PROGRESSION_CHORDS, MAX_PROGRESSION_LENGTH, optimizeProgression, optimizeSymbols, splitProgression } from "./progression.ts";
import { chord, chordSymbols, lowestFretOf, pressedFretsOf, show, v } from "./test-helpers.ts";
import { generateVoicings, validateVoicing, type Voicing } from "./voicing.ts";

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

describe("optimizeProgression: 窮屈な形と薄い形は選ばれにくい", () => {
  it("Bb Eb F Bb は、Bb が G 形のセーハ、Eb が C 形になる", () => {
    expect(picked("Bb Eb F Bb")).toEqual(["653336", "x65343", "133211", "x13331"]);
  });

  it("Fm7 Bb7 EbM7 AbM7 に x10331・x10131・xx10x3 は含まれず、Bb7 は x13131", () => {
    const steps = picked("Fm7 Bb7 EbM7 AbM7");
    for (const avoided of ["x10331", "x10131", "xx10x3"]) expect(steps).not.toContain(avoided);
    expect(steps[1]).toBe("x13131");
  });

  it("標準形の進行は変わらない", () => {
    expect(picked("C Am F G7")).toEqual(["x32010", "x02210", "133211", "320001"]);
    expect(picked("Dm7 G7 CM7")).toEqual(["xx0211", "320001", "x32000"]);
    expect(picked("E A B7 E")).toEqual(["022100", "x02220", "x21202", "022100"]);
    expect(picked("F#m7 B7 EM7 C#7")).toEqual(["242222", "x21202", "021100", "x43101"]);
  });

  it("A7 の単体は、指 2 本の x02020（窮屈な形の対象外）", () => {
    expect(picked("A7")).toEqual(["x02020"]);
  });

  // [コード, 変更前, 変更後]。変更前はどれも窮屈な形（理由は docs/adr/0026）。
  it.each<[string, string, string]>([
    ["FM7", "102210", "10x210"],
    ["F6", "100211", "100x11"],
    ["Fadd9", "103011", "10x011"],
    ["Fdim", "12x101", "1231x1"],
    ["Fdim7", "120101", "1x0101"],
    ["Faug", "10x221", "10322x"],
    ["Fsus2", "1x3011", "1330x3"],
    ["F7(#11)", "101201", "121211"],
    ["F#aug", "2x0332", "210x32"],
    ["Abm7-5", "420402", "420102"],
    ["D/F#", "200232", "2002x2"],
  ])("単体の %s は、窮屈な形の %s をやめて %s になる", (symbol, _before, after) => {
    expect(picked(symbol)).toEqual([after]);
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

/** コード `symbol` の押さえ方のうち、最低フレットが `lowest` のもの。 */
function shapesWithLowestFret(symbol: string, lowest: number): Voicing[] {
  return generateVoicings(chord(symbol)).filter((voicing) => lowestFretOf(voicing) === lowest);
}

/** 成功を期待して返す。 */
function succeeded(result: ReturnType<typeof optimizeSymbols>) {
  if (!result.ok) throw new Error(`失敗: ${JSON.stringify(result)}`);
  return result;
}

/** 押さえるフレットがすべて [low, high] に収まる（開放弦とミュートは問わない）。 */
const fitsWindow = (voicing: Voicing, low: number, high: number) =>
  pressedFretsOf(voicing).every((fret) => fret >= low && fret <= high);

describe("optimizeSymbols: 最初の押さえ方の指定（firstVoicing）", () => {
  const barreAt8 = v("8 10 10 9 8 8"); // C の 8 フレットのセーハ形

  it("指定した押さえ方が、先頭の押さえ方になる", () => {
    expect(validateVoicing(barreAt8, chord("C"))).toEqual({ ok: true });
    const result = succeeded(optimizeSymbols(["C", "Am", "F", "G"], { firstVoicing: barreAt8 }));
    expect(result.steps[0]!.voicing).toEqual(barreAt8);
    expect(result.steps).toHaveLength(4);
  });

  it("x35553 を指定した C Am F G の Am は、開放弦を使わない 577555 になる（高い位置の開放弦は不利。変更前は x0x555）", () => {
    const result = succeeded(optimizeSymbols(["C", "Am", "F", "G"], { firstVoicing: v("x35553") }));
    expect(show(result.steps[0]!.voicing)).toBe("x35553");
    expect(show(result.steps[1]!.voicing)).toBe("577555");
  });

  it("最低フレット 5 の C を指定すると、続くコードは開放に戻らず 5〜9 フレットの窓に収まる", () => {
    const first = shapesWithLowestFret("C", 5)[0]!;
    const result = succeeded(optimizeSymbols(["C", "Am", "F", "G"], { firstVoicing: first }));
    expect(result.steps.map((step) => step.inWindow)).toEqual([true, true, true, true]);
    for (const step of result.steps.slice(1)) expect(fitsWindow(step.voicing, 5, 9)).toBe(true);
    expect(show(result.steps[1]!.voicing)).not.toBe("x02210"); // 指定なしのときの Am（開放寄り）
  });

  it("inWindow が true のコードは、押さえるフレットがすべて窓に収まり、false のコードは窓に収まる候補が元々無い（性質）", () => {
    fc.assert(
      fc.property(
        fc.array(chordSymbols, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        (list, pick) => {
          const firstCandidates = generateVoicings(chord(list[0]!));
          const first = firstCandidates[pick % firstCandidates.length]!;
          const result = succeeded(optimizeSymbols(list, { firstVoicing: first }));
          expect(result.steps[0]!.voicing).toEqual(first);
          const lowest = lowestFretOf(first);
          result.steps.forEach((step, i) => {
            if (lowest === undefined) return expect(step.inWindow).toBe(true);
            const anyFits = generateVoicings(chord(list[i]!)).some((c) => fitsWindow(c, lowest, lowest + 4));
            if (step.inWindow) expect(fitsWindow(step.voicing, lowest, lowest + 4)).toBe(true);
            else expect(anyFits).toBe(false);
            if (i === 0) expect(step.inWindow).toBe(true);
          });
        },
      ),
      { numRuns: 40 },
    );
  });

  it("窓に収まる候補が無いコードは窓を広げて選び、inWindow:false が付く", () => {
    // C7(9,13) は 9〜13 フレットの窓に押さえ方が無い。最低フレット 10 の C を指定すると窓は 10〜14。
    const first = shapesWithLowestFret("C", 10)[0]!;
    expect(generateVoicings(chord("C7(9,13)")).some((c) => fitsWindow(c, 10, 14))).toBe(false);
    const result = succeeded(optimizeSymbols(["C", "C7(9,13)"], { firstVoicing: first }));
    expect(result.steps.map((step) => step.inWindow)).toEqual([true, false]);
    expect(validateVoicing(result.steps[1]!.voicing, chord("C7(9,13)"))).toEqual({ ok: true });
    // 窓は 1 つずつ広がるので、いちばん近い押さえ方が選ばれる。
    expect(lowestFretOf(result.steps[1]!.voicing)).toBe(8);
  });

  it("窓を広げても、続くコードは広げずに収まるなら inWindow:true のまま", () => {
    const first = shapesWithLowestFret("C", 10)[0]!;
    const result = succeeded(optimizeSymbols(["C", "C7(9,13)", "C"], { firstVoicing: first }));
    expect(result.steps.map((step) => step.inWindow)).toEqual([true, false, true]);
  });

  it("開放弦とミュートだけの押さえ方を指定すると、窓をかけずに先頭だけ固定し、inWindow は全て true", () => {
    const openOnly = v("0x0000"); // Em7
    expect(validateVoicing(openOnly, chord("Em7"))).toEqual({ ok: true });
    const result = succeeded(optimizeSymbols(["Em7", "C", "Am", "F"], { firstVoicing: openOnly }));
    expect(result.steps[0]!.voicing).toEqual(openOnly);
    expect(result.steps.map((step) => step.inWindow)).toEqual([true, true, true, true]);
    // 窓があれば除かれてしまう、開放寄りの C が選ばれる。
    expect(show(result.steps[1]!.voicing)).toBe("x32010");
  });

  it.each<[string, unknown]>([
    ["別のコードの押さえ方", v("x02210")], // Am の押さえ方を C に
    ["弦の数が違う", [3, 2, 0, 1, 0]],
    ["フレットが負", [-1, 3, 2, 0, 1, 0]],
    ["フレットが整数でない", [null, 3, 2, 0, 1, 0.5]],
    ["フレットが NaN", [null, 3, 2, 0, 1, Number.NaN]],
    ["配列でない", "x32010"],
    ["null", null],
  ])("妥当でない firstVoicing（%s）は invalid-first-voicing", (_name, firstVoicing) => {
    expect(optimizeSymbols(["C", "Am"], { firstVoicing: firstVoicing as Voicing })).toEqual({
      ok: false,
      reason: "invalid-first-voicing",
    });
  });

  it("既存の失敗を先に判定する。firstVoicing が不正でも、空・多すぎ・読めない記号はその失敗を返す", () => {
    const bad = v("x02210") as Voicing;
    expect(optimizeSymbols([], { firstVoicing: bad })).toEqual({ ok: false, reason: "empty" });
    expect(optimizeSymbols(Array(MAX_PROGRESSION_CHORDS + 1).fill("C"), { firstVoicing: bad })).toEqual({
      ok: false,
      reason: "too-many-chords",
    });
    expect(optimizeSymbols(["C", "H"], { firstVoicing: bad })).toEqual({
      ok: false,
      reason: "invalid-chords",
      chords: [{ index: 1, symbol: "H", reason: "invalid-root" }],
    });
    expect(optimizeProgression("C".repeat(MAX_PROGRESSION_LENGTH + 1), { firstVoicing: bad })).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("candidateIndex は、窓で絞ったあとも generateVoicings の結果全体の中の位置（性質）", () => {
    fc.assert(
      fc.property(fc.array(chordSymbols, { minLength: 1, maxLength: 6 }), fc.nat(), (list, pick) => {
        const firstCandidates = generateVoicings(chord(list[0]!));
        const first = firstCandidates[pick % firstCandidates.length]!;
        const result = succeeded(optimizeSymbols(list, { firstVoicing: first }));
        result.steps.forEach((step) => {
          expect(step.voicing).toEqual(generateVoicings(chord(step.symbol))[step.candidateIndex]);
        });
      }),
      { numRuns: 30 },
    );
  });

  it("optimizeProgression でも同じ指定ができ、optimizeSymbols と同じ結果になる", () => {
    const options = { firstVoicing: barreAt8 };
    expect(optimizeProgression("C Am | F G", options)).toEqual(
      optimizeSymbols(splitProgression("C Am | F G"), options),
    );
  });

  it("同じ入力は毎回同じ結果（firstVoicing あり。性質）", () => {
    fc.assert(
      fc.property(fc.array(chordSymbols, { minLength: 1, maxLength: 5 }), fc.nat(), (list, pick) => {
        const firstCandidates = generateVoicings(chord(list[0]!));
        const options = { firstVoicing: firstCandidates[pick % firstCandidates.length]! };
        expect(optimizeSymbols(list, options)).toEqual(optimizeSymbols(list, options));
      }),
      { numRuns: 20 },
    );
  });

  it("options が無い、または firstVoicing が無いときは、結果は変わらず inWindow も付かない", () => {
    const plain = succeeded(optimizeSymbols(["C", "Am", "F", "G"]));
    expect(plain.steps.map((step) => show(step.voicing))).toEqual(["x32010", "x02210", "133211", "320003"]);
    for (const step of plain.steps) expect("inWindow" in step).toBe(false);
    expect(optimizeSymbols(["C", "Am", "F", "G"], {})).toEqual(plain);
  });
});
