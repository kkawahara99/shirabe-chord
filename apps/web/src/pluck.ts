/** 1 音の長さ（秒）。ADR 0038。 */
export const PLUCK_SECONDS = 3;

/** 1 周ごとの減衰。大きいほど長く鳴る。 */
const LOOP_GAIN = 0.996;
/** 末尾で 0 に落とす長さ（秒）。ぶつ切りの雑音を避ける。 */
const TAIL_SECONDS = 0.1;
const PEAK = 0.9;

/**
 * 弦の撥弦音（Karplus-Strong 法）を、モノラルの波形で返す。雑音の入った遅延線を、2 点の平均で減衰させる。
 * 遅延線の長さは整数なので、端数は全域通過フィルタで補って、高い音でも音程が狂わないようにする。
 * `random` は 0 以上 1 未満の乱数（テストで差し替える）。
 */
export function renderPluck(frequency: number, sampleRate: number, random: () => number = Math.random): Float32Array {
  const length = Math.round(PLUCK_SECONDS * sampleRate);
  const out = new Float32Array(length);
  // 遅延の合計 = 線の長さ + 平均の 0.5 + 全域通過の端数
  const total = sampleRate / frequency - 0.5;
  const lineLength = Math.max(2, Math.floor(total));
  const fraction = Math.max(0, total - lineLength);
  const coefficient = (1 - fraction) / (1 + fraction);

  for (let n = 0; n < lineLength; n++) out[n] = random() * 2 - 1;
  let previousInput = 0;
  let previousOutput = 0;
  for (let n = lineLength; n < length; n++) {
    const averaged = 0.5 * (out[n - lineLength]! + (n - lineLength - 1 >= 0 ? out[n - lineLength - 1]! : 0));
    const filtered = coefficient * averaged + previousInput - coefficient * previousOutput;
    previousInput = averaged;
    previousOutput = filtered;
    out[n] = LOOP_GAIN * filtered;
  }

  const tail = Math.min(length, Math.round(TAIL_SECONDS * sampleRate));
  for (let i = 0; i < tail; i++) out[length - 1 - i] = out[length - 1 - i]! * (i / tail);

  let peak = 0;
  for (const value of out) peak = Math.max(peak, Math.abs(value));
  if (peak > 0) for (let n = 0; n < length; n++) out[n] = (out[n]! * PEAK) / peak;
  return out;
}
