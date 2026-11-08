import { describe, expect, it } from "vitest";
import { parseRoute } from "./route.ts";

const ID = "AbCdEfGhIjKlMnOpQrSt-_"; // 22 字

describe("parseRoute", () => {
  it("/ はトップ", () => {
    expect(parseRoute("/")).toEqual({ kind: "home" });
  });

  it("/mine は自分の共有の一覧", () => {
    expect(parseRoute("/mine")).toEqual({ kind: "mine" });
    expect(parseRoute("/mine/")).toEqual({ kind: "mine" });
  });

  it("/s/<22字の共有ID> は共有ページ", () => {
    expect(parseRoute(`/s/${ID}`)).toEqual({ kind: "share", id: ID });
  });

  it.each([
    ["短い ID", "/s/abc"],
    ["長い ID", `/s/${ID}x`],
    ["使えない文字を含む ID", `/s/${ID.slice(0, 21)}!`],
    ["ID が無い", "/s/"],
    ["さらに深いパス", `/s/${ID}/edit`],
    ["未知のパス", "/admin"],
    ["空文字", ""],
  ])("%s はトップ", (_name, path) => {
    expect(parseRoute(path)).toEqual({ kind: "home" });
  });
});
