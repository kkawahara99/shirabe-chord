import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";

// 確かめるのは追加ボタンの押せる・押せないだけ。64 個のコードの最適化は進行が変わるたびに走って重い（5 秒を超える）ので、
// 軽いものに差し替える。差し替えはファイル全体に効くので、ほかのテストと分けてこのファイルに置く。
vi.mock("@shirabe-chord/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shirabe-chord/core")>()),
  optimizeSymbols: () => ({ ok: true, steps: [] }),
}));

describe("App（コードの個数の上限）", () => {
  it("コードが 64 個のとき追加ボタンは押せず、63 個以下なら押せる", () => {
    render(<App />);
    const chordButtons = () =>
      within(screen.getByRole("list", { name: "コード進行" }))
        .getAllByRole("button")
        .filter((button) => button.hasAttribute("aria-pressed"));
    const addButton = screen.getByRole("button", { name: "コードを追加" }) as HTMLButtonElement;
    for (let i = 0; i < 60; i++) fireEvent.click(addButton);
    expect(chordButtons()).toHaveLength(64);
    expect(addButton.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "64番目のコードを削除" }));
    expect(addButton.disabled).toBe(false);
  });
});
