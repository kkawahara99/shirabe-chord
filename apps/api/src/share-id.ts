// 共有 ID は閲覧の鍵。推測できないことだけで守るので、128 ビットの乱数にする（ADR 0035）。
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** 16 バイト（128 ビット）の乱数を base64url にした 22 文字。 */
export function newShareId(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
}

export function isShareId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}
