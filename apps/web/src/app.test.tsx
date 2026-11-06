import { listShapesByLowestFret, optimizeSymbols } from "@shirabe-chord/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import { voicingLabel } from "./voicing-diagram.tsx";

const rawSources = import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** 結果の図（位置ごとの候補の図は含まない）。 */
const diagrams = () => within(screen.getByRole("region", { name: "進行の押さえ方" })).queryAllByRole("img");
const diagramLabels = () => diagrams().map((d) => d.getAttribute("aria-label")?.split(":")[0]);
const alert = () => screen.queryByRole("alert");

/** コードの一覧の、選ぶボタン（削除ボタンは含まない）。 */
const chordButtons = () =>
  within(screen.getByRole("list", { name: "コード進行" }))
    .getAllByRole("button")
    .filter((button) => button.hasAttribute("aria-pressed"));
const chordSymbols = () => chordButtons().map((button) => button.textContent);
const pressedIndex = () => chordButtons().findIndex((button) => button.getAttribute("aria-pressed") === "true");

const PICKER = "最初のコードの押さえ方の候補";
const AUTO = "おまかせ（押さえ方を自動で選ぶ）";
const INITIAL = ["C", "Am", "F", "G7"];
const autoButton = () => {
  showTab("押さえ方");
  return screen.getByRole("button", { name: AUTO });
};
const cards = () => {
  showTab("押さえ方");
  return within(screen.getByRole("group", { name: PICKER })).getAllByRole("listitem");
};
const cardButton = (i: number) => within(cards()[i]!).getByRole("button", { name: `${firstShapes(chordSymbols()[0]!)[i]!.lowestFret}フレット付近` });
const cardPressed = () => cards().map((_, i) => cardButton(i).getAttribute("aria-pressed"));
const firstShapes = (symbol: string) => {
  const shapes = listShapesByLowestFret(symbol);
  if (!shapes.ok) throw new Error("shapes");
  return shapes.shapes;
};
const expectedLabels = (symbols: string[], shapeIndex?: number) => {
  const result = optimizeSymbols(
    symbols,
    shapeIndex === undefined ? undefined : { firstVoicing: firstShapes(symbols[0]!)[shapeIndex]!.voicing },
  );
  if (!result.ok) throw new Error("optimize");
  return result.steps.map((step) => voicingLabel(step.symbol, step.voicing));
};
const resultLabels = () => diagrams().map((d) => d.getAttribute("aria-label"));

/** 編集欄のタブ。 */
const TABS = "編集の項目";
const tabButtons = () => within(screen.getByRole("group", { name: TABS })).getAllByRole("button");
const tabButton = (name: string) => within(screen.getByRole("group", { name: TABS })).getByRole("button", { name });
const queryTabButton = (name: string) =>
  within(screen.getByRole("group", { name: TABS })).queryByRole("button", { name });
const pressedTab = () => tabButtons().find((b) => b.getAttribute("aria-pressed") === "true")?.textContent;
const showTab = (name: string) => {
  const button = tabButton(name);
  if (button.getAttribute("aria-pressed") !== "true") fireEvent.click(button);
};
/** 入力の組が入っているタブ。組を取るときは、そのタブを開く。 */
const TAB_OF: Record<string, string> = {
  根音の音名: "コード",
  根音の変化記号: "コード",
  種類: "コード",
  テンション: "テンション・ベース",
  ベース音の音名: "テンション・ベース",
  ベース音の変化記号: "テンション・ベース",
};
const group = (name: string) => {
  const tab = TAB_OF[name];
  if (tab) showTab(tab);
  return screen.getByRole("group", { name });
};
const editorRegion = () => screen.getByRole("region", { name: /番目のコードを編集$/ });
const closeButton = () => screen.getByRole("button", { name: "閉じる" });
const closePanel = () => fireEvent.click(closeButton());
const openRail = () => fireEvent.click(screen.getByRole("button", { name: "編集を開く" }));
const handButton = () => screen.getByRole("button", { name: /^手の位置：/ }) as HTMLButtonElement;
const radio = (groupName: string, label: string) =>
  within(group(groupName)).getByRole("radio", { name: label }) as HTMLInputElement;
const checkbox = (label: string) =>
  within(group("テンション")).getByRole("checkbox", { name: label }) as HTMLInputElement;
const pick = (groupName: string, label: string) => fireEvent.click(radio(groupName, label));
const toggle = (label: string) => fireEvent.click(checkbox(label));
const select = (index: number) => fireEvent.click(chordButtons()[index]!);
const add = () => fireEvent.click(screen.getByRole("button", { name: "＋ コードを追加" }));
const remove = (n: number) => fireEvent.click(screen.getByRole("button", { name: `${n}番目のコードを削除` }));

describe("App（画面全体）", () => {
  it("初期表示で C・Am・F・G7 のボタンが並び、先頭が選ばれ、図が 4 つ出る。自由入力欄は無い", () => {
    render(<App />);
    expect(chordSymbols()).toEqual(["C", "Am", "F", "G7"]);
    expect(pressedIndex()).toBe(0);
    expect(diagramLabels()).toEqual(["C", "Am", "F", "G7"]);
    expect(alert()).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("2 番目のボタンを押すと選択が移り、編集の部品が Am（根音 A・変化記号なし・種類 m・ベースなし）を示す", () => {
    render(<App />);
    select(1);
    expect(pressedIndex()).toBe(1);
    expect(radio("根音の音名", "A").checked).toBe(true);
    expect(radio("根音の変化記号", "なし").checked).toBe(true);
    expect(radio("種類", "m").checked).toBe(true);
    expect(radio("ベース音の音名", "なし").checked).toBe(true);
  });

  it("2 番目を選んで種類を m7 に変えると、ボタンが Am7 になり、図が更新される", () => {
    render(<App />);
    select(1);
    pick("種類", "m7");
    expect(chordSymbols()).toEqual(["C", "Am7", "F", "G7"]);
    expect(diagramLabels()).toEqual(["C", "Am7", "F", "G7"]);
  });

  it("根音・種類・テンション・ベース音は、見出し（legend）つきの組。種類は 20 個で、三和音の M も選べる", () => {
    render(<App />);
    for (const name of ["根音の音名", "根音の変化記号", "種類", "テンション", "ベース音の音名", "ベース音の変化記号"]) {
      expect(group(name)).toBeTruthy();
    }
    expect(within(group("種類")).getAllByRole("radio")).toHaveLength(20);
    expect(radio("種類", "M").checked).toBe(true); // 初期の 1 番目は C
  });

  it("♯・♭ で表示し、記号には # と b で出る。ベース音を選ぶとオンコードになり、「なし」に戻せる", () => {
    render(<App />);
    pick("根音の変化記号", "♯");
    expect(chordSymbols()[0]).toBe("C#");
    pick("根音の変化記号", "♭");
    pick("根音の音名", "D");
    expect(chordSymbols()[0]).toBe("Db");
    pick("ベース音の音名", "G");
    pick("ベース音の変化記号", "♯");
    expect(chordSymbols()[0]).toBe("Db/G#");
    pick("ベース音の音名", "なし");
    expect(chordSymbols()[0]).toBe("Db");
    expect(radio("ベース音の変化記号", "なし").checked).toBe(true);
    expect(radio("ベース音の変化記号", "♯").disabled).toBe(true);
  });

  it("テンションは 7・M7・m7 のときだけ選べて、記号の中では b9,9,#9,#11,b13,13 の順に並ぶ", () => {
    render(<App />);
    expect(checkbox("9").disabled).toBe(true); // 初期の C（三和音）では選べない
    pick("種類", "7");
    toggle("13");
    toggle("#11");
    toggle("b9");
    expect(chordSymbols()[0]).toBe("C7(b9,#11,13)");
    pick("種類", "M7");
    expect(chordSymbols()[0]).toBe("CM7(b9,#11,13)");
    pick("種類", "m7");
    expect(checkbox("#11").disabled).toBe(false);
  });

  it("9 を選ぶと b9 と #9 が選べなくなる（逆も）。13 を選ぶと b13 が選べなくなる（逆も）。b9 と #9 は同時に選べる", () => {
    render(<App />);
    pick("種類", "7");
    toggle("9");
    expect(checkbox("b9").disabled).toBe(true);
    expect(checkbox("#9").disabled).toBe(true);
    toggle("9");
    toggle("b9");
    expect(checkbox("9").disabled).toBe(true);
    expect(checkbox("#9").disabled).toBe(false);
    toggle("#9");
    expect(chordSymbols()[0]).toBe("C7(b9,#9)");
    toggle("13");
    expect(checkbox("b13").disabled).toBe(true);
    toggle("13");
    toggle("b13");
    expect(checkbox("13").disabled).toBe(true);
  });

  it("テンションを選んだあと、選べない種類に切り替えると消える（7 に戻しても空）", () => {
    render(<App />);
    pick("種類", "7");
    toggle("9");
    expect(chordSymbols()[0]).toBe("C7(9)");
    pick("種類", "m");
    expect(chordSymbols()[0]).toBe("Cm");
    pick("種類", "7");
    expect(chordSymbols()[0]).toBe("C7");
    expect(checkbox("9").checked).toBe(false);
  });

  it("「＋ コードを追加」で末尾に C が増え、増えたコードが選ばれる", () => {
    render(<App />);
    add();
    expect(chordSymbols()).toEqual(["C", "Am", "F", "G7", "C"]);
    expect(pressedIndex()).toBe(4);
    expect(diagrams()).toHaveLength(5);
  });

  it("選んでいるコードを削除すると、1 つ前が選ばれる", () => {
    render(<App />);
    select(2);
    remove(3); // 3 番目（F）
    expect(chordSymbols()).toEqual(["C", "Am", "G7"]);
    expect(pressedIndex()).toBe(1);
  });

  it("先頭のコードを選んで削除すると、次が選ばれる", () => {
    render(<App />);
    remove(1);
    expect(chordSymbols()).toEqual(["Am", "F", "G7"]);
    expect(pressedIndex()).toBe(0);
  });

  it("選んでいないコードを削除しても、選んでいるコードは変わらない", () => {
    render(<App />);
    select(2); // F
    remove(1); // 手前の C を消す
    expect(chordSymbols()).toEqual(["Am", "F", "G7"]);
    expect(chordSymbols()[pressedIndex()]).toBe("F");
    remove(3); // 後ろの G7 を消す
    expect(chordSymbols()[pressedIndex()]).toBe("F");
  });

  it("コードが 1 個のとき削除ボタンは押せない", () => {
    render(<App />);
    remove(4);
    remove(3);
    remove(2);
    expect(chordSymbols()).toEqual(["C"]);
    expect((screen.getByRole("button", { name: "1番目のコードを削除" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("コードが 64 個のとき追加ボタンは押せず、63 個以下なら押せる", () => {
    render(<App />);
    const addButton = screen.getByRole("button", { name: "＋ コードを追加" }) as HTMLButtonElement;
    for (let i = 0; i < 60; i++) add();
    expect(chordButtons()).toHaveLength(64);
    expect(addButton.disabled).toBe(true);
    remove(64);
    expect(addButton.disabled).toBe(false);
  }, 30_000); // 図を 64 個描き直す操作を 60 回くり返すので、既定の 5 秒では足りない

  it("押さえ方が無いコードを選ぶと、図の代わりに日本語のメッセージが出て、コードの一覧は残る。直すと図が戻る", () => {
    render(<App />);
    pick("種類", "7");
    toggle("b9");
    toggle("#9");
    toggle("#11");
    expect(alert()?.textContent).toMatch(/1番目の記号「C7\(b9,#9,#11\)」は押さえ方が見つかりません/);
    expect(diagrams()).toHaveLength(0);
    expect(chordSymbols()).toEqual(["C7(b9,#9,#11)", "Am", "F", "G7"]);
    toggle("#11");
    expect(alert()).toBeNull();
    expect(diagrams()).toHaveLength(4);
  });

  it("「押さえ方」タブに、最低フレットごとの図が listShapesByLowestFret と同じ数だけ並び、各カードに「Nフレット付近」のボタンが 1 つある", () => {
    render(<App />);
    const shapes = firstShapes("C");
    expect(cards()).toHaveLength(shapes.length);
    cards().forEach((card, i) => {
      expect(within(card).getByText(`${shapes[i]!.lowestFret}フレット付近`)).toBeTruthy();
      expect(within(card).getAllByRole("img")).toHaveLength(1);
      expect(cardButton(i)).toBeTruthy();
    });
  });

  it("候補の図の並びはラベル付きの領域に入り、各カードの図に記号の見出しは出ない", () => {
    render(<App />);
    showTab("押さえ方");
    const picker = screen.getByRole("group", { name: PICKER });
    expect(picker.querySelectorAll("figure").length).toBeGreaterThan(0);
    expect(picker.querySelector("figcaption")).toBeNull();
  });

  it("最初のコードに押さえ方が無いとき、「押さえ方」タブは出ず、手の位置のボタンは押せない", () => {
    render(<App />);
    pick("種類", "7");
    toggle("b9");
    toggle("#9");
    toggle("#11");
    expect(within(screen.getByRole("region", { name: "進行の押さえ方" })).getByRole("alert")).toBeTruthy();
    expect(queryTabButton("押さえ方")).toBeNull();
    expect(screen.queryByRole("group", { name: PICKER })).toBeNull();
    expect(screen.queryByRole("button", { name: AUTO })).toBeNull();
    expect(handButton().disabled).toBe(true);
  });

  it("初めは「おまかせ」だけが押された状態で、結果は選択なしの最適化と同じ", () => {
    render(<App />);
    expect(autoButton().getAttribute("aria-pressed")).toBe("true");
    expect(cardPressed().every((pressed) => pressed === "false")).toBe(true);
    expect(resultLabels()).toEqual(expectedLabels(INITIAL));
  });

  it("候補のカードの「Nフレット付近」ボタンを押すと、そのボタンだけ押された状態になり、最初の図がその押さえ方になり、続く図が再計算される", () => {
    render(<App />);
    const shapes = firstShapes("C");
    const index = shapes.length - 1; // ネックの付け根寄り
    fireEvent.click(cardButton(index));
    expect(autoButton().getAttribute("aria-pressed")).toBe("false");
    expect(cardPressed()).toEqual(cards().map((_, i) => (i === index ? "true" : "false")));
    expect(resultLabels()).toEqual(expectedLabels(INITIAL, index));
    expect(resultLabels()[0]).toBe(voicingLabel("C", shapes[index]!.voicing));
    expect(resultLabels()).not.toEqual(expectedLabels(INITIAL));
  });

  describe("同じ最低フレットの図が 2 枚並ぶコード（Bm の 2 フレット: 単体の最安とセーハの最安）", () => {
    const setUpBm = () => {
      render(<App />);
      pick("根音の音名", "B");
      pick("種類", "m");
      expect(chordSymbols()[0]).toBe("Bm");
      const shapes = firstShapes("Bm");
      const twins = shapes.flatMap((shape, i) => (shape.lowestFret === 2 ? [i] : []));
      expect(twins).toHaveLength(2); // この前提が崩れたら、例を選び直す
      return { shapes, first: twins[0]!, second: twins[1]! };
    };

    it("図がすべて並び、同じ最低フレットが 2 枚あっても key の重複の警告は出ない", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { shapes } = setUpBm();
        expect(cards()).toHaveLength(shapes.length);
        expect(error).not.toHaveBeenCalled();
      } finally {
        error.mockRestore();
      }
    });

    it("2 枚目を選ぶと、その押さえ方に固定されて 2 枚目だけが押された状態になり、「おまかせ」で戻せる", () => {
      const { shapes, first, second } = setUpBm();
      fireEvent.click(cardButton(second));
      expect(cardPressed()).toEqual(cards().map((_, i) => (i === second ? "true" : "false")));
      expect(resultLabels()[0]).toBe(voicingLabel("Bm", shapes[second]!.voicing));
      expect(resultLabels()).toEqual(expectedLabels(["Bm", "Am", "F", "G7"], second));
      fireEvent.click(cardButton(first));
      expect(cardPressed()).toEqual(cards().map((_, i) => (i === first ? "true" : "false")));
      expect(resultLabels()[0]).toBe(voicingLabel("Bm", shapes[first]!.voicing));
      fireEvent.click(autoButton());
      expect(cardPressed().every((pressed) => pressed === "false")).toBe(true);
      expect(resultLabels()).toEqual(expectedLabels(["Bm", "Am", "F", "G7"]));
    });
  });

  it("選んだあとで「おまかせ」を押すと、おまかせだけが押された状態に戻り、結果も選択なしに戻る", () => {
    render(<App />);
    fireEvent.click(cardButton(3));
    fireEvent.click(autoButton());
    expect(autoButton().getAttribute("aria-pressed")).toBe("true");
    expect(cardPressed().every((pressed) => pressed === "false")).toBe(true);
    expect(resultLabels()).toEqual(expectedLabels(INITIAL));
  });

  it("「おまかせ」の結果がたまたま代表の 1 つと同じでも、そのカードに選択の印は付かない", () => {
    render(<App />);
    const auto = resultLabels()[0];
    const same = firstShapes("C").some((shape) => voicingLabel("C", shape.voicing) === auto);
    expect(same).toBe(true); // この前提が崩れたら、例を選び直す
    expect(cardPressed().every((pressed) => pressed === "false")).toBe(true);
  });

  it("選んだあとで先頭のコードを別のコードに変えると、「おまかせ」に戻る", () => {
    render(<App />);
    fireEvent.click(cardButton(3));
    pick("根音の音名", "D");
    expect(chordSymbols()[0]).toBe("D");
    expect(autoButton().getAttribute("aria-pressed")).toBe("true");
    expect(cardPressed().every((pressed) => pressed === "false")).toBe(true);
    expect(resultLabels()).toEqual(expectedLabels(["D", "Am", "F", "G7"]));
  });

  it("選んだあとで先頭のコードを削除して次が繰り上がると、「おまかせ」に戻る", () => {
    render(<App />);
    fireEvent.click(cardButton(3));
    remove(1);
    expect(chordSymbols()).toEqual(["Am", "F", "G7"]);
    expect(autoButton().getAttribute("aria-pressed")).toBe("true");
    expect(cardPressed().every((pressed) => pressed === "false")).toBe(true);
    expect(resultLabels()).toEqual(expectedLabels(["Am", "F", "G7"]));
  });

  it("先頭以外のコードを変更・削除しても、選んだ押さえ方は保たれる", () => {
    render(<App />);
    fireEvent.click(cardButton(3));
    select(1);
    pick("種類", "m7");
    select(0);
    expect(cardButton(3).getAttribute("aria-pressed")).toBe("true");
    expect(resultLabels()).toEqual(expectedLabels(["C", "Am7", "F", "G7"], 3));
    remove(4);
    expect(cardButton(3).getAttribute("aria-pressed")).toBe("true");
    expect(resultLabels()).toEqual(expectedLabels(["C", "Am7", "F"], 3));
  });

  it("手の位置に収まらず範囲を広げたコードの図には「手の位置から外れた押さえ方です」と添える。収まるコードと「おまかせ」では出ない", () => {
    render(<App />);
    const outOfWindow = () => screen.queryAllByText("手の位置から外れた押さえ方です");
    expect(outOfWindow()).toHaveLength(0);
    select(1);
    pick("根音の音名", "D");
    pick("根音の変化記号", "♭");
    pick("種類", "7");
    toggle("b9");
    toggle("#11");
    expect(chordSymbols()[1]).toBe("Db7(b9,#11)");
    expect(outOfWindow()).toHaveLength(0); // おまかせ
    select(0);
    const shapes = firstShapes("C");
    const index = shapes.findIndex((shape) => shape.lowestFret === 10);
    expect(index).toBeGreaterThanOrEqual(0);
    fireEvent.click(cardButton(index));
    const result = optimizeSymbols(["C", "Db7(b9,#11)", "F", "G7"], { firstVoicing: shapes[index]!.voicing });
    if (!result.ok) throw new Error("optimize");
    const expected = result.steps.filter((step) => step.inWindow === false).length;
    expect(expected).toBeGreaterThan(0);
    expect(outOfWindow()).toHaveLength(expected);
    expect(diagrams()[0]!.closest(".step")?.textContent).not.toContain("手の位置から外れた");
  });

  it("「押さえ方の選び方」の説明が画面にあり、4 つの点（進行全体で選ぶ・同じコードでも同じとは限らない・位置を選ぶと 5 フレットに収める・選べるのは最初のコードだけ）を含む", () => {
    render(<App />);
    const text = screen.getByRole("region", { name: "押さえ方の選び方" }).textContent ?? "";
    expect(text).toContain("進行全体");
    expect(text).toContain("同じ押さえ方になるとは限りません");
    expect(text).toContain("5フレット");
    expect(text).toContain("開放弦とミュート");
    expect(text).toContain("手の位置から外れた押さえ方です");
    expect(text).toContain("最初のコードだけ");
  });

  it("apps/web のソース（.ts・.tsx）に、HTML をそのまま差し込む React の機能（dangerously で始まるもの）が無い", () => {
    const forbidden = ["dangerously", "SetInnerHTML"].join(""); // このファイルが grep に当たらないよう分ける
    const names = Object.keys(rawSources);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(rawSources[name], name).not.toContain(forbidden);
    }
  });
});

describe("App（配置・編集パネル・開閉）", () => {
  const cardItems = () => within(screen.getByRole("list", { name: "コード進行" })).getAllByRole("listitem");
  const cardOf = (i: number) => chordButtons()[i]!.closest("li")!;
  const heading = () => within(editorRegion()).getByRole("heading", { name: /番目のコードを編集$/ }).textContent;
  const hasNoGroup = (name: string) => screen.queryByRole("group", { name }) === null;

  it("初期表示で、編集パネルが開き、見出しが「1番目のコードを編集」で隣に記号 C が出る", () => {
    render(<App />);
    expect(heading()).toBe("1番目のコードを編集");
    expect(editorRegion().querySelector(".editor-symbol")?.textContent).toBe("C");
    expect(screen.queryByRole("button", { name: "編集を開く" })).toBeNull();
  });

  it("カードは、番号がボタンの外にあり、ボタン名は記号だけで、図（figure）はボタンの外にあり、図の見出しは出ない", () => {
    render(<App />);
    const card = cardOf(1);
    const button = within(card).getByRole("button", { name: "Am" });
    expect(button.textContent).toBe("Am");
    const number = card.querySelector(".step-number");
    expect(number?.textContent).toBe("2");
    expect(button.contains(number)).toBe(false);
    const figure = card.querySelector("figure");
    expect(figure).not.toBeNull();
    expect(button.contains(figure)).toBe(false);
    expect(card.querySelector("figcaption")).toBeNull();
    expect(card.classList.contains("step")).toBe(true);
  });

  it("コード進行の一覧は、コードの数だけカードを並べ、最後の項目に「＋ コードを追加」を置く", () => {
    render(<App />);
    const items = cardItems();
    expect(items).toHaveLength(5);
    expect(within(items[4]!).getByRole("button", { name: "＋ コードを追加" })).toBeTruthy();
    expect(items.slice(0, 4).every((item) => item.classList.contains("step"))).toBe(true);
  });

  it("DOM の順は、ヘッダー → 編集欄 → 譜面", () => {
    const { container } = render(<App />);
    const header = container.querySelector("header")!;
    const score = screen.getByRole("region", { name: "進行の押さえ方" });
    expect(header.compareDocumentPosition(editorRegion()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(editorRegion().compareDocumentPosition(score) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("カードの記号を押すと選択が移り、見出しが「2番目のコードを編集」になり、タブは「コード」になる", () => {
    render(<App />);
    select(1);
    expect(pressedIndex()).toBe(1);
    expect(heading()).toBe("2番目のコードを編集");
    expect(pressedTab()).toBe("コード");
  });

  it("押さえ方が無いコードがあっても、全コードのカードが番号と記号だけで出て、メッセージは譜面の領域の中で一覧の上に出る", () => {
    render(<App />);
    pick("種類", "7");
    toggle("b9");
    toggle("#9");
    toggle("#11");
    const region = screen.getByRole("region", { name: "進行の押さえ方" });
    const message = within(region).getByRole("alert");
    const list = within(region).getByRole("list", { name: "コード進行" });
    expect(message.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chordSymbols()).toEqual(["C7(b9,#9,#11)", "Am", "F", "G7"]);
    expect(within(list).queryAllByRole("img")).toHaveLength(0);
    expect(within(cardOf(2)).getByText("3")).toBeTruthy();
    // 直すと図が戻る
    toggle("#11");
    expect(alert()).toBeNull();
    expect(diagrams()).toHaveLength(4);
  });

  it("初めは「コード」タブで、根音・種類の組だけが出る（テンション・ベースの組は出ない）", () => {
    render(<App />);
    expect(pressedTab()).toBe("コード");
    for (const name of ["根音の音名", "根音の変化記号", "種類"]) expect(hasNoGroup(name)).toBe(false);
    for (const name of ["テンション", "ベース音の音名", "ベース音の変化記号"]) expect(hasNoGroup(name)).toBe(true);
  });

  it("「テンション・ベース」タブには、テンションとベース音の組だけが出る", () => {
    render(<App />);
    showTab("テンション・ベース");
    for (const name of ["テンション", "ベース音の音名", "ベース音の変化記号"]) expect(hasNoGroup(name)).toBe(false);
    for (const name of ["根音の音名", "根音の変化記号", "種類"]) expect(hasNoGroup(name)).toBe(true);
  });

  it("タブは aria-pressed のボタンで、押したタブだけが true になる", () => {
    render(<App />);
    expect(tabButtons().map((b) => b.textContent)).toEqual(["コード", "テンション・ベース", "押さえ方"]);
    expect(tabButtons().every((b) => b.getAttribute("type") === "button" && b.hasAttribute("aria-pressed"))).toBe(true);
    fireEvent.click(tabButton("押さえ方"));
    expect(tabButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    fireEvent.click(tabButton("テンション・ベース"));
    expect(tabButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  });

  it("「押さえ方」タブは、1番目のコードを選んでいて候補があるときだけ出る（2番目を選ぶと出ない）", () => {
    render(<App />);
    expect(queryTabButton("押さえ方")).not.toBeNull();
    select(1);
    expect(queryTabButton("押さえ方")).toBeNull();
    select(0);
    expect(queryTabButton("押さえ方")).not.toBeNull();
  });

  it("「押さえ方」タブの中身は、おまかせと候補の図（最初のコードの押さえ方）である", () => {
    render(<App />);
    fireEvent.click(tabButton("押さえ方"));
    expect(screen.getByRole("button", { name: AUTO })).toBeTruthy();
    expect(screen.getByRole("group", { name: PICKER })).toBeTruthy();
    expect(hasNoGroup("種類")).toBe(true);
  });

  it("選択中のコードが変わると、タブは「コード」に戻る（カードの選択・追加・選択中の削除）", () => {
    render(<App />);
    showTab("押さえ方");
    select(2);
    expect(pressedTab()).toBe("コード");
    showTab("テンション・ベース");
    add();
    expect(pressedTab()).toBe("コード");
    showTab("テンション・ベース");
    remove(5); // 選んでいる末尾を消す
    expect(pressedTab()).toBe("コード");
    select(0);
    showTab("テンション・ベース");
    remove(1); // 選んでいる先頭を消す（次のコードが繰り上がる）
    expect(pressedTab()).toBe("コード");
  });

  it("タブは戻らない: 選んでいるカードを押し直したとき、選んでいないコードの削除で番号だけずれたとき", () => {
    render(<App />);
    select(2); // F
    showTab("テンション・ベース");
    select(2);
    expect(pressedTab()).toBe("テンション・ベース");
    remove(1); // 手前の C を消す。F の番号が 3 → 2 になる
    expect(chordSymbols()[pressedIndex()]).toBe("F");
    expect(pressedTab()).toBe("テンション・ベース");
    remove(3); // 後ろの G7 を消す
    expect(pressedTab()).toBe("テンション・ベース");
  });

  it("編集で記号が変わっても、タブは戻らない", () => {
    render(<App />);
    showTab("テンション・ベース");
    pick("ベース音の音名", "G");
    expect(chordSymbols()[0]).toBe("C/G");
    expect(pressedTab()).toBe("テンション・ベース");
    showTab("コード");
    pick("種類", "7");
    expect(chordSymbols()[0]).toBe("C7/G");
    expect(pressedTab()).toBe("コード");
    showTab("テンション・ベース");
    toggle("9");
    expect(chordSymbols()[0]).toBe("C7(9)/G");
    expect(pressedTab()).toBe("テンション・ベース");
  });

  it("「閉じる」を押すと、編集の部品が消えて「編集を開く」のボタンだけが残り、どのカードも選択の印が付かない", () => {
    render(<App />);
    closePanel();
    expect(screen.queryByRole("region", { name: /番目のコードを編集$/ })).toBeNull();
    expect(screen.queryByRole("group", { name: TABS })).toBeNull();
    expect(screen.queryByRole("button", { name: "閉じる" })).toBeNull();
    expect(screen.getByRole("button", { name: "編集を開く" })).toBeTruthy();
    expect(chordButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "false"]);
    expect(diagrams()).toHaveLength(4);
  });

  it("帯のボタンで開くと、閉じる前のコードとタブで開く（選んだ押さえ方も保たれる）", () => {
    render(<App />);
    select(2);
    showTab("テンション・ベース");
    closePanel();
    openRail();
    expect(pressedIndex()).toBe(2);
    expect(pressedTab()).toBe("テンション・ベース");
    select(0);
    fireEvent.click(cardButton(3));
    expect(pressedTab()).toBe("押さえ方");
    closePanel();
    openRail();
    expect(pressedIndex()).toBe(0);
    expect(pressedTab()).toBe("押さえ方");
    expect(cardButton(3).getAttribute("aria-pressed")).toBe("true");
  });

  it("閉じている間にカードを押すと、そのコードで開く", () => {
    render(<App />);
    closePanel();
    select(1);
    expect(heading()).toBe("2番目のコードを編集");
    expect(pressedIndex()).toBe(1);
    expect(pressedTab()).toBe("コード");
  });

  it("閉じている間に「＋ コードを追加」を押すと、増えたコードで開く", () => {
    render(<App />);
    closePanel();
    add();
    expect(heading()).toBe("5番目のコードを編集");
    expect(pressedIndex()).toBe(4);
  });

  it("開いているとき、選択中のカードを押しても閉じない", () => {
    render(<App />);
    select(0);
    select(0);
    expect(heading()).toBe("1番目のコードを編集");
    expect(screen.queryByRole("button", { name: "編集を開く" })).toBeNull();
  });

  it("閉じている間にコードを削除しても開かず、選択の番号は削除の規則で動く（開くとそのコードが選ばれている）", () => {
    render(<App />);
    select(2); // F
    closePanel();
    remove(1); // 手前を消すと、F は 2 番目になる
    expect(screen.queryByRole("region", { name: /番目のコードを編集$/ })).toBeNull();
    openRail();
    expect(chordSymbols()[pressedIndex()]).toBe("F");
    closePanel();
    remove(2); // 選んでいる F を消すと、1 つ前の Am が選ばれる
    expect(screen.queryByRole("region", { name: /番目のコードを編集$/ })).toBeNull();
    openRail();
    expect(chordSymbols()[pressedIndex()]).toBe("Am");
  });

  it("「閉じる」を押すと、選択中だったカードの記号のボタンにフォーカスが移る", () => {
    render(<App />);
    select(2);
    closePanel();
    expect(document.activeElement).toBe(chordButtons()[2]);
  });

  it("帯のボタンで開くと、「閉じる」にフォーカスが移る", () => {
    render(<App />);
    closePanel();
    openRail();
    expect(document.activeElement).toBe(closeButton());
  });

  it("カード・「＋ コードを追加」・手の位置のボタンで開いたときは、「閉じる」にフォーカスを動かさない", () => {
    render(<App />);
    closePanel();
    select(1);
    expect(document.activeElement).not.toBe(closeButton());
    closePanel();
    add();
    expect(document.activeElement).not.toBe(closeButton());
    closePanel();
    fireEvent.click(handButton());
    expect(screen.getByRole("button", { name: "閉じる" })).toBeTruthy();
    expect(document.activeElement).not.toBe(closeButton());
  });

  it("ヘッダーにサイト名と説明文があり、手の位置のボタンは「おまかせ」では「手の位置：おまかせ」、選ぶと「手の位置：Nフレット付近」になる", () => {
    const { container } = render(<App />);
    const header = container.querySelector("header")!;
    expect(within(header).getByRole("heading", { level: 1 }).textContent).toBe("shirabe-chord");
    expect(header.textContent).toContain("コード進行を組み立てると");
    expect(handButton().textContent).toBe("手の位置：おまかせ");
    const shapes = firstShapes("C");
    fireEvent.click(cardButton(3));
    expect(handButton().textContent).toBe(`手の位置：${shapes[3]!.lowestFret}フレット付近`);
    fireEvent.click(autoButton());
    expect(handButton().textContent).toBe("手の位置：おまかせ");
  });

  it("手の位置のボタンを押すと、3番目を選んで閉じていても、1番目を選んでパネルを開き「押さえ方」タブを出す。1番目が選択中でも「押さえ方」にする", () => {
    render(<App />);
    select(2);
    closePanel();
    fireEvent.click(handButton());
    expect(pressedIndex()).toBe(0);
    expect(pressedTab()).toBe("押さえ方");
    showTab("コード");
    fireEvent.click(handButton());
    expect(pressedIndex()).toBe(0);
    expect(pressedTab()).toBe("押さえ方");
  });

  it("「押さえ方の選び方」は、ヘッダーの中の領域にある開閉の部品（summary は「選び方」）で、4 つの点を含む", () => {
    const { container } = render(<App />);
    const region = screen.getByRole("region", { name: "押さえ方の選び方" });
    expect(container.querySelector("header")!.contains(region)).toBe(true);
    expect(region.querySelector("details > summary")?.textContent).toBe("選び方");
    expect(region.querySelectorAll("li")).toHaveLength(4);
  });

  it("操作をランダムに数百回くり返しても、選択の番号は範囲内で、選択中のカードは開いていればちょうど 1 枚（閉じていれば 0 枚）、押されたタブはちょうど 1 つ、「押さえ方」タブは出せるときだけ出る", () => {
    const random = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const qualities = ["M", "m", "7", "M7", "sus4", "dim7"];
    for (const seed of [1, 2, 3]) {
      const next = random(seed);
      const below = (n: number) => Math.floor(next() * n);
      const { unmount } = render(<App />);
      let count = 4;
      let open = true;
      const check = () => {
        const buttons = chordButtons();
        expect(buttons).toHaveLength(count);
        const pressed = buttons.filter((b) => b.getAttribute("aria-pressed") === "true");
        if (!open) {
          expect(pressed).toHaveLength(0);
          expect(screen.queryByRole("group", { name: TABS })).toBeNull();
          return;
        }
        expect(pressed).toHaveLength(1);
        const number = Number(/^(\d+)番目/.exec(heading()!)![1]);
        expect(number).toBe(pressedIndex() + 1);
        expect(number).toBeLessThanOrEqual(count);
        expect(tabButtons().filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
        const first = listShapesByLowestFret(chordSymbols()[0]!);
        const canShowShape = pressedIndex() === 0 && first.ok && first.shapes.length > 0;
        expect(queryTabButton("押さえ方") !== null).toBe(canShowShape);
      };
      const operations: (() => void)[] = [
        () => {
          select(below(count));
          open = true;
        },
        () => {
          if (count >= 8) return;
          add();
          count++;
          open = true;
        },
        () => {
          if (count <= 1) return;
          remove(below(count) + 1);
          count--;
        },
        () => {
          if (!open) return;
          const names = tabButtons().map((b) => b.textContent!);
          showTab(names[below(names.length)]!);
        },
        () => {
          if (!open) return;
          closePanel();
          open = false;
        },
        () => {
          if (open) return;
          openRail();
          open = true;
        },
        () => {
          if (handButton().disabled) return;
          fireEvent.click(handButton());
          open = true;
        },
        () => {
          if (!open) return;
          pick("種類", qualities[below(qualities.length)]!);
        },
        () => {
          // 最初のコードを、押さえ方の無いコード（C7(b9,#9,#11)）にする
          select(0);
          open = true;
          pick("根音の音名", "C");
          pick("根音の変化記号", "なし");
          pick("種類", "m");
          pick("種類", "7");
          for (const tension of ["b9", "#9", "#11"]) toggle(tension);
        },
      ];
      for (let step = 0; step < 150; step++) {
        operations[below(operations.length)]!();
        check();
      }
      unmount();
    }
  }, 60_000);
});
