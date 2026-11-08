import { afterEach, describe, expect, it } from "vitest";
import { loadTurnstile, TURNSTILE_SCRIPT_URL, type TurnstileApi } from "./turnstile.ts";

const fakeApi = (): TurnstileApi => ({ render: () => "w", reset: () => {}, remove: () => {} });
const scripts = () => Array.from(document.querySelectorAll<HTMLScriptElement>("script"));

afterEach(() => {
  for (const script of scripts()) script.remove();
  Reflect.deleteProperty(window, "turnstile");
});

describe("loadTurnstile", () => {
  it("すでに読み込み済みなら、スクリプトを足さずにそれを返す", async () => {
    const api = fakeApi();
    window.turnstile = api;
    expect(await loadTurnstile()).toBe(api);
    expect(scripts()).toHaveLength(0);
  });

  it("まだなら Cloudflare のスクリプトを足し、読み込めたら使える", async () => {
    const pending = loadTurnstile();
    const [script] = scripts();
    expect(script?.src).toBe(TURNSTILE_SCRIPT_URL);
    const api = fakeApi();
    window.turnstile = api;
    script!.dispatchEvent(new Event("load"));
    expect(await pending).toBe(api);
  });

  it("読み込み中にもう一度呼んでも、スクリプトは 1 つだけ", async () => {
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(scripts()).toHaveLength(1);
    window.turnstile = fakeApi();
    scripts()[0]!.dispatchEvent(new Event("load"));
    expect(await first).toBe(await second);
  });

  it("読み込めなければ失敗し、スクリプトを外す。次の呼び出しでやり直せる", async () => {
    const failing = loadTurnstile();
    scripts()[0]!.dispatchEvent(new Event("error"));
    await expect(failing).rejects.toThrow();
    expect(scripts()).toHaveLength(0);

    const retry = loadTurnstile();
    expect(scripts()).toHaveLength(1);
    window.turnstile = fakeApi();
    scripts()[0]!.dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBeTruthy();
  });

  it("読み込みが終わったのに部品が使えないときは失敗する", async () => {
    const pending = loadTurnstile();
    scripts()[0]!.dispatchEvent(new Event("load"));
    await expect(pending).rejects.toThrow();
  });
});
