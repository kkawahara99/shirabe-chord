import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import type { AuthConfig } from "./auth-config.ts";
import { storeToken } from "./login.ts";
import styleCss from "./style.css?raw";

const hasIcon = (element: HTMLElement) => element.querySelector('svg[aria-hidden="true"]') !== null;

describe("App（操作ボタンのアイコン）", () => {
  it("印刷・閉じるは、文字の前に図が付き、名前は変わらない", () => {
    render(<App />);
    for (const name of ["印刷", "閉じる"]) {
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

const CONFIG: AuthConfig = {
  cognitoDomain: "https://example.auth.ap-northeast-1.amazoncognito.com",
  clientId: "client-id",
  turnstileSiteKey: "site-key",
};

describe("App（共有のアイコン）", () => {
  it("「共有する」は、文字の前に図が付き、名前は変わらない", () => {
    render(<App config={CONFIG} />);
    const button = screen.getByRole("button", { name: "共有する" });
    expect(button.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(hasIcon(button)).toBe(true);
    expect(button.textContent).toBe("共有する");
  });
});

const ID = "AbCdEfGhIjKlMnOpQrSt-_";
const iconFirst = (button: HTMLElement, name: string) => {
  expect(button.firstElementChild?.tagName.toLowerCase()).toBe("svg");
  expect(button.textContent).toBe(name);
};

describe("共有の画面（アイコンと、確定・削除の色）", () => {
  beforeEach(() => {
    sessionStorage.clear();
    storeToken(sessionStorage, "token");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, "turnstile");
    window.history.replaceState(null, "", "/");
  });

  it("共有ダイアログ：「この内容で共有する」は確定の色、「閉じる」は色なし。どちらも図が先頭に付き、名前は変わらない", () => {
    window.turnstile = { render: vi.fn(() => "w"), reset: vi.fn(), remove: vi.fn() };
    render(<App config={CONFIG} />);
    fireEvent.click(screen.getByRole("button", { name: "共有する" }));
    const dialog = within(screen.getByRole("dialog"));
    const submit = dialog.getByRole("button", { name: "この内容で共有する" });
    const close = dialog.getByRole("button", { name: "閉じる" });
    iconFirst(submit, "この内容で共有する");
    iconFirst(close, "閉じる");
    expect(submit.className).toBe("primary");
    expect(close.className).toBe("");
  });

  it("一覧：開く・URL をコピー・削除に図。削除は赤の枠、確認の「削除する」は赤の塗り、「やめる」は色なし", async () => {
    window.history.replaceState(null, "", "/mine");
    const summary = { id: ID, title: "朝の曲", createdAt: "2026-11-07T12:00:00.000Z", chordCount: 4 };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ shares: [summary] }), { status: 200 })));
    render(<App config={CONFIG} />);
    const item = within(await screen.findByRole("listitem"));
    iconFirst(item.getByRole("link", { name: "開く" }), "開く");
    iconFirst(item.getByRole("button", { name: "URL をコピー" }), "URL をコピー");
    const remove = item.getByRole("button", { name: "削除" });
    iconFirst(remove, "削除");
    expect(remove.className).toBe("danger-outline");

    fireEvent.click(remove);
    const confirm = item.getByRole("button", { name: "削除する" });
    const cancel = item.getByRole("button", { name: "やめる" });
    iconFirst(confirm, "削除する");
    iconFirst(cancel, "やめる");
    expect(confirm.className).toBe("danger");
    expect(cancel.className).toBe("");
    iconFirst(screen.getByRole("link", { name: "トップへ戻る" }), "トップへ戻る");
  });

  it("共有ページ：「この譜面を編集する」は確定の色で図が付き、「トップへ戻る」にも図が付く", async () => {
    window.history.replaceState(null, "", `/s/${ID}`);
    const score = { title: "朝の曲", note: "", displayName: "作曲者", capo: 0, chords: [{ symbol: "C", voicing: [null, 3, 2, 0, 1, 0] }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ score, createdAt: "2026-11-07T09:00:00.000Z" }), { status: 200 })));
    render(<App config={CONFIG} />);
    const edit = await screen.findByRole("button", { name: "この譜面を編集する" });
    iconFirst(edit, "この譜面を編集する");
    expect(edit.className).toBe("primary");
    iconFirst(screen.getByRole("link", { name: "トップへ戻る" }), "トップへ戻る");
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

  it("確定（primary）・削除（danger・danger-outline）の文字色は変数", () => {
    for (const [selector, color] of [
      ["button.primary", "--on-accent"],
      ["button.danger", "--on-danger"],
      ["button.danger-outline", "--danger"],
    ] as const) {
      const [element, className] = selector.split(".");
      // border-color に当たらないよう、color の直前は空白か ; か { に限る
      const rule = new RegExp(String.raw`\n${element}\.${className} \{[^}]*[;{\s]color:\s*var\(${color}\)`);
      expect(styleCss, selector).toMatch(rule);
    }
  });

  it("アイコンは文字色に従い、CSS に固定の色を持たない", () => {
    const block = styleCss.match(/(?:^|\n)\.icon \{([^}]*)\}/)?.[1] ?? "";
    expect(block).not.toBe("");
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|hsl/i);
  });
});
