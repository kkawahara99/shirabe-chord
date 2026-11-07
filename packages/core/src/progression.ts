import { selectCheapestPath } from "./cheapest-path.ts";
import { parseChord, type ChordParseFailure } from "./chord.ts";
import { scoredTransitionCost, scoreVoicing, type ScoredVoicing } from "./cost.ts";
import { generateVoicings, lowestPressedFret, validateVoicing, type Voicing } from "./voicing.ts";

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
  /**
   * 手の位置の窓に、広げずに収まったか。`pins` が 1 つでもあるときだけ、全ステップに付く。
   * 固定したコードは常に `true`。`false` は、窓に収まる候補が無く、窓を広げて選んだコード（ADR 0021・0032）。
   */
  readonly inWindow?: boolean;
};

export type OptimizeOptions = {
  /**
   * 固定するコード。進行の位置（0 始まり）→ 押さえ方。固定したコードはその押さえ方だけを候補にし、
   * 残りは、押さえるフレットがある固定のうち先頭に最も近いものの最低フレットから 5 フレット分の窓に
   * 収まる押さえ方から選ぶ（ADR 0021・0032）。
   */
  readonly pins?: ReadonlyMap<number, Voicing>;
};

export type OptimizeProgressionResult =
  | { readonly ok: true; readonly steps: readonly ProgressionStep[]; readonly totalCost: number }
  | {
      readonly ok: false;
      readonly reason: "empty" | "too-long" | "too-many-chords";
    }
  | {
      readonly ok: false;
      readonly reason: "invalid-pinned-voicing";
      /** 最初に見つかった不正な固定の位置（0 始まり）。整数でない位置は、渡された値そのまま。 */
      readonly index: number;
    }
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
export function optimizeProgression(
  text: string,
  options?: OptimizeOptions,
): OptimizeProgressionResult {
  if (text.length > MAX_PROGRESSION_LENGTH) return { ok: false, reason: "too-long" };
  return optimizeSymbols(splitProgression(text), options);
}

/**
 * コード記号の配列から、押さえ方の並びを選ぶ。記号は分割・正規化せずそのまま読む。
 * 文字数は検査しない（記号をつなぐと `MAX_PROGRESSION_LENGTH` を超えうる。文字数の上限は文字列で渡す入口だけ）。
 */
export function optimizeSymbols(
  symbols: readonly string[],
  options?: OptimizeOptions,
): OptimizeProgressionResult {
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

  // 層は「候補」と「`generateVoicings` の結果全体の中での位置」の組。絞っても位置は変えない。
  type Entry = { readonly scored: ScoredVoicing; readonly candidateIndex: number };
  let entries: Entry[][] = layers.map((layer) =>
    layer.map((scored, candidateIndex) => ({ scored, candidateIndex })),
  );
  let inWindow: boolean[] | undefined;

  const pins = options?.pins;
  if (pins !== undefined && pins.size > 0) {
    // 整数でない位置を渡された順に、次に整数の位置を小さい順に調べる。
    const positions = [...pins.keys()];
    const pinned = positions.filter(Number.isInteger).sort((a, b) => a - b);
    const fixedIndex = new Map<number, number>();
    for (const position of [...positions.filter((p) => !Number.isInteger(p)), ...pinned]) {
      const voicing = pins.get(position)!;
      // 読めない記号は上で返したので、範囲内の位置の記号は読める。
      const parsed = Number.isInteger(position) && position >= 0 && position < symbols.length ? parseChord(symbols[position]!) : undefined;
      const index =
        parsed?.ok && validateVoicing(voicing, parsed).ok
          ? layers[position]!.findIndex((candidate) => sameVoicing(candidate.voicing, voicing))
          : -1;
      if (index === -1) return { ok: false, reason: "invalid-pinned-voicing", index: position };
      fixedIndex.set(position, index);
    }

    // 窓は 1 つだけ。押さえるフレットがある固定のうち、先頭に最も近いものから決める（ADR 0032）。
    const basis = pinned
      .map((position) => lowestPressedFret(pins.get(position)!))
      .find((lowest) => lowest !== undefined);
    const flags = layers.map(() => true);
    inWindow = flags;
    entries = entries.map((layer, i) => {
      const fixed = fixedIndex.get(i);
      if (fixed !== undefined) return [layer[fixed]!];
      // 窓をかけない（押さえるフレットがある固定が無い）。
      if (basis === undefined) return layer;
      // 窓に候補が無ければ、下限を 1 下げ（1 まで）、上限を 1 上げる。
      for (let widen = 0; ; widen++) {
        const low = Math.max(1, basis - widen);
        const high = basis + WINDOW_SIZE - 1 + widen;
        const fitting = layer.filter((entry) => fitsWindow(entry.scored.voicing, low, high));
        if (fitting.length > 0) {
          flags[i] = widen === 0;
          return fitting;
        }
      }
    });
  }

  const path = selectCheapestPath(
    entries,
    (entry) => entry.scored.cost,
    (from, to) => scoredTransitionCost(from.scored, to.scored),
  )!;
  return {
    ok: true,
    steps: path.indices.map((chosen, i) => {
      const entry = entries[i]![chosen]!;
      const step: ProgressionStep = {
        symbol: symbols[i]!,
        voicing: entry.scored.voicing,
        candidateIndex: entry.candidateIndex,
      };
      return inWindow === undefined ? step : { ...step, inWindow: inWindow[i]! };
    }),
    totalCost: path.totalCost,
  };
}

/** 窓の大きさ（フレット数）。ADR 0021。 */
const WINDOW_SIZE = 5;

/** 押さえるフレットがすべて [low, high] に収まる。開放弦とミュートは問わない。 */
function fitsWindow(voicing: Voicing, low: number, high: number): boolean {
  return voicing.every((fret) => fret === null || fret === 0 || (fret >= low && fret <= high));
}

function sameVoicing(a: Voicing, b: Voicing): boolean {
  return a.length === b.length && a.every((fret, string) => fret === b[string]);
}
