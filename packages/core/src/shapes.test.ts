import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { voicingCost } from "./cost.ts";
import { listShapesByLowestFret } from "./shapes.ts";
import { chord, chordSymbols, lowestFretOf, show } from "./test-helpers.ts";
import { generateVoicings } from "./voicing.ts";

function shapesOf(symbol: string) {
  const result = listShapesByLowestFret(symbol);
  if (!result.ok) throw new Error(`${symbol} が失敗: ${result.reason}`);
  return result.shapes;
}

describe("listShapesByLowestFret: 最低フレットごとの代表の押さえ方", () => {
  it("C は、最低フレットの昇順で、各最低フレット 1 つずつ返す", () => {
    expect(shapesOf("C").map((shape) => shape.lowestFret)).toEqual([1, 2, 3, 5, 7, 8, 9, 10, 12, 13]);
  });

  it("どのコードでも、最低フレットは重複せず昇順（性質）", () => {
    fc.assert(
      fc.property(chordSymbols, (symbol) => {
        const lowests = shapesOf(symbol).map((shape) => shape.lowestFret);
        expect(lowests).toEqual([...new Set(lowests)].sort((a, b) => a - b));
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
        expect(shapesOf(symbol).map((shape) => shape.lowestFret)).toEqual(
          [...appearing].sort((a, b) => a - b),
        );
      }),
      { numRuns: 50 },
    );
  });

  it("各代表は、同じ最低フレットの押さえ方のうち単体コストが最小。同点なら generateVoicings の順で先（性質）", () => {
    fc.assert(
      fc.property(chordSymbols, (symbol) => {
        const all = generateVoicings(chord(symbol));
        for (const shape of shapesOf(symbol)) {
          const cost = voicingCost(shape.voicing);
          all.forEach((other, index) => {
            if (lowestFretOf(other) !== shape.lowestFret) return;
            if (index < shape.candidateIndex) expect(voicingCost(other)).toBeGreaterThan(cost + 1e-9);
            else expect(voicingCost(other)).toBeGreaterThanOrEqual(cost - 1e-9);
          });
        }
      }),
      { numRuns: 30 },
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
