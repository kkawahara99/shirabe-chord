import { generateVoicings, parseChord, voicingFeatures, type Voicing } from "@shirabe-chord/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { startFretOf, VoicingDiagram, voicingLabel } from "./voicing-diagram.tsx";

const C: Voicing = [null, 3, 2, 0, 1, 0];
const F: Voicing = [1, 3, 3, 2, 1, 1];
const BM: Voicing = [null, 2, 4, 4, 3, 2];

const marks = (container: HTMLElement, mark: string) =>
  Array.from(container.querySelectorAll<SVGElement>(`[data-mark="${mark}"]`));

describe("startFretOf（開始フレット）", () => {
  it("押さえる最大のフレットが 5 以下なら 1", () => {
    expect(startFretOf(C)).toBe(1);
    expect(startFretOf([null, null, 5, 5, 5, 3])).toBe(1); // 境界の 5
  });
  it("押さえる最大のフレットが 6 以上なら、押さえる最小のフレット", () => {
    expect(startFretOf([null, 6, 8, 8, 8, 6])).toBe(6);
    expect(startFretOf([null, 3, 6, 5, 4, 3])).toBe(3);
  });
  it("押さえるフレットが無い（開放とミュートだけ）なら 1", () => {
    expect(startFretOf([0, 0, 0, 0, 0, 0])).toBe(1);
    expect(startFretOf([null, null, 0, 0, null, null])).toBe(1);
  });
});

describe("voicingLabel（読み上げ用ラベル）", () => {
  it("コード記号と押さえ方を並べ、ミュートは x にする", () => {
    expect(voicingLabel("C", C)).toBe("C: x32010");
  });
  it("10 以上のフレットを含むときだけ - で区切る", () => {
    expect(voicingLabel("Bm", [null, 10, 12, 12, 12, 10])).toBe("Bm: x-10-12-12-12-10");
  });
});

describe("VoicingDiagram（押さえ方の図）", () => {
  it("開放・ミュート・押さえる位置を描く（C の x32010 は ×1・○2・押さえる点3）", () => {
    const { container } = render(<VoicingDiagram symbol="C" voicing={C} />);
    expect(marks(container, "mute")).toHaveLength(1);
    expect(marks(container, "open")).toHaveLength(2);
    expect(marks(container, "dot")).toHaveLength(3);
  });

  it("押さえる点が弦とフレットの正しい位置に出る（6弦が左、点は開始フレットからの相対位置）", () => {
    const { container } = render(<VoicingDiagram symbol="C" voicing={C} />);
    const dots = marks(container, "dot");
    expect(dots.map((d) => [d.dataset.string, d.dataset.row])).toEqual([
      ["5", "3"],
      ["4", "2"],
      ["2", "1"],
    ]);
    const x = (mark: SVGElement) => Number(mark.getAttribute("cx"));
    expect(x(dots[0]!)).toBeLessThan(x(dots[1]!)); // 5弦のほうが左
    expect(marks(container, "mute")[0]!.dataset.string).toBe("6");
  });

  it("セーハは横棒 1 本で描く（F は 1 フレットに 6弦〜1弦、Bm は 2 フレットに 5弦〜1弦）", () => {
    const f = render(<VoicingDiagram symbol="F" voicing={F} />);
    const fBars = marks(f.container, "barre");
    expect(fBars).toHaveLength(1);
    expect(fBars[0]!.dataset).toMatchObject({ row: "1", fromString: "6", toString: "1" });
    f.unmount();

    const bm = render(<VoicingDiagram symbol="Bm" voicing={BM} />);
    const bmBars = marks(bm.container, "barre");
    expect(bmBars).toHaveLength(1);
    expect(bmBars[0]!.dataset).toMatchObject({ row: "2", fromString: "5", toString: "1" });
  });

  it("セーハが無い押さえ方は横棒を描かない", () => {
    const { container } = render(<VoicingDiagram symbol="C" voicing={C} />);
    expect(marks(container, "barre")).toHaveLength(0);
  });

  it("開始フレットが 1 でないときだけ、開始フレットの番号を出す", () => {
    const high = render(<VoicingDiagram symbol="Bb" voicing={[null, 6, 8, 8, 8, 6]} />);
    expect(screen.getByText("6fr")).toBeTruthy();
    expect(marks(high.container, "dot").map((d) => d.dataset.row)).toEqual(["1", "3", "3", "3", "1"]);
    high.unmount();

    render(<VoicingDiagram symbol="F" voicing={F} />);
    expect(screen.queryByText(/fr$/)).toBeNull();
  });

  it("図の上にコード記号を出す", () => {
    render(<VoicingDiagram symbol="Am7" voicing={[null, 0, 2, 0, 1, 0]} />);
    const figure = screen.getByRole("img").closest("figure")!;
    expect(figure.firstElementChild?.textContent).toBe("Am7");
  });

  it("図ごとに、読み上げ用のラベルを付ける", () => {
    render(<VoicingDiagram symbol="C" voicing={C} />);
    expect(screen.getByRole("img", { name: "C: x32010" })).toBeTruthy();
  });

  it.each(["C", "Am", "F", "G7", "Bm7(b5)", "B7", "Dm7", "A7(b9)"])(
    "%s の押さえ方の全候補が、ミュート・開放・押さえる弦の数どおりに描ける",
    (symbol) => {
      const parsed = parseChord(symbol);
      if (!parsed.ok) throw new Error(`読めないコード: ${symbol}`);
      const voicings = generateVoicings(parsed);
      expect(voicings.length).toBeGreaterThan(0);
      for (const voicing of voicings) {
        const { container, unmount } = render(<VoicingDiagram symbol={symbol} voicing={voicing} />);
        expect(marks(container, "mute")).toHaveLength(voicing.filter((f) => f === null).length);
        expect(marks(container, "open")).toHaveLength(voicing.filter((f) => f === 0).length);
        expect(marks(container, "dot")).toHaveLength(voicing.filter((f) => f !== null && f > 0).length);
        // 点とセーハは、どれも図の 5 フレットの中に収まる。
        for (const mark of [...marks(container, "dot"), ...marks(container, "barre")]) {
          const row = Number(mark.dataset.row);
          expect(row).toBeGreaterThanOrEqual(1);
          expect(row).toBeLessThanOrEqual(5);
        }
        expect(marks(container, "barre")).toHaveLength(voicingFeatures(voicing).hasBarre ? 1 : 0);
        unmount();
      }
    },
  );
});
