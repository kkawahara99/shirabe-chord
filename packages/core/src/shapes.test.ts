import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { voicingCost } from "./cost.ts";
import { listShapesByLowestFret, type Shape } from "./shapes.ts";
import { chord, chordSymbols, lowestFretOf, show } from "./test-helpers.ts";
import { generateVoicings, voicingFeatures, type Voicing } from "./voicing.ts";

function shapesOf(symbol: string) {
  const result = listShapesByLowestFret(symbol);
  if (!result.ok) throw new Error(`${symbol} が失敗: ${result.reason}`);
  return result.shapes;
}

const shownAt = (symbol: string, lowestFret: number) =>
  shapesOf(symbol)
    .filter((shape) => shape.lowestFret === lowestFret)
    .map((shape) => show(shape.voicing));

/** 最低フレットごとの組。`shapes` は最低フレットの昇順なので、連続する同じ値でまとめる。 */
function groupsOf(shapes: readonly Shape[]): Shape[][] {
  const groups: Shape[][] = [];
  for (const shape of shapes) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last[0]!.lowestFret === shape.lowestFret) last.push(shape);
    else groups.push([shape]);
  }
  return groups;
}

/** `shape` が `candidates` の中で単体コスト最小で、同点なら `generateVoicings` の順で先であること。 */
function expectCheapest(shape: Shape, candidates: readonly { voicing: Voicing; index: number }[]): void {
  const cost = voicingCost(shape.voicing);
  expect(candidates.some(({ index }) => index === shape.candidateIndex)).toBe(true);
  for (const { voicing, index } of candidates) {
    if (index < shape.candidateIndex) expect(voicingCost(voicing)).toBeGreaterThan(cost + 1e-9);
    else expect(voicingCost(voicing)).toBeGreaterThanOrEqual(cost - 1e-9);
  }
}

describe("listShapesByLowestFret: 最低フレットごとの代表の押さえ方（単体の最安と、あればセーハの最安）", () => {
  it("C は、最低フレットの昇順で返す（単体の最安と別のセーハの形が無いので、各最低フレット 1 つずつ）", () => {
    expect(shapesOf("C").map((shape) => shape.lowestFret)).toEqual([1, 2, 3, 5, 7, 8, 9, 10, 12, 13]);
  });

  it("C の一覧に、3 フレットの x35553 と 8 フレットの 8 10 10 9 8 8 が含まれる（高い位置の開放弦入りに勝つ）", () => {
    expect(shownAt("C", 3)).toContain("x35553");
    expect(shownAt("C", 8)).toContain("8 10 10 9 8 8");
  });

  // 単体の最安とセーハの最安が別の形になる例。単体の最安が先、セーハの最安が後。
  it.each<[string, number, string[]]>([
    ["Bm", 2, ["x20402", "x24432"]],
    ["G", 3, ["3x0003", "355433"]],
    ["CM7", 3, ["x3x000", "x35453"]],
  ])("%s の %d フレットは、単体の最安とセーハの最安を、この順で返す", (symbol, lowestFret, expected) => {
    expect(shownAt(symbol, lowestFret)).toEqual(expected);
  });

  it("最低フレットは昇順で、同じ最低フレットは最大 2 つ。2 つのとき、1 つ目はセーハでなく 2 つ目はセーハ（性質）", () => {
    fc.assert(
      fc.property(chordSymbols, (symbol) => {
        const shapes = shapesOf(symbol);
        const lowests = shapes.map((shape) => shape.lowestFret);
        expect(lowests).toEqual([...lowests].sort((a, b) => a - b));
        for (const group of groupsOf(shapes)) {
          expect(group.length).toBeLessThanOrEqual(2);
          if (group.length === 2) {
            expect(voicingFeatures(group[0]!.voicing).hasBarre).toBe(false);
            expect(voicingFeatures(group[1]!.voicing).hasBarre).toBe(true);
          }
        }
      }),
      { numRuns: 50 },
    );
  });

  it("generateVoicings に現れる最低フレットは、1 つも欠けずに返る（性質）", () => {
    fc.assert(
      fc.property(chordSymbols, (symbol) => {
        const appearing = new Set(
          generateVoicings(chord(symbol)).flatMap((voicing) => lowestFretOf(voicing) ?? []),
        );
        expect([...new Set(shapesOf(symbol).map((shape) => shape.lowestFret))]).toEqual(
          [...appearing].sort((a, b) => a - b),
        );
      }),
      { numRuns: 50 },
    );
  });

  it("各最低フレットの 1 つ目は単体コスト最小、2 つ目（あれば）はセーハの形のうち最小。同点なら generateVoicings の順で先（性質）", () => {
    fc.assert(
      fc.property(chordSymbols, (symbol) => {
        const all = generateVoicings(chord(symbol));
        for (const group of groupsOf(shapesOf(symbol))) {
          const [best, barre] = group;
          const sameLowest = all.flatMap((voicing, index) =>
            lowestFretOf(voicing) === best!.lowestFret ? [{ voicing, index }] : [],
          );
          expectCheapest(best!, sameLowest);
          const barreForms = sameLowest.filter(({ voicing }) => voicingFeatures(voicing).hasBarre);
          if (barre !== undefined) {
            expectCheapest(barre, barreForms);
          } else {
            // 2 つ目が無いのは、セーハの形が無いか、単体の最安がセーハのとき。
            expect(barreForms.length === 0 || voicingFeatures(best!.voicing).hasBarre).toBe(true);
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  it("同じ押さえ方は重複して返らない（性質）", () => {
    fc.assert(
      fc.property(chordSymbols, (symbol) => {
        const indexes = shapesOf(symbol).map((shape) => shape.candidateIndex);
        expect(new Set(indexes).size).toBe(indexes.length);
      }),
      { numRuns: 50 },
    );
  });

  it("candidateIndex は generateVoicings の結果全体の中の位置で、voicing と lowestFret に一致する（性質）", () => {
    fc.assert(
      fc.property(chordSymbols, (symbol) => {
        const all = generateVoicings(chord(symbol));
        for (const shape of shapesOf(symbol)) {
          expect(all[shape.candidateIndex]).toEqual(shape.voicing);
          expect(lowestFretOf(shape.voicing)).toBe(shape.lowestFret);
        }
      }),
      { numRuns: 50 },
    );
  });

  it("押さえるフレットが無い押さえ方（Em7 の 0x0000 など）は対象外", () => {
    expect(generateVoicings(chord("Em7")).map(show)).toContain("0x0000");
    const shown = shapesOf("Em7").map((shape) => show(shape.voicing));
    expect(shown).not.toContain("0x0000");
    expect(shapesOf("Em7").every((shape) => shape.lowestFret >= 1)).toBe(true);
  });

  it("読めない記号は、読めない理由の種類を返す", () => {
    expect(listShapesByLowestFret("H")).toEqual({ ok: false, reason: "invalid-root" });
    expect(listShapesByLowestFret("Cfoo")).toEqual({ ok: false, reason: "unsupported-quality" });
  });

  it("押さえ方が 0 件のコードは no-voicing", () => {
    expect(listShapesByLowestFret("C7(b9,#9,#11)")).toEqual({ ok: false, reason: "no-voicing" });
  });
});
