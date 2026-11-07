import { rootStrings, voicingFeatures, type Voicing } from "@shirabe-chord/core";
import { displaySymbol } from "./display-symbol.ts";

/** 図に描くフレットの数。 */
const FRET_COLUMNS = 5;
const STRING_COUNT = 6;

// 図の寸法（SVG の座標）。ナットが左、1弦が上。
const NUT_X = 40;
const FRET_GAP = 28;
const TOP = 14;
const STRING_GAP = 16;
const MARK_X = 22;
const DOT_RADIUS = 6;
/** ルートの印の寸法。角を少し丸めた四角（押さえる丸よりわずかに小さい）、セーハの中に重ねる小さな四角、開放の内側の丸。 */
const ROOT_SQUARE = DOT_RADIUS * 2 - 1;
const ROOT_OVERLAY = 7;
const OPEN_RADIUS = 5;
const ROOT_RING_RADIUS = 2;
const WIDTH = NUT_X + FRET_GAP * FRET_COLUMNS + 8;
const STRINGS_BOTTOM = TOP + STRING_GAP * (STRING_COUNT - 1);
const NUMBER_Y = STRINGS_BOTTOM + 16;
const HEIGHT = NUMBER_Y + 6;

/** 弦の番号（0 が 6弦 → 6、5 が 1弦 → 1）。 */
const stringNumber = (i: number) => STRING_COUNT - i;
/** 弦 n（1弦が上）の y 座標。 */
const stringY = (n: number) => TOP + STRING_GAP * (n - 1);
/** 左から cell 番目（1 始まり）の枠の中央の x 座標。 */
const cellX = (cell: number) => NUT_X + FRET_GAP * (cell - 0.5);

/** ポジションマークの位置。フレット → 弦の組（a と b の間）。 */
const INLAYS: Record<number, [number, number][]> = {
  3: [[3, 4]],
  5: [[3, 4]],
  7: [[3, 4]],
  9: [[3, 4]],
  12: [
    [2, 3],
    [4, 5],
  ],
  15: [[3, 4]],
  17: [[3, 4]],
  19: [[3, 4]],
};

const pressedFrets = (voicing: Voicing) =>
  voicing.filter((fret): fret is number => fret !== null && fret > 0);

const lowestOf = (voicing: Voicing) => Math.min(...pressedFrets(voicing));

/** 図の左端のフレット。押さえる最大が 5 以下なら 1、それ以外は押さえる最小。押さえるフレットが無ければ 1。 */
export function startFretOf(voicing: Voicing): number {
  const pressed = pressedFrets(voicing);
  if (pressed.length === 0 || Math.max(...pressed) <= FRET_COLUMNS) return 1;
  return Math.min(...pressed);
}

/** 押さえ方の文字列。例 `x32010`。ミュートは x。2 桁のフレットを含むときだけ `-` で区切る。 */
export function voicingFrets(voicing: Voicing): string {
  const frets = voicing.map((fret) => (fret === null ? "x" : String(fret)));
  const separator = voicing.some((fret) => fret !== null && fret >= 10) ? "-" : "";
  return frets.join(separator);
}

/** 読み上げ用のラベル。例 `C: x32010`。 */
export function voicingLabel(symbol: string, voicing: Voicing): string {
  return `${displaySymbol(symbol)}: ${voicingFrets(voicing)}`;
}

/** セーハの縦棒の範囲。成り立たないときは undefined。 */
function barreOf(voicing: Voicing, startFret: number) {
  if (!voicingFeatures(voicing).hasBarre) return undefined;
  const lowest = lowestOf(voicing);
  const indices = voicing.flatMap((fret, i) => (fret === lowest ? [i] : []));
  return { from: indices[0]!, to: indices[indices.length - 1]!, cell: lowest - startFret + 1 };
}

/** `hideCaption` は、見出しの記号が隣にもあるとき（カード）に重複を避けるためのもの。図のラベルは残る。 */
export function VoicingDiagram({
  symbol,
  voicing,
  hideCaption = false,
}: {
  symbol: string;
  voicing: Voicing;
  hideCaption?: boolean;
}) {
  const startFret = startFretOf(voicing);
  const barre = barreOf(voicing, startFret);
  const rootSet = new Set(rootStrings(symbol, voicing));
  const cells = Array.from({ length: FRET_COLUMNS }, (_, k) => k + 1);

  return (
    <figure className="diagram">
      {!hideCaption && <figcaption>{displaySymbol(symbol)}</figcaption>}
      <svg
        role="img"
        aria-label={voicingLabel(symbol, voicing)}
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        stroke="currentColor"
        fill="none"
      >
        {/* フレットの縦線。開始フレットが 1 のときは、左端（ナット）を太くする。 */}
        {Array.from({ length: FRET_COLUMNS + 1 }, (_, k) => {
          const isNut = k === 0 && startFret === 1;
          return (
            <line
              key={k}
              data-mark={isNut ? "nut" : undefined}
              x1={NUT_X + FRET_GAP * k}
              x2={NUT_X + FRET_GAP * k}
              y1={stringY(1)}
              y2={stringY(STRING_COUNT)}
              strokeWidth={isNut ? 4 : 1}
            />
          );
        })}
        {Array.from({ length: STRING_COUNT }, (_, i) => (
          <line
            key={i}
            x1={NUT_X}
            x2={NUT_X + FRET_GAP * FRET_COLUMNS}
            y1={stringY(i + 1)}
            y2={stringY(i + 1)}
          />
        ))}
        {/* ポジションマーク。押さえる丸やセーハの下になるよう先に描く。 */}
        {cells.flatMap((cell) =>
          (INLAYS[startFret + cell - 1] ?? []).map(([a, b]) => (
            <circle
              key={`${cell}-${a}`}
              data-mark="inlay"
              data-fret={startFret + cell - 1}
              data-between-strings={`${a}-${b}`}
              aria-hidden="true"
              cx={cellX(cell)}
              cy={(stringY(a) + stringY(b)) / 2}
              r={DOT_RADIUS - 1}
              fill="currentColor"
              fillOpacity={0.15}
              stroke="none"
            />
          )),
        )}
        {cells.map((cell) => (
          <text
            key={cell}
            data-mark="fret-number"
            x={cellX(cell)}
            y={NUMBER_Y}
            textAnchor="middle"
            fontSize="11"
            fill="currentColor"
            stroke="none"
          >
            {startFret + cell - 1}
          </text>
        ))}
        {barre && (
          <rect
            data-mark="barre"
            data-cell={barre.cell}
            data-from-string={stringNumber(barre.from)}
            data-to-string={stringNumber(barre.to)}
            x={cellX(barre.cell) - DOT_RADIUS}
            y={stringY(stringNumber(barre.to)) - DOT_RADIUS}
            width={DOT_RADIUS * 2}
            height={stringY(stringNumber(barre.from)) - stringY(stringNumber(barre.to)) + DOT_RADIUS * 2}
            rx={DOT_RADIUS}
            fill="currentColor"
            stroke="none"
          />
        )}
        {voicing.map((fret, i) => {
          const string = stringNumber(i);
          const y = stringY(string);
          if (fret === null) {
            return (
              <path
                key={i}
                data-mark="mute"
                data-string={string}
                data-x={MARK_X}
                d={`M${MARK_X - 5} ${y - 5}L${MARK_X + 5} ${y + 5}M${MARK_X + 5} ${y - 5}L${MARK_X - 5} ${y + 5}`}
              />
            );
          }
          const isRoot = rootSet.has(string);
          const rootAttr = isRoot ? { "data-root": "true" } : {};
          if (fret === 0) {
            return (
              <g key={i}>
                <circle data-mark="open" data-string={string} {...rootAttr} cx={MARK_X} cy={y} r={OPEN_RADIUS} />
                {isRoot && (
                  <circle
                    data-mark="root-ring"
                    data-string={string}
                    aria-hidden="true"
                    cx={MARK_X}
                    cy={y}
                    r={ROOT_RING_RADIUS}
                  />
                )}
              </g>
            );
          }
          const cell = fret - startFret + 1;
          const x = cellX(cell);
          // 棒の外のルートは丸を四角に置き換える。棒の中は丸を残し、上に小さな四角を重ねる（下の overlay）。
          if (isRoot && !(barre && fret === lowestOf(voicing))) {
            return (
              <rect
                key={i}
                data-mark="dot"
                data-string={string}
                data-cell={cell}
                {...rootAttr}
                x={x - ROOT_SQUARE / 2}
                y={y - ROOT_SQUARE / 2}
                width={ROOT_SQUARE}
                height={ROOT_SQUARE}
                rx={2}
                fill="currentColor"
                stroke="none"
              />
            );
          }
          return (
            <circle
              key={i}
              data-mark="dot"
              data-string={string}
              data-cell={cell}
              {...rootAttr}
              cx={x}
              cy={y}
              r={DOT_RADIUS}
              fill="currentColor"
              stroke="none"
            />
          );
        })}
        {/* セーハの棒の中のルート。背景色の縁取りで棒と区別する。棒と丸より後に描く。 */}
        {barre &&
          voicing.flatMap((fret, i) => {
            const string = stringNumber(i);
            if (fret !== lowestOf(voicing) || !rootSet.has(string)) return [];
            return (
              <rect
                key={`overlay-${i}`}
                data-mark="root-overlay"
                data-string={string}
                aria-hidden="true"
                x={cellX(barre.cell) - ROOT_OVERLAY / 2}
                y={stringY(string) - ROOT_OVERLAY / 2}
                width={ROOT_OVERLAY}
                height={ROOT_OVERLAY}
                rx={1.5}
                fill="currentColor"
                strokeWidth={1.5}
                style={{ stroke: "var(--surface)" }}
              />
            );
          })}
      </svg>
    </figure>
  );
}
