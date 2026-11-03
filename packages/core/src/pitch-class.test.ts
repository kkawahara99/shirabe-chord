import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { transpose, type PitchClass } from "./pitch-class.ts";

const anyPitchClass = fc.integer({ min: 0, max: 11 }).map((n) => n as PitchClass);
const anySemitones = fc.integer({ min: -100_000, max: 100_000 });

describe("transpose（例示）", () => {
  it("0 半音ずらすと同じ音", () => {
    expect(transpose(0, 0)).toBe(0);
  });

  it("上にずらす: C(0) の 7 半音上は 7", () => {
    expect(transpose(0, 7)).toBe(7);
  });

  it("11 の 1 半音上は 0 に戻る（12 で一周）", () => {
    expect(transpose(11, 1)).toBe(0);
  });

  it("下にずらす: 0 の 1 半音下は 11", () => {
    expect(transpose(0, -1)).toBe(11);
  });

  it("大きい値でも一周して収まる", () => {
    expect(transpose(0, 1000)).toBe(4);
    expect(transpose(5, -1000)).toBe(1);
  });

  it("安全な整数の範囲を超える半音でも正しく一周する", () => {
    expect(transpose(5, 2 ** 60)).toBe(9);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "整数でない半音 %s は RangeError",
    (semitones) => {
      expect(() => transpose(0, semitones)).toThrow(RangeError);
    },
  );
});

describe("transpose（性質）", () => {
  it("結果は常に 0〜11 の整数", () => {
    fc.assert(
      fc.property(anyPitchClass, anySemitones, (p, n) => {
        const r = transpose(p, n);
        return Number.isInteger(r) && r >= 0 && r <= 11;
      }),
    );
  });

  it("合成できる: transpose(transpose(p,a),b) = transpose(p,a+b)", () => {
    fc.assert(
      fc.property(anyPitchClass, anySemitones, anySemitones, (p, a, b) => {
        return transpose(transpose(p, a), b) === transpose(p, a + b);
      }),
    );
  });

  it("12 半音ずらすと元の音", () => {
    fc.assert(
      fc.property(anyPitchClass, (p) => transpose(p, 12) === p),
    );
  });

  it("逆向きに戻せる: transpose(transpose(p,n),-n) = p", () => {
    fc.assert(
      fc.property(anyPitchClass, anySemitones, (p, n) => {
        return transpose(transpose(p, n), -n) === p;
      }),
    );
  });
});
