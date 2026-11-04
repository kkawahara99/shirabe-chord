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
const autoButton = () => screen.getByRole("button", { name: AUTO });
const cards = () => within(screen.getByRole("group", { name: PICKER })).getAllByRole("listitem");
const cardButton = (i: number) => within(cards()[i]!).getByRole("button", { name: "この押さえ方にする" });
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

const group = (name: string) => screen.getByRole("group", { name });
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

  it("最初のコードの下に、最低フレットごとの図が listShapesByLowestFret と同じ数だけ並び、各カードに「Nフレット付近」と「この押さえ方にする」がある", () => {
    render(<App />);
    const shapes = firstShapes("C");
    expect(cards()).toHaveLength(shapes.length);
    cards().forEach((card, i) => {
      expect(within(card).getByText(`${shapes[i]!.lowestFret}フレット付近`)).toBeTruthy();
      expect(within(card).getAllByRole("img")).toHaveLength(1);
      expect(cardButton(i)).toBeTruthy();
    });
  });

  it("候補の図の並びはラベル付きの領域に入り、「←」「→」ボタンは 1 枚ぶんスクロールするだけで、選択を変えない", () => {
    render(<App />);
    const scroller = screen.getByRole("group", { name: PICKER });
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;
    const left = screen.getByRole("button", { name: "前の押さえ方へスクロール" });
    const right = screen.getByRole("button", { name: "次の押さえ方へスクロール" });
    expect(left.textContent).toBe("←");
    expect(right.textContent).toBe("→");
    fireEvent.click(right);
    fireEvent.click(left);
    expect(scrollBy).toHaveBeenCalledTimes(2);
    expect(autoButton().getAttribute("aria-pressed")).toBe("true");
    expect(cardPressed().every((pressed) => pressed === "false")).toBe(true);
  });

  it("最初のコードに押さえ方が無いとき、位置ごとの図の部品（おまかせ・候補）は出ない", () => {
    render(<App />);
    pick("種類", "7");
    toggle("b9");
    toggle("#9");
    toggle("#11");
    expect(within(screen.getByRole("region", { name: "進行の押さえ方" })).getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("group", { name: PICKER })).toBeNull();
    expect(screen.queryByRole("button", { name: AUTO })).toBeNull();
  });

  it("初めは「おまかせ」だけが押された状態で、結果は選択なしの最適化と同じ", () => {
    render(<App />);
    expect(autoButton().getAttribute("aria-pressed")).toBe("true");
    expect(cardPressed().every((pressed) => pressed === "false")).toBe(true);
    expect(resultLabels()).toEqual(expectedLabels(INITIAL));
  });

  it("カードの「この押さえ方にする」を押すと、そのボタンだけ押された状態になり、最初の図がその押さえ方になり、続く図が再計算される", () => {
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
