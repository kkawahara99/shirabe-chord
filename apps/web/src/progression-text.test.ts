import { optimizeSymbols, type ProgressionStep } from "@shirabe-chord/core";
import { describe, expect, it } from "vitest";
import { progressionText } from "./progression-text.ts";

const stepsOf = (symbols: string[]): readonly ProgressionStep[] => {
  const result = optimizeSymbols(symbols);
  if (!result.ok) throw new Error("optimize");
  return result.steps;
};
const step = (symbol: string, voicing: ProgressionStep["voicing"], inWindow = true): ProgressionStep =>
  ({ ...stepsOf(["C"])[0]!, symbol, voicing, inWindow }) as ProgressionStep;

describe("progressionText（押さえ方をコピーするテキスト）", () => {
  it("初期の進行は、手の位置の行と、1コード1行（番号・記号・空白2つ・押さえ方）になる", () => {
    expect(progressionText(null, stepsOf(["C", "Am", "F", "G7"]))).toBe(
      ["手の位置：おまかせ", "1. C  x32010", "2. Am  x02210", "3. F  133211", "4. G7  320001"].join("\n"),
    );
  });

  it("手の位置を選んでいるときは、先頭の行が第Nポジションになる", () => {
    expect(progressionText(5, stepsOf(["C"])).split("\n")[0]).toBe("手の位置：第5ポジション");
  });

  it("手の位置から外れたコードの行だけ、末尾に注意書きが付く", () => {
    const text = progressionText(5, [step("C", [null, 3, 2, 0, 1, 0], false), step("Am", [null, 0, 2, 2, 1, 0])]);
    expect(text.split("\n").slice(1)).toEqual(["1. C  x32010 （手の位置から外れた押さえ方）", "2. Am  x02210"]);
  });

  it("2桁のフレットを含む押さえ方だけ、- で区切る", () => {
    const text = progressionText(null, [step("Bm", [null, 10, 12, 12, 11, 10]), step("C", [null, 3, 2, 0, 1, 0])]);
    expect(text.split("\n").slice(1)).toEqual(["1. Bm  x-10-12-12-11-10", "2. C  x32010"]);
  });

  it("記号は画面と同じ表示用（♭・♯、m7(♭5)）にして出す", () => {
    const lines = progressionText(null, stepsOf(["Bb", "Bm7-5"])).split("\n");
    expect(lines[1]).toMatch(/^1\. B♭  /);
    expect(lines[2]).toMatch(/^2\. Bm7\(♭5\)  /);
  });

  it("どんな進行でも、行数はコード数＋1で、各行が「N. 」で始まる", () => {
    const progressions = [["C"], ["C", "G"], ["Am", "F7", "Bb", "E7", "Dm9", "G13"], Array(16).fill("Em")];
    for (const symbols of progressions) {
      const lines = progressionText(null, stepsOf(symbols)).split("\n");
      expect(lines).toHaveLength(symbols.length + 1);
      lines.slice(1).forEach((line, i) => expect(line.startsWith(`${i + 1}. `)).toBe(true));
    }
  });
});
