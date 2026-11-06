import type { ParsedChord } from "./chord.ts";
import { transpose, type PitchClass } from "./pitch-class.ts";

/** 1 本の弦の状態。フレット番号（0 は開放）か、鳴らさない（null）。 */
export type StringState = number | null;

/** 押さえ方。6弦（低音の E）から 1弦（高音の E）の順。 */
export type Voicing = readonly StringState[];

/** 妥当でない理由の種類。番号は ADR 0017 の条件の番号。複数破るときは小さい番号を返す。 */
export type VoicingFailure =
  | "invalid-shape" // 1
  | "too-few-strings" // 2
  | "wrong-notes" // 3
  | "wrong-bass" // 4
  | "wide-span" // 5
  | "too-many-inner-mutes" // 6
  | "too-many-fingers"; // 7

export type ValidateVoicingResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: VoicingFailure };

/** 最適化で使う特徴。押さえるフレット（開放を除く）が無いとき、`span`・`highestFret`・`averageFret` は 0。 */
export type VoicingFeatures = {
  readonly fingers: number;
  readonly hasBarre: boolean;
  readonly span: number;
  /** 押さえるフレットの最大値。 */
  readonly highestFret: number;
  readonly averageFret: number;
  readonly openStrings: number;
};

// 条件は docs/adr/0017-voicing-validity-conditions.md。
const STRING_COUNT = 6;
const MAX_FRET = 15;
/** 標準チューニング（E2・A2・D3・G3・B3・E4）の開放弦の高さ。MIDI のノート番号。 */
const OPEN_PITCHES: readonly number[] = [40, 45, 50, 55, 59, 64];
const MIN_SOUNDING_STRINGS = 3;
const MAX_SPAN = 3;
const MAX_INNER_MUTES = 1;
const MAX_FINGERS = 4;

const pitchClassOf = (string: number, fret: number): PitchClass =>
  transpose(0, OPEN_PITCHES[string]! + fret);

/** 形が合えば写しを返す。どんな値でも例外を投げない（失効した Proxy など、読むだけで投げる値も不合格）。 */
function toVoicing(value: unknown): Voicing | undefined {
  try {
    if (!Array.isArray(value) || value.length !== STRING_COUNT) return undefined;
    const voicing: StringState[] = [];
    for (let string = 0; string < STRING_COUNT; string++) {
      const fret: unknown = value[string];
      if (fret === null) {
        voicing.push(null);
      } else if (
        typeof fret === "number" &&
        Number.isInteger(fret) &&
        fret >= 0 &&
        fret <= MAX_FRET
      ) {
        voicing.push(fret);
      } else {
        return undefined;
      }
    }
    return voicing;
  } catch {
    return undefined;
  }
}

/**
 * 押さえ方の特徴を返す。形は検査しない（`validateVoicing` を通ったものか、`generateVoicings` の結果を渡す）。
 *
 * セーハは、最も低いフレットを押さえる弦が 2 本以上あり、その最も低い弦から 1弦までに開放弦が無いときに成り立つ
 * （ミュートの弦は指の腹で消すとみなす）。成り立つとき、その弦をまとめて 1 本の指に数える。
 */
export function voicingFeatures(voicing: Voicing): VoicingFeatures {
  const pressed = voicing.filter((fret): fret is number => fret !== null && fret > 0);
  const openStrings = voicing.filter((fret) => fret === 0).length;
  if (pressed.length === 0) {
    return { fingers: 0, hasBarre: false, span: 0, highestFret: 0, averageFret: 0, openStrings };
  }

  const lowest = Math.min(...pressed);
  const highest = Math.max(...pressed);
  const barreStart = voicing.indexOf(lowest);
  const hasBarre =
    pressed.filter((fret) => fret === lowest).length >= 2 &&
    voicing.slice(barreStart).every((fret) => fret !== 0);
  const fingers = hasBarre ? 1 + pressed.filter((fret) => fret > lowest).length : pressed.length;

  return {
    fingers,
    hasBarre,
    span: highest - lowest,
    highestFret: highest,
    averageFret: pressed.reduce((sum, fret) => sum + fret, 0) / pressed.length,
    openStrings,
  };
}

/**
 * 押さえるフレット（開放とミュートを除く）の最小値。押さえるフレットが無ければ undefined。
 * 平均フレット（`voicingFeatures` の `averageFret`）とは別のもの。
 */
export function lowestPressedFret(voicing: Voicing): number | undefined {
  const pressed = voicing.filter((fret): fret is number => fret !== null && fret > 0);
  return pressed.length === 0 ? undefined : Math.min(...pressed);
}

const fail = (reason: VoicingFailure): ValidateVoicingResult => ({ ok: false, reason });

/** 押さえ方がコードの押さえ方として妥当かを判定する。どんな値が渡されても例外を投げない。 */
export function validateVoicing(value: unknown, chord: ParsedChord): ValidateVoicingResult {
  const voicing = toVoicing(value);
  if (voicing === undefined) return fail("invalid-shape");

  const sounding = voicing.flatMap((fret, string) => (fret === null ? [] : [{ string, fret }]));
  if (sounding.length < MIN_SOUNDING_STRINGS) return fail("too-few-strings");

  const played = new Set(sounding.map(({ string, fret }) => pitchClassOf(string, fret)));
  const allowed = new Set<PitchClass>([...chord.required, ...chord.optional]);
  if (
    !chord.required.every((pitchClass) => played.has(pitchClass)) ||
    ![...played].every((pitchClass) => allowed.has(pitchClass))
  ) {
    return fail("wrong-notes");
  }

  const lowestPitch = Math.min(...sounding.map(({ string, fret }) => OPEN_PITCHES[string]! + fret));
  if (transpose(0, lowestPitch) !== chord.bass) return fail("wrong-bass");

  const features = voicingFeatures(voicing);
  if (features.span > MAX_SPAN) return fail("wide-span");

  const innerMutes = voicing
    .slice(sounding[0]!.string, sounding[sounding.length - 1]!.string)
    .filter((fret) => fret === null).length;
  if (innerMutes > MAX_INNER_MUTES) return fail("too-many-inner-mutes");

  if (features.fingers > MAX_FINGERS) return fail("too-many-fingers");
  return { ok: true };
}

/**
 * 条件をすべて満たす押さえ方を、重複なく返す。
 * 並びは、押さえる位置の平均フレットの昇順、同じなら 6弦から順に各弦の値の辞書順（ミュートが最小）。
 *
 * 押さえるフレットの差は 3 以下なので、最も低い押さえるフレットから 4 フレット分の窓ごとに数える
 * （全探索は 17 の 6 乗通りで遅い）。弦ごとに、コードの音になるフレットだけを選ぶ。
 * 窓が重なると同じ押さえ方が出るので、重複を除く。
 */
export function generateVoicings(chord: ParsedChord): Voicing[] {
  const allowed = new Set<PitchClass>([...chord.required, ...chord.optional]);
  const playable: number[][] = Array.from({ length: STRING_COUNT }, (_, string) =>
    Array.from({ length: MAX_FRET + 1 }, (_, fret) => fret).filter((fret) =>
      allowed.has(pitchClassOf(string, fret)),
    ),
  );

  const found = new Map<string, Voicing>();
  const current: StringState[] = Array.from({ length: STRING_COUNT }, () => null);
  const search = (string: number, window: number): void => {
    if (string === STRING_COUNT) {
      if (validateVoicing(current, chord).ok) {
        found.set(current.map((fret) => fret ?? "x").join(","), [...current]);
      }
      return;
    }
    current[string] = null;
    search(string + 1, window);
    for (const fret of playable[string]!) {
      if (fret === 0 || (fret >= window && fret <= window + MAX_SPAN)) {
        current[string] = fret;
        search(string + 1, window);
      }
    }
    current[string] = null;
  };
  for (let window = 1; window <= MAX_FRET; window++) search(0, window);

  return [...found.values()]
    .map((voicing) => ({ voicing, average: voicingFeatures(voicing).averageFret }))
    .sort((a, b) => a.average - b.average || compareByString(a.voicing, b.voicing))
    .map(({ voicing }) => voicing);
}

/** 6弦から順に各弦の値を比べる。ミュートを最も小さい（-1）とみなす。 */
function compareByString(a: Voicing, b: Voicing): number {
  for (let string = 0; string < STRING_COUNT; string++) {
    const difference = (a[string] ?? -1) - (b[string] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}
