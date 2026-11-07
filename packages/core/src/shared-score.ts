import { parseChord } from "./chord.ts";
import { CAPO_FRETS, lowerSymbol } from "./chord-transpose.ts";
import { MAX_PROGRESSION_CHORDS } from "./progression.ts";
import { validateVoicing, type Voicing } from "./voicing.ts";

// 上限は docs/adr/0035-share-by-unguessable-url-with-google-login.md。文字数はコードポイント単位。
export const MAX_TITLE_LENGTH = 50;
export const MAX_NOTE_LENGTH = 200;
export const MAX_DISPLAY_NAME_LENGTH = 20;
/** コード記号の上限。読める記号は短いので、長い文字列を `parseChord` に渡さないための余裕のある値。 */
export const MAX_SYMBOL_LENGTH = 32;
/** 表示名が空のときに使う名前。 */
export const ANONYMOUS_NAME = "匿名";

/** 共有コードの 1 つ。`symbol` は画面で選んだ「鳴らす名前」、`voicing` はカポをナットとみなした押さえ方。 */
export type SharedChord = {
  readonly symbol: string;
  readonly voicing: Voicing;
};

/** 共有する譜面。表示用の記号（`displaySymbol` など）は混ぜない。 */
export type SharedScore = {
  readonly title: string;
  readonly note: string;
  readonly displayName: string;
  readonly capo: number;
  readonly chords: readonly SharedChord[];
};

export type SharedScoreFailure =
  | "invalid-shape"
  | "invalid-title"
  | "invalid-note"
  | "invalid-display-name"
  | "invalid-capo"
  | "invalid-chord-count" // コードが配列でない場合も含む
  | "invalid-symbol"
  | "invalid-voicing";

export type ValidateSharedScoreResult =
  | { readonly ok: true; readonly score: SharedScore }
  | { readonly ok: false; readonly reason: SharedScoreFailure };

/**
 * 制御文字、行・段落区切り（U+2028・U+2029。改行として働く）、対にならないサロゲート（保存時の JSON などで壊れる）、
 * 双方向の向きを変える制御（U+202A〜202E・U+2066〜2069。表示を偽装できる）。
 */
const FORBIDDEN = /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}\u202a-\u202e\u2066-\u2069]/u;

function codePointCount(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

/** 長さと文字種の条件を満たす文字列か。`allowLf` のときだけ LF を許す。 */
function isCleanText(value: unknown, maxLength: number, allowLf = false): value is string {
  if (typeof value !== "string") return false;
  // コードポイントは UTF-16 の長さの半分以上あるので、明らかな超過は数えずに落とす
  if (value.length > maxLength * 2) return false;
  if (FORBIDDEN.test(allowLf ? value.replaceAll("\n", "") : value)) return false;
  return codePointCount(value) <= maxLength;
}

const fail = (reason: SharedScoreFailure): ValidateSharedScoreResult => ({ ok: false, reason });

/**
 * 受け取った値が共有できる譜面かを検証する。通れば、余分なフィールドを除いた新しい値を返す。
 * どんな値が渡されても例外を投げない。ブラウザ（送る前）とサーバー（受け取るとき）で同じ関数を使う。
 *
 * カポがあるときは、記号を `lowerSymbol` で形の記号にしてから押さえ方を検証する（ADR 0028）。
 */
export function validateSharedScore(value: unknown): ValidateSharedScoreResult {
  try {
    return validate(value);
  } catch {
    // 読むだけで投げる値（ゲッター・失効した Proxy）
    return fail("invalid-shape");
  }
}

function validate(value: unknown): ValidateSharedScoreResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail("invalid-shape");
  // ゲッターで値が変わっても検証と結果がずれないよう、各フィールドは一度だけ読む
  const { title, note, displayName, capo, chords } = value as Record<string, unknown>;

  if (!isCleanText(title, MAX_TITLE_LENGTH) || title.trim() === "") return fail("invalid-title");
  if (note !== undefined && !isCleanText(note, MAX_NOTE_LENGTH, true)) return fail("invalid-note");
  const nameGiven = displayName !== undefined;
  if (nameGiven && !isCleanText(displayName, MAX_DISPLAY_NAME_LENGTH)) return fail("invalid-display-name");

  const validCapo = CAPO_FRETS.find((fret) => fret === capo); // -0 は 0 になる
  if (validCapo === undefined) return fail("invalid-capo");

  const count: unknown = Array.isArray(chords) ? chords.length : undefined;
  if (!Array.isArray(chords) || typeof count !== "number" || count < 1 || count > MAX_PROGRESSION_CHORDS) {
    return fail("invalid-chord-count");
  }
  const sharedChords: SharedChord[] = [];
  for (let index = 0; index < count; index++) {
    const item: unknown = chords[index];
    const chord = toSharedChord(item, validCapo);
    if (typeof chord === "string") return fail(chord);
    sharedChords.push(chord);
  }

  return {
    ok: true,
    score: {
      title,
      note: note ?? "",
      displayName: nameGiven && displayName.trim() !== "" ? displayName : ANONYMOUS_NAME,
      capo: validCapo,
      chords: sharedChords,
    },
  };
}

function toSharedChord(item: unknown, capo: number): SharedChord | "invalid-symbol" | "invalid-voicing" {
  if (typeof item !== "object" || item === null) return "invalid-symbol";
  const { symbol, voicing } = item as Record<string, unknown>;
  if (!isCleanText(symbol, MAX_SYMBOL_LENGTH)) return "invalid-symbol";
  // 保存するのは内部の記号。表示用（♯♭）・全角・前後の空白は、`parseChord` は読めても保存しない
  if (symbol !== symbol.normalize("NFKC").trim().replaceAll("♯", "#").replaceAll("♭", "b")) return "invalid-symbol";
  const shape = parseChord(lowerSymbol(symbol, capo));
  if (!shape.ok) return "invalid-symbol";

  if (!Array.isArray(voicing) || voicing.length !== 6) return "invalid-voicing";
  // -0 は 0 に直す（`+ 0`）。写しを検証するので、検証後に値が変わらない
  const copy = Array.from(voicing as unknown[], (fret) => (typeof fret === "number" ? fret + 0 : fret));
  if (!validateVoicing(copy, shape).ok) return "invalid-voicing";
  return { symbol, voicing: copy as Voicing };
}
