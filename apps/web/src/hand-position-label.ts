/** 手の位置の表示。`lowestFret` が `null` は「おまかせ」。 */
export const handPositionLabel = (lowestFret: number | null) =>
  lowestFret === null ? "おまかせ" : `第${lowestFret}ポジション`;
