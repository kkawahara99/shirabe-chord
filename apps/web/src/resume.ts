import {
  buildChordSymbol,
  CAPO_FRETS,
  CHORD_QUALITIES,
  listShapesByLowestFret,
  lowerSymbol,
  MAX_PROGRESSION_CHORDS,
  TENSIONS,
  type ChordSelection,
  type NoteSelection,
  type Shape,
  type Tension,
} from "@shirabe-chord/core";
import { readItem, removeItem, writeItem, type StorageLike } from "./session-store.ts";

// ログインで Google の画面へ移ると、画面の入力は消える。移る前に sessionStorage へ退避し、戻ったら元に戻す。
// 退避は信用しない入力として検証し、壊れていれば無かったことにする（例外にしない）。

const KEY = "shirabe-chord.resume";

/** ログインから戻ったあとに呼ぶ操作。 */
export type AfterAction = "share" | "mine";

/** 固定した押さえ方の目印。形そのものではなく、位置と候補の番号で持つ（復元で `listShapesByLowestFret` から引き直す）。 */
export type PinMark = { readonly position: number; readonly candidateIndex: number; readonly lowestFret: number };

export type Snapshot = {
  readonly chords: readonly ChordSelection[];
  readonly capo: number;
  readonly pins: readonly PinMark[];
  readonly after: AfterAction | null;
};

export function saveSnapshot(storage: StorageLike, snapshot: Snapshot): void {
  writeItem(storage, KEY, JSON.stringify(snapshot));
}

export function clearSnapshot(storage: StorageLike): void {
  removeItem(storage, KEY);
}

/** 退避を読む。無い・壊れているときは `null`。 */
export function readSnapshot(storage: StorageLike): Snapshot | null {
  const raw = readItem(storage, KEY);
  if (raw === null) return null;
  try {
    return parseSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const QUALITIES: ReadonlySet<string> = new Set(CHORD_QUALITIES.map((q) => q.names[0]!));
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const ACCIDENTALS = ["", "#", "b"] as const;

function parseNote(value: unknown): NoteSelection | null {
  if (!isRecord(value)) return null;
  const letter = LETTERS.find((l) => l === value.letter);
  const accidental = ACCIDENTALS.find((a) => a === value.accidental);
  return letter !== undefined && accidental !== undefined ? { letter, accidental } : null;
}

function parseChord(value: unknown): ChordSelection | null {
  if (!isRecord(value)) return null;
  const root = parseNote(value.root);
  const bass = value.bass === null ? null : parseNote(value.bass);
  const { quality, tensions } = value;
  if (root === null || (value.bass !== null && bass === null)) return null;
  if (typeof quality !== "string" || !QUALITIES.has(quality)) return null;
  if (!Array.isArray(tensions) || !tensions.every((t): t is Tension => TENSIONS.some((known) => known === t))) return null;
  const chord: ChordSelection = { root, quality, tensions, bass };
  return buildChordSymbol(chord).ok ? chord : null;
}

function parsePins(value: unknown, chordCount: number): PinMark[] | null {
  if (!Array.isArray(value)) return null;
  const marks: PinMark[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const { position, candidateIndex, lowestFret } = item;
    if (!isCount(position) || !isCount(candidateIndex) || !isCount(lowestFret) || position >= chordCount) return null;
    if (marks.some((mark) => mark.position === position)) return null;
    marks.push({ position, candidateIndex, lowestFret });
  }
  return marks;
}

function parseSnapshot(value: unknown): Snapshot | null {
  if (!isRecord(value) || !Array.isArray(value.chords)) return null;
  if (value.chords.length < 1 || value.chords.length > MAX_PROGRESSION_CHORDS) return null;
  const chords = value.chords.map(parseChord);
  if (chords.some((chord) => chord === null)) return null;
  const capo = CAPO_FRETS.find((fret) => fret === value.capo);
  const after = value.after === null ? null : (["share", "mine"] as const).find((a) => a === value.after);
  const pins = parsePins(value.pins, chords.length);
  if (capo === undefined || after === undefined || pins === null) return null;
  return { chords: chords as ChordSelection[], capo, pins, after };
}

export function pinMarksOf(pins: ReadonlyMap<number, Shape>): PinMark[] {
  return [...pins].map(([position, shape]) => ({ position, candidateIndex: shape.candidateIndex, lowestFret: shape.lowestFret }));
}

/** 目印から押さえ方を引き直す。いまの候補に無くなったもの（コアの更新など）は捨てる。 */
export function restorePins(chords: readonly ChordSelection[], capo: number, marks: readonly PinMark[]): Map<number, Shape> {
  const pins = new Map<number, Shape>();
  for (const { position, candidateIndex, lowestFret } of marks) {
    const chord = chords[position];
    if (!chord) continue;
    const built = buildChordSymbol(chord);
    if (!built.ok) continue;
    const listed = listShapesByLowestFret(lowerSymbol(built.symbol, capo));
    const shape = listed.ok ? listed.shapes.find((s) => s.candidateIndex === candidateIndex && s.lowestFret === lowestFret) : undefined;
    if (shape) pins.set(position, shape);
  }
  return pins;
}
