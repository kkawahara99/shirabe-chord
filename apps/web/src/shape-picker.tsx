import type { Shape } from "@shirabe-chord/core";
import { VoicingDiagram } from "./voicing-diagram.tsx";

/**
 * 選んでいるコードの押さえ方を、最低フレットごとの代表の図から選ぶ。図は並べ、カードのどこを押しても選べる。並べた図は、置かれた場所（編集パネル）の縦スクロールで見る。
 * `pickedIndex` は選んだ `Shape` の `candidateIndex` で、`null` が「おまかせ」。
 */
export function ShapePicker(props: {
  symbol: string;
  shapes: readonly Shape[];
  pickedIndex: number | null;
  onPick: (shape: Shape | null) => void;
}) {
  const { symbol, shapes, pickedIndex, onPick } = props;

  return (
    <section aria-labelledby="picker-title">
      <h2 id="picker-title">押さえ方</h2>
      <button type="button" aria-pressed={pickedIndex === null} onClick={() => onPick(null)}>
        おまかせ（押さえ方を自動で選ぶ）
      </button>
      <div role="group" aria-label="押さえ方の候補" className="shapes">
        <ul>
          {shapes.map((shape) => (
            <li key={shape.candidateIndex} className="shape-card">
              <button
                type="button"
                className="shape-select"
                aria-pressed={pickedIndex === shape.candidateIndex}
                onClick={() => onPick(shape)}
              >
                第{shape.lowestFret}ポジション
              </button>
              <VoicingDiagram symbol={symbol} voicing={shape.voicing} hideCaption />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
