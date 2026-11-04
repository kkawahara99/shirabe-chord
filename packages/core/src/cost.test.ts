import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { transitionCost, voicingCost, type CostWeights } from "./cost.ts";
import { v } from "./test-helpers.ts";

/** 指定した項目だけ重み 1、ほかは 0。 */
function only(item: keyof CostWeights, weight = 1): CostWeights {
  return {
    fingers: 0,
    barre: 0,
    span: 0,
    averageFret: 0,
    openStrings: 0,
    mutedStrings: 0,
    fretShift: 0,
    changedStrings: 0,
    [item]: weight,
  };
}

describe("voicingCost: 単体のコスト", () => {
  // x32010 は指 3・セーハ無し・幅 2・平均フレット 2・開放 2 本・ミュート 1 本。
  // 133211 は指 4（1 フレットのセーハ 1 本＋ 3・3・2 フレット）・セーハ有り・幅 2・平均 11/6。
  it.each<[keyof CostWeights, string, number]>([
    ["fingers", "x32010", 3],
    ["fingers", "133211", 4],
    ["barre", "x32010", 0],
    ["barre", "133211", 1],
    ["span", "x32010", 2],
    ["span", "000000", 0],
    ["averageFret", "x32010", 2],
    ["averageFret", "133211", 11 / 6],
    ["openStrings", "x32010", -2],
    ["openStrings", "133211", 0],
    ["mutedStrings", "x32010", 1],
    ["mutedStrings", "xx0211", 2],
  ])("%s の重みだけ 1 にすると、%s のコストはその特徴の値 %d（開放弦は符号が負）", (item, text, expected) => {
    expect(voicingCost(v(text), only(item))).toBeCloseTo(expected, 10);
  });

  it("重みを掛けて足し合わせる", () => {
    const weights = { ...only("fingers", 2), barre: 3, span: 5, mutedStrings: 7 };
    // x32010: 指 3×2 + セーハ 0×3 + 幅 2×5 + ミュート 1×7
    expect(voicingCost(v("x32010"), weights)).toBeCloseTo(6 + 10 + 7, 10);
  });

  it("ミュートした弦が多いほど高い（既定の重み）", () => {
    // 同じ形から 6弦の開放を消すと、ミュートが 1 本増え開放弦が 1 本減る。
    expect(voicingCost(v("x22000"))).toBeGreaterThan(voicingCost(v("022000")));
  });
});

describe("transitionCost: 前後の移動のコスト", () => {
  it("同じ押さえ方どうしは 0", () => {
    expect(transitionCost(v("x32010"), v("x32010"))).toBe(0);
    expect(transitionCost(v("000000"), v("000000"))).toBe(0);
  });

  it("平均フレットの差の絶対値と、押さえ方が変わる弦の数に重みを掛けて足す", () => {
    // x32010（平均 2）→ 133211（平均 11/6）。変わる弦: 6弦 x→1、4弦 2→3、3弦 0→2、1弦 0→1 の 4 本。
    const weights = { ...only("fretShift", 2), changedStrings: 3 };
    expect(transitionCost(v("x32010"), v("133211"), weights)).toBeCloseTo((2 * 1) / 6 + 3 * 4, 10);
  });

  it("開放とミュートの入れ替えも、変わる弦に数える", () => {
    expect(transitionCost(v("x22000"), v("022000"), only("changedStrings"))).toBe(1);
  });

  it("開放弦とミュートだけの弦は、位置の平均に入れない", () => {
    // 332010 の押さえる位置は 3・3・2・1（平均 9/4）。開放の 0 を入れると平均が変わってしまう。
    expect(transitionCost(v("x32010"), v("332010"), only("fretShift"))).toBeCloseTo(0.25, 10);
  });

  it("押さえるフレットが無い押さえ方は、位置 0（開放の位置）として扱う", () => {
    expect(transitionCost(v("000000"), v("133211"), only("fretShift"))).toBeCloseTo(11 / 6, 10);
    expect(transitionCost(v("133211"), v("000000"), only("fretShift"))).toBeCloseTo(11 / 6, 10);
    expect(transitionCost(v("000000"), v("x00000"), only("fretShift"))).toBe(0);
  });

  const voicing = fc.array(fc.option(fc.integer({ min: 0, max: 15 }), { nil: null }), {
    minLength: 6,
    maxLength: 6,
  });

  it("寄り道しても近くならない（三角不等式。押さえるフレットが無い押さえ方を挟んでも）（性質）", () => {
    fc.assert(
      fc.property(voicing, voicing, voicing, (a, b, c) => {
        expect(transitionCost(a, c)).toBeLessThanOrEqual(
          transitionCost(a, b) + transitionCost(b, c) + 1e-9,
        );
      }),
    );
  });

  it("前後を入れ替えても同じ（性質）", () => {
    fc.assert(
      fc.property(voicing, voicing, (a, b) => {
        expect(transitionCost(a, b)).toBeCloseTo(transitionCost(b, a), 10);
      }),
    );
  });
});
