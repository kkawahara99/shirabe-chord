import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { soundingNotes } from "./sounding.ts";
import { v } from "./test-helpers.ts";
import type { Voicing } from "./voicing.ts";

const midis = (voicing: Voicing, capo = 0) => soundingNotes(voicing, capo).map((n) => n.midi);
const strings = (voicing: Voicing, capo = 0) => soundingNotes(voicing, capo).map((n) => n.string);

const voicingArb = fc.array(fc.option(fc.integer({ min: 0, max: 15 }), { nil: null }), {
  minLength: 6,
  maxLength: 6,
});

describe("soundingNotes: よく知られた押さえ方", () => {
  it("C x32010 は 5弦から 1弦へ 48・52・55・60・64", () => {
    expect(strings(v("x32010"))).toEqual([5, 4, 3, 2, 1]);
    expect(midis(v("x32010"))).toEqual([48, 52, 55, 60, 64]);
  });

  it("Am x02210 は 45・52・57・60・64", () => {
    expect(midis(v("x02210"))).toEqual([45, 52, 57, 60, 64]);
  });

  it("F 133211 は 6弦から 1弦へ 41・48・53・57・60・65", () => {
    expect(strings(v("133211"))).toEqual([6, 5, 4, 3, 2, 1]);
    expect(midis(v("133211"))).toEqual([41, 48, 53, 57, 60, 65]);
  });
});

describe("soundingNotes: ミュート", () => {
  it("ミュートの弦は出力に含まれない", () => {
    expect(strings(v("x3xxx0"))).toEqual([5, 1]);
  });

  it("全部ミュートなら空の配列", () => {
    expect(soundingNotes(v("xxxxxx"), 0)).toEqual([]);
  });
});

describe("soundingNotes: カポ", () => {
  it("カポ 2 なら全部の音が 2 半音高い", () => {
    expect(midis(v("x32010"), 2)).toEqual([50, 54, 57, 62, 66]);
  });
});

describe("soundingNotes: 周波数", () => {
  it("A4（MIDI 69）は 440Hz", () => {
    const [note] = soundingNotes(v("xxxxx5"), 0);
    expect(note).toEqual({ string: 1, midi: 69, frequency: 440 });
  });

  it("6弦開放（MIDI 40）は約 82.41Hz", () => {
    expect(soundingNotes(v("0xxxxx"), 0)[0]!.frequency).toBeCloseTo(82.407, 3);
  });
});

describe("soundingNotes: 性質", () => {
  it("カポを k 上げると、全部の MIDI 番号がちょうど k 増える", () => {
    fc.assert(
      fc.property(voicingArb, fc.integer({ min: 0, max: 7 }), fc.integer({ min: 0, max: 7 }), (voicing, capo, k) => {
        const base = midis(voicing, capo);
        expect(midis(voicing, capo + k)).toEqual(base.map((m) => m + k));
      }),
    );
  });

  it("MIDI 番号が 12 増えると周波数は 2 倍になる", () => {
    fc.assert(
      fc.property(voicingArb, (voicing) => {
        const up = voicing.map((fret) => (fret === null ? null : fret + 12));
        const low = soundingNotes(voicing, 0);
        const high = soundingNotes(up, 0);
        high.forEach((note, i) => {
          expect(note.midi).toBe(low[i]!.midi + 12);
          expect(note.frequency).toBeCloseTo(low[i]!.frequency * 2, 9);
        });
      }),
    );
  });

  it("出力の数はミュートでない弦の数に等しい", () => {
    fc.assert(
      fc.property(voicingArb, fc.integer({ min: 0, max: 7 }), (voicing, capo) => {
        expect(soundingNotes(voicing, capo)).toHaveLength(voicing.filter((f) => f !== null).length);
      }),
    );
  });

  it("弦番号は 6→1 の降順で、ミュートでない弦と一致する", () => {
    fc.assert(
      fc.property(voicingArb, (voicing) => {
        const expected = voicing
          .map((fret, i) => (fret === null ? null : 6 - i))
          .filter((s): s is number => s !== null);
        expect(strings(voicing)).toEqual(expected);
      }),
    );
  });
});
