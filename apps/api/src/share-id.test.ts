import { describe, expect, it } from "vitest";
import { isShareId, newShareId } from "./share-id.ts";

describe("共有ID", () => {
  it("生成したIDは128ビット（22文字のURL安全な文字）で、形式の判定に合う", () => {
    const id = newShareId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(isShareId(id)).toBe(true);
  });

  it("1000回生成して重複しない", () => {
    expect(new Set(Array.from({ length: 1000 }, newShareId)).size).toBe(1000);
  });

  it("形式の判定は、不正な文字・長さ・型を落とす", () => {
    for (const value of ["", "a".repeat(21), "a".repeat(23), `${"a".repeat(21)}=`, `${"a".repeat(21)}/`, `${"a".repeat(21)}\n`, `${"a".repeat(21)}あ`, undefined, 123]) {
      expect(isShareId(value)).toBe(false);
    }
  });
});
