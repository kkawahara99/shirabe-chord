/** テスト用の偽の AudioContext（予約の層を見るため。波形は作らず、音の高さは `render` に入れた値で見る）。 */
import type { AudioContextLike } from "./player.ts";

export type GainEvent = readonly ["set" | "ramp", number, number];

export class FakeGain {
  events: GainEvent[] = [];
  target: unknown = null;
  disconnected = false;
  gain = {
    value: 1,
    setValueAtTime: (value: number, time: number) => void this.events.push(["set", value, time]),
    linearRampToValueAtTime: (value: number, time: number) => void this.events.push(["ramp", value, time]),
    cancelScheduledValues: () => undefined,
  };
  connect(target: unknown) {
    this.target = target;
  }
  disconnect() {
    this.disconnected = true;
  }
}

export class FakeSource {
  buffer: { getChannelData: (channel: number) => Float32Array } | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  target: unknown = null;
  onended: (() => void) | null = null;
  connect(target: unknown) {
    this.target = target;
  }
  disconnect() {}
  start(when: number) {
    this.startedAt = when;
  }
  stop(when: number) {
    this.stoppedAt = when;
  }
  /** `render` がサンプル 1 個に入れた周波数。 */
  get frequency() {
    return this.buffer!.getChannelData(0)[0]!;
  }
  get voiceGain() {
    return this.target as FakeGain;
  }
}

export class FakeContext implements AudioContextLike {
  private readonly origin = Date.now();
  sampleRate = 8000;
  destination = { name: "destination" };
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  closed = false;
  get currentTime() {
    return (Date.now() - this.origin) / 1000;
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}
