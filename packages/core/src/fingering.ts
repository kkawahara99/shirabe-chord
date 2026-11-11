import { voicingFeatures, type Voicing } from "./voicing.ts";

/** セーハの範囲。`from`・`to` は押さえ方の添字（0 が 6弦、`from` < `to`）。 */
export type Barre = {
  readonly fret: number;
  readonly from: number;
  readonly to: number;
};

export type Fingering = {
  /** 弦ごとの指番号（6弦から1弦の順）。押さえない弦（開放・ミュート）は null。 */
  readonly byString: readonly (number | null)[];
  /** セーハにする弦の範囲。成り立たないときは undefined。 */
  readonly barre: Barre | undefined;
};

/**
 * 弦ごとの指番号を決める。規則は docs/adr/0039-assign-fingers-by-a-fixed-rule.md。
 * 押さえるフレット（開放・ミュートを除く）の弦を、フレットの低い順、同じフレットなら低音側の弦から順に 1 から振る。
 * セーハ（最も低いフレットの弦をまとめる）は人差し指（1）にする。形は検査せず、どんな入力でも例外を投げない。
 */
export function fingering(voicing: Voicing): Fingering {
  const pressed = voicing.flatMap((fret, string) => (fret !== null && fret > 0 ? [{ fret, string }] : []));
  const byString: (number | null)[] = voicing.map(() => null);
  if (pressed.length === 0) return { byString, barre: undefined };

  const lowest = Math.min(...pressed.map(({ fret }) => fret));
  const lowStrings = pressed.filter(({ fret }) => fret === lowest).map(({ string }) => string);
  const barre: Barre | undefined =
    voicingFeatures(voicing).hasBarre && !isSplitBarre(voicing, pressed.length, lowest, lowStrings)
      ? { fret: lowest, from: lowStrings[0]!, to: lowStrings[lowStrings.length - 1]! }
      : undefined;

  let finger = 0;
  let previousFret: number | undefined;
  for (const { fret, string } of [...pressed].sort((a, b) => a.fret - b.fret || a.string - b.string)) {
    // セーハの弦（最も低いフレットの弦）は、最初の 1 本で番号を進め、残りは同じ番号にする。
    if (!(barre !== undefined && fret === lowest && previousFret === lowest)) finger++;
    byString[string] = finger;
    previousFret = fret;
  }
  return { byString, barre };
}

/**
 * D の xx0232 の配置。`hasBarre` が真でも、人差し指でまとめず別の指で押さえる（標準の運指は 1・3・2）。
 * 押さえる弦がちょうど 3 本で、最も低いフレットの弦がちょうど 2 本、その 2 本の間が 1 本だけで、
 * それが最も低いフレットのちょうど 1 つ上のフレットの弦。
 */
function isSplitBarre(
  voicing: Voicing,
  pressedCount: number,
  lowest: number,
  lowStrings: readonly number[],
): boolean {
  if (pressedCount !== 3 || lowStrings.length !== 2) return false;
  const between = voicing.slice(lowStrings[0]! + 1, lowStrings[1]!);
  return between.length === 1 && between[0] === lowest + 1;
}
