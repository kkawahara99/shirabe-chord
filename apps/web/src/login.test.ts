import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "./auth-config.ts";
import {
  beginLogin,
  challengeOf,
  clearToken,
  completeLogin,
  getToken,
  logoutUrl,
  parseLoginReturn,
  type LoginReturn,
} from "./login.ts";

const CONFIG: AuthConfig = {
  cognitoDomain: "https://example.auth.ap-northeast-1.amazoncognito.com",
  clientId: "client-id",
  turnstileSiteKey: "site-key",
};
const ORIGIN = "https://shirabe.example.test";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

/** 認可 URL に付いた state を取り出す。 */
const stateOf = (url: string) => new URL(url).searchParams.get("state")!;
const tokenResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const codeReturn = (state: string, code = "auth-code"): Extract<LoginReturn, { kind: "code" }> => ({ kind: "code", code, state });

describe("beginLogin", () => {
  it("認可 URL に client_id・redirect_uri・response_type=code・scope=openid・state・code_challenge（S256）・identity_provider=Google が付く", async () => {
    const url = new URL(await beginLogin(CONFIG, sessionStorage, ORIGIN));
    expect(url.origin).toBe(CONFIG.cognitoDomain);
    expect(url.pathname).toBe("/oauth2/authorize");
    const params = url.searchParams;
    expect(params.get("client_id")).toBe("client-id");
    expect(params.get("redirect_uri")).toBe(`${ORIGIN}/`);
    expect(params.get("response_type")).toBe("code");
    expect(params.get("scope")).toBe("openid");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("identity_provider")).toBe("Google");
    expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("state と verifier は毎回違う十分長い乱数", async () => {
    const urls = await Promise.all([1, 2, 3].map(() => beginLogin(CONFIG, sessionStorage, ORIGIN)));
    expect(new Set(urls.map(stateOf)).size).toBe(3);
    expect(new Set(urls.map((u) => new URL(u).searchParams.get("code_challenge"))).size).toBe(3);
  });
});

describe("challengeOf", () => {
  it("verifier の SHA-256 を base64url にしたものを返す（RFC 7636 の例）", async () => {
    expect(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("parseLoginReturn", () => {
  it("code と state があれば code の戻りとして読む", () => {
    expect(parseLoginReturn("?code=abc&state=xyz")).toEqual({ kind: "code", code: "abc", state: "xyz" });
  });

  it("error があれば失敗の戻りとして読む（取りやめもここに来る）", () => {
    expect(parseLoginReturn("?error=access_denied&state=xyz")).toEqual({ kind: "failed" });
    expect(parseLoginReturn("?error=access_denied&code=abc&state=xyz")).toEqual({ kind: "failed" });
  });

  it("code か state が欠けていれば失敗の戻りとして読む", () => {
    expect(parseLoginReturn("?code=abc")).toEqual({ kind: "failed" });
    expect(parseLoginReturn("?state=xyz")).toEqual({ kind: "failed" });
  });

  it("何も無ければ戻りではない", () => {
    expect(parseLoginReturn("")).toEqual({ kind: "none" });
    expect(parseLoginReturn("?utm_source=x")).toEqual({ kind: "none" });
  });
});

describe("completeLogin", () => {
  it("state が一致すれば code をトークンに交換し、アクセストークンを sessionStorage にだけ置く", async () => {
    const authorizeUrl = await beginLogin(CONFIG, sessionStorage, ORIGIN);
    const state = stateOf(authorizeUrl);
    const fetchFn = vi.fn(async () => tokenResponse({ access_token: "the-access-token", id_token: "ignored" }));

    const result = await completeLogin({ config: CONFIG, ret: codeReturn(state), storage: sessionStorage, origin: ORIGIN, fetchFn });

    expect(result).toBe("ok");
    expect(getToken(sessionStorage)).toBe("the-access-token");
    expect(JSON.stringify({ ...localStorage })).not.toContain("the-access-token");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${CONFIG.cognitoDomain}/oauth2/token`);
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe(`${ORIGIN}/`);
    // 送る verifier が、認可 URL に付けた challenge と対になっている
    expect(await challengeOf(body.get("code_verifier")!)).toBe(new URL(authorizeUrl).searchParams.get("code_challenge"));
  });

  it("state が違えば拒み、交換の通信をしない", async () => {
    await beginLogin(CONFIG, sessionStorage, ORIGIN);
    const fetchFn = vi.fn();

    const result = await completeLogin({ config: CONFIG, ret: codeReturn("forged"), storage: sessionStorage, origin: ORIGIN, fetchFn });

    expect(result).toBe("failed");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(getToken(sessionStorage)).toBeNull();
  });

  it("退避した state・verifier が無ければ拒み、交換の通信をしない", async () => {
    const fetchFn = vi.fn();
    const result = await completeLogin({ config: CONFIG, ret: codeReturn("any"), storage: sessionStorage, origin: ORIGIN, fetchFn });
    expect(result).toBe("failed");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("退避が壊れていても、例外にせず拒む", async () => {
    const state = stateOf(await beginLogin(CONFIG, sessionStorage, ORIGIN));
    for (const key of Object.keys(sessionStorage)) sessionStorage.setItem(key, "{not json");
    const result = await completeLogin({ config: CONFIG, ret: codeReturn(state), storage: sessionStorage, origin: ORIGIN, fetchFn: vi.fn() });
    expect(result).toBe("failed");
  });

  it("error 付き（取りやめ）の戻りは失敗で、交換の通信をしない", async () => {
    await beginLogin(CONFIG, sessionStorage, ORIGIN);
    const fetchFn = vi.fn();
    const result = await completeLogin({ config: CONFIG, ret: { kind: "failed" }, storage: sessionStorage, origin: ORIGIN, fetchFn });
    expect(result).toBe("failed");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["非 2xx", async () => tokenResponse({ error: "invalid_grant" }, 400)],
    ["通信の失敗", async () => Promise.reject(new TypeError("network"))],
    ["access_token が無い", async () => tokenResponse({ id_token: "x" })],
    ["access_token が文字列でない", async () => tokenResponse({ access_token: 1 })],
    ["JSON でない", async () => new Response("<html>")],
  ])("交換が%sでも、例外にせず失敗を返し、トークンは置かない", async (_name, respond) => {
    const state = stateOf(await beginLogin(CONFIG, sessionStorage, ORIGIN));
    const result = await completeLogin({ config: CONFIG, ret: codeReturn(state), storage: sessionStorage, origin: ORIGIN, fetchFn: vi.fn(respond) });
    expect(result).toBe("failed");
    expect(getToken(sessionStorage)).toBeNull();
  });

  it.each(["成功", "失敗"])("%s のどちらでも、使った state・verifier は消え、同じ戻りを再び使えない", async (outcome) => {
    const state = stateOf(await beginLogin(CONFIG, sessionStorage, ORIGIN));
    const ok = outcome === "成功";
    const fetchFn = vi.fn(async () => (ok ? tokenResponse({ access_token: "t" }) : tokenResponse({}, 500)));
    await completeLogin({ config: CONFIG, ret: codeReturn(state), storage: sessionStorage, origin: ORIGIN, fetchFn });
    clearToken(sessionStorage);

    const again = await completeLogin({ config: CONFIG, ret: codeReturn(state), storage: sessionStorage, origin: ORIGIN, fetchFn });
    expect(again).toBe("failed");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("logoutUrl", () => {
  it("client_id と logout_uri（origin/）を持つ", () => {
    const url = new URL(logoutUrl(CONFIG, ORIGIN));
    expect(url.origin).toBe(CONFIG.cognitoDomain);
    expect(url.pathname).toBe("/logout");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("logout_uri")).toBe(`${ORIGIN}/`);
  });
});
