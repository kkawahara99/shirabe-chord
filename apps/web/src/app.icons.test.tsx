import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./app.tsx";
import styleCss from "./style.css?raw";

const hasIcon = (element: HTMLElement) => element.querySelector('svg[aria-hidden="true"]') !== null;

describe("App（操作ボタンのアイコン）", () => {
  it("印刷・テキストでコピー・閉じるは、文字の前に図が付き、名前は変わらない", () => {
    render(<App />);
    for (const name of ["印刷", "テキストでコピー", "閉じる"]) {
      const button = screen.getByRole("button", { name });
      expect(hasIcon(button)).toBe(true);
      expect(button.firstElementChild?.tagName.toLowerCase()).toBe("svg");
      expect(button.textContent).toBe(name);
    }
  });

  it("「コードを追加」は図が付き、＋ の文字が残らない", () => {
    render(<App />);
    const button = screen.getByRole("button", { name: "コードを追加" });
    expect(hasIcon(button)).toBe(true);
    expect(button.textContent).toBe("コードを追加");
    expect(button.textContent).not.toContain("＋");
  });

  it("コードの削除は図だけで、名前は「N番目のコードを削除」。× の文字が残らない", () => {
    render(<App />);
    const button = screen.getByRole("button", { name: "1番目のコードを削除" });
    expect(hasIcon(button)).toBe(true);
    expect(button.textContent).toBe("");
  });

  it("印刷では削除のボタンを隠す（アイコン付きボタンの display に負けない）", () => {
    const start = styleCss.indexOf("@media print");
    const print = styleCss.slice(start);
    const hidden = print.match(/([^{}]+)\{\s*display:\s*none;?\s*\}/)?.[1] ?? "";
    expect(hidden.split(",").map((selector) => selector.replace(/\/\*.*?\*\//g, "").trim())).toContain("button.step-remove");
  });

  it("画面のどのボタンにも × ＋ の文字が残らない", () => {
    render(<App />);
    for (const button of screen.getAllByRole("button")) expect(button.textContent).not.toMatch(/[×＋]/);
  });

  it("共通の図が無いボタン（編集を開く・編集の項目など）には図を付けない", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(hasIcon(screen.getByRole("button", { name: "編集を開く" }))).toBe(false);
    expect(hasIcon(document.querySelector<HTMLElement>(".hand-button")!)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "編集を開く" }));
    for (const tab of within(screen.getByRole("group", { name: "編集の項目" })).getAllByRole("button")) {
      expect(hasIcon(tab)).toBe(false);
    }
  });
});

describe("style.css（アイコン）", () => {
  it("button は min-width・min-height が 2rem 以上", () => {
    const block = styleCss.match(/(?:^|\n)button \{([^}]*)\}/)![1]!;
    for (const property of ["min-width", "min-height"]) {
      const rem = Number(new RegExp(String.raw`${property}:\s*([\d.]+)rem`).exec(block)?.[1]);
      expect(rem).toBeGreaterThanOrEqual(2);
    }
  });

  it("アイコンは文字色に従い、CSS に固定の色を持たない", () => {
    const block = styleCss.match(/(?:^|\n)\.icon \{([^}]*)\}/)?.[1] ?? "";
    expect(block).not.toBe("");
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl/i);
  });
});
