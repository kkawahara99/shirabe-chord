import { voicingFeatures, type Voicing } from "./voicing.ts";

/**
 * コストの項目ごとの重み。値の意味と初期値の根拠は docs/adr/0018-minimize-voicing-cost-with-dynamic-programming.md。
 * 重みは音楽的な判断を含むので、変えると `progression.test.ts` の代表の進行の期待値も変わる。
 */
export type CostWeights = {
  // 単体（押さえ方 1 つ）。
  readonly fingers: number;
  readonly barre: number;
  readonly span: number;
  readonly averageFret: number;
  /** 開放弦が多いほどコストを下げる（1 本あたりの値引き）。 */
  readonly openStrings: number;
  readonly mutedStrings: number;
  // 移動（前後の押さえ方）。
  readonly fretShift: number;
  readonly changedStrings: number;
};

export const DEFAULT_COST_WEIGHTS: CostWeights = {
  fingers: 1,
  barre: 0.5,
  span: 0.3,
  averageFret: 0.2,
  openStrings: 0.5,
  mutedStrings: 2,
  fretShift: 0.6,
  changedStrings: 0.4,
};

/** 最適化の 1 候補。特徴を比べるたびに数え直さないよう、単体のコストと位置を先に求めておく。 */
export type ScoredVoicing = {
  readonly voicing: Voicing;
  readonly cost: number;
  /**
   * 押さえる位置の平均フレット。開放弦とミュートだけの弦は入れない。
   * 押さえるフレットが無い押さえ方は 0（開放の位置）。0 に決めておくと、移動の距離が三角不等式を満たし、
   * 同じコードが続くのに間の押さえ方で位置が飛ぶ、ということが起きない。
   */
  readonly position: number;
};

export function scoreVoicing(
  voicing: Voicing,
  weights: CostWeights = DEFAULT_COST_WEIGHTS,
): ScoredVoicing {
  const features = voicingFeatures(voicing);
  const mutedStrings = voicing.filter((fret) => fret === null).length;
  const cost =
    weights.fingers * features.fingers +
    weights.barre * (features.hasBarre ? 1 : 0) +
    weights.span * features.span +
    weights.averageFret * features.averageFret -
    weights.openStrings * features.openStrings +
    weights.mutedStrings * mutedStrings;
  return {
    voicing,
    cost,
    position: features.averageFret,
  };
}

export function scoredTransitionCost(
  from: ScoredVoicing,
  to: ScoredVoicing,
  weights: CostWeights = DEFAULT_COST_WEIGHTS,
): number {
  const shift = Math.abs(from.position - to.position);
  let changed = 0;
  for (let string = 0; string < from.voicing.length; string++) {
    if (from.voicing[string] !== to.voicing[string]) changed++;
  }
  return weights.fretShift * shift + weights.changedStrings * changed;
}

/** 押さえ方 1 つの弾きにくさ。形は検査しない（`generateVoicings` の結果を渡す）。 */
export function voicingCost(voicing: Voicing, weights: CostWeights = DEFAULT_COST_WEIGHTS): number {
  return scoreVoicing(voicing, weights).cost;
}

/** 前の押さえ方から次の押さえ方へ移る手間。前後を入れ替えても同じ。 */
export function transitionCost(
  from: Voicing,
  to: Voicing,
  weights: CostWeights = DEFAULT_COST_WEIGHTS,
): number {
  return scoredTransitionCost(scoreVoicing(from, weights), scoreVoicing(to, weights), weights);
}
