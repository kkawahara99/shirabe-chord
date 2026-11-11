import { lowerSymbol, type SharedScore } from "@shirabe-chord/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import type { AuthConfig } from "./auth-config.ts";
import { storeToken } from "./login.ts";
import { voicingLabel } from "./voicing-diagram.tsx";

const CONFIG: AuthConfig = {
  cognitoDomain: "https://example.auth.ap-northeast-1.amazoncognito.com",
  clientId: "client-id",
  turnstileSiteKey: "site-key",
};
const ID = "AbCdEfGhIjKlMnOpQrSt-_";

// カポ 2 の「鳴らす名前」は D・A。押さえ方はカポをナットとみなした形（C・G）。
const SCORE: SharedScore = {
  title: "朝の曲",
  note: "サビは強めに\n二行目",
  displayName: "作曲者",
  capo: 2,
  chords: [
    { symbol: "D", voicing: [null, 3, 2, 0, 1, 0] },
    { symbol: "A", voicing: [3, 2, 0, 0, 0, 3] },
  ],
};

type Call = { url: string; init: RequestInit | undefined };
let calls: Call[];
const serve = (respond: () => Response | Promise<Response>) => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return respond();
    }),
  );
};
const found = (score: unknown = SCORE) => () => new Response(JSON.stringify({ score, createdAt: "2026-11-07T09:00:00.000Z" }), { status: 200 });

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", `/s/${ID}`);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

const view = () => within(screen.getByRole("main"));
const chordButtons = () =>
  within(screen.getByRole("list", { name: "コード進行" }))
    .getAllByRole("button")
    .filter((button) => button.hasAttribute("aria-pressed"));
const pinned = () => Array.from(document.querySelectorAll(".steps > .step")).flatMap((element, i) => (element.querySelector(".step-pinned") ? [i] : []));
const expectedLabels = () => SCORE.chords.map(({ symbol, voicing }) => voicingLabel(lowerSymbol(symbol, SCORE.capo), voicing));

describe("共有ページ /s/<ID>", () => {
  it("取得して、タイトル・ひと言・表示名・カポ・各コードの押さえ方を出す", async () => {
    serve(found());
    render(<App config={CONFIG} />);

    await view().findByText("朝の曲");
    expect(view().getByRole("heading", { name: "共有された譜面" })).toBeTruthy();
    expect(view().getByText(/サビは強めに/).textContent).toBe("サビは強めに\n二行目");
    expect(view().getByText("共有した人：作曲者")).toBeTruthy();
    expect(view().getByText("カポ2")).toBeTruthy();
    expect(view().getByText("D")).toBeTruthy();
    expect(view().getByText("A")).toBeTruthy();
    expect(view().getByText("Cの形")).toBeTruthy(); // カポ 2 の D は、C の形で押さえる
    expect(view().getAllByRole("img").map((img) => img.getAttribute("aria-label"))).toEqual(expectedLabels());
  });

  it("各コードの図に指番号を出す（C の形 x32010 は 3・2・1）", async () => {
    serve(found());
    render(<App config={CONFIG} />);
    await view().findByText("朝の曲");
    const first = document.querySelector(".steps > .step")!;
    expect(Array.from(first.querySelectorAll('[data-mark="finger"]')).map((e) => e.textContent)).toEqual(["3", "2", "1"]);
  });

  it("読み込み中は、その旨を出す", async () => {
    serve(() => new Promise<Response>(() => {}));
    render(<App config={CONFIG} />);
    expect(await view().findByText("読み込み中")).toBeTruthy();
  });

  it("ログインしていなくても開ける。取得は ID だけで、トークンを送らない", async () => {
    serve(found());
    render(<App config={CONFIG} />);
    await view().findByText("朝の曲");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`/api/shares/${ID}`);
    expect(new Headers(calls[0]!.init?.headers).has("authorization")).toBe(false);
  });

  it("ログイン済みでも、トークンを送らない", async () => {
    storeToken(sessionStorage, "secret-access-token-123");
    serve(found());
    render(<App config={CONFIG} />);
    await view().findByText("朝の曲");
    expect(new Headers(calls[0]!.init?.headers).has("authorization")).toBe(false);
  });

  it("ひと言が空なら、ひと言の欄を出さない", async () => {
    serve(found({ ...SCORE, note: "" }));
    render(<App config={CONFIG} />);
    await view().findByText("朝の曲");
    expect(document.querySelector(".share-note")).toBeNull();
  });

  it("タイトル・ひと言・表示名に HTML を入れても、文字として出て要素にならない", async () => {
    const title = "<script>window.__pwned = 1</script>";
    const note = "<img src=x onerror=alert(1)>";
    const displayName = "<b>太字</b>";
    serve(found({ ...SCORE, title, note, displayName }));
    render(<App config={CONFIG} />);

    await view().findByText(title);
    const main = screen.getByRole("main");
    expect(main.textContent).toContain(note);
    expect(main.textContent).toContain(displayName);
    expect(main.querySelector("script, img, b")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("保存した押さえ方は、構成音などの検証に通らなくなっても、形が正しければ表示する（コアの検証が将来厳しくなっても読める）", async () => {
    const voicing = [1, 1, 1, 1, 1, 1] as const; // D の押さえ方としては合っていない
    serve(found({ ...SCORE, chords: [{ symbol: "D", voicing }] }));
    render(<App config={CONFIG} />);
    await view().findByText("朝の曲");
    expect(view().getAllByRole("img")).toHaveLength(1);
    expect(view().getByRole("button", { name: "この譜面を編集する" })).toBeTruthy();
  });

  it("存在しない ID（404）は、見つからない旨の案内を出す", async () => {
    serve(() => new Response('{"error":"not-found"}', { status: 404 }));
    render(<App config={CONFIG} />);
    expect((await view().findByRole("alert")).textContent).toMatch(/見つかりません/);
    expect(view().queryByRole("button", { name: "この譜面を編集する" })).toBeNull();
  });

  it.each([
    ["通信の失敗", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["サーバーの失敗（503）", () => new Response('{"error":"unavailable"}', { status: 503 })],
    ["壊れた応答", () => new Response("<html>", { status: 200 })],
    ["譜面の形でない応答", () => new Response(JSON.stringify({ score: { title: "x" } }), { status: 200 })],
    ["弦の数が違う押さえ方", found({ ...SCORE, chords: [{ symbol: "D", voicing: [1, 1, 1] }] })],
    ["フレットが文字列の押さえ方", found({ ...SCORE, chords: [{ symbol: "D", voicing: [1, 1, 1, 1, 1, "x"] }] })],
    ["フレットが整数でない押さえ方", found({ ...SCORE, chords: [{ symbol: "D", voicing: [1, 1, 1, 1, 1, 1.5] }] })],
    ["フレットが負の押さえ方", found({ ...SCORE, chords: [{ symbol: "D", voicing: [1, 1, 1, 1, 1, -1] }] })],
    ["フレットが大きすぎる押さえ方", found({ ...SCORE, chords: [{ symbol: "D", voicing: [1, 1, 1, 1, 1, 99] }] })],
    ["コードが 0 件", found({ ...SCORE, chords: [] })],
    ["コードが多すぎる", found({ ...SCORE, chords: Array.from({ length: 65 }, () => SCORE.chords[0]) })],
    ["表にないカポ", found({ ...SCORE, capo: 8 })],
    ["カポが文字列", found({ ...SCORE, capo: "2" })],
    ["読めない記号", found({ ...SCORE, chords: [{ symbol: "Hm", voicing: [1, 1, 1, 1, 1, 1] }] })],
  ])("%s：「読み込めませんでした」の案内を出す", async (_name, respond) => {
    serve(respond);
    render(<App config={CONFIG} />);
    expect((await view().findByRole("alert")).textContent).toMatch(/読み込めませんでした/);
  });

  it("形が不正な ID（/s/short）は、取得せずトップを出す", () => {
    serve(found());
    window.history.replaceState(null, "", "/s/short");
    render(<App config={CONFIG} />);
    expect(screen.getByRole("list", { name: "コード進行" })).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("読み取り専用：入力欄・コードの削除・共有・印刷のボタンは出ない", async () => {
    serve(found());
    render(<App config={CONFIG} />);
    await view().findByText("朝の曲");
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /削除/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "共有する" })).toBeNull();
    expect(document.querySelector(".step-remove, .step-add")).toBeNull();
  });
});

describe("この譜面を編集する", () => {
  const edit = async () => {
    serve(found());
    render(<App config={CONFIG} />);
    await view().findByText("朝の曲");
    fireEvent.click(view().getByRole("button", { name: "この譜面を編集する" }));
  };

  it("トップに移り、進行・カポが共有と同じで、各コードが固定された状態になる", async () => {
    await edit();

    expect(window.location.pathname).toBe("/");
    expect(chordButtons().map((b) => b.dataset.symbol)).toEqual(["D", "A"]);
    expect((screen.getByRole("combobox", { name: "カポ" }) as HTMLSelectElement).value).toBe("2");
    expect(pinned()).toEqual([0, 1]);
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("aria-label"))).toEqual(expectedLabels());
  });

  it("固定は「おまかせ」で外せる。共有元には何も送らない", async () => {
    await edit();
    fireEvent.click(chordButtons()[0]!);
    fireEvent.click(screen.getByRole("button", { name: "押さえ方" }));
    fireEvent.click(screen.getByRole("button", { name: "おまかせ（押さえ方を自動で選ぶ）" }));

    expect(pinned()).toEqual([1]);
    await waitFor(() => expect(calls).toHaveLength(1)); // 取得の 1 回だけ
    expect(calls[0]!.init?.method ?? "GET").toBe("GET");
  });
});
