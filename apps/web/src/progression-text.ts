import type { ProgressionStep } from "@shirabe-chord/core";
import { displaySymbol } from "./display-symbol.ts";
import { voicingFrets } from "./voicing-diagram.tsx";

/** 手の位置の表示。`lowestFret` が `null` は「おまかせ」。画面のボタンとコピーのテキストで共通。 */
export const handPositionLabel = (lowestFret: number | null) =>
  lowestFret === null ? "おまかせ" : `第${lowestFret}ポジション`;

/** カポを付けているとき。`played` は各コードの鳴らす名前（`steps` の記号は押さえる形の名前）。 */
export type CapoInfo = { readonly fret: number; readonly played: readonly string[] };

/** ギター担当に渡すための、押さえ方の一覧のテキスト。先頭にカポ（付けているときだけ）と手の位置、続いて1コード1行。 */
export function progressionText(
  handPosition: number | null,
  steps: readonly ProgressionStep[],
  capo?: CapoInfo,
): string {
  const lines = steps.map((step, i) => {
    const name = capo
      ? `${displaySymbol(capo.played[i]!)} （${displaySymbol(step.symbol)}の形）`
      : displaySymbol(step.symbol);
    return (
      `${i + 1}. ${name}  ${voicingFrets(step.voicing)}` +
      (step.inWindow === false ? " （手の位置から外れた押さえ方）" : "")
    );
  });
  return [...(capo ? [`カポ：${capo.fret}`] : []), `手の位置：${handPositionLabel(handPosition)}`, ...lines].join("\n");
}
