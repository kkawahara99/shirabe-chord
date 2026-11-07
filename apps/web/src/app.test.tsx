import { listShapesByLowestFret, lowerSymbol, optimizeSymbols, rootStrings, type Shape } from "@shirabe-chord/core";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import { voicingFrets, voicingLabel } from "./voicing-diagram.tsx";

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
const chordSymbols = () => chordButtons().map((button) => button.dataset.symbol);
const chordTexts = () => chordButtons().map((button) => button.textContent);
/** 画面の選択肢の表示。内部の記号の b・# は ♭・♯ で出る。 */
const shown = (label: string) => label.replace("m7-5", "m7(♭5)").replace(/b/g, "♭").replace(/#/g, "♯");
const pressedIndex = () => chordButtons().findIndex((button) => button.getAttribute("aria-pressed") === "true");

const PICKER = "押さえ方の候補";
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
/** 選んでいるコードの、押さえ方の候補（カポ基準）。 */
const capoValue = () => Number((screen.getByRole("combobox", { name: "カポ" }) as HTMLSelectElement).value);
const selectedShapes = () => shapesOf(lowerSymbol(chordSymbols()[pressedIndex()]!, capoValue()));
const cardButton = (i: number) => within(cards()[i]!).getByRole("button", { name: `第${selectedShapes()[i]!.lowestFret}ポジション` });
const cardPressed = () => cards().map((_, i) => cardButton(i).getAttribute("aria-pressed"));
const shapesOf = (symbol: string) => {
  const shapes = listShapesByLowestFret(symbol);
  if (!shapes.ok) throw new Error("shapes");
  return shapes.shapes;
};
/** `pins` は、進行の位置 → そのコードの候補（`listShapesByLowestFret`）の何番目か。 */
const expectedLabels = (symbols: string[], pins: Record<number, number> = {}) => {
  const result = optimizeSymbols(symbols, {
    pins: new Map(Object.entries(pins).map(([position, index]) => [Number(position), shapesOf(symbols[Number(position)]!)[index]!.voicing])),
  });
  if (!result.ok) throw new Error("optimize");
  return result.steps.map((step) => voicingLabel(step.symbol, step.voicing));
};
/** 「固定」の印が付いているカードの位置（0 始まり）。 */
const pinMarks = () =>
  Array.from(document.querySelectorAll(".steps > .step")).flatMap((element, i) => (element.querySelector(".step-pinned") ? [i] : []));
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
  within(group(groupName)).getByRole("radio", { name: groupName === "種類" ? shown(label) : label }) as HTMLInputElement;
const checkbox = (label: string) =>
  within(group("テンション")).getByRole("checkbox", { name: shown(label) }) as HTMLInputElement;
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

  it("初期の進行は従来どおりの表記で、カードの data-symbol も同じ", () => {
    render(<App />);
    expect(chordTexts()).toEqual(INITIAL);
    expect(chordSymbols()).toEqual(INITIAL);
    expect(document.querySelector(".editor-symbol")?.textContent).toBe("C");
  });

  it("Bb・F#m7-5・C7(b9)/E を選ぶと、カード・見出し・図の読み上げ名が譜面の表記になり、data-symbol は内部の記号のまま", () => {
    render(<App />);
    pick("根音の変化記号", "♭");
    pick("根音の音名", "B");
    expect(chordTexts()[0]).toBe("B♭");
    expect(chordSymbols()[0]).toBe("Bb");
    expect(document.querySelector(".editor-symbol")?.textContent).toBe("B♭");
    expect(resultLabels()[0]).toMatch(/^B♭: /);

    pick("根音の音名", "F");
    pick("根音の変化記号", "♯");
    pick("種類", "m7-5");
    expect(chordTexts()[0]).toBe("F♯m7(♭5)");
    expect(chordSymbols()[0]).toBe("F#m7-5");
    expect(document.querySelector(".editor-symbol")?.textContent).toBe("F♯m7(♭5)");
    expect(resultLabels()[0]).toMatch(/^F♯m7\(♭5\): /);
    expect(radio("種類", "m7-5").labels?.[0]?.textContent).toBe("m7(♭5)");

    pick("根音の音名", "C");
    pick("根音の変化記号", "なし");
    pick("種類", "7");
    toggle("b9");
    pick("ベース音の音名", "E");
    expect(chordTexts()[0]).toBe("C7(♭9)/E");
    expect(chordSymbols()[0]).toBe("C7(b9)/E");
    expect(resultLabels()[0]).toMatch(/^C7\(♭9\)\/E: /);
    expect(checkbox("#11").labels?.[0]?.textContent).toBe("♯11");
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
    expect(alert()?.textContent).toMatch(/1番目の記号「C7\(♭9,♯9,♯11\)」は押さえ方が見つかりません/);
    expect(diagrams()).toHaveLength(0);
    expect(chordSymbols()).toEqual(["C7(b9,#9,#11)", "Am", "F", "G7"]);
    toggle("#11");
    expect(alert()).toBeNull();
    expect(diagrams()).toHaveLength(4);
  });

  it("「押さえ方」タブに、最低フレットごとの図が listShapesByLowestFret と同じ数だけ並び、各カードに「第Nポジション」のボタンが 1 つある", () => {
    render(<App />);
    const shapes = shapesOf("C");
    expect(cards()).toHaveLength(shapes.length);
    cards().forEach((card, i) => {
      expect(within(card).getByText(`第${shapes[i]!.lowestFret}ポジション`)).toBeTruthy();
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

  it("候補のカードの「第Nポジション」ボタンを押すと、そのボタンだけ押された状態になり、最初の図がその押さえ方になり、続く図が再計算される", () => {
    render(<App />);
    const shapes = shapesOf("C");
    const index = shapes.length - 1; // ネックの付け根寄り
    fireEvent.click(cardButton(index));
    expect(autoButton().getAttribute("aria-pressed")).toBe("false");
    expect(cardPressed()).toEqual(cards().map((_, i) => (i === index ? "true" : "false")));
    expect(resultLabels()).toEqual(expectedLabels(INITIAL, { 0: index }));
    expect(resultLabels()[0]).toBe(voicingLabel("C", shapes[index]!.voicing));
    expect(resultLabels()).not.toEqual(expectedLabels(INITIAL));
  });

  describe("同じ最低フレットの図が 2 枚並ぶコード（Bm の 2 フレット: 単体の最安とセーハの最安）", () => {
    const setUpBm = () => {
      render(<App />);
      pick("根音の音名", "B");
      pick("種類", "m");
      expect(chordSymbols()[0]).toBe("Bm");
      const shapes = shapesOf("Bm");
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
      expect(resultLabels()).toEqual(expectedLabels(["Bm", "Am", "F", "G7"], { 0: second }));
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
    const same = shapesOf("C").some((shape) => voicingLabel("C", shape.voicing) === auto);
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
    expect(resultLabels()).toEqual(expectedLabels(["C", "Am7", "F", "G7"], { 0: 3 }));
    remove(4);
    expect(cardButton(3).getAttribute("aria-pressed")).toBe("true");
    expect(resultLabels()).toEqual(expectedLabels(["C", "Am7", "F"], { 0: 3 }));
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
    const shapes = shapesOf("C");
    const index = shapes.findIndex((shape) => shape.lowestFret === 10);
    expect(index).toBeGreaterThanOrEqual(0);
    fireEvent.click(cardButton(index));
    const result = optimizeSymbols(["C", "Db7(b9,#11)", "F", "G7"], { pins: new Map([[0, shapes[index]!.voicing]]) });
    if (!result.ok) throw new Error("optimize");
    const expected = result.steps.filter((step) => step.inWindow === false).length;
    expect(expected).toBeGreaterThan(0);
    expect(outOfWindow()).toHaveLength(expected);
    expect(diagrams()[0]!.closest(".step")?.textContent).not.toContain("手の位置から外れた");
  });

  it("「押さえ方の選び方」の説明が画面にあり、5 つの点（標準チューニングの右利き前提・進行全体で選ぶ・同じコードでも同じとは限らない・固定すると 5 フレットに収める・どのコードでも選び直せる）を含み、最初のコードだけとは書かない", () => {
    render(<App />);
    const text = screen.getByRole("region", { name: "押さえ方の選び方" }).textContent ?? "";
    expect(text).toContain("進行全体");
    expect(text).toContain("同じ押さえ方になるとは限りません");
    expect(text).toContain("5フレット");
    expect(text).toContain("開放弦とミュート");
    expect(text).toContain("手の位置から外れた押さえ方です");
    expect(text).toContain("押さえ方は、どのコードでも選び直せます");
    expect(text).toContain("押さえ方を固定すると、固定したうち最も前のコードの最低フレットから5フレット分に、固定していないコードを収めます");
    expect(text).not.toContain("最初のコード");
    expect(text).toContain("標準チューニングの右利きのギターを前提にしています。");
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

  it("「押さえ方」タブは、選んでいるコードに候補があるときだけ出る（どのコードでも出る）", () => {
    render(<App />);
    for (let i = 0; i < 4; i++) {
      select(i);
      expect(queryTabButton("押さえ方")).not.toBeNull();
    }
    pick("種類", "7");
    toggle("b9");
    toggle("#9");
    toggle("#11");
    expect(queryTabButton("押さえ方")).toBeNull();
  });

  it("「押さえ方」タブの中身は、おまかせと候補の図（選んでいるコードの押さえ方）である", () => {
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

  it("ヘッダーにサイト名と説明文があり、手の位置のボタンは「おまかせ」では「手の位置：おまかせ」、選ぶと「手の位置：第Nポジション」になる", () => {
    const { container } = render(<App />);
    const header = container.querySelector("header")!;
    expect(within(header).getByRole("heading", { level: 1 }).textContent).toBe("shirabe-chord");
    expect(header.textContent).toContain("コード進行を組み立てると");
    expect(handButton().textContent).toBe("手の位置：おまかせ");
    const shapes = shapesOf("C");
    fireEvent.click(cardButton(3));
    expect(handButton().textContent).toBe(`手の位置：第${shapes[3]!.lowestFret}ポジション`);
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

  it("「押さえ方の選び方」は、ヘッダーの中の領域にある開閉の部品（summary は「選び方」）で、5 つの点を含む", () => {
    const { container } = render(<App />);
    const region = screen.getByRole("region", { name: "押さえ方の選び方" });
    expect(container.querySelector("header")!.contains(region)).toBe(true);
    expect(region.querySelector("details > summary")?.textContent).toBe("選び方");
    expect(region.querySelectorAll("li")).toHaveLength(5);
  });

  it("操作をランダムに数百回くり返しても、固定の印は写しの位置とちょうど一致して図が固定した形で、固定の失敗の文は出ず、選択の番号は範囲内、選択中のカードは開いていればちょうど 1 枚（閉じていれば 0 枚）、押されたタブはちょうど 1 つ、「押さえ方」タブは選んだコードに候補があるときだけ出る", () => {
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
      /** 画面の外に持つ、固定の写し。進行の位置 → 固定した形。 */
      let model = new Map<number, Shape>();
      const check = () => {
        const buttons = chordButtons();
        expect(buttons).toHaveLength(count);
        // 固定の位置は範囲内で、印の位置と一致する
        expect(pinMarks()).toEqual([...model.keys()].sort((x, y) => x - y));
        expect([...model.keys()].every((position) => position >= 0 && position < count)).toBe(true);
        // 固定した形で図が出る（進行が失敗しているときは図が無い）
        const labels = resultLabels();
        if (labels.length > 0) {
          for (const [position, shape] of model) {
            expect(labels[position]).toBe(voicingLabel(lowerSymbol(chordSymbols()[position]!, capoValue()), shape.voicing));
          }
        }
        // 手の位置は、固定のうち最も前のコードの最低フレット
        const front = Math.min(...model.keys());
        expect(handButton().textContent).toBe(`手の位置：${model.size === 0 ? "おまかせ" : `第${model.get(front)!.lowestFret}ポジション`}`);
        const firstList = listShapesByLowestFret(lowerSymbol(chordSymbols()[0]!, capoValue()));
        expect(handButton().disabled).toBe(model.size === 0 && !(firstList.ok && firstList.shapes.length > 0));
        expect(alert()?.textContent ?? "").not.toContain("固定した押さえ方が合っていません");
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
        const selectedList = listShapesByLowestFret(lowerSymbol(chordSymbols()[pressedIndex()]!, capoValue()));
        const canShowShape = selectedList.ok && selectedList.shapes.length > 0;
        expect(queryTabButton("押さえ方") !== null).toBe(canShowShape);
      };
      /** 記号を変える操作。記号が変わったコードの固定は外れる。 */
      const editing = (position: number, edit: () => void) => {
        const before = chordSymbols()[position];
        edit();
        if (chordSymbols()[position] !== before) model.delete(position);
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
          const position = below(count);
          remove(position + 1);
          count--;
          model = new Map([...model].filter(([p]) => p !== position).map(([p, shape]) => [p > position ? p - 1 : p, shape]));
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
          editing(pressedIndex(), () => pick("種類", qualities[below(qualities.length)]!));
        },
        () => {
          // 最初のコードを、押さえ方の無いコード（C7(b9,#9,#11)）にする
          select(0);
          open = true;
          editing(0, () => {
            pick("根音の音名", "C");
            pick("根音の変化記号", "なし");
            pick("種類", "m");
            pick("種類", "7");
            for (const tension of ["b9", "#9", "#11"]) toggle(tension);
          });
        },
        () => {
          // 選んだコードに、候補の 1 つを固定する
          const position = below(count);
          select(position);
          open = true;
          if (queryTabButton("押さえ方") === null) return;
          const index = below(cards().length);
          fireEvent.click(cardButton(index));
          model.set(position, selectedShapes()[index]!);
        },
        () => {
          // 選んだコードを「おまかせ」に戻す
          if (!open || queryTabButton("押さえ方") === null) return;
          fireEvent.click(autoButton());
          model.delete(pressedIndex());
        },
        () => {
          // カポを変える。値が変わるときだけ、固定がすべて外れる
          const fret = below(8);
          if (fret !== capoValue()) model.clear();
          fireEvent.change(screen.getByRole("combobox", { name: "カポ" }), { target: { value: String(fret) } });
        },
      ];
      for (let step = 0; step < 120; step++) {
        operations[below(operations.length)]!();
        check();
      }
      unmount();
    }
  }, 180_000);
});

describe("どのコードでも押さえ方を固定できる", () => {
  /** 位置 `position` のコードを選び、候補の `index` 番目に固定する。 */
  const pin = (position: number, index: number) => {
    select(position);
    fireEvent.click(cardButton(index));
  };
  const lastIndex = (symbol: string) => shapesOf(symbol).length - 1;

  it("どのコードを選んでも、候補の数はそのコード（カポ基準の記号）の listShapesByLowestFret と同じになる", () => {
    render(<App />);
    INITIAL.forEach((symbol, i) => {
      select(i);
      expect(cards()).toHaveLength(shapesOf(symbol).length);
    });
    fireEvent.change(screen.getByRole("combobox", { name: "カポ" }), { target: { value: "3" } });
    select(1);
    expect(cards()).toHaveLength(shapesOf("F#m").length);
  });

  it("見出しと領域名は「押さえ方」「押さえ方の候補」で、「最初のコード」とは書かない", () => {
    render(<App />);
    showTab("押さえ方");
    expect(screen.getByRole("heading", { name: "押さえ方", level: 2 })).toBeTruthy();
    expect(screen.getByRole("group", { name: "押さえ方の候補" })).toBeTruthy();
    expect(editorRegion().textContent).not.toContain("最初のコード");
  });

  it("候補が無い別のコードがあっても、移る先の 1 番目に候補があれば手の位置のボタンは押せる", () => {
    render(<App />);
    select(1);
    pick("根音の音名", "C");
    pick("根音の変化記号", "なし");
    pick("種類", "7");
    toggle("b9");
    toggle("#9");
    toggle("#11");
    expect(queryTabButton("押さえ方")).toBeNull();
    expect(handButton().disabled).toBe(false);
  });

  it("1 番目に候補が無くても、ほかのコードに固定があれば手の位置のボタンは押せて、その固定のコードを選ぶ", () => {
    render(<App />);
    pin(2, 1);
    select(0);
    pick("種類", "7");
    toggle("b9");
    toggle("#9");
    toggle("#11");
    expect(queryTabButton("押さえ方")).toBeNull();
    expect(handButton().disabled).toBe(false);
    expect(handButton().textContent).toBe(`手の位置：第${shapesOf("F")[1]!.lowestFret}ポジション`);
    fireEvent.click(handButton());
    expect(pressedIndex()).toBe(2);
    expect(pressedTab()).toBe("押さえ方");
  });

  it("2 番目のコードで形を選ぶと、その図が選んだ形になり、固定していない前後は pins つきの最適化と同じに選び直される", () => {
    render(<App />);
    const index = lastIndex("Am");
    pin(1, index);
    expect(cardPressed()[index]).toBe("true");
    expect(autoButton().getAttribute("aria-pressed")).toBe("false");
    expect(resultLabels()[1]).toBe(voicingLabel("Am", shapesOf("Am")[index]!.voicing));
    expect(resultLabels()).toEqual(expectedLabels(INITIAL, { 1: index }));
    expect(resultLabels()).not.toEqual(expectedLabels(INITIAL));
    expect(alert()).toBeNull();
  });

  it("1 番目と 3 番目のように複数のコードを固定でき、どちらも保たれる", () => {
    render(<App />);
    pin(0, 3);
    pin(2, 0);
    expect(resultLabels()).toEqual(expectedLabels(INITIAL, { 0: 3, 2: 0 }));
    expect(pinMarks()).toEqual([0, 2]);
    select(0);
    expect(cardPressed()[3]).toBe("true");
    select(2);
    expect(cardPressed()[0]).toBe("true");
  });

  it("固定したカードにだけ「固定」の印が出て、「おまかせ」で解除するとそのコードの印だけ消え、ほかの固定は残る", () => {
    render(<App />);
    expect(pinMarks()).toEqual([]);
    pin(1, 2);
    pin(3, 0);
    expect(pinMarks()).toEqual([1, 3]);
    expect(document.querySelectorAll(".steps > .step")[1]!.textContent).toContain("固定");
    expect(document.querySelectorAll(".steps > .step")[0]!.textContent).not.toContain("固定");
    fireEvent.click(autoButton());
    expect(pinMarks()).toEqual([1]);
    expect(autoButton().getAttribute("aria-pressed")).toBe("true");
    expect(cardPressed().every((pressed) => pressed === "false")).toBe(true);
    expect(resultLabels()).toEqual(expectedLabels(INITIAL, { 1: 2 }));
  });

  it("選ぶコードを変えると、「押さえ方」の押された状態はそのコードの固定を表す", () => {
    render(<App />);
    pin(1, 2);
    select(2);
    expect(autoButton().getAttribute("aria-pressed")).toBe("true");
    expect(cardPressed().every((pressed) => pressed === "false")).toBe(true);
    select(1);
    expect(autoButton().getAttribute("aria-pressed")).toBe("false");
    expect(cardPressed()[2]).toBe("true");
  });

  it("固定したコードの記号を変えると、そのコードの固定だけ外れ、固定していないコードの編集では固定が保たれる", () => {
    render(<App />);
    pin(0, 3);
    pin(1, 2);
    select(2);
    pick("種類", "m");
    expect(pinMarks()).toEqual([0, 1]);
    select(1);
    pick("種類", "m7");
    expect(chordSymbols()[1]).toBe("Am7");
    expect(pinMarks()).toEqual([0]);
    expect(alert()).toBeNull();
    expect(resultLabels()).toEqual(expectedLabels(["C", "Am7", "Fm", "G7"], { 0: 3 }));
  });

  it("先頭の記号を変えても、ほかのコードの固定は残る", () => {
    render(<App />);
    pin(0, 3);
    pin(2, 0);
    select(0);
    pick("根音の音名", "D");
    expect(pinMarks()).toEqual([2]);
    expect(resultLabels()).toEqual(expectedLabels(["D", "Am", "F", "G7"], { 2: 0 }));
  });

  it("コードを削除すると、後ろの固定の位置が 1 つ詰まって固定したコードに付いたまま動き、削除したコード自身の固定は消える", () => {
    render(<App />);
    pin(0, 3);
    pin(2, 1);
    remove(2);
    expect(chordSymbols()).toEqual(["C", "F", "G7"]);
    expect(pinMarks()).toEqual([0, 1]);
    expect(resultLabels()).toEqual(expectedLabels(["C", "F", "G7"], { 0: 3, 1: 1 }));
    remove(2);
    expect(chordSymbols()).toEqual(["C", "G7"]);
    expect(pinMarks()).toEqual([0]);
    expect(alert()).toBeNull();
  });

  it("先頭を削除すると先頭の固定が消え、後ろの固定は 1 つ前に詰まる", () => {
    render(<App />);
    pin(0, 3);
    pin(2, 1);
    remove(1);
    expect(chordSymbols()).toEqual(["Am", "F", "G7"]);
    expect(pinMarks()).toEqual([1]);
    expect(resultLabels()).toEqual(expectedLabels(["Am", "F", "G7"], { 1: 1 }));
  });

  it("カポを変えると、すべての固定が外れ、失敗の文は出ない", () => {
    render(<App />);
    pin(0, 3);
    pin(2, 1);
    fireEvent.change(screen.getByRole("combobox", { name: "カポ" }), { target: { value: "3" } });
    expect(pinMarks()).toEqual([]);
    expect(alert()).toBeNull();
    expect(resultLabels()).toEqual(expectedLabels(["A", "F#m", "D", "E7"]));
  });

  it("コードを末尾に足しても、固定は変わらない", () => {
    render(<App />);
    pin(1, 2);
    add();
    expect(pinMarks()).toEqual([1]);
    expect(resultLabels()).toEqual(expectedLabels([...INITIAL, "C"], { 1: 2 }));
  });

  describe("手の位置のボタン", () => {
    it("固定が無ければ「おまかせ」、あれば進行の先頭に最も近い固定の最低フレットになる", () => {
      render(<App />);
      expect(handButton().textContent).toBe("手の位置：おまかせ");
      pin(2, 1);
      expect(handButton().textContent).toBe(`手の位置：第${shapesOf("F")[1]!.lowestFret}ポジション`);
      pin(3, 0);
      expect(handButton().textContent).toBe(`手の位置：第${shapesOf("F")[1]!.lowestFret}ポジション`);
      pin(0, 3);
      expect(handButton().textContent).toBe(`手の位置：第${shapesOf("C")[3]!.lowestFret}ポジション`);
    });

    it("押すと、最も前の固定のコード（固定が無ければ 1 番目）を選び、閉じていてもパネルを開いて「押さえ方」タブを出す", () => {
      render(<App />);
      pin(3, 0);
      pin(2, 1);
      select(0);
      closePanel();
      fireEvent.click(handButton());
      expect(pressedIndex()).toBe(2);
      expect(pressedTab()).toBe("押さえ方");
      fireEvent.click(autoButton()); // 3 番目の固定を外す
      fireEvent.click(handButton());
      expect(pressedIndex()).toBe(3);
      fireEvent.click(autoButton()); // 固定が無くなる
      showTab("コード");
      fireEvent.click(handButton());
      expect(pressedIndex()).toBe(0);
      expect(pressedTab()).toBe("押さえ方");
    });
  });
});

describe("印刷とコピー", () => {
  const INITIAL_TEXT = ["手の位置：おまかせ", "1. C  x32010", "2. Am  x02210", "3. F  133211", "4. G7  320001"].join("\n");
  const copyButton = () => screen.getByRole("button", { name: "テキストでコピー" }) as HTMLButtonElement;
  const printButton = () => screen.getByRole("button", { name: "印刷" }) as HTMLButtonElement;
  const status = () => screen.getByRole("status").textContent;
  const setClipboard = (clipboard: unknown) =>
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  const click = async (button: HTMLElement) => {
    fireEvent.click(button);
    await act(async () => {});
  };

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("「テキストでコピー」で、押さえ方の一覧がクリップボードに入り、成功の文が出る", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<App />);
    expect(status()).toBe("");
    await click(copyButton());
    expect(writeText).toHaveBeenCalledWith(INITIAL_TEXT);
    expect(status()).toBe("コピーしました");
  });

  it("クリップボードへの書き込みが失敗したら、失敗の文が出る", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    render(<App />);
    await click(copyButton());
    expect(status()).toBe("コピーできませんでした");
  });

  it("クリップボードが使えない環境でも、落ちずに失敗の文が出る", async () => {
    render(<App />);
    await click(copyButton());
    expect(status()).toBe("コピーできませんでした");
  });

  it("コードを足すと、前のコピーの結果の文は消える", async () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    render(<App />);
    await click(copyButton());
    expect(status()).toBe("コピーしました");
    fireEvent.click(screen.getByRole("button", { name: "＋ コードを追加" }));
    expect(status()).toBe("");
  });

  it("手の位置を選び直すと、前のコピーの結果の文は消える", async () => {
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    render(<App />);
    await click(copyButton());
    expect(status()).toBe("コピーしました");
    fireEvent.click(cardButton(1));
    expect(status()).toBe("");
  });

  it("固定したコードがあるとき、コピーの「手の位置：」の行は固定のうち最も前のコードの最低フレットで、「固定」の文字は出ない", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<App />);
    select(2);
    fireEvent.click(cardButton(1));
    await click(copyButton());
    const result = optimizeSymbols(INITIAL, { pins: new Map([[2, shapesOf("F")[1]!.voicing]]) });
    if (!result.ok) throw new Error("optimize");
    const expected = [
      `手の位置：第${shapesOf("F")[1]!.lowestFret}ポジション`,
      ...result.steps.map((s, i) => `${i + 1}. ${INITIAL[i]}  ${voicingFrets(s.voicing)}`),
    ].join("\n");
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(writeText.mock.calls[0]![0]).not.toContain("固定");
  });

  it("「印刷」で window.print が呼ばれる", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<App />);
    fireEvent.click(printButton());
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("進行が失敗しているときは、2つのボタンが押せない。直すと押せる", () => {
    render(<App />);
    expect(printButton().disabled).toBe(false);
    expect(copyButton().disabled).toBe(false);
    pick("種類", "7");
    toggle("b9");
    toggle("#9");
    toggle("#11");
    expect(alert()).not.toBeNull();
    expect(printButton().disabled).toBe(true);
    expect(copyButton().disabled).toBe(true);
    toggle("#11");
    expect(printButton().disabled).toBe(false);
    expect(copyButton().disabled).toBe(false);
  });
});

describe("カポ", () => {
  const capoSelect = () => screen.getByRole("combobox", { name: "カポ" }) as HTMLSelectElement;
  const setCapo = (n: number) => fireEvent.change(capoSelect(), { target: { value: String(n) } });
  const capoNote = (n: number) => screen.queryByText(`カポ${n}`);
  const shapeNotes = () => Array.from(document.querySelectorAll(".step-shape")).map((e) => e.textContent);
  /** B♭ E♭ F B♭ にする（初期の C Am F G7 の 1・2・4 番目を変える）。 */
  const toBbEbFBb = () => {
    select(0);
    pick("根音の変化記号", "♭");
    pick("根音の音名", "B");
    select(1);
    pick("根音の変化記号", "♭");
    pick("根音の音名", "E");
    pick("種類", "M");
    select(3);
    pick("根音の変化記号", "♭");
    pick("根音の音名", "B");
    pick("種類", "M");
    expect(chordSymbols()).toEqual(["Bb", "Eb", "F", "Bb"]);
  };
  const SHAPE_SYMBOLS = ["G", "C", "D", "G"];

  it("ヘッダーに「カポ」の選択欄があり、選択肢は「なし」と 1〜7、初めは「なし」", () => {
    render(<App />);
    const header = document.querySelector("header")!;
    expect(within(header).getByRole("combobox", { name: "カポ" })).toBe(capoSelect());
    expect(Array.from(capoSelect().options).map((o) => o.textContent)).toEqual(["なし", "1", "2", "3", "4", "5", "6", "7"]);
    expect(capoSelect().selectedOptions[0]!.textContent).toBe("なし");
  });

  it("カポなしのとき、「〜の形」も「カポN」の行も出ない", () => {
    render(<App />);
    expect(shapeNotes()).toEqual([]);
    expect(screen.queryByText(/^カポ\d$/)).toBeNull();
    setCapo(3);
    expect(capoNote(3)).not.toBeNull();
    setCapo(0);
    expect(shapeNotes()).toEqual([]);
    expect(screen.queryByText(/^カポ\d$/)).toBeNull();
  });

  it("カポなしでは、D♭ のようなつづりも変わらない（図の読み上げ名・押さえ方の候補の図も D♭ のまま）", () => {
    render(<App />);
    pick("根音の変化記号", "♭");
    pick("根音の音名", "D");
    expect(chordSymbols()[0]).toBe("Db");
    expect(resultLabels()[0]).toMatch(/^D♭: /);
    cards();
    const picker = within(screen.getByRole("group", { name: PICKER }));
    expect(picker.getAllByRole("img").every((img) => img.getAttribute("aria-label")?.startsWith("D♭: "))).toBe(true);
  });

  it("カポ3で B♭ E♭ F B♭ にすると、押さえ方は G C D G のおまかせと同じで、カードは鳴らす名前のまま「Gの形」などが出る。図の読み上げ名は形の記号", () => {
    render(<App />);
    toBbEbFBb();
    setCapo(3);
    expect(resultLabels()).toEqual(expectedLabels(SHAPE_SYMBOLS));
    expect(resultLabels().map((l) => l?.split(":")[0])).toEqual(["G", "C", "D", "G"]);
    expect(chordTexts()).toEqual(["B♭", "E♭", "F", "B♭"]);
    expect(chordSymbols()).toEqual(["Bb", "Eb", "F", "Bb"]);
    expect(shapeNotes()).toEqual(["Gの形", "Cの形", "Dの形", "Gの形"]);
  });

  it("カポありのとき、譜面の領域に「カポ3」の行が 1 つだけ出る", () => {
    render(<App />);
    setCapo(3);
    const region = screen.getByRole("region", { name: "進行の押さえ方" });
    expect(within(region).getAllByText("カポ3")).toHaveLength(1);
    setCapo(5);
    expect(capoNote(3)).toBeNull();
    expect(within(region).getAllByText("カポ5")).toHaveLength(1);
  });

  it("押さえ方の候補・手の位置・ルートの印は形の記号で作る（カポ3＋先頭 B♭ → G の候補と同じ数、ルートの印は G の弦）", () => {
    render(<App />);
    toBbEbFBb();
    setCapo(3);
    select(0);
    const shapes = shapesOf("G");
    expect(cards()).toHaveLength(shapes.length);
    fireEvent.click(within(cards()[1]!).getByRole("button", { name: `第${shapes[1]!.lowestFret}ポジション` }));
    expect(handButton().textContent).toBe(`手の位置：第${shapes[1]!.lowestFret}ポジション`);
    expect(resultLabels()).toEqual(expectedLabels(SHAPE_SYMBOLS, { 0: 1 }));
    const first = diagrams()[0]!;
    const rootMarks = Array.from(first.querySelectorAll('[data-root="true"][data-string]')).map((e) => Number(e.getAttribute("data-string")));
    expect([...new Set(rootMarks)].sort()).toEqual([...rootStrings("G", shapes[1]!.voicing)].sort());
  });

  it("押さえ方を選んだあとでカポを変えると「おまかせ」に戻り、失敗の文は出ない", () => {
    render(<App />);
    fireEvent.click(cardButton(1));
    expect(cardPressed()[1]).toBe("true");
    setCapo(3);
    expect(alert()).toBeNull();
    expect(autoButton().getAttribute("aria-pressed")).toBe("true");
    expect(resultLabels()).toEqual(expectedLabels(["A", "F#m", "D", "E7"]));
  });

  it("カポ7でも、押さえ方が全コードに出る", () => {
    render(<App />);
    setCapo(7);
    expect(alert()).toBeNull();
    expect(diagrams()).toHaveLength(4);
    expect(resultLabels()).toEqual(expectedLabels(["F", "Dm", "Bb", "C7"]));
  });

  it("カポの数は保存しない（描画し直すと「なし」に戻る）", () => {
    const { unmount } = render(<App />);
    setCapo(4);
    unmount();
    render(<App />);
    expect(capoSelect().value).toBe("0");
  });

  it("コピーは、カポありのとき先頭に「カポ：3」、各行の記号の後に「（Gの形）」が付く。カポを変えると前のコピー結果の文は消える", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      render(<App />);
      toBbEbFBb();
      setCapo(3);
      fireEvent.click(screen.getByRole("button", { name: "テキストでコピー" }));
      await act(async () => {});
      const result = optimizeSymbols(SHAPE_SYMBOLS);
      if (!result.ok) throw new Error("optimize");
      const names = ["B♭", "E♭", "F", "B♭"];
      expect(writeText).toHaveBeenCalledWith(
        [
          "カポ：3",
          "手の位置：おまかせ",
          ...result.steps.map((s, i) => `${i + 1}. ${names[i]} （${SHAPE_SYMBOLS[i]}の形）  ${voicingFrets(s.voicing)}`),
        ].join("\n"),
      );
      expect(screen.getByRole("status").textContent).toBe("コピーしました");
      setCapo(2);
      expect(screen.getByRole("status").textContent).toBe("");
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });
});
