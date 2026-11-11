import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import css from "./style.css?raw";
import { readTheme, THEME_KEY } from "./theme.ts";

const htmlTheme = () => document.documentElement.getAttribute("data-theme");
const systemDark = (dark: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: dark && query.includes("dark"), media: query }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
});

describe("ライト／ダークの切り替え", () => {
  it("選んでいなければ、OS が明るいとき「ダークにする」、暗いとき「ライトにする」を出し、data-theme は付けない", () => {
    systemDark(false);
    const first = render(<App />);
    expect(screen.getByRole("button", { name: "ダークにする" })).toBeTruthy();
    expect(htmlTheme()).toBeNull();
    first.unmount();

    systemDark(true);
    render(<App />);
    expect(screen.getByRole("button", { name: "ライトにする" })).toBeTruthy();
    expect(htmlTheme()).toBeNull();
  });

  it("選んでいない間は、開いたまま OS が暗くなると、ボタンが「ライトにする」に変わる。選んだあとは OS に追従しない", () => {
    let handler: (() => void) | undefined;
    let dark = false;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return dark && query.includes("dark");
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => (handler = listener),
      removeEventListener: () => {},
    }));
    render(<App />);
    expect(screen.getByRole("button", { name: "ダークにする" })).toBeTruthy();
    dark = true;
    act(() => handler!());
    expect(screen.getByRole("button", { name: "ライトにする" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "ライトにする" })); // 選ぶ（ライト）
    dark = false;
    act(() => handler!());
    expect(screen.getByRole("button", { name: "ダークにする" })).toBeTruthy(); // ライトを選んだままなので、次はダーク
    expect(htmlTheme()).toBe("light");
  });

  it("OS が明るいとき押すとダークになり、覚える。もう一度押すとライトに戻る", () => {
    systemDark(false);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "ダークにする" }));
    expect(htmlTheme()).toBe("dark");
    expect(readTheme(localStorage)).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "ライトにする" }));
    expect(htmlTheme()).toBe("light");
    expect(readTheme(localStorage)).toBe("light");
  });

  it("OS が暗いとき押すと、OS に逆らってライトになる", () => {
    systemDark(true);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "ライトにする" }));
    expect(htmlTheme()).toBe("light");
  });

  it("覚えた配色で始まる（OS と逆でも）。壊れた値は無視して OS に従う", () => {
    systemDark(false);
    localStorage.setItem(THEME_KEY, "dark");
    const first = render(<App />);
    expect(htmlTheme()).toBe("dark");
    expect(screen.getByRole("button", { name: "ライトにする" })).toBeTruthy();
    first.unmount();

    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem(THEME_KEY, "<script>");
    render(<App />);
    expect(htmlTheme()).toBeNull();
    expect(screen.getByRole("button", { name: "ダークにする" })).toBeTruthy();
  });

  it("localStorage に触れなくても（プライベートウィンドウなど）、切り替えられる", () => {
    systemDark(false);
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "ダークにする" }));
    expect(htmlTheme()).toBe("dark");
  });

  it("印刷では隠す（アイコン付きボタンの display に負けないよう、種類まで書く）", () => {
    const print = css.slice(css.indexOf("@media print"));
    const hidden = print.match(/([^{}]+)\{\s*display:\s*none;?\s*\}/)?.[1] ?? "";
    expect(hidden.split(",").map((selector) => selector.replace(/\/\*.*?\*\//g, "").trim())).toContain("button.theme-toggle");
  });

  it("ボタンは図だけで、名前は aria-label", () => {
    render(<App />);
    const button = screen.getByRole("button", { name: /にする$/ });
    expect(button.textContent).toBe("");
    expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});
