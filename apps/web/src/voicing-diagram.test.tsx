import { generateVoicings, parseChord, rootStrings, voicingFeatures, type Voicing } from "@shirabe-chord/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { startFretOf, VoicingDiagram, voicingLabel } from "./voicing-diagram.tsx";

const C: Voicing = [null, 3, 2, 0, 1, 0];
const F: Voicing = [1, 3, 3, 2, 1, 1];
const BM: Voicing = [null, 2, 4, 4, 3, 2];

const marks = (container: HTMLElement, mark: string) =>
  Array.from(container.querySelectorAll<SVGElement>(`[data-mark="${mark}"]`));

const num = (el: Element, attr: string) => Number(el.getAttribute(attr));
/** 丸は cx・cy、ルートの四角は x・y・width・height から中心を出す。 */
const center = (el: Element) =>
  el.tagName === "rect"
    ? { x: num(el, "x") + num(el, "width") / 2, y: num(el, "y") + num(el, "height") / 2 }
    : { x: num(el, "cx"), y: num(el, "cy") };
const roots = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<SVGElement>('[data-root="true"]'));
const fretNumbers = (container: HTMLElement) => marks(container, "fret-number").map((m) => m.textContent);

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
  it("記号の b・# は譜面の表記（♭・♯）で読み上げる", () => {
    expect(voicingLabel("Bb", C)).toBe("B♭: x32010");
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

  it("押さえる点が弦とフレットの正しい位置に出る（1弦が上、フレットが大きいほど右、点は開始フレットからの相対位置）", () => {
    const { container } = render(<VoicingDiagram symbol="C" voicing={C} />);
    const dots = marks(container, "dot");
    expect(dots.map((d) => [d.dataset.string, d.dataset.cell])).toEqual([
      ["5", "3"],
      ["4", "2"],
      ["2", "1"],
    ]);
    const [d5, d4, d2] = dots;
    expect(center(d2!).y).toBeLessThan(center(d4!).y); // 2弦のほうが上
    expect(center(d4!).y).toBeLessThan(center(d5!).y);
    expect(center(d2!).x).toBeLessThan(center(d4!).x); // 1フレットのほうが左
    expect(center(d4!).x).toBeLessThan(center(d5!).x);
    expect(marks(container, "mute")[0]!.dataset.string).toBe("6");
  });

  it("セーハは縦長の棒 1 本で描く（F は 1 フレットに 6弦〜1弦、Bm は 2 フレットに 5弦〜1弦）", () => {
    const f = render(<VoicingDiagram symbol="F" voicing={F} />);
    const fBars = marks(f.container, "barre");
    expect(fBars).toHaveLength(1);
    expect(fBars[0]!.dataset).toMatchObject({ cell: "1", fromString: "6", toString: "1" });
    expect(num(fBars[0]!, "height")).toBeGreaterThan(num(fBars[0]!, "width"));
    f.unmount();

    const bm = render(<VoicingDiagram symbol="Bm" voicing={BM} />);
    const bmBars = marks(bm.container, "barre");
    expect(bmBars).toHaveLength(1);
    expect(bmBars[0]!.dataset).toMatchObject({ cell: "2", fromString: "5", toString: "1" });
  });

  it("セーハが無い押さえ方は棒を描かない", () => {
    const { container } = render(<VoicingDiagram symbol="C" voicing={C} />);
    expect(marks(container, "barre")).toHaveLength(0);
  });

  it("ナット（開始フレットが 1 のときの太線）が左端にあり、×と○はナットより左に置く", () => {
    const { container } = render(<VoicingDiagram symbol="C" voicing={C} />);
    const nut = marks(container, "nut");
    expect(nut).toHaveLength(1);
    const nutX = num(nut[0]!, "x1");
    for (const dot of marks(container, "dot")) expect(center(dot).x).toBeGreaterThan(nutX);
    for (const open of marks(container, "open")) expect(num(open, "cx")).toBeLessThan(nutX);
    const mute = marks(container, "mute")[0]!;
    expect(Number(mute.dataset.x)).toBeLessThan(nutX);
  });

  it("開始フレットが 1 でない図にはナットを描かない", () => {
    const { container } = render(<VoicingDiagram symbol="Bb" voicing={[null, 6, 8, 8, 8, 6]} />);
    expect(marks(container, "nut")).toHaveLength(0);
  });

  it("全フレットの枠に番号を出す（開始フレット 1 は 1〜5、8 は 8〜12）。Nfr 表記は出さない", () => {
    const low = render(<VoicingDiagram symbol="C" voicing={C} />);
    expect(fretNumbers(low.container)).toEqual(["1", "2", "3", "4", "5"]);
    low.unmount();

    const high = render(<VoicingDiagram symbol="X" voicing={[null, 8, 10, 10, 10, 8]} />);
    expect(fretNumbers(high.container)).toEqual(["8", "9", "10", "11", "12"]);
    expect(screen.queryByText(/fr$/)).toBeNull();
    // 番号は図の下（弦より下）に出る。
    const stringBottom = Math.max(...Array.from(high.container.querySelectorAll("line")).map((l) => num(l, "y2")));
    for (const label of marks(high.container, "fret-number")) expect(num(label, "y")).toBeGreaterThan(stringBottom);
  });

  it("ポジションマーク（開始 1・C）は 3・5 フレットに 1 つずつ、枠の中央（3弦と4弦の間）に出る", () => {
    const { container } = render(<VoicingDiagram symbol="C" voicing={C} />);
    const inlays = marks(container, "inlay");
    expect(inlays.map((m) => m.dataset.fret)).toEqual(["3", "5"]);
    for (const m of inlays) expect(m.getAttribute("aria-hidden")).toBe("true");
    expect(new Set(inlays.map((m) => num(m, "cy"))).size).toBe(1);
    expect(inlays.map((m) => m.dataset.betweenStrings)).toEqual(["3-4", "3-4"]);
  });

  it("ポジションマーク（開始 8）は 9 に 1 つ、12 に 2 つ（2弦と3弦の間・4弦と5弦の間）。8・10・11 には出ない", () => {
    const { container } = render(<VoicingDiagram symbol="X" voicing={[null, 8, 10, 10, 10, 8]} />);
    const inlays = marks(container, "inlay");
    expect(inlays.map((m) => [m.dataset.fret, m.dataset.betweenStrings])).toEqual([
      ["9", "3-4"],
      ["12", "2-3"],
      ["12", "4-5"],
    ]);
  });

  it("ポジションマークは押さえる丸やセーハより先に描く（その下になる）", () => {
    const { container } = render(<VoicingDiagram symbol="F" voicing={[1, 3, 3, 2, 1, 1]} />);
    const all = Array.from(container.querySelectorAll("[data-mark]"));
    const lastInlay = Math.max(...marks(container, "inlay").map((m) => all.indexOf(m)));
    const firstPress = Math.min(...[...marks(container, "dot"), ...marks(container, "barre")].map((m) => all.indexOf(m)));
    expect(lastInlay).toBeLessThan(firstPress);
  });

  it("開始フレット 1〜15 のどの図でも、ポジションマークは 3・5・7・9・15・17・19 が 1 つ、12 が 2 つ、ほかは無し", () => {
    const single = [3, 5, 7, 9, 15, 17, 19];
    for (let start = 1; start <= 15; start++) {
      // 開始フレットが start になる押さえ方（最小が start、最大が start+4）。
      const voicing: Voicing = [null, start, start + 4, null, null, null];
      expect(startFretOf(voicing)).toBe(start);
      const { container, unmount } = render(<VoicingDiagram symbol="X" voicing={voicing} />);
      const shown = marks(container, "inlay").map((m) => Number(m.dataset.fret));
      const expected = Array.from({ length: 5 }, (_, k) => start + k).flatMap((f) =>
        single.includes(f) ? [f] : f === 12 ? [12, 12] : [],
      );
      expect(shown).toEqual(expected);
      unmount();
    }
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
          const cell = Number(mark.dataset.cell);
          expect(cell).toBeGreaterThanOrEqual(1);
          expect(cell).toBeLessThanOrEqual(5);
        }
        expect(marks(container, "barre")).toHaveLength(voicingFeatures(voicing).hasBarre ? 1 : 0);
        expect(roots(container).map((m) => Number(m.dataset.string))).toEqual(
          rootStrings(symbol, voicing).reverse(),
        );
        unmount();
      }
    },
  );
});

describe("VoicingDiagram のルート音の印", () => {
  const E: Voicing = [0, 2, 2, 1, 0, 0];

  it("C x32010: ルート音の弦（5弦3フレット・2弦1フレット）だけに印が付き、四角になる", () => {
    const { container } = render(<VoicingDiagram symbol="C" voicing={C} />);
    expect(roots(container).map((m) => [m.tagName, m.dataset.mark, m.dataset.string])).toEqual([
      ["rect", "dot", "5"],
      ["rect", "dot", "2"],
    ]);
    const plain = marks(container, "dot").filter((m) => m.tagName === "circle");
    expect(plain.map((m) => m.dataset.string)).toEqual(["4"]);
    expect(marks(container, "open")).toHaveLength(2); // 開放弦（3弦・1弦）はルートではない
    expect(marks(container, "root-ring")).toHaveLength(0);
  });

  it("E 022100: 6弦開放と1弦開放のルートは二重の丸、4弦2フレットは四角。ほかの開放弦は二重にならない", () => {
    const { container } = render(<VoicingDiagram symbol="E" voicing={E} />);
    expect(roots(container).map((m) => [m.dataset.mark, m.dataset.string])).toEqual([
      ["open", "6"],
      ["dot", "4"],
      ["open", "1"],
    ]);
    const inner = marks(container, "root-ring");
    expect(inner.map((m) => m.dataset.string)).toEqual(["6", "1"]);
    expect(marks(container, "open")).toHaveLength(3);
  });

  it("F 133211: セーハの棒の中のルート（6弦・1弦）は丸を残して小さな四角を重ね、棒の外のルート（4弦3フレット）は丸が四角になる", () => {
    const { container } = render(<VoicingDiagram symbol="F" voicing={F} />);
    expect(roots(container).map((m) => [m.tagName, m.dataset.mark, m.dataset.string])).toEqual([
      ["circle", "dot", "6"],
      ["rect", "dot", "4"],
      ["circle", "dot", "1"],
    ]);
    const overlays = marks(container, "root-overlay");
    expect(overlays.map((m) => m.dataset.string)).toEqual(["6", "1"]);
    for (const overlay of overlays) {
      expect(overlay.tagName).toBe("rect");
      const dot = marks(container, "dot").find((d) => d.dataset.string === overlay.dataset.string)!;
      expect(center(overlay)).toEqual(center(dot));
      expect(overlay.getAttribute("style")).toContain("var(--surface)");
      expect(num(overlay, "width")).toBeLessThan(num(dot, "r") * 2);
    }
    // 重ねる四角は棒と丸より後に描く。
    const all = Array.from(container.querySelectorAll("[data-mark]"));
    expect(Math.min(...overlays.map((o) => all.indexOf(o)))).toBeGreaterThan(
      Math.max(...marks(container, "dot").map((d) => all.indexOf(d)), all.indexOf(marks(container, "barre")[0]!)),
    );
  });

  it("ルートの印を足しても、dot・open・barre の数と読み上げラベルは変わらない", () => {
    const { container } = render(<VoicingDiagram symbol="F" voicing={F} />);
    expect(marks(container, "dot")).toHaveLength(6);
    expect(marks(container, "barre")).toHaveLength(1);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("F: 133211");
  });
});

describe("VoicingDiagram の見出し", () => {
  it("既定では記号の見出しを出す。hideCaption を指定すると見出しは出ず、図のラベルは残る", () => {
    const { container, rerender } = render(<VoicingDiagram symbol="C" voicing={C} />);
    expect(container.querySelector("figcaption")?.textContent).toBe("C");
    rerender(<VoicingDiagram symbol="C" voicing={C} hideCaption />);
    expect(container.querySelector("figcaption")).toBeNull();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("C: x32010");
  });
});
