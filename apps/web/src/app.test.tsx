import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";

const rawSources = import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const input = () => screen.getByLabelText("コード進行") as HTMLTextAreaElement;
const diagrams = () => screen.queryAllByRole("img");
const alert = () => screen.queryByRole("alert");

/** 入力を変えて、出し直しの待ち時間（300ms）が過ぎるまで進める。 */
function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("App（画面全体）", () => {
  it("入力欄に初期値 C Am F G7 が入っている", () => {
    render(<App />);
    expect(input().value).toBe("C Am F G7");
  });

  it("初期表示で図が 4 つ、入力順に並ぶ", () => {
    render(<App />);
    const labels = diagrams().map((d) => d.getAttribute("aria-label")?.split(":")[0]);
    expect(labels).toEqual(["C", "Am", "F", "G7"]);
    expect(alert()).toBeNull();
  });

  it("入力を変えても 300ms たつまでは結果が変わらず、たつと出し直す", () => {
    render(<App />);
    fireEvent.change(input(), { target: { value: "C" } });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(diagrams()).toHaveLength(4);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(diagrams()).toHaveLength(1);
  });

  it("入力が続くあいだは出し直さない（最後の入力から 300ms で数え直す）", () => {
    render(<App />);
    fireEvent.change(input(), { target: { value: "C" } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.change(input(), { target: { value: "C G" } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(diagrams()).toHaveLength(4); // 最初の入力から 400ms たっても、まだ
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(diagrams()).toHaveLength(2);
  });

  it("読めない記号があれば「2番目の記号 Xyz は読めない」と出て、図は出ない", () => {
    render(<App />);
    type("C Xyz");
    expect(alert()?.textContent).toMatch(/2番目の記号「Xyz」は読めません/);
    expect(diagrams()).toHaveLength(0);
  });

  it("押さえ方が無いコードは「押さえ方が見つかりません」と出る", () => {
    render(<App />);
    type("C C7(b9,#11)/F");
    expect(alert()?.textContent).toMatch(/2番目の記号「C7\(b9,#11\)\/F」は押さえ方が見つかりません/);
  });

  it("失敗が複数あれば全部出す", () => {
    render(<App />);
    type("Xyz C Qq");
    const items = within(alert()!).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toMatch(/1番目の記号「Xyz」/);
    expect(items[1]!.textContent).toMatch(/3番目の記号「Qq」/);
  });

  it.each([
    ["Xyz", /ルート/],
    ["Cxyz", /種類/],
    ["Cm7(b9,b9)", /重な/],
    ["C7(9,b9)", /矛盾/],
    ["Cm7(foo)", /テンション/],
    ["C/H", /ベース/],
  ])("読めない理由を日本語で出す（%s）", (symbol, reason) => {
    render(<App />);
    type(symbol);
    expect(alert()?.textContent).toMatch(reason);
  });

  it("数の上限: 65 個で「64個まで」、1001 文字で「1000文字まで」と出る", () => {
    render(<App />);
    type("C ".repeat(65));
    expect(alert()?.textContent).toMatch(/64個まで/);
    type("C".repeat(1001));
    expect(alert()?.textContent).toMatch(/1000文字まで/);
  });

  it("空（空白だけも含む）のときは、入力をうながす", () => {
    render(<App />);
    type("");
    expect(alert()?.textContent).toMatch(/入力してください/);
    type("  \n ");
    expect(alert()?.textContent).toMatch(/入力してください/);
    expect(diagrams()).toHaveLength(0);
  });

  it("失敗の表示のあとに入力を直すと、失敗の表示が消えて図が出る", () => {
    render(<App />);
    type("C Xyz");
    expect(alert()).not.toBeNull();
    type("C G");
    expect(alert()).toBeNull();
    expect(diagrams()).toHaveLength(2);
  });

  it("入力の文字は HTML として解釈されない", () => {
    const { container } = render(<App />);
    type("<b>x</b>");
    expect(alert()?.textContent).toContain("<b>x</b>");
    expect(container.querySelector("b")).toBeNull();
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
