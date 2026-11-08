import {
  buildChordSymbol,
  CAPO_FRETS,
  CHORD_QUALITIES,
  generateVoicings,
  listShapesByLowestFret,
  lowestPressedFret,
  parseChord,
  lowerSymbol,
  MAX_PROGRESSION_CHORDS,
  TENSIONS,
  type ChordSelection,
  type NoteLetter,
} from "@shirabe-chord/core";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { clearSnapshot, pinMarksOf, readSnapshot, restorePins, saveSnapshot, type Snapshot } from "./resume.ts";

beforeEach(() => sessionStorage.clear());

const note = fc.record({
  letter: fc.constantFrom<NoteLetter>("C", "D", "E", "F", "G", "A", "B"),
  accidental: fc.constantFrom("" as const, "#" as const, "b" as const),
});
const chordArb: fc.Arbitrary<ChordSelection> = fc
  .record({
    root: note,
    quality: fc.constantFrom(...CHORD_QUALITIES.map((q) => q.names[0]!)),
    tensions: fc.subarray([...TENSIONS]),
    bass: fc.option(note, { nil: null }),
  })
  .filter((chord) => buildChordSymbol(chord).ok);

const snapshotArb: fc.Arbitrary<Snapshot> = fc
  .array(chordArb, { minLength: 1, maxLength: MAX_PROGRESSION_CHORDS })
  .chain((chords) =>
    fc.record({
      chords: fc.constant(chords),
      capo: fc.constantFrom(...CAPO_FRETS),
      pins: fc.uniqueArray(
        fc.record({
          position: fc.nat(chords.length - 1),
          candidateIndex: fc.nat(200),
          lowestFret: fc.integer({ min: 1, max: 20 }),
        }),
        { selector: (pin) => pin.position },
      ),
      after: fc.constantFrom(null, "share" as const, "mine" as const),
    }),
  );

const SAMPLE: Snapshot = {
  chords: [
    { root: { letter: "C", accidental: "" }, quality: "", tensions: [], bass: null },
    { root: { letter: "B", accidental: "b" }, quality: "7", tensions: ["9"], bass: { letter: "D", accidental: "" } },
  ],
  capo: 2,
  pins: [{ position: 1, candidateIndex: 0, lowestFret: 1 }],
  after: "share",
};

/** 保存先のキーを知らなくても壊せるよう、入っている値をすべて差し替える。 */
const corruptStorageWith = (value: string) => {
  for (const key of Object.keys(sessionStorage)) sessionStorage.setItem(key, value);
};
const save = (snapshot: unknown) => saveSnapshot(sessionStorage, snapshot as Snapshot);

describe("saveSnapshot / readSnapshot", () => {
  it("保存して読み戻すと、進行・カポ・固定・戻ったあとの操作が元と一致する（任意の有効な退避）", () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        sessionStorage.clear();
        saveSnapshot(sessionStorage, snapshot);
        expect(readSnapshot(sessionStorage)).toEqual(snapshot);
      }),
      { numRuns: 100 },
    );
  });

  it("退避が無ければ null", () => {
    expect(readSnapshot(sessionStorage)).toBeNull();
  });

  it("消したあとは null", () => {
    saveSnapshot(sessionStorage, SAMPLE);
    clearSnapshot(sessionStorage);
    expect(readSnapshot(sessionStorage)).toBeNull();
  });

  describe("壊れた退避は、例外にせず null", () => {
    const broken: [string, (s: Snapshot) => unknown][] = [
      ["形が違う（進行が配列でない）", (s) => ({ ...s, chords: "C Am" })],
      ["進行が空", (s) => ({ ...s, chords: [] })],
      ["コード数が上限を超える", (s) => ({ ...s, chords: Array.from({ length: MAX_PROGRESSION_CHORDS + 1 }, () => s.chords[0]) })],
      ["未知の音名", (s) => ({ ...s, chords: [{ ...s.chords[0], root: { letter: "H", accidental: "" } }] })],
      ["未知の変化記号", (s) => ({ ...s, chords: [{ ...s.chords[0], root: { letter: "C", accidental: "x" } }] })],
      ["未知の種類", (s) => ({ ...s, chords: [{ ...s.chords[0], quality: "nonsense" }] })],
      ["未知のテンション", (s) => ({ ...s, chords: [{ ...s.chords[0], tensions: ["99"] }] })],
      ["記号が組めない（同時に選べないテンション）", (s) => ({ ...s, chords: [{ ...s.chords[1], tensions: ["9", "b9"] }] })],
      ["カポが範囲外", (s) => ({ ...s, capo: 12 })],
      ["カポが数でない", (s) => ({ ...s, capo: "2" })],
      ["未知の操作", (s) => ({ ...s, after: "delete-everything" })],
      ["固定の位置が進行の外", (s) => ({ ...s, pins: [{ position: 5, candidateIndex: 0, lowestFret: 1 }] })],
      ["固定の目印が数でない", (s) => ({ ...s, pins: [{ position: 0, candidateIndex: "0", lowestFret: 1 }] })],
      ["同じ位置の固定が重なる", (s) => ({ ...s, pins: [s.pins[0], s.pins[0]] })],
      ["項目が足りない", (s) => ({ chords: s.chords })],
    ];
    it.each(broken)("%s", (_name, make) => {
      save(make(SAMPLE));
      expect(readSnapshot(sessionStorage)).toBeNull();
    });

    it.each([["JSON でない", "{not json"], ["null", "null"], ["数", "42"], ["空文字", ""]])("保存された値が%s", (_name, raw) => {
      saveSnapshot(sessionStorage, SAMPLE);
      corruptStorageWith(raw);
      expect(readSnapshot(sessionStorage)).toBeNull();
    });
  });

  it("保存先が使えなくても（例外を投げても）、保存・読み戻し・消去は例外にしない", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => saveSnapshot(blocked, SAMPLE)).not.toThrow();
    expect(readSnapshot(blocked)).toBeNull();
    expect(() => clearSnapshot(blocked)).not.toThrow();
  });
});

describe("pinMarksOf / restorePins", () => {
  const chords: ChordSelection[] = [
    { root: { letter: "C", accidental: "" }, quality: "", tensions: [], bass: null },
    { root: { letter: "A", accidental: "" }, quality: "m", tensions: [], bass: null },
    { root: { letter: "G", accidental: "" }, quality: "7", tensions: [], bass: null },
  ];
  const shapesOf = (symbol: string) => {
    const result = listShapesByLowestFret(symbol);
    if (!result.ok) throw new Error("shapes");
    return result.shapes;
  };

  it("固定を位置＋形の目印にして、復元で同じ押さえ方に戻す", () => {
    const pins = new Map([
      [0, shapesOf("C")[1]!],
      [2, shapesOf("G7")[0]!],
    ]);
    const marks = pinMarksOf(pins);
    expect(restorePins(chords, 0, marks)).toEqual(pins);
  });

  it("カポがあるときは、カポで下げた形の記号の候補に戻す", () => {
    const shape = shapesOf(lowerSymbol("Am", 3))[0]!;
    expect(restorePins(chords, 3, pinMarksOf(new Map([[1, shape]])))).toEqual(new Map([[1, shape]]));
  });

  it("押さえ方タブの代表に当たらない固定（共有から持ち込んだ最適化の結果）も、復元で同じ押さえ方に戻す", () => {
    const parsed = parseChord("C");
    if (!parsed.ok) throw new Error("parse");
    const representative = new Set(shapesOf("C").map((s) => s.candidateIndex));
    const all = generateVoicings(parsed);
    const index = all.findIndex((v, i) => !representative.has(i) && lowestPressedFret(v) !== undefined);
    expect(index).toBeGreaterThan(-1); // 前提: 代表でない候補がある
    const voicing = all[index]!;
    const shape = { lowestFret: lowestPressedFret(voicing)!, voicing, candidateIndex: index };
    expect(restorePins(chords, 0, pinMarksOf(new Map([[0, shape]])))).toEqual(new Map([[0, shape]]));
  });

  it("合わなくなった固定（候補が無い・最低フレットが違う）だけ捨てて、他は残す", () => {
    const kept = shapesOf("C")[0]!;
    const marks = [
      { position: 0, candidateIndex: kept.candidateIndex, lowestFret: kept.lowestFret },
      { position: 1, candidateIndex: 99999, lowestFret: 1 },
      { position: 2, candidateIndex: shapesOf("G7")[0]!.candidateIndex, lowestFret: 99 },
    ];
    expect(restorePins(chords, 0, marks)).toEqual(new Map([[0, kept]]));
  });
});
