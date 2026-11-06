import { lowestPressedFret, voicingFeatures, type Voicing, type VoicingFeatures } from "./voicing.ts";

/**
 * コストの項目ごとの重み。値の意味と初期値の根拠は docs/adr/0018-minimize-voicing-cost-with-dynamic-programming.md（開放弦の項の分け方と `openStringsHighPosition` は docs/adr/0024-discount-open-strings-only-in-low-positions.md）。
 * 窮屈な形と鳴る弦の少なさの項は docs/adr/0026-penalize-cramped-and-thin-voicings.md。
 * 重みは音楽的な判断を含むので、変えると `progression.test.ts` の代表の進行の期待値も変わる。
 */
export type CostWeights = {
  // 単体（押さえ方 1 つ）。
  readonly fingers: number;
  readonly barre: number;
  readonly span: number;
  readonly averageFret: number;
  /** 低い位置（押さえる最高フレットが `OPEN_POSITION_MAX_FRET` 以下）で、開放弦が多いほどコストを下げる（1 本あたりの値引き）。 */
  readonly openStrings: number;
  /** 高い位置（押さえる最高フレットが `OPEN_POSITION_MAX_FRET` を超える）で、開放弦が多いほどコストを上げる（1 本あたりの加算）。 */
  readonly openStringsHighPosition: number;
  readonly mutedStrings: number;
  /** 窮屈な形（`isCrampedShape`）への加算。 */
  readonly crampedShape: number;
  /** 鳴る弦が `MIN_COMFORTABLE_STRINGS` 本に足りない 1 本あたりの加算。 */
  readonly missingSoundingStrings: number;
  // 移動（前後の押さえ方）。
  readonly fretShift: number;
  readonly changedStrings: number;
};

/** 開放弦を値引きする、押さえる最高フレットの上限。これを超えると加算に変わる（docs/adr/0024）。 */
export const OPEN_POSITION_MAX_FRET = 4;

export const DEFAULT_COST_WEIGHTS: CostWeights = {
  fingers: 1,
  barre: 0.5,
  span: 0.3,
  averageFret: 0.2,
  openStrings: 0.5,
  openStringsHighPosition: 2,
  mutedStrings: 2,
  crampedShape: 1.5,
  missingSoundingStrings: 0.5,
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

/** 鳴る弦がこれより少ない形は、足りない 1 本ごとに加算する（docs/adr/0026）。 */
export const MIN_COMFORTABLE_STRINGS = 4;

/**
 * 窮屈な形か。最も低いフレットを押さえる弦が 2 本以上あり、その弦の間に開放弦と、より高いフレットを押さえる弦の両方があり、
 * 指が 4 本必要な形（Bb の `x10331` など）。開放弦をはさむのでセーハにならず、同じフレットを別々の指で押さえることになる。
 */
function isCrampedShape(voicing: Voicing, features: VoicingFeatures): boolean {
  if (features.fingers !== 4) return false;
  const lowest = lowestPressedFret(voicing)!; // 指が 4 本なので押さえるフレットはある。
  const first = voicing.indexOf(lowest);
  const between = voicing.slice(first, voicing.lastIndexOf(lowest) + 1);
  return (
    between.filter((fret) => fret === lowest).length >= 2 &&
    between.includes(0) &&
    between.some((fret) => fret !== null && fret > lowest)
  );
}

/** 開放弦の項。押さえるフレットが無い形は最高フレット 0 なので値引き側。 */
function openStringsCost(
  features: Pick<VoicingFeatures, "highestFret" | "openStrings">,
  weights: CostWeights,
): number {
  return features.highestFret <= OPEN_POSITION_MAX_FRET
    ? -weights.openStrings * features.openStrings
    : weights.openStringsHighPosition * features.openStrings;
}

export function scoreVoicing(
  voicing: Voicing,
  weights: CostWeights = DEFAULT_COST_WEIGHTS,
): ScoredVoicing {
  const features = voicingFeatures(voicing);
  const mutedStrings = voicing.filter((fret) => fret === null).length;
  const missingStrings = Math.max(0, MIN_COMFORTABLE_STRINGS - (voicing.length - mutedStrings));
  const cost =
    weights.fingers * features.fingers +
    weights.barre * (features.hasBarre ? 1 : 0) +
    weights.span * features.span +
    weights.averageFret * features.averageFret +
    openStringsCost(features, weights) +
    weights.mutedStrings * mutedStrings +
    (isCrampedShape(voicing, features) ? weights.crampedShape : 0) +
    weights.missingSoundingStrings * missingStrings;
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
