import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPO, MAX_TEMPO, MIN_TEMPO, normalizeTempo } from "./tempo.ts";

describe("normalizeTempo（テンポの入力を丸める）", () => {
  it("既定は 90、範囲は 40〜200", () => {
    expect([DEFAULT_TEMPO, MIN_TEMPO, MAX_TEMPO]).toEqual([90, 40, 200]);
  });

  it.each(["", "  ", "abc", "1e", "NaN", "Infinity"])("空や数でない「%s」は 90", (text) => {
    expect(normalizeTempo(text)).toBe(90);
  });

  it("小数は四捨五入する（90.5 → 91、90.4 → 90）", () => {
    expect(normalizeTempo("90.5")).toBe(91);
    expect(normalizeTempo("90.4")).toBe(90);
  });

  it("範囲外は近い方の端に丸める（39 → 40、201 → 200、負の数 → 40）", () => {
    expect(normalizeTempo("39")).toBe(40);
    expect(normalizeTempo("201")).toBe(200);
    expect(normalizeTempo("-5")).toBe(40);
    expect(normalizeTempo("40")).toBe(40);
    expect(normalizeTempo("200")).toBe(200);
  });

  it("【性質】どんな文字列でも、結果は 40〜200 の整数", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.double().map(String), fc.integer().map(String)), (text) => {
        const tempo = normalizeTempo(text);
        expect(Number.isInteger(tempo)).toBe(true);
        expect(tempo).toBeGreaterThanOrEqual(40);
        expect(tempo).toBeLessThanOrEqual(200);
      }),
    );
  });
});
