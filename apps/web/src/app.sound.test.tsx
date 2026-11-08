import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.tsx";
import { FakeContext } from "./fake-audio.ts";
import { ICONS } from "./icon.tsx";
import styleCss from "./style.css?raw";

// 波形は作らず、周波数をそのまま 1 サンプルに入れる（予約された音の高さを読むため）。
vi.mock("./pluck.ts", () => ({
  PLUCK_SECONDS: 3,
  renderPluck: (frequency: number) => new Float32Array([frequency]),
}));

let contexts: FakeContext[];

class TestAudioContext extends FakeContext {
  constructor() {
    super();
    contexts.push(this);
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  contexts = [];
  vi.stubGlobal("AudioContext", TestAudioContext);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "hidden");
  window.history.replaceState(null, "", "/");
});

const advance = (milliseconds: number) => act(() => void vi.advanceTimersByTime(milliseconds));
const cardPlayButtons = () => screen.getAllByRole("button", { name: "鳴らす" }) as HTMLButtonElement[];
const playAll = () => screen.getByRole("button", { name: "進行を鳴らす" }) as HTMLButtonElement;
const stopButton = () => screen.getByRole("button", { name: "止める" }) as HTMLButtonElement;
const tempoInput = () => screen.getByRole("spinbutton", { name: /テンポ/ }) as HTMLInputElement;
const loopBox = () => screen.getByRole("checkbox", { name: "ループ" }) as HTMLInputElement;
const capoSelect = () => screen.getByRole("combobox", { name: "カポ" }) as HTMLSelectElement;
const steps = () => Array.from(document.querySelectorAll<HTMLElement>(".steps > .step"));
const allSources = () => contexts.flatMap((context) => context.sources);
/** 予約された弦の音の、ピッチクラス（C=0）。 */
const pitchClasses = (sources: readonly { frequency: number }[]) =>
  [...new Set(sources.map((s) => (Math.round(69 + 12 * Math.log2(s.frequency / 440)) + 1200) % 12))].sort((a, b) => a - b);
const BAR_90 = 240 / 90;

const FAILING = () => {
  fireEvent.click(within(screen.getByRole("group", { name: "種類" })).getByRole("radio", { name: "7" }));
  fireEvent.click(screen.getByRole("button", { name: "テンション・ベース" }));
  for (const label of ["♭9", "♯9", "♯11"]) fireEvent.click(screen.getByRole("checkbox", { name: label }));
};

describe("App（音を鳴らす）", () => {
  describe("ボタンと入力", () => {
    it("各カードに「鳴らす」、操作列に「進行を鳴らす」「止める」があり、文字に添えて図が付く", () => {
      render(<App />);
      expect(cardPlayButtons()).toHaveLength(4);
      for (const button of [...cardPlayButtons(), playAll(), stopButton()]) {
        expect(button.firstElementChild?.tagName.toLowerCase()).toBe("svg");
        expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      }
      expect(Object.keys(ICONS)).toEqual(expect.arrayContaining(["play", "stop"]));
      expect(ICONS.play).not.toEqual(ICONS.stop);
      expect(document.querySelector(".score-actions")!.contains(playAll())).toBe(true);
    });

    it("操作の前に音声を始めない: 画面を開いても AudioContext は作られず、ボタンを押して初めて作られる", () => {
      render(<App />);
      advance(5000);
      expect(contexts).toHaveLength(0);
      fireEvent.click(cardPlayButtons()[0]!);
      expect(contexts).toHaveLength(1);
    });

    it("テンポ・ループは操作列にあり、初期値は 90・オフ", () => {
      render(<App />);
      const actions = document.querySelector<HTMLElement>(".score-actions")!;
      expect(actions.contains(tempoInput())).toBe(true);
      expect(actions.contains(loopBox())).toBe(true);
      expect(tempoInput().value).toBe("90");
      expect(loopBox().checked).toBe(false);
    });

    it("再生していないとき「止める」は無効。再生中は有効で、テンポの入力が無効になる。止めると戻る", () => {
      render(<App />);
      expect(stopButton().disabled).toBe(true);
      expect(tempoInput().disabled).toBe(false);
      fireEvent.click(playAll());
      expect(stopButton().disabled).toBe(false);
      expect(tempoInput().disabled).toBe(true);
      fireEvent.click(stopButton());
      expect(stopButton().disabled).toBe(true);
      expect(tempoInput().disabled).toBe(false);
    });

    it("テンポの入力は、フォーカスが外れたときに丸められる（空 → 90、300 → 200、20 → 40、90.5 → 91）", () => {
      render(<App />);
      for (const [typed, rounded] of [["", "90"], ["300", "200"], ["20", "40"], ["90.5", "91"]] as const) {
        fireEvent.change(tempoInput(), { target: { value: typed } });
        fireEvent.blur(tempoInput());
        expect(tempoInput().value).toBe(rounded);
      }
    });

    it("再生を押したときにも丸められ、その速さで鳴る（250 → 200。1 コード 1.2 秒）", () => {
      render(<App />);
      fireEvent.change(tempoInput(), { target: { value: "250" } });
      fireEvent.click(playAll());
      expect(tempoInput().value).toBe("200");
      const first = allSources()[0]!.startedAt!;
      const next = Math.min(...allSources().map((s) => s.startedAt!).filter((t) => t > first + 1));
      expect(next - first).toBeCloseTo(1.2, 6);
    });

    it("進行を鳴らすと、今のコードと次のコードの分だけ予約され、ループなしなら 4 小節で終わる", () => {
      render(<App />);
      fireEvent.click(playAll());
      const reserved = allSources().length;
      expect(reserved).toBeLessThan(16 + 1); // 4 コードの全部（各 4〜6 弦）ではない
      advance(BAR_90 * 6 * 1000);
      expect(allSources().length).toBeGreaterThan(reserved);
      expect(stopButton().disabled).toBe(true);
    });

    it("ループありなら、4 小節を過ぎても続く", () => {
      render(<App />);
      fireEvent.click(loopBox());
      fireEvent.click(playAll());
      advance(BAR_90 * 6 * 1000);
      expect(stopButton().disabled).toBe(false);
    });
  });

  describe("カードの「鳴らす」", () => {
    it("そのコードの押さえ方の音（C の構成音）が予約される。進行は鳴らさない", () => {
      render(<App />);
      fireEvent.click(cardPlayButtons()[0]!);
      expect(pitchClasses(allSources())).toEqual([0, 4, 7]);
      expect(stopButton().disabled).toBe(true);
    });

    it("カポは音の高さに反映される（記号は鳴らす名前のままなので、カポ 2 でも C の構成音）", () => {
      render(<App />);
      fireEvent.change(capoSelect(), { target: { value: "2" } });
      fireEvent.click(cardPlayButtons()[0]!);
      // 押さえる形は B♭（カポ 2 でナットを 2 つ上げた形）。カポを無視すると、B♭ の構成音（10・2・5）が鳴ってしまう。
      // 5 度が省かれることがあるので、C・E・G の部分集合で見る。
      const pcs = pitchClasses(allSources());
      expect(pcs).toEqual(expect.arrayContaining([0, 4]));
      expect(pcs.every((pc) => [0, 4, 7].includes(pc))).toBe(true);
    });

    it("進行の再生中に押すと、進行を止めてそのコードだけ鳴る", () => {
      render(<App />);
      fireEvent.click(playAll());
      const before = allSources().length;
      fireEvent.click(cardPlayButtons()[1]!);
      expect(stopButton().disabled).toBe(true);
      const added = allSources().slice(before);
      expect(pitchClasses(added)).toEqual([0, 4, 9]); // Am
      advance(BAR_90 * 3 * 1000);
      expect(allSources()).toHaveLength(before + added.length);
    });
  });

  describe("再生中のカード", () => {
    it("再生中のカードに印が付き、「選択中」とは別に見分けられる。再生が進むと印が移る", () => {
      render(<App />);
      fireEvent.click(playAll());
      advance(60);
      expect(steps().map((step) => step.classList.contains("playing"))).toEqual([true, false, false, false]);
      advance(BAR_90 * 1000);
      expect(steps().map((step) => step.classList.contains("playing"))).toEqual([false, true, false, false]);
      // 選択中は 1 枚目のまま。印は選択の状態を変えない
      const pressed = steps().map((step) => step.querySelector(".step-select")!.getAttribute("aria-pressed"));
      expect(pressed).toEqual(["true", "false", "false", "false"]);
    });

    it("止めると印が消える", () => {
      render(<App />);
      fireEvent.click(playAll());
      advance(60);
      fireEvent.click(stopButton());
      expect(steps().some((step) => step.classList.contains("playing"))).toBe(false);
    });
  });

  describe("止まる条件", () => {
    const start = () => {
      fireEvent.click(playAll());
      advance(60);
      expect(stopButton().disabled).toBe(false);
    };

    it("再生中にカポを変えると止まる", () => {
      render(<App />);
      start();
      fireEvent.change(capoSelect(), { target: { value: "3" } });
      expect(stopButton().disabled).toBe(true);
      expect(allSources().every((s) => s.stoppedAt !== null)).toBe(true);
    });

    it("再生中に進行（コード）を変えると止まる", () => {
      render(<App />);
      start();
      fireEvent.click(screen.getByRole("button", { name: "コードを追加" }));
      expect(stopButton().disabled).toBe(true);
    });

    it("再生中に押さえ方を固定すると止まる", () => {
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: "押さえ方" }));
      start();
      const candidates = within(screen.getByRole("group", { name: "押さえ方の候補" })).getAllByRole("button");
      fireEvent.click(candidates.find((button) => button.getAttribute("aria-pressed") === "false")!);
      expect(document.querySelector(".step-pinned")).not.toBeNull();
      expect(stopButton().disabled).toBe(true);
    });

    it("タブが非表示になると止まる", () => {
      render(<App />);
      start();
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      act(() => void document.dispatchEvent(new Event("visibilitychange")));
      expect(stopButton().disabled).toBe(true);
      expect(allSources().every((s) => s.stoppedAt !== null)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("再生中に別の画面（自分の一覧）へ移ると止まる。ループの操作列が消えても鳴り続けない", () => {
      vi.stubGlobal("fetch", () => new Promise(() => undefined));
      window.history.replaceState(null, "", "/");
      render(<App config={{ cognitoDomain: "https://example.auth.ap-northeast-1.amazoncognito.com", clientId: "c", turnstileSiteKey: "k" }} />);
      fireEvent.click(loopBox());
      start();
      act(() => {
        window.history.pushState(null, "", "/mine");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      expect(screen.queryByRole("button", { name: "止める" })).toBeNull();
      expect(allSources().every((s) => s.stoppedAt !== null)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("再生中はループも切り替えられない（始めた時点の値で固定されるため）", () => {
      render(<App />);
      start();
      expect(loopBox().disabled).toBe(true);
    });

    it("タブが表示されたままの visibilitychange では止まらない", () => {
      render(<App />);
      start();
      act(() => void document.dispatchEvent(new Event("visibilitychange")));
      expect(stopButton().disabled).toBe(false);
    });

    it("画面を閉じると止まり、AudioContext も閉じる", () => {
      const { unmount } = render(<App />);
      start();
      unmount();
      expect(contexts[0]!.closed).toBe(true);
      expect(allSources().every((s) => s.stoppedAt !== null)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("鳴らせないとき", () => {
    it("押さえ方が決まらないとき（失敗の表示が出ているとき）は、3 種のボタンがすべて無効", () => {
      render(<App />);
      FAILING();
      expect(screen.getByRole("alert")).toBeTruthy();
      for (const button of [...cardPlayButtons(), playAll(), stopButton()]) expect(button.disabled).toBe(true);
    });

    it("再生中に押さえ方が決まらなくなると、止まる", () => {
      render(<App />);
      fireEvent.click(playAll());
      FAILING();
      expect(allSources().every((s) => s.stoppedAt !== null)).toBe(true);
      expect(stopButton().disabled).toBe(true);
    });

    it("AudioContext が無い環境では、ボタンが無効で「この環境では音を出せません」と出る", () => {
      vi.stubGlobal("AudioContext", undefined);
      render(<App />);
      expect(screen.getByText("この環境では音を出せません")).toBeTruthy();
      for (const button of [...cardPlayButtons(), playAll()]) expect(button.disabled).toBe(true);
    });

    it("AudioContext を作るのに失敗したら、押した後にボタンが無効になり、同じ文が出る", () => {
      vi.stubGlobal(
        "AudioContext",
        class {
          constructor() {
            throw new Error("blocked");
          }
        },
      );
      render(<App />);
      expect(screen.queryByText("この環境では音を出せません")).toBeNull();
      fireEvent.click(cardPlayButtons()[0]!);
      expect(screen.getByText("この環境では音を出せません")).toBeTruthy();
      for (const button of [...cardPlayButtons(), playAll()]) expect(button.disabled).toBe(true);
    });

    it("音が出せる環境では、その文は出ない", () => {
      render(<App />);
      expect(screen.queryByText("この環境では音を出せません")).toBeNull();
    });
  });
});

describe("style.css（音を鳴らす）", () => {
  const print = styleCss.slice(styleCss.indexOf("@media print"));

  it("印刷では、カードの「鳴らす」も隠す（アイコン付きボタンの display に負けないよう、種類まで書く）", () => {
    const hidden = print.match(/([^{}]+)\{\s*display:\s*none;?\s*\}/)?.[1] ?? "";
    const selectors = hidden.split(",").map((selector) => selector.replace(/\/\*.*?\*\//g, "").trim());
    expect(selectors).toContain("button.step-play");
    expect(selectors).toContain(".score-actions");
  });

  it("再生中のカードの上端の太い線は、変数 --accent で付く（色の直書きなし）", () => {
    const block = styleCss.match(/\.step\.playing \{([^}]*)\}/)![1]!;
    expect(block).toMatch(/box-shadow:\s*inset 0 [4-9]px 0 var\(--accent\)/);
    expect(block).toContain("var(--accent)");
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  });

  it("「鳴らす」ボタンは、カード全体を覆う ::after の上に重なって押せる", () => {
    const block = styleCss.match(/button\.step-play \{([^}]*)\}/)![1]!;
    expect(block).toMatch(/position:\s*relative/);
    expect(block).toMatch(/z-index:\s*[1-9]/);
  });
});
