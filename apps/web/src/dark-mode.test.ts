import { describe, expect, it } from "vitest";
import css from "./style.css?raw";

// jsdom は prefers-color-scheme を評価しないので、CSS の文字列から変数を取り出して比べる。
// vitest は CSS を空にする（css.include の既定）ので、vite.config.ts で style.css だけ許している。

/** `start` の直後の `{` から対応する `}` までの中身。 */
const blockAfter = (source: string, start: number): string => {
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("括弧が閉じていない");
};

const darkQuery = /@media[^{]*prefers-color-scheme:\s*dark[^{]*/;
const darkAt = css.search(darkQuery);
// 無いときは空にして、例外ではなく各テストの失敗として示す。
const darkMedia = darkAt < 0 ? "" : blockAfter(css, darkAt);
const darkQueryText = css.slice(darkAt).match(darkQuery)?.[0] ?? "";
const darkRoot = darkMedia === "" ? "" : blockAfter(darkMedia, darkMedia.indexOf(":root"));
const lightRoot = blockAfter(css, css.indexOf(":root"));
const printAt = css.indexOf("@media print");
const printMedia = blockAfter(css, printAt);

const variables = (block: string): Record<string, string> =>
  Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1]!, m[2]!]),
  );

const light = variables(lightRoot);
const dark = variables(darkRoot);

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

const ratio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const textPairs: [string, string][] = [
  ["--text", "--bg"],
  ["--text", "--surface"],
  ["--text", "--accent-bg"], // 選んだカードの上のコード名
  ["--text-sub", "--bg"],
  ["--text-sub", "--surface"],
  ["--text-sub", "--accent-bg"],
  ["--accent", "--surface"],
  ["--accent", "--accent-bg"],
  ["--warn", "--surface"],
  ["--warn", "--bg"],
  ["--warn", "--accent-bg"],
  ["--on-accent", "--accent"],
];

describe("暗い配色", () => {
  it("OS が暗い配色のときだけ効く @media の :root に、color-scheme: dark がある", () => {
    expect(darkAt).toBeGreaterThanOrEqual(0);
    expect(darkRoot).toMatch(/color-scheme:\s*dark\s*;/);
  });

  it("暗い配色の @media は screen に限られ、印刷に及ばない", () => {
    expect(darkQueryText).toMatch(/\bscreen\b/);
    expect(printMedia).not.toContain("prefers-color-scheme");
  });

  it("ダークは、ライトと同じ変数名をすべて持つ（--on-accent を含む）", () => {
    expect(Object.keys(light)).toContain("--on-accent");
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it.each([
    ["ライト", light],
    ["ダーク", dark],
  ])("%s: 文字と背景の組み合わせの比が 4.5:1 以上", (_name, vars) => {
    for (const [fg, bg] of textPairs) {
      expect(ratio(vars[fg]!, vars[bg]!), `${fg} / ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ["ライト", light],
    ["ダーク", dark],
  ])("%s: 図の線（--text と --accent-bg）の比が 3:1 以上", (_name, vars) => {
    expect(ratio(vars["--text"]!, vars["--accent-bg"]!)).toBeGreaterThanOrEqual(3);
  });
});

describe("色の直書き", () => {
  it("@media print の中と影を除き、style.css に色の直書きが残らない", () => {
    const rest = css
      .replace(printMedia, "")
      .replace(darkMedia, "")
      .replace(lightRoot, "")
      .replace(/box-shadow:[^;]*;/g, "");
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rest).not.toMatch(/\brgba?\(/);
  });

  it("名前で書いた色（white・black）も、Google の G の白い丸（テーマで変えない公式の色の下地）以外には無い", () => {
    const rest = css
      .replace(printMedia, "")
      .replace(darkMedia, "")
      .replace(lightRoot, "")
      .replace(/(?:^|\n)\.google-mark \{[^}]*\}/, "");
    expect(rest).not.toMatch(/:\s*(?:white|black)\b/i);
  });

  it("押した状態のボタンの文字色は var(--on-accent) である", () => {
    const rule = css.match(/\nbutton\[aria-pressed="true"\]\s*\{[^}]*\}/)?.[0];
    expect(rule).toMatch(/color:\s*var\(--on-accent\)\s*;/);
  });
});
