import { TIE_EPSILON } from "./cheapest-path.ts";
import { parseChord, type ChordParseFailure } from "./chord.ts";
import { voicingCost } from "./cost.ts";
import { generateVoicings, lowestPressedFret, type Voicing } from "./voicing.ts";

/** 最低フレットごとの代表の押さえ方。`candidateIndex` は `generateVoicings` の結果全体の中での位置。 */
export type Shape = {
  readonly lowestFret: number;
  readonly voicing: Voicing;
  readonly candidateIndex: number;
};

export type ListShapesResult =
  | { readonly ok: true; readonly shapes: readonly Shape[] }
  | { readonly ok: false; readonly reason: ChordParseFailure | "no-voicing" };

/**
 * コードの押さえ方を最低フレットで分け、各最低フレットで単体のコストが最小の 1 つを、最低フレットの昇順で返す。
 * 同じコストなら `generateVoicings` の順で先。押さえるフレットが無い押さえ方（開放弦とミュートだけ）は対象外。
 */
export function listShapesByLowestFret(symbol: string): ListShapesResult {
  const parsed = parseChord(symbol);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const voicings = generateVoicings(parsed);
  if (voicings.length === 0) return { ok: false, reason: "no-voicing" };

  const best = new Map<number, Shape & { readonly cost: number }>();
  voicings.forEach((voicing, candidateIndex) => {
    const lowestFret = lowestPressedFret(voicing);
    if (lowestFret === undefined) return;
    const cost = voicingCost(voicing);
    const current = best.get(lowestFret);
    if (current === undefined || cost < current.cost - TIE_EPSILON) {
      best.set(lowestFret, { lowestFret, voicing, candidateIndex, cost });
    }
  });
  const shapes = [...best.values()]
    .sort((a, b) => a.lowestFret - b.lowestFret)
    .map(({ lowestFret, voicing, candidateIndex }) => ({ lowestFret, voicing, candidateIndex }));
  return { ok: true, shapes };
}
