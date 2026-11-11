import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import type { AuthConfig } from "./auth-config.ts";
import { AuthControl } from "./auth-control.tsx";
import { AuthProvider, useAuth } from "./auth-context.tsx";
import { beginLogin, getToken, logoutUrl, storeToken } from "./login.ts";
import { readSnapshot, saveSnapshot, type Snapshot } from "./resume.ts";

const CONFIG: AuthConfig = {
  cognitoDomain: "https://example.auth.ap-northeast-1.amazoncognito.com",
  clientId: "client-id",
  turnstileSiteKey: "site-key",
};
const ORIGIN = window.location.origin;
const SECRET = "secret-access-token-123";
const LOGIN = "Google でログイン";
const ID = "AbCdEfGhIjKlMnOpQrSt-_";

const FAILED_NOTICE = /ログインできませんでした/;
const EXPIRED_NOTICE = /ログインの有効期限が切れました/;

const consoleSpies = () =>
  (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

const goToSpy = () => vi.fn<(url: string) => void>();
const tokenFetch = (token = SECRET) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ access_token: token }), { status: 200 }));

const loginButton = () => screen.queryByRole("button", { name: LOGIN });
const chordButtons = () =>
  within(screen.getByRole("list", { name: "コード進行" }))
    .getAllByRole("button")
    .filter((button) => button.hasAttribute("aria-pressed"));
const chordSymbols = () => chordButtons().map((button) => button.dataset.symbol);
const capoSelect = () => screen.getByRole("combobox", { name: "カポ" }) as HTMLSelectElement;
const pinnedPositions = () =>
  Array.from(document.querySelectorAll(".steps > .step")).flatMap((element, i) => (element.querySelector(".step-pinned") ? [i] : []));

/** 進行を「C Am F G7 C」にし、カポ 2 にして、1 番目のコードの押さえ方を固定する。 */
function arrange() {
  fireEvent.click(screen.getByRole("button", { name: "コードを追加" }));
  fireEvent.change(capoSelect(), { target: { value: "2" } });
  fireEvent.click(chordButtons()[0]!);
  fireEvent.click(screen.getByRole("button", { name: "押さえ方" }));
  const candidates = within(screen.getByRole("group", { name: "押さえ方の候補" })).getAllByRole("listitem");
  fireEvent.click(within(candidates[1]!).getByRole("button"));
}
const ARRANGED = { symbols: ["C", "Am", "F", "G7", "C"], capo: 2, pinned: [0] };
const expectArranged = () => {
  expect(chordSymbols()).toEqual(ARRANGED.symbols);
  expect(Number(capoSelect().value)).toBe(ARRANGED.capo);
  expect(pinnedPositions()).toEqual(ARRANGED.pinned);
};

/** 「画面で組む → ログインへ移る」までを 1 回やり、移る先の URL と、そのとき戻ってくる state を返す。 */
function leaveForLogin() {
  const goTo = goToSpy();
  const view = render(<App config={CONFIG} goTo={goTo} />);
  arrange();
  fireEvent.click(screen.getByRole("button", { name: LOGIN }));
  return { goTo, view };
}

describe("設定が空のとき", () => {
  it("「Google でログイン」が出ない（これまでどおりの画面）", () => {
    render(<App config={null} />);
    expect(loginButton()).toBeNull();
    expect(screen.queryByRole("button", { name: "アカウントのメニュー" })).toBeNull();
  });

  it("/mine を開いていても、これまでどおりのトップを出す", () => {
    window.history.replaceState(null, "", "/mine");
    render(<App config={null} />);
    expect(screen.getByRole("list", { name: "コード進行" })).toBeTruthy();
  });

  it("ログインの戻り（?code=）が付いていても、何も読まず消さない", () => {
    window.history.replaceState(null, "", "/?code=abc&state=xyz");
    const fetchFn = tokenFetch();
    vi.stubGlobal("fetch", fetchFn);
    render(<App config={null} />);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?code=abc&state=xyz");
  });
});

describe("ヘッダーのログイン", () => {
  it("未ログインなら「Google でログイン」を出す", () => {
    render(<App config={CONFIG} />);
    expect(loginButton()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "アカウントのメニュー" })).toBeNull();
  });

  it("ログインのボタンは、先頭に GoogleMark が付き、名前は「Google でログイン」のまま", () => {
    render(<App config={CONFIG} />);
    const button = loginButton()!;
    expect(button.firstElementChild?.getAttribute("class")).toBe("google-mark");
    expect(button.textContent).toBe(LOGIN);
  });

  it("押すと、進行・カポ・固定を退避して、認可 URL へ移る", async () => {
    const { goTo } = leaveForLogin();

    await waitFor(() => expect(goTo).toHaveBeenCalledTimes(1));
    const url = new URL(goTo.mock.calls[0]![0]);
    expect(url.origin).toBe(CONFIG.cognitoDomain);
    expect(url.pathname).toBe("/oauth2/authorize");
    const saved = readSnapshot(sessionStorage);
    expect(saved?.capo).toBe(2);
    expect(saved?.pins.map((pin) => pin.position)).toEqual([0]);
    expect(saved?.chords).toHaveLength(5);
    expect(saved?.after).toBeNull();
  });

  it("ログイン済みなら、ボタンの代わりにアイコンのメニュー（「共有した譜面」「ログアウト」）を出す。イニシャルや名前は出ない", () => {
    storeToken(sessionStorage, SECRET);
    render(<App config={CONFIG} />);

    expect(loginButton()).toBeNull();
    const menuButton = screen.getByRole("button", { name: "アカウントのメニュー" });
    expect(menuButton.textContent).toBe("");
    expect(menuButton.querySelector("svg")).toBeTruthy();
    fireEvent.click(menuButton);
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["共有した譜面", "ログアウト"]);
  });

  it("ログアウトは、トークンを消して Cognito のログアウト URL へ移る", () => {
    storeToken(sessionStorage, SECRET);
    const goTo = goToSpy();
    render(<App config={CONFIG} goTo={goTo} />);

    fireEvent.click(screen.getByRole("button", { name: "アカウントのメニュー" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "ログアウト" }));

    expect(getToken(sessionStorage)).toBeNull();
    expect(goTo).toHaveBeenCalledWith(logoutUrl(CONFIG, ORIGIN));
    expect(loginButton()).toBeTruthy();
  });
});

describe("ログインから戻ったとき", () => {
  const comeBack = (goTo: ReturnType<typeof goToSpy>) => {
    const state = new URL(goTo.mock.calls[0]![0]).searchParams.get("state")!;
    window.history.replaceState(null, "", `/?code=auth-code&state=${state}`);
  };

  it("成功したら、進行・カポ・固定が元に戻り、URL は / になり、ログイン済みになる（画面が二重に開いても交換は 1 回）", async () => {
    const { goTo, view } = leaveForLogin();
    await waitFor(() => expect(goTo).toHaveBeenCalled());
    view.unmount();
    comeBack(goTo);
    const fetchFn = tokenFetch();
    vi.stubGlobal("fetch", fetchFn);

    render(
      <StrictMode>
        <App config={CONFIG} goTo={goTo} />
      </StrictMode>,
    );

    await screen.findByRole("button", { name: "アカウントのメニュー" });
    await act(async () => {}); // 二重に走った側の結果が出るのを待つ（ガードが無いと、成功したのに失敗の案内が出る）
    expect(screen.queryByText(FAILED_NOTICE)).toBeNull();
    expectArranged();
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
    expect(getToken(sessionStorage)).toBe(SECRET);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("戻ったあとの操作が「共有ダイアログを開く」なら、共有ダイアログを開く", async () => {
    const goTo = goToSpy();
    saveSnapshot(sessionStorage, { chords: DEFAULT_CHORDS, capo: 0, pins: [], after: "share" });
    const url = await beginLogin(CONFIG, sessionStorage, ORIGIN);
    window.history.replaceState(null, "", `/?code=c&state=${new URL(url).searchParams.get("state")}`);
    vi.stubGlobal("fetch", tokenFetch());

    render(<App config={CONFIG} goTo={goTo} />);

    expect(await screen.findByRole("dialog", { name: "譜面を共有する" })).toBeTruthy();
  });

  it("戻ったあとの操作が「/mine を開く」なら、/mine の画面になる", async () => {
    saveSnapshot(sessionStorage, { chords: DEFAULT_CHORDS, capo: 0, pins: [], after: "mine" });
    const url = await beginLogin(CONFIG, sessionStorage, ORIGIN);
    window.history.replaceState(null, "", `/?code=c&state=${new URL(url).searchParams.get("state")}`);
    vi.stubGlobal("fetch", tokenFetch());

    render(<App config={CONFIG} goTo={goToSpy()} />);

    await screen.findByRole("heading", { name: "共有した譜面" });
    expect(window.location.pathname).toBe("/mine");
  });

  it("戻り先でないパス（/s/<ID>?error=…）では、戻りとして読まず、URL も画面も変えない", () => {
    window.history.replaceState(null, "", `/s/${ID}?error=access_denied`);
    render(<App config={CONFIG} goTo={goToSpy()} />);
    expect(screen.queryByText(FAILED_NOTICE)).toBeNull();
    expect(screen.getByRole("heading", { name: "共有された譜面" })).toBeTruthy();
    expect(window.location.pathname).toBe(`/s/${ID}`);
  });

  describe("退避が無い・壊れているとき", () => {
    const returnWith = async () => {
      const url = await beginLogin(CONFIG, sessionStorage, ORIGIN);
      window.history.replaceState(null, "", `/?code=c&state=${new URL(url).searchParams.get("state")}`);
      vi.stubGlobal("fetch", tokenFetch());
    };

    it.each([
      ["退避が無い", () => {}],
      [
        "退避が壊れている",
        () => {
          saveSnapshot(sessionStorage, { chords: DEFAULT_CHORDS, capo: 0, pins: [], after: "share" });
          for (const key of Object.keys(sessionStorage)) sessionStorage.setItem(key, "{broken");
        },
      ],
    ])("%s：操作を呼ばず、既定のトップをログイン済みで出す（例外にしない）", async (_name, prepare) => {
      prepare();
      await returnWith();

      render(<App config={CONFIG} goTo={goToSpy()} />);

      await screen.findByRole("button", { name: "アカウントのメニュー" });
      expect(chordSymbols()).toEqual(["C", "Am", "F", "G7"]);
      expect(Number(capoSelect().value)).toBe(0);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByText(FAILED_NOTICE)).toBeNull();
      expect(window.location.pathname).toBe("/");
    });
  });

  describe("取りやめ・失敗・state の不一致", () => {
    const failures: [string, () => Promise<string>][] = [
      ["取りやめ（error 付き）", async () => {
        await beginLogin(CONFIG, sessionStorage, ORIGIN);
        return "/?error=access_denied";
      }],
      ["state の不一致", async () => {
        await beginLogin(CONFIG, sessionStorage, ORIGIN);
        return "/?code=c&state=forged";
      }],
      ["トークン交換の失敗", async () => {
        const url = await beginLogin(CONFIG, sessionStorage, ORIGIN);
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
        return `/?code=c&state=${new URL(url).searchParams.get("state")}`;
      }],
    ];

    it.each(failures)("%s：短い案内を出し、進行は元に戻し、ログインしていない状態にする", async (_name, prepare) => {
      const { goTo, view } = leaveForLogin();
      await waitFor(() => expect(goTo).toHaveBeenCalled());
      view.unmount();
      // 退避は上で作ったものを使い、戻り側の state だけ差し替える
      const location = await prepare();
      window.history.replaceState(null, "", location);

      render(<App config={CONFIG} goTo={goTo} />);

      await screen.findByText(FAILED_NOTICE);
      expectArranged();
      expect(loginButton()).toBeTruthy();
      expect(getToken(sessionStorage)).toBeNull();
      expect(window.location.search).toBe("");
    });
  });

  it("トークンは画面にもコンソールにも出ない", async () => {
    const spies = consoleSpies();
    const { goTo, view } = leaveForLogin();
    await waitFor(() => expect(goTo).toHaveBeenCalled());
    view.unmount();
    comeBack(goTo);
    vi.stubGlobal("fetch", tokenFetch());

    render(<App config={CONFIG} goTo={goTo} />);
    const menuButton = await screen.findByRole("button", { name: "アカウントのメニュー" });
    fireEvent.click(menuButton);

    expect(getToken(sessionStorage)).toBe(SECRET);
    expect(document.documentElement.outerHTML).not.toContain(SECRET);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
  });
});

describe("API を呼ぶとき（AuthProvider）", () => {
  function Probe() {
    const auth = useAuth();
    return (
      <>
        <AuthControl onOpenMine={() => {}} />
        <button type="button" onClick={() => void auth.apiFetch("/api/shares").catch(() => {})}>
          呼ぶ
        </button>
        <button type="button" onClick={() => void auth.login("share")}>
          共有のためにログイン
        </button>
        <button type="button" onClick={() => void auth.apiFetch("https://elsewhere.example/api/shares").catch(() => {})}>
          外へ呼ぶ
        </button>
      </>
    );
  }
  const renderProvider = (goTo: (url: string) => void = () => {}) =>
    render(
      <AuthProvider
        config={CONFIG}
        back={{ kind: "none" }}
        after={null}
        captureSnapshot={(after) => ({ chords: DEFAULT_CHORDS, capo: 0, pins: [], after })}
        onResume={() => {}}
        goTo={goTo}
      >
        <Probe />
      </AuthProvider>,
    );

  it("Authorization ヘッダーにトークンを付けて送り、200 ならログイン済みを保つ", async () => {
    storeToken(sessionStorage, SECRET);
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "呼ぶ" }));

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    const [, init] = fetchFn.mock.calls[0]!;
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${SECRET}`);
    expect(getToken(sessionStorage)).toBe(SECRET);
    expect(screen.getByRole("button", { name: "アカウントのメニュー" })).toBeTruthy();
    expect(screen.queryByText(EXPIRED_NOTICE)).toBeNull();
  });

  it("401 が返ったら、トークンを消してログアウト状態にし、ログインの案内を出す", async () => {
    storeToken(sessionStorage, SECRET);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "呼ぶ" }));

    await screen.findByText(EXPIRED_NOTICE);
    expect(getToken(sessionStorage)).toBeNull();
    expect(loginButton()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "アカウントのメニュー" })).toBeNull();
  });

  it("トークンを持たない人への 401 では、「期限切れ」の案内を出さない", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "呼ぶ" }));
    await act(async () => {});

    expect(screen.queryByText(EXPIRED_NOTICE)).toBeNull();
    expect(loginButton()).toBeTruthy();
  });

  it("login に「共有」を渡すと、戻ったあとの操作として退避に載り、認可 URL へ移る", async () => {
    const goTo = goToSpy();
    renderProvider(goTo);

    fireEvent.click(screen.getByRole("button", { name: "共有のためにログイン" }));

    await waitFor(() => expect(goTo).toHaveBeenCalledTimes(1));
    expect(readSnapshot(sessionStorage)?.after).toBe("share");
    expect(goTo.mock.calls[0]![0]).toContain("/oauth2/authorize");
  });

  it("同じオリジンの /api/ 以外には、トークンを付けて送らない", async () => {
    storeToken(sessionStorage, SECRET);
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    renderProvider();

    fireEvent.click(screen.getByRole("button", { name: "外へ呼ぶ" }));
    await act(async () => {});

    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("ルーティング", () => {
  const loggedIn = () => storeToken(sessionStorage, SECRET);

  it("メニューの「共有した譜面」で /mine の画面になり、「トップへ戻る」で、組んでいた進行がそのまま戻る", () => {
    loggedIn();
    render(<App config={CONFIG} />);
    fireEvent.click(screen.getByRole("button", { name: "コードを追加" }));
    fireEvent.click(screen.getByRole("button", { name: "アカウントのメニュー" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "共有した譜面" }));

    expect(window.location.pathname).toBe("/mine");
    expect(screen.getByRole("heading", { name: "共有した譜面" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "コード進行" })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "トップへ戻る" }));

    expect(window.location.pathname).toBe("/");
    expect(chordSymbols()).toEqual(["C", "Am", "F", "G7", "C"]);
  });

  it("/s/<ID> を開くと、共有ページの画面が出る", () => {
    window.history.replaceState(null, "", `/s/${ID}`);
    render(<App config={CONFIG} />);
    expect(screen.getByRole("heading", { name: "共有された譜面" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "トップへ戻る" })).toBeTruthy();
  });

  it("ブラウザの戻る・進むに合わせて画面が変わる", () => {
    loggedIn();
    render(<App config={CONFIG} />);
    fireEvent.click(screen.getByRole("button", { name: "アカウントのメニュー" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "共有した譜面" }));

    act(() => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.getByRole("list", { name: "コード進行" })).toBeTruthy();
  });
});

describe("画面のソース", () => {
  it("Cognito のドメインやクライアント ID を直書きしていない（環境変数から読む）", () => {
    const sources = import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    for (const [name, text] of Object.entries(sources)) {
      expect(text, name).not.toMatch(/amazoncognito\.com/);
    }
    expect(sources["./auth-config.ts"]).toContain("VITE_COGNITO_DOMAIN");
    expect(sources["./auth-config.ts"]).toContain("VITE_COGNITO_CLIENT_ID");
    expect(sources["./auth-config.ts"]).toContain("VITE_TURNSTILE_SITE_KEY");
  });
});

/** 初期の進行（C Am F G7）を、退避の形にしたもの。 */
const DEFAULT_CHORDS: Snapshot["chords"] = [
  { root: { letter: "C", accidental: "" }, quality: "", tensions: [], bass: null },
  { root: { letter: "A", accidental: "" }, quality: "m", tensions: [], bass: null },
  { root: { letter: "F", accidental: "" }, quality: "", tensions: [], bass: null },
  { root: { letter: "G", accidental: "" }, quality: "7", tensions: [], bass: null },
];
