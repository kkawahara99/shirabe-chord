import { CHORD_QUALITIES, CONFLICTING_TENSIONS } from "./chord.ts";

export type NoteLetter = "C" | "D" | "E" | "F" | "G" | "A" | "B";
/** `""` は変化記号なし。 */
export type Accidental = "" | "#" | "b";
export type NoteSelection = { readonly letter: NoteLetter; readonly accidental: Accidental };

/** 記号の中に並べる順（b9, 9, #9, #11, b13, 13）。 */
export const TENSIONS = ["b9", "9", "#9", "#11", "b13", "13"] as const;
export type Tension = (typeof TENSIONS)[number];

/** 画面で選ぶ内容。`quality` は `CHORD_QUALITIES` の `names[0]` に限る（別名や一覧にない文字列は、読めない記号になる）。`bass` が `null` ならオンコードにしない。 */
export type ChordSelection = {
  readonly root: NoteSelection;
  readonly quality: string;
  readonly tensions: readonly Tension[];
  readonly bass: NoteSelection | null;
};

export type BuildChordSymbolResult =
  | { readonly ok: true; readonly symbol: string }
  | { readonly ok: false; readonly reason: "conflicting-tension" };

/** 同時には選べないテンション。 */
export function tensionsConflictingWith(tension: Tension): readonly Tension[] {
  return CONFLICTING_TENSIONS.flatMap(([a, b]) =>
    a === tension ? [b as Tension] : b === tension ? [a as Tension] : [],
  );
}

const TENSIONABLE_QUALITIES: ReadonlySet<string> = new Set(
  CHORD_QUALITIES.filter((q) => q.tensionable).map((q) => q.names[0]!),
);

const noteText = ({ letter, accidental }: NoteSelection) => letter + accidental;

/**
 * 選択からコード記号の文字列を作る。`quality` が `names[0]` なら、作った記号は `parseChord` で読める。
 * テンションを付けられない種類（`CHORD_QUALITIES` の `tensionable` が偽）に渡したテンションは、矛盾する組でも無視する。
 */
export function buildChordSymbol(selection: ChordSelection): BuildChordSymbolResult {
  const chosen = TENSIONABLE_QUALITIES.has(selection.quality)
    ? TENSIONS.filter((t) => selection.tensions.includes(t))
    : [];
  if (CONFLICTING_TENSIONS.some(([a, b]) => chosen.includes(a as Tension) && chosen.includes(b as Tension))) {
    return { ok: false, reason: "conflicting-tension" };
  }
  const tensions = chosen.length > 0 ? `(${chosen.join(",")})` : "";
  const bass = selection.bass === null ? "" : `/${noteText(selection.bass)}`;
  return { ok: true, symbol: `${noteText(selection.root)}${selection.quality}${tensions}${bass}` };
}
