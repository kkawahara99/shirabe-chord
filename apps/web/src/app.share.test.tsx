import { lowerSymbol, optimizeSymbols } from "@shirabe-chord/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import type { AuthConfig } from "./auth-config.ts";
import { beginLogin, getToken, storeToken } from "./login.ts";
import { readSnapshot, saveSnapshot } from "./resume.ts";
import type { TurnstileApi, TurnstileOptions } from "./turnstile.ts";

const CONFIG: AuthConfig = {
  cognitoDomain: "https://example.auth.ap-northeast-1.amazoncognito.com",
  clientId: "client-id",
  turnstileSiteKey: "site-key",
};
const ORIGIN = window.location.origin;
const SECRET = "secret-access-token-123";
const ID = "AbCdEfGhIjKlMnOpQrSt-_";
const TS_TOKEN = "turnstile-token-1";

const GUIDANCE = "共有には Google ログインが必要です";
const LOGIN = "Google でログイン";

/** Turnstile の代わり。`render` に渡された設定を覚え、テストからトークンを渡せるようにする。 */
function installTurnstile() {
  let options: TurnstileOptions | undefined;
  const api = {
    render: vi.fn((_container: HTMLElement, given: TurnstileOptions) => {
      options = given;
      return "widget-1";
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  } satisfies TurnstileApi;
  window.turnstile = api;
  return {
    api,
    token: (value = TS_TOKEN) => act(() => options!.callback(value)),
    expire: () => act(() => options!["expired-callback"]()),
    error: () => act(() => options!["error-callback"]()),
  };
}
let turnstile: ReturnType<typeof installTurnstile>;

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  turnstile = installTurnstile();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "turnstile");
  Reflect.deleteProperty(navigator, "clipboard");
  window.history.replaceState(null, "", "/");
});

const shareButton = () => screen.queryByRole("button", { name: "共有する" }) as HTMLButtonElement | null;
const dialog = () => screen.queryByRole("dialog");
const inDialog = () => within(screen.getByRole("dialog"));
const submitButton = () => inDialog().getByRole("button", { name: "この内容で共有する" }) as HTMLButtonElement;
const alertText = () => inDialog().queryByRole("alert")?.textContent ?? null;
const capoSelect = () => screen.getByRole("combobox", { name: "カポ" }) as HTMLSelectElement;

const setup = (opts: { loggedIn?: boolean } = {}) => {
  if (opts.loggedIn ?? true) storeToken(sessionStorage, SECRET);
  const goTo = vi.fn<(url: string) => void>();
  render(<App config={CONFIG} goTo={goTo} />);
  return { goTo };
};

/** ダイアログを開き、Turnstile の部品が描かれるまで待つ。 */
async function openForm() {
  fireEvent.click(shareButton()!);
  await waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
}
const type = (label: string, value: string) => fireEvent.change(inDialog().getByLabelText(label), { target: { value } });

/** タイトルを入れ、トークンを得て、送れる状態にする。 */
async function fillAndReady(title = "朝の曲") {
  await openForm();
  type("タイトル", title);
  turnstile.token();
}

type Call = { url: string; init: RequestInit };
const respondWith = (response: () => Response | Promise<Response>) => {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return response();
    }),
  );
  return calls;
};
const created = () => new Response(JSON.stringify({ id: ID }), { status: 201 });
const sentBody = (calls: Call[]) => JSON.parse(calls[0]!.init.body as string);

describe("「共有する」ボタン", () => {
  it("設定が空なら出さない", () => {
    render(<App config={null} />);
    expect(shareButton()).toBeNull();
  });

  it("設定があれば譜面の操作列に出る", () => {
    setup();
    expect(within(document.querySelector(".score-actions") as HTMLElement).getByRole("button", { name: "共有する" })).toBeTruthy();
  });

  it("押さえ方を出せない進行のあいだは押せない", () => {
    setup();
    fireEvent.click(screen.getByRole("radio", { name: "7" }));
    fireEvent.click(screen.getByRole("button", { name: "テンション・ベース" }));
    for (const tension of ["♭9", "♯9", "♯11"]) fireEvent.click(screen.getByRole("checkbox", { name: tension }));
    expect(screen.getByRole("alert").textContent).toMatch(/押さえ方が見つかりません/);
    expect(shareButton()!.disabled).toBe(true);
  });
});

describe("ログイン前", () => {
  it("押すと「共有には Google ログインが必要です」の案内が出る。Turnstile は出さない", () => {
    setup({ loggedIn: false });
    fireEvent.click(shareButton()!);
    expect(inDialog().getByText(GUIDANCE)).toBeTruthy();
    expect(inDialog().queryByLabelText("タイトル")).toBeNull();
    expect(turnstile.api.render).not.toHaveBeenCalled();
  });

  it("案内のボタンで、進行を退避してログインへ進む。戻ったあとの操作は「共有」", async () => {
    const { goTo } = setup({ loggedIn: false });
    fireEvent.change(capoSelect(), { target: { value: "3" } });
    fireEvent.click(shareButton()!);
    fireEvent.click(inDialog().getByRole("button", { name: LOGIN }));

    await waitFor(() => expect(goTo).toHaveBeenCalledTimes(1));
    expect(new URL(goTo.mock.calls[0]![0]).pathname).toBe("/oauth2/authorize");
    expect(readSnapshot(sessionStorage)).toMatchObject({ capo: 3, after: "share" });
  });
});

describe("ログインから戻ったとき", () => {
  const returnWith = async (snapshot: Parameters<typeof saveSnapshot>[1]) => {
    saveSnapshot(sessionStorage, snapshot);
    const url = await beginLogin(CONFIG, sessionStorage, ORIGIN);
    window.history.replaceState(null, "", `/?code=c&state=${new URL(url).searchParams.get("state")}`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: SECRET }), { status: 200 })));
  };
  const C = { root: { letter: "C", accidental: "" }, quality: "", tensions: [], bass: null } as const;

  it("復元のあと、共有ダイアログが開く", async () => {
    await returnWith({ chords: [C], capo: 0, pins: [], after: "share" });
    render(<App config={CONFIG} goTo={vi.fn()} />);

    await screen.findByRole("dialog");
    expect(getToken(sessionStorage)).toBe(SECRET);
    expect(inDialog().getByLabelText("タイトル")).toBeTruthy();
  });

  it("復元した進行が押さえ方を出せないときは、共有できない旨を出し、送れない", async () => {
    const hard = { ...C, quality: "7", tensions: ["b9", "#9", "#11"] } as const;
    await returnWith({ chords: [hard], capo: 0, pins: [], after: "share" });
    render(<App config={CONFIG} goTo={vi.fn()} />);

    await screen.findByRole("dialog");
    expect(inDialog().getByText(/押さえ方を出せない進行は共有できません/)).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
  });
});

describe("共有ダイアログ（ログイン済み）", () => {
  it("タイトル・ひと言・表示名の欄がある。「誰でも見られる」旨は送信ボタンより前にある", async () => {
    setup();
    await openForm();
    for (const label of ["タイトル", "ひと言（任意）", "表示名（任意）"]) expect(inDialog().getByLabelText(label)).toBeTruthy();
    const notice = inDialog().getByText(/URL を知っている人は誰でも/);
    expect(notice.compareDocumentPosition(submitButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Escape で閉じる。ダイアログのあいだ、後ろの画面は操作できない", async () => {
    setup();
    await openForm();
    expect(document.querySelector(".app")?.hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(document.querySelector(".app")?.hasAttribute("inert")).toBe(false);
  });

  it("「閉じる」で閉じ、「共有する」ボタンにフォーカスが戻る", async () => {
    setup();
    await openForm();
    fireEvent.click(inDialog().getByRole("button", { name: "閉じる" }));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(shareButton());
  });
});

describe("入力の検証（送る前）", () => {
  const tooLong = (n: number) => "あ".repeat(n);

  it.each([
    ["タイトルが空", "タイトル", "", /タイトル/],
    ["タイトルが空白だけ", "タイトル", "   ", /タイトル/],
    ["タイトルが 51 字", "タイトル", tooLong(51), /タイトル/],
    ["タイトルに制御文字", "タイトル", "a\u0007b", /タイトル/],
    ["ひと言が 201 字", "ひと言（任意）", tooLong(201), /ひと言/],
    ["表示名が 21 字", "表示名（任意）", tooLong(21), /表示名/],
    ["表示名に制御文字", "表示名（任意）", "a\u0000b", /表示名/],
  ])("%s：送らずに、固定の文言を出す", async (_name, label, value, message) => {
    const calls = respondWith(created);
    setup();
    await fillAndReady("題");
    type(label, value);
    fireEvent.click(submitButton());

    expect(alertText()).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("絵文字はコードポイントで数える：タイトル 50 個は送れ、51 個は送れない", async () => {
    const calls = respondWith(created);
    setup();
    await fillAndReady("😀".repeat(51));
    fireEvent.click(submitButton());
    expect(alertText()).toMatch(/タイトル/);
    expect(calls).toHaveLength(0);

    type("タイトル", "😀".repeat(50));
    fireEvent.click(submitButton());
    await waitFor(() => expect(calls).toHaveLength(1));
  });
});

describe("Turnstile", () => {
  it("トークンが無いあいだは送れない。得たら送れ、期限切れでまた送れなくなる", async () => {
    setup();
    await openForm();
    type("タイトル", "題");
    expect(submitButton().disabled).toBe(true);
    turnstile.token();
    expect(submitButton().disabled).toBe(false);
    turnstile.expire();
    expect(submitButton().disabled).toBe(true);
  });

  it("サイトキーを渡して描く", async () => {
    setup();
    await openForm();
    expect(turnstile.api.render.mock.calls[0]![1].sitekey).toBe(CONFIG.turnstileSiteKey);
  });

  it("部品の失敗の案内は、取り直してトークンを得たら消える", async () => {
    setup();
    await openForm();
    turnstile.error();
    expect(alertText()).toMatch(/確認の部品を読み込めませんでした/);
    turnstile.token();
    expect(alertText()).toBeNull();
  });

  it("ダイアログを閉じたら、部品を取り除く", async () => {
    setup();
    await openForm();
    fireEvent.click(inDialog().getByRole("button", { name: "閉じる" }));
    expect(turnstile.api.remove).toHaveBeenCalledWith("widget-1");
  });

  it("部品を読み込めないときは案内を出し、送れない", async () => {
    Reflect.deleteProperty(window, "turnstile");
    setup();
    fireEvent.click(shareButton()!);
    await waitFor(() => expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeTruthy());
    document.querySelector('script[src*="challenges.cloudflare.com"]')!.dispatchEvent(new Event("error"));

    await waitFor(() => expect(alertText()).toMatch(/確認の部品を読み込めませんでした/));
    expect(submitButton().disabled).toBe(true);
  });
});

describe("送信", () => {
  it("POST /api/shares に、Turnstile のトークンと検証済みの譜面を、ログインのトークン付きで送る。表示名が空なら匿名", async () => {
    const calls = respondWith(created);
    setup();
    await fillAndReady();
    type("ひと言（任意）", "サビは強めに");
    fireEvent.click(submitButton());

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toBe("/api/shares");
    expect(calls[0]!.init.method).toBe("POST");
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(headers.get("content-type")).toBe("application/json");
    const solved = optimizeSymbols(["C", "Am", "F", "G7"]);
    if (!solved.ok) throw new Error("optimize");
    expect(sentBody(calls)).toEqual({
      turnstileToken: TS_TOKEN,
      score: {
        title: "朝の曲",
        note: "サビは強めに",
        displayName: "匿名",
        capo: 0,
        chords: ["C", "Am", "F", "G7"].map((symbol, i) => ({ symbol, voicing: solved.steps[i]!.voicing })),
      },
    });
  });

  it("カポがあるときは、記号は鳴らす名前のまま、押さえ方はカポをナットとみなした形で送る", async () => {
    const calls = respondWith(created);
    setup();
    fireEvent.change(capoSelect(), { target: { value: "2" } });
    await fillAndReady();
    fireEvent.click(submitButton());

    await waitFor(() => expect(calls).toHaveLength(1));
    const solved = optimizeSymbols(["C", "Am", "F", "G7"].map((s) => lowerSymbol(s, 2)));
    if (!solved.ok) throw new Error("optimize");
    const { score } = sentBody(calls);
    expect(score.capo).toBe(2);
    expect(score.chords.map((c: { symbol: string }) => c.symbol)).toEqual(["C", "Am", "F", "G7"]);
    expect(score.chords.map((c: { voicing: unknown }) => c.voicing)).toEqual(solved.steps.map((s) => s.voicing));
  });

  it("成功したら共有 URL（/s/ID）を出し、コピーできる", async () => {
    respondWith(created);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup();
    await fillAndReady();
    fireEvent.click(submitButton());

    const url = (await inDialog().findByLabelText("共有 URL")) as HTMLInputElement;
    expect(url.value).toBe(`${ORIGIN}/s/${ID}`);
    expect(url.readOnly).toBe(true);
    fireEvent.click(inDialog().getByRole("button", { name: "URL をコピー" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/s/${ID}`));
    await inDialog().findByText("コピーしました");
  });

  it("コピーできなかったら、その旨を出す（URL は選んでコピーできるよう残す）", async () => {
    respondWith(created);
    setup();
    await fillAndReady();
    fireEvent.click(submitButton());
    await inDialog().findByLabelText("共有 URL");
    fireEvent.click(inDialog().getByRole("button", { name: "URL をコピー" })); // clipboard が無い環境
    await inDialog().findByText("コピーできませんでした");
    expect(inDialog().getByLabelText("共有 URL")).toBeTruthy();
  });

  it("返ってきた ID の形が不正なら、成功扱いにしない", async () => {
    respondWith(() => new Response(JSON.stringify({ id: "../evil" }), { status: 201 }));
    setup();
    await fillAndReady();
    fireEvent.click(submitButton());

    await waitFor(() => expect(alertText()).toMatch(/共有できませんでした/));
    expect(inDialog().queryByLabelText("共有 URL")).toBeNull();
  });

  it("上限（409）：古い共有を削除するよう案内し、/mine へ進める", async () => {
    respondWith(() => new Response(JSON.stringify({ error: "limit-reached" }), { status: 409 }));
    setup();
    await fillAndReady();
    fireEvent.click(submitButton());

    await waitFor(() => expect(alertText()).toMatch(/古い共有を削除してください/));
    fireEvent.click(inDialog().getByRole("button", { name: "共有した譜面を開く" }));
    expect(dialog()).toBeNull();
    expect(window.location.pathname).toBe("/mine");
  });

  it("回数の上限（429）：「しばらくしてからもう一度お試しください」", async () => {
    respondWith(() => new Response("", { status: 429 }));
    setup();
    await fillAndReady();
    fireEvent.click(submitButton());
    await waitFor(() => expect(alertText()).toMatch(/しばらくしてからもう一度お試しください/));
  });

  it.each([
    ["400", () => new Response('{"error":"<b>detail</b>"}', { status: 400 }), /この内容では共有できません/],
    ["403", () => new Response('{"error":"turnstile-failed"}', { status: 403 }), /確認に失敗/],
    ["503", () => new Response('{"error":"unavailable"}', { status: 503 }), /共有できませんでした/],
    ["通信の失敗", () => Promise.reject(new TypeError("Failed to fetch: secret-host")), /共有できませんでした/],
  ])("%s：固定の文言を出し、サーバーの本文や例外の中身は出さない。Turnstile を取り直して再送できる", async (_name, response, message) => {
    const calls = respondWith(response);
    setup();
    await fillAndReady();
    fireEvent.click(submitButton());

    await waitFor(() => expect(alertText()).toMatch(message));
    expect(document.body.textContent).not.toMatch(/detail|turnstile-failed|unavailable|secret-host/);
    await waitFor(() => expect(turnstile.api.reset).toHaveBeenCalled());
    expect(submitButton().disabled).toBe(true); // 使ったトークンは再利用しない
    turnstile.token("turnstile-token-2");
    fireEvent.click(submitButton());
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(sentBody([calls[1]!]).turnstileToken).toBe("turnstile-token-2");
  });

  it("401：ログインの案内に戻る", async () => {
    respondWith(() => new Response('{"error":"unauthorized"}', { status: 401 }));
    setup();
    await fillAndReady();
    fireEvent.click(submitButton());

    await waitFor(() => expect(inDialog().getByText(GUIDANCE)).toBeTruthy());
    expect(getToken(sessionStorage)).toBeNull();
  });

  it("送信中は、Escape でも「閉じる」でも閉じられない（作られた共有の URL を見失わないため）", async () => {
    let finish: (response: Response) => void = () => {};
    respondWith(() => new Promise<Response>((resolve) => (finish = resolve)));
    setup();
    await fillAndReady();
    fireEvent.click(submitButton());
    await waitFor(() => expect(submitButton().disabled).toBe(true));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog()).toBeTruthy();
    expect((inDialog().getByRole("button", { name: "閉じる" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish(created()));
    await inDialog().findByLabelText("共有 URL");
  });

  it("成功したら、共有 URL の欄にフォーカスが移り、成功が読み上げられる（status）", async () => {
    respondWith(created);
    setup();
    await fillAndReady();
    fireEvent.click(submitButton());

    const url = await inDialog().findByLabelText("共有 URL");
    await waitFor(() => expect(document.activeElement).toBe(url));
    expect(inDialog().getByText(/共有しました/).getAttribute("role")).toBe("status");
  });

  it("401 でログインの案内に変わったら、フォーカスはダイアログに戻る", async () => {
    respondWith(() => new Response("", { status: 401 }));
    setup();
    await fillAndReady();
    fireEvent.click(submitButton());

    await waitFor(() => expect(inDialog().getByText(GUIDANCE)).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("dialog")));
  });

  it("ブラウザの戻る・進むで別の画面になったら、ダイアログを閉じる", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    setup();
    await openForm();
    act(() => {
      window.history.pushState(null, "", `/s/${ID}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(dialog()).toBeNull();
  });

  it("送信中は二重に送れない", async () => {
    let finish: (response: Response) => void = () => {};
    const calls = respondWith(() => new Promise<Response>((resolve) => (finish = resolve)));
    setup();
    await fillAndReady();
    fireEvent.click(submitButton());
    await waitFor(() => expect(calls).toHaveLength(1));

    expect(submitButton().disabled).toBe(true);
    fireEvent.click(submitButton());
    expect(calls).toHaveLength(1);
    await act(async () => finish(created()));
    await inDialog().findByLabelText("共有 URL");
  });
});
