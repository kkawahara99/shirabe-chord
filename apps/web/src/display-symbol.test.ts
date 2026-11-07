import { buildChordSymbol, CHORD_QUALITIES, TENSIONS, type Accidental, type NoteLetter, type Tension } from "@shirabe-chord/core";
import { describe, expect, it } from "vitest";
import { displayQuality, displaySymbol, displayTension } from "./display-symbol.ts";

describe("displaySymbol（記号を譜面の表記に直す）", () => {
  it("根音の b・# を ♭・♯ にする", () => {
    expect(displaySymbol("Bb")).toBe("B♭");
    expect(displaySymbol("C#7")).toBe("C♯7");
    expect(displaySymbol("F#m7-5")).toBe("F♯m7(♭5)");
  });
  it("変化記号のない記号はそのまま", () => {
    for (const symbol of ["C", "Am", "G7", "CM7", "Cdim7", "Cadd9", "C7sus4"]) expect(displaySymbol(symbol)).toBe(symbol);
  });
  it("種類 m7-5 は m7(♭5) にする", () => {
    expect(displaySymbol("Bm7-5")).toBe("Bm7(♭5)");
  });
  it("テンションの b・# を ♭・♯ にし、区切りの , は残す", () => {
    expect(displaySymbol("C7(b9,#11,13)")).toBe("C7(♭9,♯11,13)");
  });
  it("ベース音の b・# を ♭・♯ にする", () => {
    expect(displaySymbol("C7(b9)/E")).toBe("C7(♭9)/E");
    expect(displaySymbol("Db/G#")).toBe("D♭/G♯");
  });
  it("読めない文字列はそのまま返す", () => {
    expect(displaySymbol("")).toBe("");
    expect(displaySymbol("xyz")).toBe("xyz");
  });
});

describe("displayQuality・displayTension（選択肢の表示）", () => {
  it("三和音の種類は M、m7-5 は m7(♭5)、ほかはそのまま", () => {
    expect(displayQuality("")).toBe("M");
    expect(displayQuality("m7-5")).toBe("m7(♭5)");
    expect(displayQuality("M7")).toBe("M7");
  });
  it("テンションの b・# を ♭・♯ にする", () => {
    expect(TENSIONS.map(displayTension)).toEqual(["♭9", "9", "♯9", "♯11", "♭13", "13"]);
  });
});

describe("displaySymbol（網羅）", () => {
  it("コアが組み立てるどの記号も、ASCII の # と b を含まず、♯♭を # b に戻すと元の記号になる", () => {
    const letters: NoteLetter[] = ["C", "D", "E", "F", "G", "A", "B"];
    const accidentals: Accidental[] = ["", "#", "b"];
    const notes = letters.flatMap((letter) => accidentals.map((accidental) => ({ letter, accidental })));
    const bassOptions = [null, notes[0]!, notes[4]!, notes[8]!]; // C・D♯・E♭
    const tensionSets: Tension[][] = Array.from({ length: 1 << TENSIONS.length }, (_, mask) =>
      TENSIONS.filter((_, i) => mask & (1 << i)),
    );
    let checked = 0;
    for (const quality of CHORD_QUALITIES) {
      for (const root of notes) {
        for (const tensions of tensionSets) {
          for (const bass of bassOptions) {
            const built = buildChordSymbol({ root, quality: quality.names[0]!, tensions, bass });
            if (!built.ok) continue;
            const shown = displaySymbol(built.symbol);
            expect(shown).not.toMatch(/[#b]/);
            const restored = shown.replace(/♯/g, "#").replace(/♭/g, "b").replace("m7(b5)", "m7-5");
            expect(restored).toBe(built.symbol);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
