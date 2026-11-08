import {
  buildChordSymbol,
  CHORD_QUALITIES,
  generateVoicings,
  lowerSymbol,
  lowestPressedFret,
  parseChord,
  TENSIONS,
  type ChordSelection,
  type NoteSelection,
  type SharedScore,
  type Shape,
  type Tension,
  type Voicing,
} from "@shirabe-chord/core";

// 共有した譜面を、トップの編集画面の状態（コードの選択・カポ・固定）に直す。

/** 別名を含む種類の名前 → 記号に出す名前（`names[0]`）。 */
const QUALITY_BY_NAME: ReadonlyMap<string, string> = new Map(CHORD_QUALITIES.flatMap((q) => q.names.map((name) => [name, q.names[0]!] as const)));

const NOTE = /^([A-G])([#b]?)$/;

function noteOf(text: string): NoteSelection | null {
  const match = NOTE.exec(text);
  return match ? { letter: match[1] as NoteSelection["letter"], accidental: match[2] as NoteSelection["accidental"] } : null;
}

/**
 * コード記号を画面の選択に戻す。読めない記号は `null`。
 * 戻した選択から作る記号が元の記号と同じ構成音であることを確かめる（食い違うなら `null`）。
 */
export function selectionOf(symbol: string): ChordSelection | null {
  const expected = parseChord(symbol);
  if (!expected.ok) return null;
  const text = symbol.normalize("NFKC").trim().replaceAll("♯", "#").replaceAll("♭", "b");

  const [head = "", bassText, ...rest] = text.split("/");
  if (rest.length > 0) return null;
  const rootName = /^[A-G][#b]?/.exec(head)?.[0] ?? "";
  const root = noteOf(rootName);
  const bass = bassText === undefined ? null : noteOf(bassText);
  if (root === null || (bassText !== undefined && bass === null)) return null;

  const qualityText = head.slice(rootName.length);
  let quality = QUALITY_BY_NAME.get(qualityText);
  let tensions: Tension[] = [];
  if (quality === undefined) {
    const bracketed = /^([^()]*)\(([^()]*)\)$/.exec(qualityText);
    quality = bracketed ? QUALITY_BY_NAME.get(bracketed[1]!) : undefined;
    if (quality === undefined) return null;
    const listed = bracketed![2]!.split(",");
    tensions = TENSIONS.filter((t) => listed.includes(t));
    if (tensions.length !== listed.length) return null;
  }

  const selection: ChordSelection = { root, quality, tensions, bass };
  const built = buildChordSymbol(selection);
  const actual = built.ok ? parseChord(built.symbol) : undefined;
  return actual?.ok && JSON.stringify(actual) === JSON.stringify(expected) ? selection : null;
}

const sameVoicing = (a: Voicing, b: Voicing) => a.length === b.length && a.every((fret, string) => fret === b[string]);

/** 共有の押さえ方を、固定できる形にする。いまの候補に無い・押さえるフレットが無いなら `null`。 */
function shapeOf(shapeSymbol: string, voicing: Voicing): Shape | null {
  const parsed = parseChord(shapeSymbol);
  if (!parsed.ok) return null;
  const candidateIndex = generateVoicings(parsed).findIndex((candidate) => sameVoicing(candidate, voicing));
  const lowestFret = lowestPressedFret(voicing);
  return candidateIndex === -1 || lowestFret === undefined ? null : { lowestFret, voicing, candidateIndex };
}

export type ImportedScore = {
  readonly chords: readonly ChordSelection[];
  readonly capo: number;
  /** 進行の位置（0 始まり）→ 固定する形。持ち込めない押さえ方の位置は入れない（そのコードは「おまかせ」）。 */
  readonly pins: ReadonlyMap<number, Shape>;
};

/** 読めない記号を含むときは `null`。 */
export function importScore(score: SharedScore): ImportedScore | null {
  const chords: ChordSelection[] = [];
  const pins = new Map<number, Shape>();
  for (const [position, { symbol, voicing }] of score.chords.entries()) {
    const selection = selectionOf(symbol);
    if (selection === null) return null;
    chords.push(selection);
    const shape = shapeOf(lowerSymbol(symbol, score.capo), voicing);
    if (shape !== null) pins.set(position, shape);
  }
  return { chords, capo: score.capo, pins };
}
