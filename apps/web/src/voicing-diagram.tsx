import { fingering, rootStrings, type Voicing } from "@shirabe-chord/core";
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
/** 押さえる丸の半径。指番号を出すとき（`showFingers`）は、数字が読めるよう少し大きくする。 */
const DOT_RADIUS = 6;
const FINGER_DOT_RADIUS = 7;
/** ポジションマークの半径（押さえる丸の大きさによらず一定）。 */
const INLAY_RADIUS = DOT_RADIUS - 1;
/** 指番号の文字の大きさ。 */
const FINGER_FONT_SIZE = 10;
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

/** セーハの縦棒の範囲。成り立たないときは undefined。`hasBarre` でなく、指番号の規則（`fingering`）の結果に合わせる。 */
function barreOf(voicing: Voicing, startFret: number) {
  const barre = fingering(voicing).barre;
  return barre && { from: barre.from, to: barre.to, fret: barre.fret, cell: barre.fret - startFret + 1 };
}

/** `hideCaption` は、見出しの記号が隣にもあるとき（カード）に重複を避けるためのもの。図のラベルは残る。 */
export function VoicingDiagram({
  symbol,
  voicing,
  hideCaption = false,
  showFingers = false,
}: {
  symbol: string;
  voicing: Voicing;
  hideCaption?: boolean;
  /** 押さえる点に指番号を出す（docs/adr/0039）。セーハは棒の端（最も低い弦）に 1 を 1 か所だけ。 */
  showFingers?: boolean;
}) {
  const dotRadius = showFingers ? FINGER_DOT_RADIUS : DOT_RADIUS;
  // ルートの印。角を少し丸めた四角（押さえる丸よりわずかに小さい）と、セーハの中に重ねる小さな四角。
  const rootSquare = dotRadius * 2 - 1;
  const rootOverlay = showFingers ? 10 : 7;
  const { byString } = fingering(voicing);
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
              r={INLAY_RADIUS}
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
            x={cellX(barre.cell) - dotRadius}
            y={stringY(stringNumber(barre.to)) - dotRadius}
            width={dotRadius * 2}
            height={stringY(stringNumber(barre.from)) - stringY(stringNumber(barre.to)) + dotRadius * 2}
            rx={dotRadius}
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
          if (isRoot && !(barre && fret === barre.fret)) {
            return (
              <rect
                key={i}
                data-mark="dot"
                data-string={string}
                data-cell={cell}
                {...rootAttr}
                x={x - rootSquare / 2}
                y={y - rootSquare / 2}
                width={rootSquare}
                height={rootSquare}
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
              r={dotRadius}
              fill="currentColor"
              stroke="none"
            />
          );
        })}
        {/* セーハの棒の中のルート。背景色の縁取りで棒と区別する。棒と丸より後に描く。 */}
        {barre &&
          voicing.flatMap((fret, i) => {
            const string = stringNumber(i);
            if (fret !== barre.fret || !rootSet.has(string)) return [];
            return (
              <rect
                key={`overlay-${i}`}
                data-mark="root-overlay"
                data-string={string}
                aria-hidden="true"
                x={cellX(barre.cell) - rootOverlay / 2}
                y={stringY(string) - rootOverlay / 2}
                width={rootOverlay}
                height={rootOverlay}
                rx={1.5}
                fill="currentColor"
                strokeWidth={1.5}
                style={{ stroke: "var(--surface)" }}
              />
            );
          })}
        {/* 指番号。点・棒・ルートの印より後に描き、背景色の文字で重ねる。セーハは棒の端（最も低い弦）の 1 か所だけ。 */}
        {showFingers &&
          voicing.flatMap((fret, i) => {
            const finger = byString[i];
            if (finger === null || finger === undefined || fret === null) return [];
            if (barre && fret === barre.fret && i !== barre.from) return [];
            return (
              <text
                key={`finger-${i}`}
                data-mark="finger"
                data-string={stringNumber(i)}
                aria-hidden="true"
                x={cellX(fret - startFret + 1)}
                y={stringY(stringNumber(i))}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={FINGER_FONT_SIZE}
                fontWeight={700}
                stroke="none"
                style={{ fill: "var(--surface)" }}
              >
                {finger}
              </text>
            );
          })}
      </svg>
    </figure>
  );
}
