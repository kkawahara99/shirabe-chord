import type { SoundingNote } from "@shirabe-chord/core";
import { renderPluck } from "./pluck.ts";

/** ストラムで、低い弦から高い弦へずらす間隔（秒）。 */
export const STRUM_SECONDS = 0.025;
/** 全体の音量。 */
export const MASTER_VOLUME = 0.3;
/** 音の立ち上がりと、止めるときのフェードの長さ（秒）。 */
export const FADE_SECONDS = 0.005;
/** 鳴らし始めを、今より少し先にする（秒）。予約が間に合わないのを避ける。 */
const LEAD_SECONDS = 0.05;
const BEATS_PER_CHORD = 4;

type ParamLike = {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  cancelScheduledValues(time: number): unknown;
};
type GainLike = { readonly gain: ParamLike; connect(destination: unknown): unknown; disconnect(): void };
type BufferLike = { getChannelData(channel: number): Float32Array };
type SourceLike = {
  buffer: BufferLike | null;
  onended: (() => void) | null;
  connect(destination: unknown): unknown;
  disconnect(): void;
  start(when: number): void;
  stop(when: number): void;
};

/** 予約の層が `AudioContext` に求めるものだけ。テストでは偽物を渡す。 */
export type AudioContextLike = {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: unknown;
  readonly state?: string;
  resume?(): Promise<void>;
  close?(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createBufferSource(): SourceLike;
  createGain(): GainLike;
};

export type PlaybackState = {
  /** 進行を再生している間は真（1 コードだけ鳴らしているときは偽）。 */
  readonly playing: boolean;
  /** 今のコードの番号（0 始まり）。進行の最初のコードの頭までは `null`。 */
  readonly active: number | null;
};

export type PlayerOptions = {
  /** `AudioContext` を作る。鳴らす操作のときに初めて呼ぶ。失敗（例外）は鳴らせない扱いにする。 */
  createContext: () => AudioContextLike;
  /** 波形を作る。既定は撥弦音。 */
  render?: (frequency: number, sampleRate: number) => Float32Array;
  random?: () => number;
  onChange?: (state: PlaybackState) => void;
};

export type Player = {
  /** 1 コードをストラムで鳴らす。鳴っている音は止める。鳴らせなければ `false`。 */
  playChord(notes: readonly SoundingNote[]): boolean;
  /** 進行を鳴らす。1 コード = 4 拍。鳴らせなければ `false`。 */
  playProgression(
    chords: readonly (readonly SoundingNote[])[],
    options: { tempo: number; loop: boolean },
  ): boolean;
  /** タイマーと予約を取り消し、鳴っている音を切る。 */
  stop(): void;
  /** 止めて、`AudioContext` を閉じる。 */
  dispose(): void;
};

const IDLE: PlaybackState = { playing: false, active: null };

type Voice = { readonly source: SourceLike; readonly gain: GainLike };

export function createPlayer(options: PlayerOptions): Player {
  const render = options.render ?? ((frequency, sampleRate) => renderPluck(frequency, sampleRate, options.random));
  let context: AudioContextLike | null = null;
  let master: GainLike | null = null;
  let buffers = new Map<number, BufferLike>();
  const voices = new Set<Voice>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** 止めるたびに進める。残ったタイマーの処理が、止めたあとに予約しないための印。 */
  let generation = 0;
  let state = IDLE;

  const emit = (next: PlaybackState) => {
    state = next;
    options.onChange?.(next);
  };

  const later = (milliseconds: number, run: () => void) => {
    const mine = generation;
    const id = setTimeout(() => {
      timers.delete(id);
      if (mine === generation) run();
    }, Math.max(0, milliseconds));
    timers.add(id);
  };

  const ensureContext = (): AudioContextLike | null => {
    try {
      if (!context) {
        const created = options.createContext();
        const gain = created.createGain();
        gain.gain.value = MASTER_VOLUME;
        gain.connect(created.destination);
        context = created;
        master = gain;
      }
      if (context.state === "suspended") context.resume?.()?.catch(() => undefined);
      return context;
    } catch {
      context = null;
      master = null;
      return null;
    }
  };

  const bufferFor = (ctx: AudioContextLike, note: SoundingNote): BufferLike => {
    let buffer = buffers.get(note.midi);
    if (!buffer) {
      const wave = render(note.frequency, ctx.sampleRate);
      buffer = ctx.createBuffer(1, wave.length, ctx.sampleRate);
      buffer.getChannelData(0).set(wave);
      buffers.set(note.midi, buffer);
    }
    return buffer;
  };

  const strum = (ctx: AudioContextLike, notes: readonly SoundingNote[], at: number) => {
    notes.forEach((note, i) => {
      const when = at + i * STRUM_SECONDS;
      const source = ctx.createBufferSource();
      source.buffer = bufferFor(ctx, note);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(1, when + FADE_SECONDS);
      source.connect(gain);
      gain.connect(master);
      const voice: Voice = { source, gain };
      voices.add(voice);
      source.onended = () => {
        voices.delete(voice);
        source.disconnect();
        gain.disconnect();
      };
      source.start(when);
    });
  };

  const silence = () => {
    generation++;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    if (context) {
      const now = context.currentTime;
      for (const { source, gain } of voices) {
        // 立ち上がりの予約が残っていると、そこから下がり始めてしまう。今の値から 5ms で 0 にする。
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
        source.stop(now + FADE_SECONDS);
      }
    }
    voices.clear();
    if (state.playing) emit(IDLE);
  };

  return {
    playChord(notes) {
      const ctx = ensureContext();
      if (!ctx) return false;
      silence();
      strum(ctx, notes, ctx.currentTime + LEAD_SECONDS);
      return true;
    },

    playProgression(chords, { tempo, loop }) {
      const ctx = ensureContext();
      if (!ctx || chords.length === 0) return false;
      silence();
      const bar = (BEATS_PER_CHORD * 60) / tempo;
      const origin = ctx.currentTime + LEAD_SECONDS;
      let next = 0;
      emit({ playing: true, active: null });

      /** 今のコードと次のコードの分だけ予約する。半小節ごとに呼んで、切り替えの前に次を足す。 */
      const pump = () => {
        const now = ctx.currentTime;
        while ((loop || next < chords.length) && origin + next * bar < now + 2 * bar) {
          const index = next % chords.length;
          const start = origin + next * bar;
          strum(ctx, chords[index]!, start);
          later((start - now) * 1000, () => emit({ playing: true, active: index }));
          next++;
        }
        if (loop || next < chords.length) later((bar / 2) * 1000, pump);
        else later((origin + chords.length * bar - now) * 1000, () => emit(IDLE));
      };
      pump();
      return true;
    },

    stop: silence,

    dispose() {
      silence();
      const closing = context;
      context = null;
      master = null;
      buffers = new Map();
      closing?.close?.()?.catch(() => undefined);
    },
  };
}
