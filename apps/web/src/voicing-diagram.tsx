import { voicingFeatures, type Voicing } from "@shirabe-chord/core";

/** 図に描くフレットの数。 */
const FRET_ROWS = 5;
const STRING_COUNT = 6;

// 図の寸法（SVG の座標）。
const LEFT = 34;
const STRING_GAP = 16;
const TOP = 36;
const FRET_GAP = 20;
const MARK_Y = 22;
const DOT_RADIUS = 6;
const WIDTH = LEFT + STRING_GAP * (STRING_COUNT - 1) + 22;
const HEIGHT = TOP + FRET_GAP * FRET_ROWS + 8;

/** 左から i 番目の弦（0 が 6弦）の x 座標。 */
const stringX = (i: number) => LEFT + STRING_GAP * i;
/** 弦の番号（6弦〜1弦）。 */
const stringNumber = (i: number) => STRING_COUNT - i;
const rowY = (row: number) => TOP + FRET_GAP * (row - 0.5);

const pressedFrets = (voicing: Voicing) =>
  voicing.filter((fret): fret is number => fret !== null && fret > 0);

/** 図の一番上のフレット。押さえる最大が 5 以下なら 1、それ以外は押さえる最小。押さえるフレットが無ければ 1。 */
export function startFretOf(voicing: Voicing): number {
  const pressed = pressedFrets(voicing);
  if (pressed.length === 0 || Math.max(...pressed) <= FRET_ROWS) return 1;
  return Math.min(...pressed);
}

/** 読み上げ用のラベル。例 `C: x32010`。2 桁のフレットを含むときだけ `-` で区切る。 */
export function voicingLabel(symbol: string, voicing: Voicing): string {
  const frets = voicing.map((fret) => (fret === null ? "x" : String(fret)));
  const separator = voicing.some((fret) => fret !== null && fret >= 10) ? "-" : "";
  return `${symbol}: ${frets.join(separator)}`;
}

/** セーハの横棒の範囲。成り立たないときは undefined。 */
function barreOf(voicing: Voicing, startFret: number) {
  if (!voicingFeatures(voicing).hasBarre) return undefined;
  const lowest = Math.min(...pressedFrets(voicing));
  const indices = voicing.flatMap((fret, i) => (fret === lowest ? [i] : []));
  return { from: indices[0]!, to: indices[indices.length - 1]!, row: lowest - startFret + 1 };
}

export function VoicingDiagram({ symbol, voicing }: { symbol: string; voicing: Voicing }) {
  const startFret = startFretOf(voicing);
  const barre = barreOf(voicing, startFret);

  return (
    <figure className="diagram">
      <figcaption>{symbol}</figcaption>
      <svg
        role="img"
        aria-label={voicingLabel(symbol, voicing)}
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        stroke="currentColor"
        fill="none"
      >
        {/* フレットの横線。開始フレットが 1 のときは、一番上（ナット）を太くする。 */}
        {Array.from({ length: FRET_ROWS + 1 }, (_, k) => (
          <line
            key={k}
            x1={stringX(0)}
            x2={stringX(STRING_COUNT - 1)}
            y1={TOP + FRET_GAP * k}
            y2={TOP + FRET_GAP * k}
            strokeWidth={k === 0 && startFret === 1 ? 4 : 1}
          />
        ))}
        {Array.from({ length: STRING_COUNT }, (_, i) => (
          <line key={i} x1={stringX(i)} x2={stringX(i)} y1={TOP} y2={TOP + FRET_GAP * FRET_ROWS} />
        ))}
        {startFret > 1 && (
          <text x={LEFT - 8} y={rowY(1) + 4} textAnchor="end" fontSize="12" fill="currentColor" stroke="none">
            {`${startFret}fr`}
          </text>
        )}
        {barre && (
          <rect
            data-mark="barre"
            data-row={barre.row}
            data-from-string={stringNumber(barre.from)}
            data-to-string={stringNumber(barre.to)}
            x={stringX(barre.from) - DOT_RADIUS}
            y={rowY(barre.row) - DOT_RADIUS}
            width={stringX(barre.to) - stringX(barre.from) + DOT_RADIUS * 2}
            height={DOT_RADIUS * 2}
            rx={DOT_RADIUS}
            fill="currentColor"
            stroke="none"
          />
        )}
        {voicing.map((fret, i) => {
          const x = stringX(i);
          const string = stringNumber(i);
          if (fret === null) {
            return (
              <path
                key={i}
                data-mark="mute"
                data-string={string}
                d={`M${x - 5} ${MARK_Y - 5}L${x + 5} ${MARK_Y + 5}M${x + 5} ${MARK_Y - 5}L${x - 5} ${MARK_Y + 5}`}
              />
            );
          }
          if (fret === 0) {
            return <circle key={i} data-mark="open" data-string={string} cx={x} cy={MARK_Y} r={5} />;
          }
          const row = fret - startFret + 1;
          return (
            <circle
              key={i}
              data-mark="dot"
              data-string={string}
              data-row={row}
              cx={x}
              cy={rowY(row)}
              r={DOT_RADIUS}
              fill="currentColor"
              stroke="none"
            />
          );
        })}
      </svg>
    </figure>
  );
}
