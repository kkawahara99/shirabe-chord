import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PLUCK_SECONDS, renderPluck } from "./pluck.ts";

const SAMPLE_RATE = 22050;

/** 種から決まる乱数（0 以上 1 未満）。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const frequencyOf = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** 自己相関が最大になる遅れ（サンプル数）から、基本周波数を求める。音が落ち着いたあとの区間で測る。 */
function estimateFrequency(wave: Float32Array, expected: number): number {
  const start = 3000;
  const length = 4096;
  const lo = Math.floor(SAMPLE_RATE / (expected * 1.4));
  const hi = Math.ceil(SAMPLE_RATE / (expected * 0.7));
  let best = lo;
  let bestValue = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    let sum = 0;
    for (let i = start; i < start + length; i++) sum += wave[i]! * wave[i + lag]!;
    if (sum > bestValue) {
      bestValue = sum;
      best = lag;
    }
  }
  return SAMPLE_RATE / best;
}

const rms = (wave: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += wave[i]! * wave[i]!;
  return Math.sqrt(sum / (to - from));
};

describe("renderPluck（弦の撥弦音の波形）", () => {
  it("長さは 3 秒 × サンプルレート", () => {
    expect(PLUCK_SECONDS).toBe(3);
    expect(renderPluck(110, SAMPLE_RATE, seeded(1)).length).toBe(3 * SAMPLE_RATE);
  });

  it.each([110, 220, 440])("%iHz を作ると、波形の周期が約その周波数になる", (frequency) => {
    const wave = renderPluck(frequency, SAMPLE_RATE, seeded(7));
    expect(Math.abs(estimateFrequency(wave, frequency) / frequency - 1)).toBeLessThan(0.015);
  });

  it("同じ乱数なら同じ波形、違う乱数なら違う波形になる", () => {
    const a = renderPluck(196, SAMPLE_RATE, seeded(1));
    expect(renderPluck(196, SAMPLE_RATE, seeded(1))).toEqual(a);
    expect(renderPluck(196, SAMPLE_RATE, seeded(2))).not.toEqual(a);
  });

  it("【性質】任意の MIDI ノート（40〜88）・乱数で、値は有限で絶対値 1 以下、無音ではない", () => {
    fc.assert(
      fc.property(fc.integer({ min: 40, max: 88 }), fc.integer({ min: 0, max: 2 ** 31 }), (midi, seed) => {
        const wave = renderPluck(frequencyOf(midi), 8000, seeded(seed));
        let peak = 0;
        let finite = true;
        for (const value of wave) {
          finite &&= Number.isFinite(value); // 1 サンプルごとに expect すると遅い
          peak = Math.max(peak, Math.abs(value));
        }
        expect(finite).toBe(true);
        expect(peak).toBeLessThanOrEqual(1);
        expect(peak).toBeGreaterThan(0.1);
      }),
      { numRuns: 20 },
    );
  });

  it("減衰する: 末尾の振幅は先頭より小さい", () => {
    const wave = renderPluck(110, SAMPLE_RATE, seeded(3));
    const head = rms(wave, 0, 2000);
    expect(rms(wave, wave.length - 2000, wave.length)).toBeLessThan(head / 10);
  });
});
