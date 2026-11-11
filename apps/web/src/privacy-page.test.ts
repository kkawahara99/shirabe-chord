import { describe, expect, it } from "vitest";
import cognitoTf from "../../../infra/app/cognito.tf?raw";
import sharingTf from "../../../infra/app/sharing.tf?raw";
import privacyCss from "../public/privacy.css?raw";
import privacyHtml from "../public/privacy.html?raw";
import styleCss from "./style.css?raw";

// privacy.html は Vite を通らない静的ページ。CSP（default-src 'self'）がインラインのスタイルとスクリプトを止める。
// 書いた内容の正本はコード（infra・apps）。食い違ったらページをコードに合わせる。

const publicFiles = import.meta.glob("../public/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** タグを除いた本文。 */
const text = privacyHtml
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<[^>]+>/g, "")
  .replace(/\s+/g, "");

describe("privacy.html の作り", () => {
  it("インラインのスタイルが無い（<style> も style=\"\" も無い）", () => {
    expect(privacyHtml).not.toMatch(/<style[\s>]/i);
    expect(privacyHtml).not.toMatch(/\sstyle\s*=/i);
  });

  it("スクリプトが無い（<script> も on…= も無い）", () => {
    expect(privacyHtml).not.toMatch(/<script[\s>]/i);
    expect(privacyHtml).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('<meta charset="UTF-8"> がある', () => {
    expect(privacyHtml).toMatch(/<meta\s+charset="UTF-8"\s*\/?>/i);
  });

  it("privacy.css を読み、そのファイルが public/ に実在する", () => {
    const href = privacyHtml.match(/<link\s[^>]*rel="stylesheet"[^>]*href="([^"]+)"/)?.[1];
    expect(href).toBe("/privacy.css");
    expect(publicFiles[`../public${href}`]).toBeDefined();
  });

  it('lang="ja"・viewport・title「プライバシーポリシー」がある', () => {
    expect(privacyHtml).toMatch(/<html\s[^>]*lang="ja"/);
    expect(privacyHtml).toMatch(/<meta\s+name="viewport"/);
    expect(privacyHtml).toMatch(/<title>[^<]*プライバシーポリシー[^<]*<\/title>/);
  });
});

describe("privacy.html の中身", () => {
  it("Google から受け取るのは openid だけで、メール・名前は持たないと書き、cognito.tf の scope も openid だけである", () => {
    expect(text).toContain("openid");
    expect(text).toMatch(/メール.*名前.*(受け取|持ち)/);
    const scopes = [...cognitoTf.matchAll(/(?:authorize_scopes|allowed_oauth_scopes)\s*=\s*(.+)/g)].map((m) => m[1]!.replace(/[\s[\]"]/g, ""));
    expect(scopes.length).toBeGreaterThanOrEqual(2);
    expect(scopes.every((scope) => scope === "openid")).toBe(true);
  });

  it("Cognito のユーザーに残るのは、Google の識別子（ユーザー名）と sub", () => {
    expect(text).toContain("Cognito");
    expect(text).toContain("ユーザー名");
    expect(text).toContain("sub");
  });

  it("共有ごとに保存するもの（譜面・カポ・タイトル・ひと言・表示名・作成日時・持ち主の識別子）を挙げる", () => {
    for (const word of ["譜面", "カポ", "タイトル", "ひと言", "表示名", "作成日時", "持ち主"]) expect(text).toContain(word);
  });

  it("URL を知る人は誰でも見られ、本人が /mine から削除するまで残ると書く", () => {
    expect(text).toMatch(/URL.*知る人.*誰でも.*見られ/);
    expect(text).toContain("/mine");
    expect(text).toMatch(/削除するまで残/);
  });

  it("共有をすべて削除しても Cognito の記録は残り、消す手段は用意していないと書く", () => {
    expect(text).toMatch(/すべて削除して(も)?.*残/);
    expect(text).toMatch(/消す手段は(用意していません|ありません)/);
  });

  it("アクセスログは取らず、Lambda のログは sharing.tf の保持日数で消え、AWS・Google・Cloudflare が IP アドレスなどを記録しうると書く", () => {
    expect(text).toMatch(/CloudFront.*APIGateway.*アクセスログ.*取っていません/);
    const days = sharingTf.match(/retention_in_days\s*=\s*(\d+)/)?.[1];
    expect(days).toBeDefined();
    expect(text).toContain(`${days}日で消え`);
    expect(text).toMatch(/AWS.*Google.*Cloudflare.*IPアドレス/);
  });

  it("ログインのトークンと入力途中の譜面を sessionStorage に置くと書く", () => {
    expect(text).toContain("sessionStorage");
    expect(text).toContain("トークン");
    expect(text).toContain("入力途中の譜面");
  });

  it("画面で選んだ配色（ライトかダーク）を localStorage に置くと書く", () => {
    expect(text).toContain("localStorage");
    expect(text).toContain("配色");
  });

  it("使う外部サービス（Google のログイン・Cloudflare Turnstile・AWS）を挙げ、Turnstile は共有のダイアログを開いたときだけと書く", () => {
    expect(text).toContain("Googleのログイン");
    expect(text).toContain("CloudflareTurnstile");
    expect(text).toMatch(/共有のダイアログを開いたときだけ/);
    expect(text).toContain("AWS");
  });

  it("問い合わせ先を書かない（mailto もメールアドレスも無い）", () => {
    expect(privacyHtml).not.toMatch(/mailto:/i);
    expect(privacyHtml).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  });
});

// ---- privacy.css ----

const blockAfter = (source: string, start: number): string => {
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("括弧が閉じていない");
};

const variables = (block: string): Record<string, string> =>
  Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1]!, m[2]!]));

const darkQuery = /@media[^{]*prefers-color-scheme:\s*dark[^{]*/;
const rootsOf = (css: string) => {
  const darkAt = css.search(darkQuery);
  const darkMedia = darkAt < 0 ? "" : blockAfter(css, darkAt);
  return {
    darkAt,
    darkQueryText: css.slice(darkAt).match(darkQuery)?.[0] ?? "",
    darkMedia,
    lightRoot: blockAfter(css, css.indexOf(":root")),
    darkRoot: darkMedia === "" ? "" : blockAfter(darkMedia, darkMedia.indexOf(":root")),
  };
};
const mine = rootsOf(privacyCss);
const theirs = rootsOf(styleCss);

describe("privacy.css", () => {
  it("暗い配色は screen だけの @media にあり、使う色の変数は style.css と同じ名前・同じ値（比は dark-mode.test.ts が守る）", () => {
    expect(mine.darkAt).toBeGreaterThanOrEqual(0);
    expect(mine.darkQueryText).toMatch(/\bscreen\b/);
    expect(mine.darkRoot).toMatch(/color-scheme:\s*dark\s*;/);
    for (const [mineRoot, theirRoot] of [
      [mine.lightRoot, theirs.lightRoot],
      [mine.darkRoot, theirs.darkRoot],
    ] as const) {
      const used = variables(mineRoot);
      expect(Object.keys(used).length).toBeGreaterThan(0);
      for (const [name, value] of Object.entries(used)) expect(variables(theirRoot)[name], name).toBe(value);
    }
    expect(Object.keys(variables(mine.darkRoot)).sort()).toEqual(Object.keys(variables(mine.lightRoot)).sort());
  });

  it("色の直書きが無い（変数の定義と @media print を除く）", () => {
    const printAt = privacyCss.indexOf("@media print");
    const printMedia = printAt < 0 ? "" : blockAfter(privacyCss, printAt);
    const rest = privacyCss.replace(printMedia, "").replace(mine.darkMedia, "").replace(mine.lightRoot, "");
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rest).not.toMatch(/\brgba?\(/);
  });
});
