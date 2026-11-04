/** 浮動小数点の足し算の誤差で、同点の順序が入れ替わらないようにする幅。 */
const TIE_EPSILON = 1e-9;

/**
 * 層（コードごとの候補）を 1 つずつ選んで通る道のうち、コストが最小のものを選ぶ（動的計画法）。
 * 前から各候補までの最小コストを積み、最後の層の最小から後ろへたどる。
 * コストが同じなら、候補の順序で先のものを選ぶ。層が無い、または空の層があれば undefined。
 *
 * 道のコストは、選んだ候補の `layerCost` の合計と、隣り合う候補の `transitionCost` の合計。
 */
export function selectCheapestPath<T>(
  layers: readonly (readonly T[])[],
  layerCost: (candidate: T) => number,
  transitionCost: (from: T, to: T) => number,
): { readonly indices: number[]; readonly totalCost: number } | undefined {
  if (layers.length === 0 || layers.some((layer) => layer.length === 0)) return undefined;

  // `map(layerCost)` と書かない。添字が第 2 引数として渡り、省略できる引数を持つ関数が壊れる。
  let totals = layers[0]!.map((candidate) => layerCost(candidate));
  const previous: number[][] = [];
  for (let depth = 1; depth < layers.length; depth++) {
    const from = layers[depth - 1]!;
    const nextTotals: number[] = [];
    const nextPrevious: number[] = [];
    for (const candidate of layers[depth]!) {
      let best = Number.POSITIVE_INFINITY;
      let bestIndex = 0;
      from.forEach((source, index) => {
        const total = totals[index]! + transitionCost(source, candidate);
        if (total < best - TIE_EPSILON) {
          best = total;
          bestIndex = index;
        }
      });
      nextTotals.push(best + layerCost(candidate));
      nextPrevious.push(bestIndex);
    }
    totals = nextTotals;
    previous.push(nextPrevious);
  }

  let last = 0;
  totals.forEach((total, index) => {
    if (total < totals[last]! - TIE_EPSILON) last = index;
  });
  const indices = [last];
  for (let depth = layers.length - 2; depth >= 0; depth--) {
    indices.unshift(previous[depth]![indices[0]!]!);
  }
  return { indices, totalCost: totals[last]! };
}
