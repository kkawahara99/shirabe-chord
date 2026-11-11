import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fingering } from "./fingering.ts";
import { chord, v } from "./test-helpers.ts";
import { generateVoicings, voicingFeatures, type Voicing } from "./voicing.ts";

/** 弦ごとの指番号。押さえない弦（開放・ミュート）は null。6弦から1弦の順。 */
const N = null;

describe("fingering: 指番号の例（6弦から1弦の順。押さえない弦は null）", () => {
  it.each<[string, string, (number | null)[]]>([
    ["C x32010 は、フレットの低い順に 1・2・3", "x32010", [N, 3, 2, N, 1, N]],
    ["D xx0232 は、セーハにせず、2 フレットの G 弦が 1、E 弦が 2、3 フレットの B 弦が 3", "xx0232", [N, N, N, 1, 3, 2]],
    ["F 133211 は、セーハの 1 フレットが 1、2 フレットが 2、3 フレットの 2 本が低音側から 3・4", "133211", [1, 3, 4, 2, 1, 1]],
    ["xxx232 も D と同じ形（位置を問わない）", "xxx232", [N, N, N, 1, 3, 2]],
    ["xx0 14 15 14 も D と同じ形（高いポジション）", "x x 0 14 15 14", [N, N, N, 1, 3, 2]],
    ["xx0252 は高いフレットが 2 つ以上上なので、セーハのまま", "xx0252", [N, N, N, 1, 2, 1]],
    ["C7 x3x353 は押さえる弦が 4 本なので、セーハのまま", "x3x353", [N, 1, N, 1, 2, 1]],
    ["C7 x3535x は押さえる弦が 4 本なので、セーハのまま", "x3535x", [N, 1, 2, 1, 3, N]],
    ["C x3x553 は押さえる弦が 4 本なので、セーハのまま", "x3x553", [N, 1, N, 2, 3, 1]],
    ["Csus4 x335x3 は押さえる弦が 4 本なので、セーハのまま", "x335x3", [N, 1, 1, 2, N, 1]],
    ["xx2232 は押さえる弦が 4 本なので、セーハのまま", "xx2232", [N, N, 1, 1, 2, 1]],
    ["Fm 1x31xx は間にミュートを含み、間の弦が 2 本なので、セーハのまま", "1x31xx", [1, N, 2, 1, N, N]],
    ["x10331 は開放弦をはさむのでセーハではなく、同じフレットでも別の指（低音側から 1・2、3・4）", "x10331", [N, 1, N, 3, 4, 2]],
    ["押さえるフレットが無い 0x0000 は全て null", "0x0000", [N, N, N, N, N, N]],
    ["全部ミュートの xxxxxx も全て null", "xxxxxx", [N, N, N, N, N, N]],
  ])("%s", (_name, text, expected) => {
    expect(fingering(v(text)).byString).toEqual(expected);
  });
});

/** 実装と別に、例外の 4 条件を文面どおりに書いた判定。 */
function isExceptionByDefinition(shape: Voicing): boolean {
  const pressed = shape.flatMap((fret, string) => (fret !== null && fret > 0 ? [{ fret, string }] : []));
  if (pressed.length !== 3) return false; // (a)
  const lowest = Math.min(...pressed.map(({ fret }) => fret));
  const lowStrings = pressed.filter(({ fret }) => fret === lowest).map(({ string }) => string);
  if (lowStrings.length !== 2) return false; // (b)
  const between = shape.slice(lowStrings[0]! + 1, lowStrings[1]!);
  return between.length === 1 && between[0] === lowest + 1; // (c)(d)
}

const anyVoicing = fc.array(fc.option(fc.integer({ min: 0, max: 15 }), { nil: null }), {
  minLength: 6,
  maxLength: 6,
});
// 低いフレットに絞ると、セーハや例外の形が十分な割合で生まれる。
const lowVoicing = fc.array(fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }), {
  minLength: 6,
  maxLength: 6,
});
const eitherVoicing = fc.oneof(anyVoicing, lowVoicing);

describe("fingering: 任意の押さえ方の性質", () => {
  it("例外を投げず、押さえる弦（フレット 1 以上）だけに 1 以上の整数の番号が付く（性質）", () => {
    fc.assert(
      fc.property(eitherVoicing, (shape) => {
        const { byString } = fingering(shape);
        expect(byString).toHaveLength(6);
        shape.forEach((fret, string) => {
          const finger = byString[string];
          if (fret === null || fret === 0) {
            expect(finger).toBeNull();
          } else {
            expect(Number.isInteger(finger)).toBe(true);
            expect(finger!).toBeGreaterThanOrEqual(1);
          }
        });
      }),
      { numRuns: 1000 },
    );
  });

  it("フレットが低い弦の指ほど小さい番号になる（性質）", () => {
    fc.assert(
      fc.property(eitherVoicing, (shape) => {
        const { byString } = fingering(shape);
        for (let a = 0; a < 6; a++) {
          for (let b = 0; b < 6; b++) {
            const [fa, fb] = [shape[a], shape[b]];
            if (fa && fb && fa < fb) expect(byString[a]!).toBeLessThan(byString[b]!);
          }
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("番号は 1 から最大まで欠けず、同じ番号の弦は同じフレットを押さえる（性質）", () => {
    fc.assert(
      fc.property(eitherVoicing, (shape) => {
        const { byString } = fingering(shape);
        const used = [...new Set(byString.filter((finger): finger is number => finger !== null))];
        expect(used.sort((a, b) => a - b)).toEqual(Array.from({ length: used.length }, (_, k) => k + 1));
        for (const finger of used) {
          const frets = new Set(shape.filter((_, string) => byString[string] === finger));
          expect(frets.size).toBe(1);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe("fingering: セーハの範囲", () => {
  it("F 133211 は 1 フレットの 6弦（添字 0）から 1弦（添字 5）まで", () => {
    expect(fingering(v("133211")).barre).toEqual({ fret: 1, from: 0, to: 5 });
  });

  it("Bm x24432 は 2 フレットの 5弦（添字 1）から 1弦まで", () => {
    expect(fingering(v("x24432")).barre).toEqual({ fret: 2, from: 1, to: 5 });
  });

  it("セーハが無い C x32010 と、例外の D xx0232 は barre が無い", () => {
    expect(fingering(v("x32010")).barre).toBeUndefined();
    expect(fingering(v("xx0232")).barre).toBeUndefined();
  });

  it("barre があれば、その弦は全て最低フレットで番号 1。hasBarre が偽なら barre は無い（性質）", () => {
    fc.assert(
      fc.property(eitherVoicing, (shape) => {
        const { barre, byString } = fingering(shape);
        if (barre === undefined) return;
        expect(voicingFeatures(shape).hasBarre).toBe(true);
        const pressed = shape.filter((fret): fret is number => fret !== null && fret > 0);
        expect(barre.fret).toBe(Math.min(...pressed));
        shape.forEach((fret, string) => {
          if (fret === barre.fret) expect(byString[string]).toBe(1);
        });
        expect(shape[barre.from]).toBe(barre.fret);
        expect(shape[barre.to]).toBe(barre.fret);
      }),
      { numRuns: 1000 },
    );
  });

  it("hasBarre が真なのに barre が無いのは、例外の形（4 条件を文面どおりに書いた判定）だけ（性質）", () => {
    fc.assert(
      fc.property(eitherVoicing, (shape) => {
        const hasBarre = voicingFeatures(shape).hasBarre;
        const { barre } = fingering(shape);
        expect(barre !== undefined).toBe(hasBarre && !isExceptionByDefinition(shape));
      }),
      { numRuns: 3000 },
    );
  });
});

describe("fingering: 検証済みの押さえ方（generateVoicings の全候補）", () => {
  const symbols = ["C", "Am", "F", "G7", "D", "Bm7(b5)", "Fm", "Bb", "C7", "Csus4"];

  it.each(symbols)("%s の全候補で、番号は 1〜4。指の種類の数は fingers（例外の形だけ fingers + 1）", (symbol) => {
    const voicings = generateVoicings(chord(symbol));
    expect(voicings.length).toBeGreaterThan(0);
    for (const voicing of voicings) {
      const { byString } = fingering(voicing);
      const used = new Set(byString.filter((finger): finger is number => finger !== null));
      for (const finger of used) {
        expect(finger).toBeGreaterThanOrEqual(1);
        expect(finger).toBeLessThanOrEqual(4);
      }
      const exception = voicingFeatures(voicing).hasBarre && isExceptionByDefinition(voicing);
      expect(used.size).toBe(voicingFeatures(voicing).fingers + (exception ? 1 : 0));
    }
  });
});
