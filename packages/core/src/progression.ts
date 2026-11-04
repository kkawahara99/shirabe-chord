import { selectCheapestPath } from "./cheapest-path.ts";
import { parseChord, type ChordParseFailure } from "./chord.ts";
import { scoredTransitionCost, scoreVoicing, type ScoredVoicing } from "./cost.ts";
import { generateVoicings, type Voicing } from "./voicing.ts";

/** 入力の上限。長い入力で処理が重くなるのを防ぐ（ADR 0018）。 */
export const MAX_PROGRESSION_LENGTH = 1000;
export const MAX_PROGRESSION_CHORDS = 64;

/** 進行のうち、押さえ方を選べなかったコード。`index` は 0 始まり。 */
export type InvalidChord = {
  readonly index: number;
  readonly symbol: string;
  readonly reason: ChordParseFailure | "no-voicing";
};

export type ProgressionStep = {
  readonly symbol: string;
  readonly voicing: Voicing;
  /** `generateVoicings` の結果の中での位置。モード 2 で候補から選び直すときに使う。 */
  readonly candidateIndex: number;
};

export type OptimizeProgressionResult =
  | { readonly ok: true; readonly steps: readonly ProgressionStep[]; readonly totalCost: number }
  | { readonly ok: false; readonly reason: "empty" | "too-long" | "too-many-chords" }
  | {
      readonly ok: false;
      readonly reason: "invalid-chords";
      readonly chords: readonly InvalidChord[];
    };

/**
 * 空白（改行・タブを含む）と `|` で区切り、空の記号は作らない。
 * 先に全角を半角にそろえる（NFKC）ので、全角の空白と `｜` でも区切れる。コード記号の読み取りも同じそろえ方をする。
 */
export function splitProgression(text: string): string[] {
  return text
    .normalize("NFKC")
    .split(/[\s|]+/)
    .filter((symbol) => symbol !== "");
}

/**
 * コード進行の文字列から、手の移動が少なく弾きやすい押さえ方の並びを選ぶ。同じ入力には同じ結果を返す。
 * 失敗は例外でなく値で返す。読めない記号と押さえ方が無いコードは、全部まとめて返す。
 */
export function optimizeProgression(text: string): OptimizeProgressionResult {
  if (text.length > MAX_PROGRESSION_LENGTH) return { ok: false, reason: "too-long" };
  const symbols = splitProgression(text);
  if (symbols.length === 0) return { ok: false, reason: "empty" };
  if (symbols.length > MAX_PROGRESSION_CHORDS) return { ok: false, reason: "too-many-chords" };

  // 同じ記号の候補は 1 度だけ作る。
  const cache = new Map<string, ScoredVoicing[] | ChordParseFailure | "no-voicing">();
  const candidatesOf = (symbol: string) => {
    let found = cache.get(symbol);
    if (found === undefined) {
      const parsed = parseChord(symbol);
      if (!parsed.ok) {
        found = parsed.reason;
      } else {
        const voicings = generateVoicings(parsed);
        found = voicings.length === 0 ? "no-voicing" : voicings.map((v) => scoreVoicing(v));
      }
      cache.set(symbol, found);
    }
    return found;
  };

  const layers: ScoredVoicing[][] = [];
  const invalid: InvalidChord[] = [];
  symbols.forEach((symbol, index) => {
    const candidates = candidatesOf(symbol);
    if (typeof candidates === "string") invalid.push({ index, symbol, reason: candidates });
    else layers.push(candidates);
  });
  if (invalid.length > 0) return { ok: false, reason: "invalid-chords", chords: invalid };

  const path = selectCheapestPath(
    layers,
    (candidate) => candidate.cost,
    (from, to) => scoredTransitionCost(from, to),
  )!;
  return {
    ok: true,
    steps: path.indices.map((candidateIndex, i) => ({
      symbol: symbols[i]!,
      voicing: layers[i]![candidateIndex]!.voicing,
      candidateIndex,
    })),
    totalCost: path.totalCost,
  };
}
