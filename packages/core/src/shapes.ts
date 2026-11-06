import { TIE_EPSILON } from "./cheapest-path.ts";
import { parseChord, type ChordParseFailure } from "./chord.ts";
import { voicingCost } from "./cost.ts";
import { generateVoicings, lowestPressedFret, voicingFeatures, type Voicing } from "./voicing.ts";

/** 最低フレットごとの代表の押さえ方（同じ最低フレットで最大 2 つ）。`candidateIndex` は `generateVoicings` の結果全体の中での位置。 */
export type Shape = {
  readonly lowestFret: number;
  readonly voicing: Voicing;
  readonly candidateIndex: number;
};

export type ListShapesResult =
  | { readonly ok: true; readonly shapes: readonly Shape[] }
  | { readonly ok: false; readonly reason: ChordParseFailure | "no-voicing" };

/**
 * コードの押さえ方を最低フレットで分け、各最低フレットで、単体のコストが最小の 1 つと、セーハの形のうち単体のコストが最小の 1 つを返す
 * （同じ押さえ方なら 1 つ。セーハの形が無い最低フレットは 1 つだけ）。
 * 並びは最低フレットの昇順で、同じ最低フレットの中は単体のコストの昇順（セーハの最安は単体の最安より安くならない）。
 * 同じコストなら `generateVoicings` の順で先。押さえるフレットが無い押さえ方（開放弦とミュートだけ）は対象外。
 * 理由は docs/adr/0024-discount-open-strings-only-in-low-positions.md。
 */
export function listShapesByLowestFret(symbol: string): ListShapesResult {
  const parsed = parseChord(symbol);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const voicings = generateVoicings(parsed);
  if (voicings.length === 0) return { ok: false, reason: "no-voicing" };

  type Scored = Shape & { readonly cost: number };
  const cheaper = (candidate: Scored, current: Scored | undefined) =>
    current === undefined || candidate.cost < current.cost - TIE_EPSILON;
  const best = new Map<number, { overall?: Scored; barre?: Scored }>();
  voicings.forEach((voicing, candidateIndex) => {
    const lowestFret = lowestPressedFret(voicing);
    if (lowestFret === undefined) return;
    const scored = { lowestFret, voicing, candidateIndex, cost: voicingCost(voicing) };
    const entry = best.get(lowestFret) ?? {};
    best.set(lowestFret, entry);
    if (cheaper(scored, entry.overall)) entry.overall = scored;
    if (voicingFeatures(voicing).hasBarre && cheaper(scored, entry.barre)) entry.barre = scored;
  });
  const shapes = [...best.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, { overall, barre }]) => (barre === undefined || barre === overall ? [overall!] : [overall!, barre]))
    .map(({ lowestFret, voicing, candidateIndex }) => ({ lowestFret, voicing, candidateIndex }));
  return { ok: true, shapes };
}
