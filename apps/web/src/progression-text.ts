import type { ProgressionStep } from "@shirabe-chord/core";
import { displaySymbol } from "./display-symbol.ts";
import { voicingFrets } from "./voicing-diagram.tsx";

/** 手の位置の表示。`lowestFret` が `null` は「おまかせ」。画面のボタンとコピーのテキストで共通。 */
export const handPositionLabel = (lowestFret: number | null) =>
  lowestFret === null ? "おまかせ" : `第${lowestFret}ポジション`;

/** ギター担当に渡すための、押さえ方の一覧のテキスト。先頭に手の位置、続いて1コード1行。 */
export function progressionText(handPosition: number | null, steps: readonly ProgressionStep[]): string {
  const lines = steps.map(
    (step, i) =>
      `${i + 1}. ${displaySymbol(step.symbol)}  ${voicingFrets(step.voicing)}` +
      (step.inWindow === false ? " （手の位置から外れた押さえ方）" : ""),
  );
  return [`手の位置：${handPositionLabel(handPosition)}`, ...lines].join("\n");
}
