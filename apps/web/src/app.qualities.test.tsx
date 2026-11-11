import { CHORD_QUALITIES } from "@shirabe-chord/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./app.tsx";

const BASIC = ["", "m", "7", "M7", "m7"];
const names = CHORD_QUALITIES.map((q) => q.names[0]!);
/** 画面の名前（ラベル）。空文字は三和音の M、m7-5 は m7(♭5)。 */
const labelOf = (name: string) => (name === "" ? "M" : name === "m7-5" ? "m7(♭5)" : name);

const qualityGroup = () => screen.getByRole("group", { name: "種類" });
const radios = () => within(qualityGroup()).queryAllByRole("radio") as HTMLInputElement[];
const more = () => within(qualityGroup()).getByRole("button", { name: "ほかの種類" }) as HTMLButtonElement;
const titles = () => [...qualityGroup().querySelectorAll(".quality-group-title")].map((e) => e.textContent);
const radio = (name: string) => within(qualityGroup()).getByRole("radio", { name: labelOf(name) }) as HTMLInputElement;
const chooseQuality = (name: string) => fireEvent.click(radio(name));
const chordButton = (index: number) => document.querySelectorAll<HTMLButtonElement>(".step-select")[index]!;
const tab = (name: string) => within(screen.getByRole("group", { name: "編集の項目" })).getByRole("button", { name });
/** タブを替えて戻す。手で開いた状態を捨てて、選んでいる種類で決め直させる。 */
const reenterChordTab = () => {
  fireEvent.click(tab("テンション・ベース"));
  fireEvent.click(tab("コード"));
};

describe("App（種類の選択肢。基本だけ出して「…」で残りを開く）", () => {
  it("初めは基本の 5 個（M・m・7・M7・m7）だけで、見出しは「三和音」「7th」の 2 つ。「6・9・13 系」は無い", () => {
    render(<App />);
    expect(radios().map((r) => r.closest("label")!.textContent)).toEqual(["M", "m", "7", "M7", "m7"]);
    expect(titles()).toEqual(["三和音", "7th"]);
  });

  it("「ほかの種類」ボタンは種類の欄の末尾に 1 つ。押すと 20 個・見出し 3 つになり、aria-expanded が false から true になる", () => {
    render(<App />);
    expect(within(qualityGroup()).getAllByRole("button")).toHaveLength(1);
    expect(qualityGroup().lastElementChild).toBe(more());
    expect(more().textContent).toBe("…");
    expect(more().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more());
    expect(more().getAttribute("aria-expanded")).toBe("true");
    expect(radios()).toHaveLength(20);
    expect(titles()).toEqual(["三和音", "7th", "6・9・13 系"]);
  });

  it("手で開いたあと、もう一度押すと閉じる", () => {
    render(<App />);
    fireEvent.click(more());
    fireEvent.click(more());
    expect(radios()).toHaveLength(5);
    expect(more().getAttribute("aria-expanded")).toBe("false");
  });

  it("1 番目のコードを選んだまま削除して次のコードに替わると、手で開いた状態は引き継がれない", () => {
    render(<App />);
    fireEvent.click(more());
    fireEvent.click(screen.getByRole("button", { name: "1番目のコードを削除" }));
    expect(radios()).toHaveLength(5);
  });

  // 全種類を 1 つずつ（1 件を 5 秒以内に収めるため、種類ごとのテストにする）
  it.each(names.map((name) => [labelOf(name), name]))("種類「%s」を選んだ状態で、隠れ側なら最初から開いて「…」は押せず、基本側なら閉じて「…」は押せる", (_label, name) => {
    render(<App />);
    fireEvent.click(more()); // 隠れ側を選ぶために、手で開く
    chooseQuality(name);
    reenterChordTab(); // 手で開いた状態を捨てる
    const hidden = !BASIC.includes(name);
    expect(more().disabled).toBe(hidden);
    expect(more().getAttribute("aria-expanded")).toBe(String(hidden));
    expect(radios()).toHaveLength(hidden ? 20 : 5);
    expect(radio(name).checked).toBe(true);
  });

  it("隠れ側を選んでいる間は開いたまま。基本の種類へ移ると、手で開いていなければ閉じる", () => {
    render(<App />);
    fireEvent.click(more());
    chooseQuality("sus4");
    reenterChordTab();
    expect(radios()).toHaveLength(20);
    chooseQuality("m");
    expect(radios()).toHaveLength(5);
    expect(more().disabled).toBe(false);
  });

  it("手で開いていれば、基本の種類へ移っても開いたまま", () => {
    render(<App />);
    fireEvent.click(more());
    chooseQuality("sus4");
    chooseQuality("m");
    expect(radios()).toHaveLength(20);
    expect(more().getAttribute("aria-expanded")).toBe("true");
  });

  it("「編集するコード」を替えると、手で開いた状態は引き継がれず、選んでいる種類で決め直される", () => {
    render(<App />);
    fireEvent.click(more());
    fireEvent.click(chordButton(1)); // Am（基本）
    expect(radios()).toHaveLength(5);
    fireEvent.click(chordButton(0));
    fireEvent.click(more());
    chooseQuality("add9");
    fireEvent.click(chordButton(1));
    expect(radios()).toHaveLength(5);
    fireEvent.click(chordButton(0)); // 隠れ側の種類のコードに戻ると、最初から開いている
    expect(radios()).toHaveLength(20);
    expect(more().disabled).toBe(true);
  });

  it("タブを替えて戻すと、手で開いた状態は引き継がれない", () => {
    render(<App />);
    fireEvent.click(more());
    reenterChordTab();
    expect(radios()).toHaveLength(5);
    expect(more().getAttribute("aria-expanded")).toBe("false");
  });
});
