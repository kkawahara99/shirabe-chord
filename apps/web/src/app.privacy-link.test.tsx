import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import type { AuthConfig } from "./auth-config.ts";
import styleCss from "./style.css?raw";

const CONFIG: AuthConfig = {
  cognitoDomain: "https://example.auth.ap-northeast-1.amazoncognito.com",
  clientId: "client-id",
  turnstileSiteKey: "site-key",
};
const ID = "AbCdEfGhIjKlMnOpQrSt-_";
const NAME = "プライバシーポリシー";

beforeEach(() => {
  sessionStorage.clear();
  // /mine と /s/<ID> が呼ぶ API。リンクの有無には関係しないので、失敗させておく
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

const at = (path: string) => window.history.replaceState(null, "", path);

describe("プライバシーポリシーへのリンク", () => {
  it("共有が設定されているとき、トップに「プライバシーポリシー」のリンクが出て、href は /privacy.html", () => {
    at("/");
    render(<App config={CONFIG} />);
    expect(screen.getByRole("link", { name: NAME }).getAttribute("href")).toBe("/privacy.html");
  });

  it("共有が設定されていない（config が空）とき、リンクは出ない", () => {
    at("/");
    render(<App config={null} />);
    expect(screen.queryByRole("link", { name: NAME })).toBeNull();
  });

  it.each([["/mine"], [`/s/${ID}`]])("%s にもリンクが出る", (path) => {
    at(path);
    render(<App config={CONFIG} />);
    expect(screen.getByRole("link", { name: NAME }).getAttribute("href")).toBe("/privacy.html");
  });

  it("リンクは画面の下端（アプリの最後の要素）にある", () => {
    at("/");
    render(<App config={CONFIG} />);
    const link = screen.getByRole("link", { name: NAME });
    expect(link.closest(".site-footer")).toBe(document.querySelector(".app")!.lastElementChild);
  });

  it("印刷では隠す（style.css の @media print で .site-footer が display: none）", () => {
    const start = styleCss.indexOf("@media print");
    const open = styleCss.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (; end < styleCss.length; end++) {
      if (styleCss[end] === "{") depth++;
      if (styleCss[end] === "}" && --depth === 0) break;
    }
    const print = styleCss.slice(open + 1, end);
    const hidden = print.match(/([^{}]+)\{\s*display:\s*none;?\s*\}/)?.[1] ?? "";
    expect(hidden.split(",").map((selector) => selector.trim())).toContain(".site-footer");
  });
});
