import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import type { AuthConfig } from "./auth-config.ts";
import { getToken, storeToken } from "./login.ts";
import { readSnapshot } from "./resume.ts";

const CONFIG: AuthConfig = {
  cognitoDomain: "https://example.auth.ap-northeast-1.amazoncognito.com",
  clientId: "client-id",
  turnstileSiteKey: "site-key",
};
const SECRET = "secret-access-token-123";
const ID_A = "AbCdEfGhIjKlMnOpQrSt-_";
const ID_B = "BbCdEfGhIjKlMnOpQrSt-_";

type Summary = { id: string; title: string; createdAt: string; chordCount: number };
const A: Summary = { id: ID_A, title: "朝の曲", createdAt: "2026-11-07T12:00:00.000Z", chordCount: 4 };
const B: Summary = { id: ID_B, title: "夜の曲", createdAt: "2026-11-05T12:00:00.000Z", chordCount: 8 };

type Call = { url: string; method: string; headers: Headers };
let calls: Call[];

/** 一覧の取得（GET /api/shares）と削除（DELETE /api/shares/<ID>）の応答を決めて、fetch を差し替える。 */
function serve(options: { list?: () => Response | Promise<Response>; remove?: () => Response | Promise<Response> }) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, headers: new Headers(init?.headers) });
      if (method === "DELETE") return options.remove ? options.remove() : new Response(null, { status: 204 });
      return options.list ? options.list() : listOf([A, B])();
    }),
  );
}
const listOf = (shares: unknown[]) => () => new Response(JSON.stringify({ shares }), { status: 200 });
const deletes = () => calls.filter((call) => call.method === "DELETE");

const loggedIn = () => storeToken(sessionStorage, SECRET);
const main = () => within(screen.getByRole("main"));
const items = () => main().getAllByRole("listitem");
const itemOf = (title: string) => within(items().find((item) => item.textContent?.includes(title))!);
const setClipboard = (clipboard: unknown) => Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/mine");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
  window.history.replaceState(null, "", "/");
});

describe("共有した譜面 /mine：一覧", () => {
  it("新しい順（API の順）に、タイトル・日付・コード数を出し、件数「n / 20」を出す", async () => {
    loggedIn();
    serve({});
    render(<App config={CONFIG} />);

    await main().findByText("朝の曲");
    expect(main().getByText("2 / 20")).toBeTruthy();
    expect(items().map((item) => item.querySelector(".mine-title")?.textContent)).toEqual(["朝の曲", "夜の曲"]);
    expect(itemOf("朝の曲").getByText("2026/11/07")).toBeTruthy();
    expect(itemOf("朝の曲").getByText("4コード")).toBeTruthy();
    expect(itemOf("夜の曲").getByText("8コード")).toBeTruthy();
  });

  it("取得は GET /api/shares を、ログインのトークン付きで呼ぶ", async () => {
    loggedIn();
    serve({});
    render(<App config={CONFIG} />);
    await main().findByText("朝の曲");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/shares");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
  });

  it("タイトルに HTML を入れても、文字として出て要素にならない", async () => {
    loggedIn();
    const title = "<img src=x onerror=alert(1)><script>window.__pwned = 1</script>";
    serve({ list: listOf([{ ...A, title }]) });
    render(<App config={CONFIG} />);

    await main().findByText(title);
    expect(screen.getByRole("main").querySelector("img, script")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("空の一覧：「まだ共有した譜面はありません」を出し、件数は「0 / 20」", async () => {
    loggedIn();
    serve({ list: listOf([]) });
    render(<App config={CONFIG} />);

    await main().findByText("まだ共有した譜面はありません");
    expect(main().getByText("0 / 20")).toBeTruthy();
    expect(main().queryAllByRole("listitem")).toHaveLength(0);
  });

  it("読み込み中は、その旨を出す", async () => {
    loggedIn();
    serve({ list: () => new Promise<Response>(() => {}) });
    render(<App config={CONFIG} />);
    expect(await main().findByText("読み込み中")).toBeTruthy();
  });

  it.each([
    ["通信の失敗", () => Promise.reject(new TypeError("Failed to fetch: secret-host"))],
    ["サーバーの失敗（503）", () => new Response('{"error":"unavailable-detail"}', { status: 503 })],
    ["壊れた応答", () => new Response("<html>", { status: 200 })],
    ["一覧の形でない応答", () => new Response(JSON.stringify({ shares: "x" }), { status: 200 })],
    ["項目の形が違う応答", listOf([{ id: ID_A, title: 1, createdAt: "x", chordCount: 4 }])],
    ["形が不正な ID を含む応答", listOf([{ ...A, id: "short" }])],
  ])("取得の失敗（%s）：固定の短い案内を出し、サーバーの本文や例外の中身は出さない", async (_name, list) => {
    loggedIn();
    serve({ list });
    render(<App config={CONFIG} />);

    expect((await main().findByRole("alert")).textContent).toMatch(/読み込めませんでした/);
    expect(document.body.textContent).not.toMatch(/secret-host|unavailable-detail/);
    expect(main().queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("共有した譜面 /mine：ログイン", () => {
  it("ログイン前：取得せず、ログインの案内と「Google でログイン」を出す。押すと戻ったあとの操作は /mine", async () => {
    serve({});
    const goTo = vi.fn<(url: string) => void>();
    render(<App config={CONFIG} goTo={goTo} />);

    expect(main().getByText(/ログインが必要です/)).toBeTruthy();
    expect(calls).toHaveLength(0);
    fireEvent.click(main().getByRole("button", { name: "Google でログイン" }));
    await waitFor(() => expect(goTo).toHaveBeenCalled());
    expect(readSnapshot(sessionStorage)?.after).toBe("mine");
  });

  it("取得が 401（期限切れ）：ログインの案内に切り替わる", async () => {
    loggedIn();
    serve({ list: () => new Response('{"error":"unauthorized"}', { status: 401 }) });
    render(<App config={CONFIG} />);

    await main().findByText(/ログインが必要です/);
    expect(getToken(sessionStorage)).toBeNull();
    expect(main().queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("共有した譜面 /mine：開く・URL のコピー", () => {
  it("「開く」で /s/<ID> の共有ページに移る", async () => {
    loggedIn();
    serve({});
    render(<App config={CONFIG} />);
    await main().findByText("朝の曲");

    fireEvent.click(itemOf("朝の曲").getByRole("link", { name: "開く" }));
    expect(window.location.pathname).toBe(`/s/${ID_A}`);
    expect(screen.getByRole("heading", { name: "共有された譜面" })).toBeTruthy();
  });

  it("「URL をコピー」で https://<オリジン>/s/<ID> をクリップボードに書き、「コピーしました」を出す", async () => {
    loggedIn();
    serve({});
    const writeText = vi.fn(async (_text: string) => {});
    setClipboard({ writeText });
    render(<App config={CONFIG} />);
    await main().findByText("朝の曲");

    fireEvent.click(itemOf("朝の曲").getByRole("button", { name: "URL をコピー" }));
    await itemOf("朝の曲").findByText("コピーしました");
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/${ID_A}`);
    expect(itemOf("夜の曲").queryByText("コピーしました")).toBeNull();
  });

  it.each([
    ["クリップボードが無い環境", undefined],
    ["書き込みを拒否されたとき", { writeText: vi.fn(async () => Promise.reject(new DOMException("denied", "NotAllowedError"))) }],
  ])("%s：「コピーできませんでした」を出す", async (_name, clipboard) => {
    loggedIn();
    serve({});
    setClipboard(clipboard);
    render(<App config={CONFIG} />);
    await main().findByText("朝の曲");

    fireEvent.click(itemOf("朝の曲").getByRole("button", { name: "URL をコピー" }));
    expect(await itemOf("朝の曲").findByText("コピーできませんでした")).toBeTruthy();
  });
});

describe("共有した譜面 /mine：削除", () => {
  const ask = async () => {
    loggedIn();
    render(<App config={CONFIG} />);
    await main().findByText("朝の曲");
    fireEvent.click(itemOf("朝の曲").getByRole("button", { name: "削除" }));
  };

  it("「削除」を押すと、画面の中の確認が出る。URL を開いても見られなくなる旨を書き、この時点では DELETE を呼ばない", async () => {
    serve({});
    const confirm = vi.spyOn(window, "confirm");
    await ask();

    expect(itemOf("朝の曲").getByText(/URL を開いても見られなくなります/)).toBeTruthy();
    expect(itemOf("朝の曲").getByRole("button", { name: "削除する" })).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    expect(deletes()).toHaveLength(0);
  });

  it("確認で「やめる」：何も呼ばず、確認が閉じて一覧はそのまま", async () => {
    serve({});
    await ask();
    fireEvent.click(itemOf("朝の曲").getByRole("button", { name: "やめる" }));

    expect(itemOf("朝の曲").queryByRole("button", { name: "削除する" })).toBeNull();
    expect(itemOf("朝の曲").getByRole("button", { name: "削除" })).toBeTruthy();
    expect(items()).toHaveLength(2);
    expect(deletes()).toHaveLength(0);
  });

  it("確認で「削除する」：DELETE /api/shares/<ID> をトークン付きで呼び、204 なら一覧から消え、件数が減る", async () => {
    serve({});
    await ask();
    fireEvent.click(itemOf("朝の曲").getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(main().queryByText("朝の曲")).toBeNull());
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0]!.url).toBe(`/api/shares/${ID_A}`);
    expect(deletes()[0]!.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(main().getByText("1 / 20")).toBeTruthy();
    expect(main().getByText("夜の曲")).toBeTruthy();
  });

  it.each([
    ["サーバーの失敗（503）", () => new Response('{"error":"unavailable-detail"}', { status: 503 })],
    ["通信の失敗", () => Promise.reject(new TypeError("Failed to fetch: secret-host"))],
  ])("削除の失敗（%s）：一覧に残し、固定の失敗の案内を出す。もう一度試せる", async (_name, remove) => {
    serve({ remove });
    await ask();
    fireEvent.click(itemOf("朝の曲").getByRole("button", { name: "削除する" }));

    expect((await itemOf("朝の曲").findByRole("alert")).textContent).toMatch(/削除できませんでした/);
    expect(document.body.textContent).not.toMatch(/secret-host|unavailable-detail/);
    expect(items()).toHaveLength(2);
    expect(main().getByText("2 / 20")).toBeTruthy();
    fireEvent.click(itemOf("朝の曲").getByRole("button", { name: "削除する" })); // 確認は開いたまま、もう一度試せる
    await waitFor(() => expect(deletes()).toHaveLength(2));
  });

  it("削除が 404（すでに無い）：一覧から消す", async () => {
    serve({ remove: () => new Response('{"error":"not-found"}', { status: 404 }) });
    await ask();
    fireEvent.click(itemOf("朝の曲").getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(main().queryByText("朝の曲")).toBeNull());
    expect(items()).toHaveLength(1);
  });

  it("削除が 401：ログインの案内に切り替わる", async () => {
    serve({ remove: () => new Response('{"error":"unauthorized"}', { status: 401 }) });
    await ask();
    fireEvent.click(itemOf("朝の曲").getByRole("button", { name: "削除する" }));

    await main().findByText(/ログインが必要です/);
    expect(main().queryAllByRole("listitem")).toHaveLength(0);
  });

  it("削除の最中は同じ項目のボタンを押せず、二重に呼ばない", async () => {
    let finish: (response: Response) => void = () => {};
    serve({ remove: () => new Promise<Response>((resolve) => (finish = resolve)) });
    await ask();
    const confirmButton = itemOf("朝の曲").getByRole("button", { name: "削除する" }) as HTMLButtonElement;
    fireEvent.click(confirmButton);

    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(confirmButton.disabled).toBe(true);
    expect((itemOf("朝の曲").getByRole("button", { name: "やめる" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirmButton);
    expect(deletes()).toHaveLength(1);
    finish(new Response(null, { status: 204 }));
    await waitFor(() => expect(main().queryByText("朝の曲")).toBeNull());
  });

  it("最後の 1 件を削除すると、空の一覧の案内になる", async () => {
    serve({ list: listOf([A]) });
    await ask();
    fireEvent.click(itemOf("朝の曲").getByRole("button", { name: "削除する" }));

    await main().findByText("まだ共有した譜面はありません");
    expect(main().getByText("0 / 20")).toBeTruthy();
  });
});
