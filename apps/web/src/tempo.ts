export const DEFAULT_TEMPO = 90;
export const MIN_TEMPO = 40;
export const MAX_TEMPO = 200;

/** テンポの入力を、40〜200 の整数にする。空や数でないものは既定、小数は四捨五入、範囲外は近い方の端。 */
export function normalizeTempo(text: string): number {
  const trimmed = text.trim();
  const value = trimmed === "" ? NaN : Number(trimmed);
  if (!Number.isFinite(value)) return DEFAULT_TEMPO;
  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(value)));
}
