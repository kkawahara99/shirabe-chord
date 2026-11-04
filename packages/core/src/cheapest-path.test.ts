import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { selectCheapestPath } from "./cheapest-path.ts";
import { transitionCost, voicingCost } from "./cost.ts";
import { chord, chordSymbols } from "./test-helpers.ts";
import { generateVoicings, type Voicing } from "./voicing.ts";

type Node = { readonly id: string; readonly cost: number };
const node = (id: string, cost = 0): Node => ({ id, cost });
const free = () => 0;

describe("selectCheapestPath: 動的計画法", () => {
  it("貪欲法と答えが違う例: 前の押さえ方を少し高くしても、後ろが安くなる並びを選ぶ", () => {
    // a0 は安い（0）が、a0 からはどこへ行っても 10 かかる。a1 は少し高い（1）が、移動が 0。
    const layers = [[node("a0", 0), node("a1", 1)], [node("b0", 0)]];
    const result = selectCheapestPath(
      layers,
      (n) => n.cost,
      (from) => (from.id === "a0" ? 10 : 0),
    );
    expect(result).toEqual({ indices: [1, 0], totalCost: 1 });
  });

  it("最小の並びが複数あるときは、後ろの層の候補の順序を優先する（後ろからたどるため）", () => {
    // [0, 1] と [1, 0] がどちらも合計 1 の最小。後ろの層の先頭（b0）を選び、そこへつながる a1 になる。
    const layers = [[node("a0"), node("a1")], [node("b0"), node("b1")]];
    const result = selectCheapestPath(
      layers,
      () => 0,
      (from, to) => (from.id === "a0" && to.id === "b1") || (from.id === "a1" && to.id === "b0") ? 1 : 2,
    );
    expect(result).toEqual({ indices: [1, 0], totalCost: 1 });
  });

  it("コストが全部同じなら、全部先頭を選ぶ", () => {
    const layers = [
      [node("a0"), node("a1")],
      [node("b0"), node("b1")],
      [node("c0"), node("c1")],
    ];
    expect(selectCheapestPath(layers, (n) => n.cost, free)).toEqual({
      indices: [0, 0, 0],
      totalCost: 0,
    });
  });

  it("途中だけ同点なら、候補の順序で先のものを選ぶ", () => {
    // a0 と a1 を通る道は、どちらも合計 5 で同点。a2 は単体が安い（0）が、移動で合計 6 になる。
    const layers = [[node("a0", 1), node("a1", 1), node("a2", 0)], [node("b0")]];
    const result = selectCheapestPath(
      layers,
      (n) => n.cost,
      (from) => (from.id === "a2" ? 6 : 4),
    );
    expect(result).toEqual({ indices: [0, 0], totalCost: 5 });
  });

  it("浮動小数点の誤差だけの差は同点とみなし、先のものを選ぶ", () => {
    const layers = [[node("a0", 0.1 + 0.2), node("a1", 0.3)]];
    expect(selectCheapestPath(layers, (n) => n.cost, free)?.indices).toEqual([0]);
  });

  it("層が 1 つなら、その中で単体のコストが最小（同点なら先）の候補", () => {
    const layers = [[node("a0", 3), node("a1", 1), node("a2", 1)]];
    expect(selectCheapestPath(layers, (n) => n.cost, free)).toEqual({
      indices: [1],
      totalCost: 1,
    });
  });

  it("層が無い、または空の層があれば undefined", () => {
    expect(selectCheapestPath([], () => 0, free)).toBeUndefined();
    expect(selectCheapestPath([[node("a0")], []], () => 0, free)).toBeUndefined();
  });
});

describe("selectCheapestPath: 実際の押さえ方での性質", () => {
  const candidatesOf = (symbol: string): Voicing[] => generateVoicings(chord(symbol));

  /** 総当たりで最小のコスト。 */
  function bruteForce(layers: readonly (readonly Voicing[])[]): number {
    let best = Number.POSITIVE_INFINITY;
    const walk = (depth: number, previous: Voicing | undefined, sum: number): void => {
      if (depth === layers.length) {
        best = Math.min(best, sum);
        return;
      }
      for (const voicing of layers[depth]!) {
        const move = previous === undefined ? 0 : transitionCost(previous, voicing);
        walk(depth + 1, voicing, sum + move + voicingCost(voicing));
      }
    };
    walk(0, undefined, 0);
    return best;
  }

  it("3 コード以下・候補を先頭 30 件に絞った入力で、総当たりの最小コストと等しい", () => {
    fc.assert(
      fc.property(fc.array(chordSymbols, { minLength: 1, maxLength: 3 }), (list) => {
        const layers = list.map((symbol) => candidatesOf(symbol).slice(0, 30));
        const result = selectCheapestPath(layers, voicingCost, transitionCost);
        expect(result).toBeDefined();
        expect(result!.totalCost).toBeCloseTo(bruteForce(layers), 8);
      }),
      { numRuns: 25 },
    );
  });

  it("返した合計コストは、選んだ並びの単体コストと移動コストの合計に等しい", () => {
    fc.assert(
      fc.property(fc.array(chordSymbols, { minLength: 1, maxLength: 6 }), (list) => {
        const layers = list.map((symbol) => candidatesOf(symbol).slice(0, 40));
        const result = selectCheapestPath(layers, voicingCost, transitionCost)!;
        const chosen = result.indices.map((index, i) => layers[i]![index]!);
        const sum = chosen.reduce(
          (total, voicing, i) =>
            total + voicingCost(voicing) + (i === 0 ? 0 : transitionCost(chosen[i - 1]!, voicing)),
          0,
        );
        expect(result.totalCost).toBeCloseTo(sum, 8);
      }),
      { numRuns: 25 },
    );
  });
});
