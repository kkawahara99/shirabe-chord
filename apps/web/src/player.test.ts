import { soundingNotes, type Voicing } from "@shirabe-chord/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeContext, type FakeSource } from "./fake-audio.ts";
import {
  FADE_SECONDS,
  MASTER_VOLUME,
  STRUM_SECONDS,
  createPlayer,
  type AudioContextLike,
  type PlaybackState,
  type Player,
} from "./player.ts";

// C メジャー（x32010）。低い弦から C3 E3 G3 C4 E4
const C_MAJOR: Voicing = [null, 3, 2, 0, 1, 0];
const G_MAJOR: Voicing = [3, 2, 0, 0, 0, 3];
const A_MINOR: Voicing = [null, 0, 2, 2, 1, 0];
const at = (voicing: Voicing, capo = 0) => soundingNotes(voicing, capo);
const midisOf = (voicing: Voicing, capo = 0) => at(voicing, capo).map((n) => n.midi);

let context: FakeContext;
let render: ReturnType<typeof vi.fn<(frequency: number, sampleRate: number) => Float32Array>>;
let states: PlaybackState[];
let createContext: ReturnType<typeof vi.fn<() => AudioContextLike>>;
let player: Player;

beforeEach(() => {
  vi.useFakeTimers();
  context = new FakeContext();
  render = vi.fn((frequency: number) => new Float32Array([frequency]));
  states = [];
  createContext = vi.fn(() => context);
  player = createPlayer({ createContext, render, onChange: (state) => states.push(state) });
});

afterEach(() => {
  vi.useRealTimers();
});

const frequencies = (sources: readonly FakeSource[]) => sources.map((s) => s.frequency);
/** 偽の `render` は周波数を Float32Array に入れるので、期待値も Float32 に丸める。 */
const expectedFrequencies = (voicing: Voicing, capo = 0) => at(voicing, capo).map((n) => Math.fround(n.frequency));
const starts = (sources: readonly FakeSource[]) => sources.map((s) => s.startedAt!);
const BAR = (tempo: number) => (4 * 60) / tempo;

describe("player（コードの音を予約して鳴らす）", () => {
  describe("1 コードのストラム", () => {
    it("鳴る弦の数だけ予約され、低い弦から高い弦の順に 25ms ずつ開始が遅れる", () => {
      expect(player.playChord(at(C_MAJOR))).toBe(true);
      expect(context.sources).toHaveLength(5);
      const s = starts(context.sources);
      for (let i = 1; i < s.length; i++) expect(s[i]! - s[i - 1]!).toBeCloseTo(STRUM_SECONDS, 6);
      expect(STRUM_SECONDS).toBe(0.025);
      expect(s[0]!).toBeGreaterThanOrEqual(context.currentTime);
    });

    it("弦の音の高さ: 予約された波形は押さえ方の音（低い弦から C3 E3 G3 C4 E4）になる", () => {
      player.playChord(at(C_MAJOR));
      expect(midisOf(C_MAJOR)).toEqual([48, 52, 55, 60, 64]);
      expect(frequencies(context.sources)).toEqual(expectedFrequencies(C_MAJOR));
    });

    it("カポの反映: カポ 2 なら、全弦が 2 半音高い波形になる", () => {
      player.playChord(at(C_MAJOR, 2));
      expect(frequencies(context.sources)).toEqual(expectedFrequencies(C_MAJOR, 2));
      const plain = expectedFrequencies(C_MAJOR);
      frequencies(context.sources).forEach((f, i) => expect(f / plain[i]!).toBeCloseTo(2 ** (2 / 12), 6));
    });

    it("波形の使い回し: 同じ MIDI ノートの波形は 1 回だけ作る（同じコードを 2 回鳴らしても作り直さない）", () => {
      player.playChord(at(C_MAJOR));
      player.playChord(at(C_MAJOR));
      expect(context.sources).toHaveLength(10);
      expect(render).toHaveBeenCalledTimes(5);
      player.playChord(at(A_MINOR)); // 共通の音（E3・C4 など）は作り直さない
      const distinct = new Set([...midisOf(C_MAJOR), ...midisOf(A_MINOR)]).size;
      expect(render).toHaveBeenCalledTimes(distinct);
    });

    it("音量と包絡: マスター音量は 0.3 以下、立ち上がりとフェードアウトは 5ms", () => {
      player.playChord(at(C_MAJOR));
      const master = context.gains.find((g) => g.target === context.destination)!;
      expect(MASTER_VOLUME).toBeLessThanOrEqual(0.3);
      expect(master.gain.value).toBe(MASTER_VOLUME);
      expect(FADE_SECONDS).toBe(0.005);
      for (const source of context.sources) {
        const [attackFrom, attackTo] = source.voiceGain.events;
        expect(attackFrom).toEqual(["set", 0, source.startedAt]);
        expect(attackTo![0]).toBe("ramp");
        expect(attackTo![1]).toBe(1);
        expect(attackTo![2]).toBeCloseTo(source.startedAt! + 0.005, 6);
        expect(source.voiceGain.target).toBe(master);
      }
    });
  });

  describe("進行の再生", () => {
    const progression = [at(C_MAJOR), at(G_MAJOR), at(A_MINOR)];

    it("1 コード = 4 拍（テンポ 90 なら約 2.67 秒）ごとに、コードの頭でストラムする", () => {
      expect(player.playProgression(progression, { tempo: 90, loop: false })).toBe(true);
      const first = context.sources.slice(0, 5);
      const second = context.sources.slice(5, 5 + at(G_MAJOR).length);
      expect(BAR(90)).toBeCloseTo(2.6667, 3);
      expect(starts(second)[0]! - starts(first)[0]!).toBeCloseTo(BAR(90), 6);
      expect(frequencies(second)).toEqual(expectedFrequencies(G_MAJOR));
    });

    it("テンポで長さが変わる（テンポ 120 なら 2 秒）", () => {
      player.playProgression(progression, { tempo: 120, loop: false });
      const gap = context.sources[5]!.startedAt! - context.sources[0]!.startedAt!;
      expect(gap).toBeCloseTo(2, 6);
    });

    it("先読み: 開始時は今のコードと次のコードの分だけ予約する。64 コードでも一度に全部は予約しない", () => {
      const many = Array.from({ length: 64 }, () => at(C_MAJOR));
      player.playProgression(many, { tempo: 200, loop: true });
      expect(context.sources).toHaveLength(10);
    });

    it("切り替え前に次を予約する: タイマーが進むと、次の次のコードの分が予約される", () => {
      player.playProgression(progression, { tempo: 90, loop: false });
      expect(context.sources).toHaveLength(5 + 6);
      vi.advanceTimersByTime((BAR(90) / 2) * 1000 + 1);
      expect(context.sources).toHaveLength(5 + 6 + 5);
      expect(frequencies(context.sources.slice(11))).toEqual(expectedFrequencies(A_MINOR));
      // その時点で、次のコード（2 番目）はまだ始まっていない
      expect(context.currentTime).toBeLessThan(context.sources[5]!.startedAt!);
    });

    it("ループなし: 最後のコードを過ぎたら予約が止まり、再生が終わった状態に戻る", () => {
      player.playProgression(progression, { tempo: 90, loop: false });
      vi.advanceTimersByTime(BAR(90) * 5 * 1000);
      expect(context.sources).toHaveLength(5 + 6 + 5);
      expect(vi.getTimerCount()).toBe(0);
      expect(states.at(-1)).toEqual({ playing: false, active: null });
    });

    it("ループあり: 最後のコードの次は先頭に戻って予約される（2 周目の開始時刻が連続している）", () => {
      const two = [at(C_MAJOR), at(G_MAJOR)];
      player.playProgression(two, { tempo: 90, loop: true });
      vi.advanceTimersByTime(BAR(90) * 1.6 * 1000); // 2 周目の頭（3 番目の位置）が予約済みになる
      const third = context.sources.slice(11, 16);
      expect(frequencies(third)).toEqual(expectedFrequencies(C_MAJOR));
      expect(third[0]!.startedAt! - context.sources[0]!.startedAt!).toBeCloseTo(BAR(90) * 2, 6);
      vi.advanceTimersByTime(BAR(90) * 4 * 1000);
      expect(states.at(-1)!.playing).toBe(true);
    });

    it("コードの頭で、今のコードの番号を知らせる（ループで先頭に戻る）", () => {
      player.playProgression([at(C_MAJOR), at(G_MAJOR)], { tempo: 90, loop: true });
      expect(states.at(-1)).toEqual({ playing: true, active: null });
      vi.advanceTimersByTime(60);
      expect(states.at(-1)).toEqual({ playing: true, active: 0 });
      vi.advanceTimersByTime(BAR(90) * 1000);
      expect(states.at(-1)).toEqual({ playing: true, active: 1 });
      vi.advanceTimersByTime(BAR(90) * 1000);
      expect(states.at(-1)).toEqual({ playing: true, active: 0 });
    });
  });

  describe("止める", () => {
    it("タイマーと予約済みの再生ノードの両方が取り消され、鳴っている音も 5ms で切れる", () => {
      player.playProgression([at(C_MAJOR), at(G_MAJOR)], { tempo: 90, loop: true });
      vi.advanceTimersByTime(1000);
      const now = context.currentTime;
      player.stop();
      expect(vi.getTimerCount()).toBe(0);
      for (const source of context.sources) {
        expect(source.stoppedAt).not.toBeNull();
        expect(source.stoppedAt!).toBeCloseTo(now + FADE_SECONDS, 6);
        expect(source.voiceGain.events.at(-1)).toEqual(["ramp", 0, source.stoppedAt]);
      }
      expect(states.at(-1)).toEqual({ playing: false, active: null });
    });

    it("止めたあと、タイマーが残っていても何も予約されない", () => {
      const callbacks: (() => void)[] = [];
      const real = globalThis.setTimeout;
      vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
        callbacks.push(fn);
        return real(fn, ms);
      }) as typeof setTimeout);
      player.playProgression([at(C_MAJOR), at(G_MAJOR)], { tempo: 90, loop: true });
      expect(callbacks.length).toBeGreaterThan(0);
      player.stop();
      const count = context.sources.length;
      for (const callback of callbacks) callback();
      expect(context.sources).toHaveLength(count);
    });

    it("鳴らしていないときに止めても何も起きない（状態も通知しない）", () => {
      player.stop();
      expect(states).toEqual([]);
      expect(createContext).not.toHaveBeenCalled();
    });

    it("進行の再生中にコードを 1 つ鳴らすと、進行を止めてそのコードだけ鳴る", () => {
      player.playProgression([at(C_MAJOR), at(G_MAJOR)], { tempo: 90, loop: true });
      const before = [...context.sources];
      player.playChord(at(A_MINOR));
      for (const source of before) expect(source.stoppedAt).not.toBeNull();
      const added = context.sources.slice(before.length);
      expect(frequencies(added)).toEqual(expectedFrequencies(A_MINOR));
      for (const source of added) expect(source.stoppedAt).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      expect(states.at(-1)).toEqual({ playing: false, active: null });
    });

    it("破棄すると止めて、AudioContext を閉じる。次に鳴らすときは作り直す", () => {
      player.playChord(at(C_MAJOR));
      player.dispose();
      expect(context.closed).toBe(true);
      expect(context.sources.every((s) => s.stoppedAt !== null)).toBe(true);
      const next = new FakeContext();
      createContext.mockReturnValue(next);
      player.playChord(at(C_MAJOR));
      expect(next.sources).toHaveLength(5);
    });
  });

  describe("音声の始まり", () => {
    it("操作の前に音声を始めない: 作っただけでは AudioContext を作らず、鳴らして初めて作る（以降は使い回す）", () => {
      expect(createContext).not.toHaveBeenCalled();
      player.playChord(at(C_MAJOR));
      player.playProgression([at(C_MAJOR)], { tempo: 90, loop: false });
      expect(createContext).toHaveBeenCalledTimes(1);
    });

    it("止まっている AudioContext は、鳴らすときに再開する", () => {
      const resume = vi.fn(() => Promise.resolve());
      Object.assign(context, { state: "suspended", resume });
      player.playChord(at(C_MAJOR));
      expect(resume).toHaveBeenCalled();
    });

    it("AudioContext を作るのに失敗したら、例外にせず false を返す", () => {
      createContext.mockImplementation(() => {
        throw new Error("blocked");
      });
      expect(player.playChord(at(C_MAJOR))).toBe(false);
      expect(player.playProgression([at(C_MAJOR)], { tempo: 90, loop: false })).toBe(false);
      expect(states).toEqual([]);
    });
  });
});
