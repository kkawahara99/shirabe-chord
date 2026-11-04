import type { Shape } from "@shirabe-chord/core";
import { useRef } from "react";
import { VoicingDiagram } from "./voicing-diagram.tsx";

/**
 * 最初のコードの押さえ方を、最低フレットごとの代表の図から選ぶ。`pickedIndex` は選んだ `Shape` の `candidateIndex`
 * で、`null` が「おまかせ」。
 */
export function ShapePicker(props: {
  symbol: string;
  shapes: readonly Shape[];
  pickedIndex: number | null;
  onPick: (shape: Shape | null) => void;
}) {
  const { symbol, shapes, pickedIndex, onPick } = props;
  const scroller = useRef<HTMLDivElement>(null);

  /** 1 枚ぶんスクロールする。1 枚の幅は、隣り合うカードの左端の差（間隔を含む）。 */
  const scrollByCard = (direction: 1 | -1) => {
    const element = scroller.current;
    if (!element) return;
    const [first, second] = Array.from(element.querySelectorAll<HTMLElement>("li"));
    const step = first && second ? second.offsetLeft - first.offsetLeft : (first?.offsetWidth ?? 0);
    element.scrollBy?.({ left: direction * step, behavior: "smooth" }); // jsdom には scrollBy が無い
  };

  return (
    <section aria-labelledby="picker-title">
      <h2 id="picker-title">最初のコードの押さえ方</h2>
      <button type="button" aria-pressed={pickedIndex === null} onClick={() => onPick(null)}>
        おまかせ（押さえ方を自動で選ぶ）
      </button>
      <div className="shape-nav">
        <button type="button" aria-label="前の押さえ方へスクロール" onClick={() => scrollByCard(-1)}>
          ←
        </button>
        <button type="button" aria-label="次の押さえ方へスクロール" onClick={() => scrollByCard(1)}>
          →
        </button>
      </div>
      <div ref={scroller} role="group" aria-label="最初のコードの押さえ方の候補" tabIndex={0} className="shapes">
        <ul>
          {shapes.map((shape) => (
            <li key={shape.candidateIndex} className="shape-card">
              <p>{shape.lowestFret}フレット付近</p>
              <VoicingDiagram symbol={symbol} voicing={shape.voicing} />
              <button
                type="button"
                aria-pressed={pickedIndex === shape.candidateIndex}
                onClick={() => onPick(shape)}
              >
                この押さえ方にする
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
