import { transpose, type PitchClass } from "./pitch-class.ts";

/** 読めなかった理由の種類。 */
export type ChordParseFailure =
  | "empty"
  | "invalid-root"
  | "unsupported-quality"
  | "invalid-tension"
  | "duplicate-tension"
  | "conflicting-tension"
  | "invalid-bass";

/**
 * コード記号の構成音。`required`・`optional` はピッチクラスの昇順で、重ならない。
 * `bass` は常に `required` に含まれる（オンコードでなければルートと同じ）。
 */
export type ParsedChord = {
  readonly root: PitchClass;
  readonly bass: PitchClass;
  readonly required: readonly PitchClass[];
  readonly optional: readonly PitchClass[];
};

export type ParseChordResult =
  | ({ readonly ok: true } & ParsedChord)
  | { readonly ok: false; readonly reason: ChordParseFailure };

/** ルートからの半音数で、種類ごとの必須・省略できる音を表す。 */
type Quality = {
  readonly names: readonly string[];
  readonly required: readonly number[];
  readonly optional: readonly number[];
  /** 括弧のテンションを付けられる種類（7・m7・M7）。 */
  readonly tensionable?: true;
};

// 規則は docs/adr/0016-chord-symbol-grammar-and-required-notes.md。
// 完全 5度（7）は省略できる。変化した 5度（6・8）はコードの性格を決めるので必須。
const QUALITIES: readonly Quality[] = [
  { names: [""], required: [0, 4], optional: [7] },
  { names: ["m"], required: [0, 3], optional: [7] },
  { names: ["7"], required: [0, 4, 10], optional: [7], tensionable: true },
  { names: ["M7", "maj7", "△7"], required: [0, 4, 11], optional: [7], tensionable: true },
  { names: ["m7"], required: [0, 3, 10], optional: [7], tensionable: true },
  { names: ["mM7"], required: [0, 3, 11], optional: [7] },
  { names: ["6"], required: [0, 4, 9], optional: [7] },
  { names: ["m6"], required: [0, 3, 9], optional: [7] },
  { names: ["9"], required: [0, 4, 10, 2], optional: [7] },
  { names: ["M9"], required: [0, 4, 11, 2], optional: [7] },
  { names: ["m9"], required: [0, 3, 10, 2], optional: [7] },
  { names: ["add9"], required: [0, 4, 2], optional: [7] },
  // 11度は 3度とぶつかるので含めない。9度は省略できる。
  { names: ["13"], required: [0, 4, 10, 9], optional: [7, 2] },
  { names: ["m7-5", "m7(b5)", "ø"], required: [0, 3, 6, 10], optional: [] },
  { names: ["dim", "°"], required: [0, 3, 6], optional: [] },
  { names: ["dim7", "°7"], required: [0, 3, 6, 9], optional: [] },
  { names: ["aug", "+"], required: [0, 4, 8], optional: [] },
  { names: ["sus4"], required: [0, 5], optional: [7] },
  { names: ["sus2"], required: [0, 2], optional: [7] },
  { names: ["7sus4"], required: [0, 5, 10], optional: [7] },
];

/** 画面が選択肢に使う、種類の情報。音程は出さない。`names[0]` が記号に出す名前（三和音の M は空文字）。 */
export type ChordQualityInfo = {
  readonly names: readonly string[];
  readonly tensionable: boolean;
};

export const CHORD_QUALITIES: readonly ChordQualityInfo[] = QUALITIES.map((q) => ({
  names: q.names,
  tensionable: q.tensionable === true,
}));

const QUALITY_BY_NAME: ReadonlyMap<string, Quality> = new Map(
  QUALITIES.flatMap((q) => q.names.map((name) => [name, q] as const)),
);

const TENSION_SEMITONES: Readonly<Record<string, number>> = {
  b9: 1,
  "9": 2,
  "#9": 3,
  "#11": 6,
  b13: 8,
  "13": 9,
};

/** 同じ度数の「変化しない形」と「変化した形」は同時に指定できない。 */
export const CONFLICTING_TENSIONS: readonly (readonly string[])[] = [
  ["9", "b9"],
  ["9", "#9"],
  ["13", "b13"],
];

const NATURAL_NOTES: Readonly<Record<string, PitchClass>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const NOTE_NAME = /^[A-G][#b]?/;

function noteNameToPitchClass(name: string): PitchClass {
  const natural = NATURAL_NOTES[name[0]!]!;
  if (name.length === 1) return natural;
  return transpose(natural, name[1] === "#" ? 1 : -1);
}

const fail = (reason: ChordParseFailure): ParseChordResult => ({ ok: false, reason });

/** コード記号の文字列を読み、構成音を返す。読めないときは例外でなく失敗の種類を返す。 */
export function parseChord(symbol: string): ParseChordResult {
  const text = symbol.normalize("NFKC").trim().replaceAll("♯", "#").replaceAll("♭", "b");
  if (text === "") return fail("empty");

  const rootName = NOTE_NAME.exec(text)?.[0];
  if (rootName === undefined) return fail("invalid-root");
  const root = noteNameToPitchClass(rootName);

  const parts = text.slice(rootName.length).split("/");
  if (parts.length > 2) return fail("invalid-bass");
  const [qualityText = "", bassText] = parts;

  let bass = root;
  if (bassText !== undefined) {
    if (!NOTE_NAME.test(bassText) || NOTE_NAME.exec(bassText)![0] !== bassText) {
      return fail("invalid-bass");
    }
    bass = noteNameToPitchClass(bassText);
  }

  const resolved = resolveQuality(qualityText);
  if (!resolved.ok) return fail(resolved.reason);
  const { quality, tensions } = resolved;

  const required = new Set<PitchClass>();
  for (const semitones of [...quality.required, ...tensions.map((t) => TENSION_SEMITONES[t]!)]) {
    required.add(transpose(root, semitones));
  }
  required.add(bass);
  const optional = new Set<PitchClass>();
  for (const semitones of quality.optional) {
    const pitchClass = transpose(root, semitones);
    if (!required.has(pitchClass)) optional.add(pitchClass);
  }

  const ascending = (set: ReadonlySet<PitchClass>) => [...set].sort((a, b) => a - b);
  return { ok: true, root, bass, required: ascending(required), optional: ascending(optional) };
}

function resolveQuality(
  text: string,
):
  | { ok: true; quality: Quality; tensions: readonly string[] }
  | { ok: false; reason: ChordParseFailure } {
  const whole = QUALITY_BY_NAME.get(text);
  if (whole !== undefined) return { ok: true, quality: whole, tensions: [] };
  if (!text.includes("(") && !text.includes(")")) {
    return { ok: false, reason: "unsupported-quality" };
  }

  const bracketed = /^([^()]*)\(([^()]*)\)$/.exec(text);
  if (bracketed === null) return { ok: false, reason: "invalid-tension" };
  const quality = QUALITY_BY_NAME.get(bracketed[1]!);
  if (quality === undefined) return { ok: false, reason: "unsupported-quality" };
  if (quality.tensionable !== true) return { ok: false, reason: "invalid-tension" };

  const tensions = bracketed[2]!.split(",");
  if (!tensions.every((t) => Object.hasOwn(TENSION_SEMITONES, t))) {
    return { ok: false, reason: "invalid-tension" };
  }
  if (new Set(tensions).size !== tensions.length) {
    return { ok: false, reason: "duplicate-tension" };
  }
  if (CONFLICTING_TENSIONS.some(([a, b]) => tensions.includes(a!) && tensions.includes(b!))) {
    return { ok: false, reason: "conflicting-tension" };
  }
  return { ok: true, quality, tensions };
}
