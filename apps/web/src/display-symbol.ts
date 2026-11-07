/** 内部の記号の b・# を、譜面の ♭・♯ に直す（音名・テンション・種類に使う。種類の名前は b・# を含まない前提）。 */
const flatSharp = (text: string) => text.replace(/b/g, "♭").replace(/#/g, "♯");

const SYMBOL = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/;

/**
 * 画面に出す記号にする。コアに渡す内部の記号は変えず、表示だけを日本の譜面の流儀にそろえる（ADR 0016 の文法は不変）。
 * 読めない文字列はそのまま返す（失敗メッセージにも通すため）。
 */
export function displaySymbol(symbol: string): string {
  const match = SYMBOL.exec(symbol);
  if (!match) return symbol;
  const [, root, rootAccidental, rest, bass, bassAccidental] = match;
  const quality = flatSharp(rest!.replace(/^m7-5/, "m7(b5)"));
  const onChord = bass ? `/${bass}${flatSharp(bassAccidental!)}` : "";
  return `${root}${flatSharp(rootAccidental!)}${quality}${onChord}`;
}

/** 種類の選択肢の表示。空文字（三和音）は M。 */
export function displayQuality(name: string): string {
  return name === "" ? "M" : displaySymbol(`C${name}`).slice(1);
}

/** テンションの選択肢の表示。 */
export const displayTension = flatSharp;
