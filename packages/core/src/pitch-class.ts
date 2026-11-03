/** 音の高さを、オクターブを無視した 12 段階（半音単位）で表す。0 を C とする。 */
export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

const SEMITONES_PER_OCTAVE = 12;

/** 半音ずらす。正で上、負で下。12 で一周する。整数でない半音は RangeError。 */
export function transpose(pitchClass: PitchClass, semitones: number): PitchClass {
  if (!Number.isInteger(semitones)) {
    throw new RangeError(`半音は整数で指定する: ${semitones}`);
  }
  // 足す前に剰余を取る（2^53 を超える整数でも誤差を出さない）。
  // JS の % は負の値を負で返すので、足したあとにもう一度剰余を取る。
  const shifted =
    (((pitchClass + (semitones % SEMITONES_PER_OCTAVE)) % SEMITONES_PER_OCTAVE) +
      SEMITONES_PER_OCTAVE) %
    SEMITONES_PER_OCTAVE;
  return shifted as PitchClass;
}
